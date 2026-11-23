// @polsia:user-owned — permit detail edits stay team-owner and paid-access scoped.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { PermitDetailsPage as PermitDetailsPageSchema } from '@/lib/contracts/permit';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];
const subscriptionStateFiles: string[] = [];

async function signUp(page: Page, origin: string, label: string) {
  const email = `qa-${label}-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: `QA ${label}`, email, password },
  });
  expect(signup.status(), await signup.text()).toBe(200);

  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const userId = session.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not create a session user.');

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signin.status(), await signin.text()).toBe(200);
  fixtureUserIds.push(userId);
  return { userId, email };
}

async function signedInContext(browser: Browser, origin: string, label: string) {
  const context = await browser.newContext();
  fixtureContexts.push(context);
  const page = await context.newPage();
  const user = await signUp(page, origin, label);
  return { context, page, ...user };
}

async function setSubscriptionState(email: string, active: boolean) {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const path = `/tmp/polsia-subscription-state-${digest}.json`;
  subscriptionStateFiles.push(path);
  await writeFile(path, JSON.stringify({ active }), 'utf8');
}

async function createTeam(userId: string, name: string, role: string) {
  const team = await prisma.teamSpace.create({
    data: {
      name,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role } });
  return team;
}

async function markTeamPaid(teamId: string, userId: string) {
  await prisma.teamCheckout.create({
    data: {
      teamId,
      userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
}

async function createPermit(userId: string, teamId: string, suffix: string) {
  return prisma.permit.create({
    data: {
      userId,
      teamId,
      projectName: `QA Permit Details ${suffix}`,
      address: `${suffix} Original Street, Tampa`,
      permitNumber: `QA-${suffix.toUpperCase()}`,
      permitType: 'Building',
      status: 'Under review',
      notes: 'Team-maintained details.',
      portalUrl:
        'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=QA&agencyCode=TAMPA',
    },
  });
}

function detailUpdate(teamId: string, suffix: string) {
  return {
    teamId,
    permitNumber: `QA-${suffix.toUpperCase()}-UPDATED`,
    address: `${suffix} Updated Street, Tampa`,
  };
}

async function captureSavedDetails(page: Page, testInfo: TestInfo) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByText('QA-OWNER-UPDATED', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('definition').filter({ hasText: 'Owner Updated Street, Tampa' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`permit-details-saved-${viewport.name}.png`),
      fullPage: true,
    });
  }
}

function rgbChannels(color: string): number[] {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Could not read computed color: ${color}`);
  return channels;
}

function relativeLuminance(color: string): number {
  const channels = rgbChannels(color).slice(0, 3).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const red = channels[0] ?? 0;
  const green = channels[1] ?? 0;
  const blue = channels[2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function expectContrastRatio(locator: Locator) {
  const colors = await locator.evaluate((element) => {
    const backgrounds: string[] = [];
    let current: Element | null = element;
    while (current) {
      backgrounds.push(getComputedStyle(current).backgroundColor);
      current = current.parentElement;
    }
    backgrounds.push(getComputedStyle(document.body).backgroundColor);
    return { foreground: getComputedStyle(element).color, backgrounds };
  });
  const background = colors.backgrounds.find((color) => {
    const channels = rgbChannels(color);
    return channels.length < 4 || (channels[3] ?? 1) >= 1;
  });
  if (!background) throw new Error('Could not find an opaque background for the button label.');
  const foregroundLuminance = relativeLuminance(colors.foreground);
  const backgroundLuminance = relativeLuminance(background);
  const ratio =
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  if (fixtureTeamIds.length > 0) {
    await prisma.permit.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamCheckout.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamSpace.deleteMany({ where: { id: { in: fixtureTeamIds } } });
    fixtureTeamIds.length = 0;
  }
  if (fixtureUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    fixtureUserIds.length = 0;
  }
  await Promise.all(subscriptionStateFiles.map((path) => unlink(path).catch(() => undefined)));
  subscriptionStateFiles.length = 0;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('paid permit status timeline shows saved events oldest first and leaves portal history and notes unchanged', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'status-timeline-owner');
  const team = await createTeam(owner.userId, 'QA Status Timeline Team', 'owner');
  await markTeamPaid(team.id, owner.userId);
  await setSubscriptionState(owner.email, true);

  const permit = await createPermit(owner.userId, team.id, 'Timeline');
  const timelineEvents = [
    { status: 'Submitted', createdAt: new Date('2026-10-18T08:15:00.000Z') },
    { status: 'Corrections requested', createdAt: new Date('2026-10-20T14:30:00.000Z') },
    { status: 'Issued', createdAt: new Date('2026-10-23T09:45:00.000Z') },
  ] as const;
  for (const event of [...timelineEvents].reverse()) {
    await prisma.permitStatusEvent.create({
      data: { permitId: permit.id, status: event.status, createdAt: event.createdAt },
    });
  }

  const cityChecks = [
    {
      status: 'Plan Review',
      checkedAt: new Date('2026-10-24T08:00:00.000Z'),
      sourceFetchedAt: new Date('2026-10-24T07:59:00.000Z'),
    },
    {
      status: 'Finaled',
      checkedAt: new Date('2026-10-26T08:00:00.000Z'),
      sourceFetchedAt: new Date('2026-10-26T07:59:00.000Z'),
    },
  ] as const;
  for (const [index, check] of cityChecks.entries()) {
    await prisma.permitPortalStatusCheck.create({
      data: {
        permitId: permit.id,
        teamId: team.id,
        permitNumber: permit.permitNumber,
        sourceUrl: permit.portalUrl,
        status: check.status,
        result: 'checked',
        checkedAt: check.checkedAt,
        requestSequence: index + 1,
        sourceFetchedAt: check.sourceFetchedAt,
        redlineStatus: 'not connected',
        redlineResult: 'not_connected',
      },
    });
  }
  await prisma.permitTeamNote.create({
    data: {
      permitId: permit.id,
      teamId: team.id,
      authorUserId: owner.userId,
      body: 'Internal note: confirm the revised inspection window with the crew.',
    },
  });

  const emptyPermit = await createPermit(owner.userId, team.id, 'No History');
  const lockedTeam = await createTeam(owner.userId, 'QA Status Timeline Locked Team', 'owner');
  const lockedPermit = await createPermit(owner.userId, lockedTeam.id, 'Locked Timeline');

  const savedEventsBefore = await prisma.permitStatusEvent.findMany({
    where: { permitId: permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const cityChecksBefore = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id },
    orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
  });
  const teamNotesBefore = await prisma.permitTeamNote.findMany({
    where: { permitId: permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const paidDetailsResponse = await page.request.get(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}`,
  );
  expect(paidDetailsResponse.status()).toBe(200);
  const paidDetails = PermitDetailsPageSchema.parse(await paidDetailsResponse.json());
  expect(
    paidDetails.statusEvents.map((event) => ({ status: event.status, createdAt: event.createdAt })),
  ).toEqual(
    savedEventsBefore.map((event) => ({ status: event.status, createdAt: event.createdAt.toISOString() })),
  );

  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  const history = page.getByRole('region', { name: 'Status history' });
  const eventRows = history.getByRole('listitem');
  await expect(eventRows).toHaveCount(savedEventsBefore.length);
  for (const [index, event] of savedEventsBefore.entries()) {
    const row = eventRows.nth(index);
    await expect(row.getByText(event.status, { exact: true })).toBeVisible();
    const time = row.locator('time');
    const isoTime = event.createdAt.toISOString();
    await expect(time).toHaveAttribute('datetime', isoTime);
    const visibleTime = await page.evaluate(
      (value) =>
        new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value),
        ),
      isoTime,
    );
    await expect(time).toHaveText(visibleTime);
  }
  await expect(
    page.getByRole('region', { name: 'Latest verified City of Tampa portal result' }),
  ).toContainText('Finaled');
  await expect(
    page.getByText('Internal note: confirm the revised inspection window with the crew.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Team-maintained details.', { exact: true })).toBeVisible();

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(eventRows).toHaveCount(savedEventsBefore.length);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`status-timeline-${viewport.name}.png`),
      fullPage: true,
    });
  }

  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(emptyPermit.id)}`);
  const emptyHistory = page.getByRole('region', { name: 'Status history' });
  await expect(emptyHistory.getByText('No status changes have been recorded yet.')).toBeVisible();
  await expect(emptyHistory.getByRole('listitem')).toHaveCount(0);

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();
  const anonymousDetail = await anonymousPage.request.get(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}`,
  );
  expect(anonymousDetail.status()).toBe(401);
  expect(JSON.stringify(await anonymousDetail.json())).not.toContain(permit.projectName);
  await anonymousPage.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  await expect(anonymousPage).toHaveURL(/\/login/);
  await expect(anonymousPage.getByText(permit.projectName, { exact: true })).toHaveCount(0);

  const outsiderContext = await browser.newContext();
  fixtureContexts.push(outsiderContext);
  const outsiderPage = await outsiderContext.newPage();
  await signUp(outsiderPage, origin, 'status-timeline-outsider');
  const nonmemberDetail = await outsiderPage.request.get(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}`,
  );
  expect(nonmemberDetail.status()).toBe(403);
  expect(JSON.stringify(await nonmemberDetail.json())).not.toContain(permit.projectName);
  await outsiderPage.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  await expect(outsiderPage.getByRole('heading', { name: 'Permit unavailable' })).toBeVisible();
  await expect(outsiderPage.getByText(permit.projectName, { exact: true })).toHaveCount(0);

  const lockedDetail = await page.request.get(
    `${origin}/api/permits/${encodeURIComponent(lockedPermit.id)}`,
  );
  expect(lockedDetail.status()).toBe(402);
  expect(await lockedDetail.json()).toMatchObject({
    error: 'team_subscription_required',
    paymentStatus: 'unpaid',
  });
  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(lockedPermit.id)}`);
  await expect(page.getByRole('heading', { name: 'Permit unavailable' })).toBeVisible();
  await expect(page.getByText(lockedPermit.projectName, { exact: true })).toHaveCount(0);

  expect(
    await prisma.permitStatusEvent.findMany({
      where: { permitId: permit.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ).toEqual(savedEventsBefore);
  expect(
    await prisma.permitPortalStatusCheck.findMany({
      where: { permitId: permit.id },
      orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
    }),
  ).toEqual(cityChecksBefore);
  expect(
    await prisma.permitTeamNote.findMany({
      where: { permitId: permit.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ).toEqual(teamNotesBefore);
  const savedPermitAfterRead = await prisma.permit.findUniqueOrThrow({ where: { id: permit.id } });
  expect(savedPermitAfterRead).toMatchObject({
    status: permit.status,
    notes: permit.notes,
    portalUrl: permit.portalUrl,
  });
});

test('a paid team owner can edit permit reference and address without changing status or monitoring history', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'permit-edit-owner');
  const team = await createTeam(owner.userId, 'QA Permit Details Owner Team', 'owner');
  await markTeamPaid(team.id, owner.userId);
  await setSubscriptionState(owner.email, true);

  const permit = await createPermit(owner.userId, team.id, 'Owner');
  const statusEvent = await prisma.permitStatusEvent.create({
    data: {
      permitId: permit.id,
      status: 'Submitted',
      falseAlarmReason: 'Retain this recorded status event.',
      createdAt: new Date('2026-10-20T08:00:00.000Z'),
    },
  });
  const portalCheck = await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: permit.id,
      teamId: team.id,
      permitNumber: permit.permitNumber,
      sourceUrl: permit.portalUrl,
      status: 'Initial Review',
      result: 'checked',
      checkedAt: new Date('2026-10-21T08:00:00.000Z'),
      sourceFetchedAt: new Date('2026-10-21T07:59:00.000Z'),
      redlineResult: 'not_connected',
    },
  });
  const originalStatusEvents = await prisma.permitStatusEvent.findMany({
    where: { permitId: permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const originalPortalChecks = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id },
    orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
  });

  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  await expect(page.getByRole('heading', { name: `QA Permit Details Owner` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit permit details' })).toBeVisible();
  await expect(page.getByText(`QA-OWNER`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit permit details' }).click();
  await expect(page.getByRole('textbox', { name: 'Permit reference' })).toHaveValue('QA-OWNER');
  await expect(page.getByRole('textbox', { name: 'Job address' })).toHaveValue(
    'Owner Original Street, Tampa',
  );
  await page.getByRole('textbox', { name: 'Permit reference' }).fill('');
  await page.getByRole('textbox', { name: 'Job address' }).fill('Owner Updated Street, Tampa');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Not added', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: 'Owner Updated Street, Tampa' }),
  ).toBeVisible();
  await expect(page.getByText('Initial Review', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Edit permit details' }).click();
  await page.getByRole('textbox', { name: 'Permit reference' }).fill('QA-OWNER-UPDATED');
  await page.getByRole('textbox', { name: 'Job address' }).fill('Owner Updated Street, Tampa');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('QA-OWNER-UPDATED', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: 'Owner Updated Street, Tampa' }),
  ).toBeVisible();
  await expect(page.getByText('Under review', { exact: true })).toBeVisible();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();

  const savedPermit = await prisma.permit.findUniqueOrThrow({ where: { id: permit.id } });
  expect(savedPermit).toMatchObject({
    address: 'Owner Updated Street, Tampa',
    permitNumber: 'QA-OWNER-UPDATED',
    status: 'Under review',
  });
  const updatedStatusEvents = await prisma.permitStatusEvent.findMany({
    where: { permitId: permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const updatedPortalChecks = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id },
    orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
  });
  expect(updatedStatusEvents).toEqual(originalStatusEvents);
  expect(updatedPortalChecks).toEqual(originalPortalChecks);
  expect(updatedStatusEvents.map((event) => event.id)).toEqual([statusEvent.id]);
  expect(updatedPortalChecks.map((check) => check.id)).toEqual([portalCheck.id]);

  await page.reload();
  await expect(page.getByText('QA-OWNER-UPDATED', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: 'Owner Updated Street, Tampa' }),
  ).toBeVisible();
  await expect(page.getByText('Initial Review', { exact: true }).first()).toBeVisible();
  await captureSavedDetails(page, testInfo);
  await page.getByRole('button', { name: 'Edit permit details' }).click();
  await expect(page.getByRole('textbox', { name: 'Permit reference' })).toHaveValue(
    'QA-OWNER-UPDATED',
  );
  await expect(page.getByRole('textbox', { name: 'Job address' })).toHaveValue(
    'Owner Updated Street, Tampa',
  );
  await expectContrastRatio(page.getByRole('button', { name: 'Save details' }));
  await expectContrastRatio(page.getByRole('button', { name: 'Cancel' }));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath('permit-details-editor-mobile-320.png'),
    fullPage: true,
  });
});

test('permit detail edits reject every role, billing state, and team other than its active owner team', async ({
  browser,
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'permit-edit-active-owner');
  const team = await createTeam(owner.userId, 'QA Permit Details Active Team', 'owner');
  await markTeamPaid(team.id, owner.userId);
  await setSubscriptionState(owner.email, true);
  const permit = await createPermit(owner.userId, team.id, 'Protected');

  const purchaser = await signedInContext(browser, origin, 'permit-edit-purchaser');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: purchaser.userId, role: 'purchaser' },
  });
  const manager = await signedInContext(browser, origin, 'permit-edit-manager');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: manager.userId, role: 'project_manager' },
  });
  const outsider = await signedInContext(browser, origin, 'permit-edit-outsider');
  const outsideTeam = await createTeam(outsider.userId, 'QA Permit Details Outside Team', 'owner');
  await markTeamPaid(outsideTeam.id, outsider.userId);
  await setSubscriptionState(outsider.email, true);

  const unpaidTeam = await createTeam(owner.userId, 'QA Permit Details Unpaid Team', 'owner');
  const unpaidPermit = await createPermit(owner.userId, unpaidTeam.id, 'Unpaid');
  const inactiveOwner = await signedInContext(browser, origin, 'permit-edit-inactive-owner');
  const inactiveTeam = await createTeam(
    inactiveOwner.userId,
    'QA Permit Details Inactive Team',
    'owner',
  );
  await markTeamPaid(inactiveTeam.id, inactiveOwner.userId);
  await setSubscriptionState(inactiveOwner.email, false);
  const inactivePermit = await createPermit(inactiveOwner.userId, inactiveTeam.id, 'Inactive');

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();

  const cases = [
    {
      label: 'project manager',
      request: manager.page.request,
      permitId: permit.id,
      data: detailUpdate(team.id, 'Protected'),
      status: 403,
      error: 'team_owner_required',
    },
    {
      label: 'purchaser',
      request: purchaser.page.request,
      permitId: permit.id,
      data: detailUpdate(team.id, 'Protected'),
      status: 403,
      error: 'team_owner_required',
    },
    {
      label: 'nonmember targeting another team',
      request: outsider.page.request,
      permitId: permit.id,
      data: detailUpdate(outsideTeam.id, 'Protected'),
      status: 404,
      error: 'permit_not_found',
    },
    {
      label: 'owner supplying another team id',
      request: page.request,
      permitId: permit.id,
      data: detailUpdate(outsideTeam.id, 'Protected'),
      status: 404,
      error: 'permit_not_found',
    },
    {
      label: 'owner of an unpaid team',
      request: page.request,
      permitId: unpaidPermit.id,
      data: detailUpdate(unpaidTeam.id, 'Unpaid'),
      status: 402,
      error: 'team_subscription_required',
    },
    {
      label: 'owner of an inactive team',
      request: inactiveOwner.page.request,
      permitId: inactivePermit.id,
      data: detailUpdate(inactiveTeam.id, 'Inactive'),
      status: 402,
      error: 'team_subscription_required',
    },
  ] as const;

  for (const testCase of cases) {
    const response = await testCase.request.patch(
      `${origin}/api/permits/${encodeURIComponent(testCase.permitId)}/details`,
      { headers: { origin }, data: testCase.data },
    );
    expect(response.status(), testCase.label).toBe(testCase.status);
    expect(await response.json(), testCase.label).toMatchObject({ error: testCase.error });
  }

  const anonymous = await anonymousPage.request.patch(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}/details`,
    { headers: { origin }, data: detailUpdate(team.id, 'Protected') },
  );
  expect(anonymous.status()).toBe(401);

  const wrongTeamField = await page.request.patch(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}/details`,
    {
      headers: { origin },
      data: { ...detailUpdate(team.id, 'Protected'), status: 'Issued' },
    },
  );
  expect(wrongTeamField.status()).toBe(400);

  const managerDetails = await manager.page.request.get(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}`,
  );
  expect(managerDetails.status()).toBe(200);
  expect(await managerDetails.json()).toMatchObject({ canEditDetails: false });

  const unchanged = await prisma.permit.findUniqueOrThrow({ where: { id: permit.id } });
  expect(unchanged).toMatchObject({
    address: 'Protected Original Street, Tampa',
    permitNumber: 'QA-PROTECTED',
    status: 'Under review',
  });
  expect(
    await prisma.permit.findUniqueOrThrow({ where: { id: unpaidPermit.id } }),
  ).toMatchObject({
    address: 'Unpaid Original Street, Tampa',
    permitNumber: 'QA-UNPAID',
  });
  expect(
    await prisma.permit.findUniqueOrThrow({ where: { id: inactivePermit.id } }),
  ).toMatchObject({
    address: 'Inactive Original Street, Tampa',
    permitNumber: 'QA-INACTIVE',
  });
});
