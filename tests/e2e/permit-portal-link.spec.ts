// @polsia:user-owned — permit portal link save, edit, clear, and reload journey.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { tampaRecordUrl } from './permit-test-helpers';

const prisma = new PrismaClient();
const FETCH_CALL_LOG_PATH = '/tmp/polsia-portal-fetch-calls.ndjson';
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureBrowserContexts: BrowserContext[] = [];

async function signIn(page: Page, origin: string) {
  const email = `qa-portal-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'QA Permit Owner', email, password },
  });
  expect(signup.status(), await signup.text()).toBe(200);

  const signupSession = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const signupBody = (await signupSession.json()) as { user?: { id?: string } };
  const userId = signupBody.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not create a signed-in user.');

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signin.status(), await signin.text()).toBe(200);
  fixtureUserIds.push(userId);
  return userId;
}

async function capturePortalView(page: Page, testInfo: TestInfo) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({
      path: testInfo.outputPath(`permit-portal-view-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function capturePortalEditor(page: Page, testInfo: TestInfo) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({
      path: testInfo.outputPath(`permit-portal-edit-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.afterEach(async () => {
  await Promise.all(fixtureBrowserContexts.map((context) => context.close()));
  fixtureBrowserContexts.length = 0;
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
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a team owner can add, change, clear, and reopen a permit portal link', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const userId = await signIn(page, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Portal Link Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Portal Kitchen Remodel',
      address: '101 Test Street, Tampa',
      permitNumber: '2026-010101',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const permitCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'QA Portal Kitchen Remodel' }) });
  await expect(permitCard).toBeVisible();
  await permitCard.getByRole('button', { name: 'Edit' }).click();
  const portalInput = permitCard.getByLabel('Official City of Tampa Accela Building record URL');
  await expect(portalInput).toHaveValue('');
  await expect(
    permitCard.getByText(
      'A Tampa mailing address alone does not establish City jurisdiction. Only a direct City of Tampa Accela Building record URL enables a public check. A check stores the raw Record Status after the page confirms this permit number; applicant-only details are not accessed. Checks run on demand, not on a schedule.',
    ),
  ).toBeVisible();

  const firstUrl = tampaRecordUrl('2026-010101');
  await portalInput.fill(firstUrl);
  await permitCard.getByRole('button', { name: 'Save changes' }).click();
  const portalLink = permitCard.getByRole('link', {
    name: 'Official City of Tampa Accela record',
  });
  await expect(portalLink).toHaveAttribute('href', firstUrl);
  await expect(portalLink).toHaveAttribute('target', '_blank');
  await expect(permitCard.getByText('Tampa public record link. Applicant-only information is not accessed.'))
    .toBeVisible();
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(firstUrl);
  const savedToast = page.getByText('Permit details saved.');
  await expect(savedToast).toBeVisible();
  await expect(savedToast).toBeHidden({ timeout: 10_000 });
  await capturePortalView(page, testInfo);

  await page.reload();
  const reopenedCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'QA Portal Kitchen Remodel' }) });
  const reopenedLink = reopenedCard.getByRole('link', {
    name: 'Official City of Tampa Accela record',
  });
  await expect(reopenedLink).toHaveAttribute('href', firstUrl);
  await reopenedCard.getByRole('button', { name: 'Edit' }).click();
  const reopenedInput = reopenedCard.getByLabel('Official City of Tampa Accela Building record URL');
  await expect(reopenedInput).toHaveValue(firstUrl);
  const editLink = reopenedCard.getByRole('link', { name: 'Open saved City portal link' });
  await expect(editLink).toHaveAttribute('href', firstUrl);
  await capturePortalEditor(page, testInfo);

  const secondUrl = tampaRecordUrl('2026-010102');
  await reopenedInput.fill(secondUrl);
  await reopenedCard.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    reopenedCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveAttribute('href', secondUrl);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(secondUrl);

  await page.reload();
  const changedCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'QA Portal Kitchen Remodel' }) });
  await expect(
    changedCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveAttribute('href', secondUrl);
  await changedCard.getByRole('button', { name: 'Edit' }).click();
  await changedCard.getByLabel('Official City of Tampa Accela Building record URL').fill('');
  await changedCard.getByRole('button', { name: 'Save changes' }).click();
  await expect(changedCard.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(
    changedCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveCount(0);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBeNull();

  await page.reload();
  const clearedCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'QA Portal Kitchen Remodel' }) });
  await expect(
    clearedCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveCount(0);
  await clearedCard.getByRole('button', { name: 'Edit' }).click();
  await expect(
    clearedCard.getByLabel('Official City of Tampa Accela Building record URL'),
  ).toHaveValue('');

  // Re-save the sample link so the final review capture visibly includes it.
  await clearedCard.getByLabel('Official City of Tampa Accela Building record URL').fill(secondUrl);
  await clearedCard.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    clearedCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveAttribute('href', secondUrl);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(secondUrl);

  const outsiderContext = await browser.newContext();
  fixtureBrowserContexts.push(outsiderContext);
  const outsiderPage = await outsiderContext.newPage();
  const outsiderUserId = await signIn(outsiderPage, origin);
  const outsiderTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Other Portal Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: outsiderUserId,
    },
  });
  fixtureTeamIds.push(outsiderTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: outsiderTeam.id, userId: outsiderUserId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: outsiderTeam.id,
      userId: outsiderUserId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const outsiderOwnList = await outsiderPage.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(outsiderTeam.id)}`,
    { headers: { origin } },
  );
  expect(outsiderOwnList.status()).toBe(200);
  const outsiderOwnItems = (await outsiderOwnList.json()) as {
    items: Array<{ id: string; portalUrl: string }>;
  };
  expect(outsiderOwnItems.items.some((item) => item.id === permit.id)).toBe(false);

  const outsiderRead = await outsiderPage.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
    { headers: { origin } },
  );
  expect(outsiderRead.status()).toBe(403);
  expect(await outsiderRead.json()).toMatchObject({ error: 'team_membership_required' });

  const outsiderUpdate = await outsiderPage.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      action: 'update',
      id: permit.id,
      teamId: team.id,
      data: {
        projectName: 'Unauthorized portal update',
        address: '101 Test Street, Tampa',
        permitNumber: '2026-010101',
        permitType: 'Building',
        status: 'Planning',
        notes: '',
        portalUrl: tampaRecordUrl('2026-010101', { source: 'unauthorized' }),
      },
    },
  });
  expect(outsiderUpdate.status()).toBe(403);
  expect(await outsiderUpdate.json()).toMatchObject({ error: 'team_membership_required' });
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(secondUrl);

  await page.reload();
  const finalCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'QA Portal Kitchen Remodel' }) });
  await expect(
    finalCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveAttribute('href', secondUrl);
  await capturePortalView(page, testInfo);
  await finalCard.getByRole('button', { name: 'Edit' }).click();
  await expect(
    finalCard.getByLabel('Official City of Tampa Accela Building record URL'),
  ).toHaveValue(secondUrl);
  await expect(finalCard.getByRole('link', { name: 'Open saved City portal link' })).toHaveAttribute(
    'href',
    secondUrl,
  );
  await capturePortalEditor(page, testInfo);
});

test('a permit details URL edit preserves manual status history and feeds the next public check', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const teamOwnerId = await signIn(page, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Permit Details Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: teamOwnerId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: teamOwnerId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: teamOwnerId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const memberContext = await browser.newContext();
  fixtureBrowserContexts.push(memberContext);
  const memberPage = await memberContext.newPage();
  const memberUserId = await signIn(memberPage, origin);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: memberUserId, role: 'project_manager' },
  });

  const permitNumber = '2026-070707';
  const oldUrl = `https://example.invalid/record/${permitNumber}?source=old`;
  const newUrl = tampaRecordUrl(permitNumber, { source: 'updated', fixture: `permit-link-${permitNumber}` });
  const permit = await prisma.permit.create({
    data: {
      userId: teamOwnerId,
      teamId: team.id,
      assignedProjectManagerUserId: memberUserId,
      projectName: 'QA Permit Details Kitchen Remodel',
      address: '101 Test Street, Tampa',
      permitNumber,
      permitType: 'Building',
      status: 'Under review',
      notes: 'Manual status and history should remain intact.',
      portalUrl: oldUrl,
    },
  });
  await prisma.permitStatusEvent.create({
    data: {
      permitId: permit.id,
      status: 'Submitted',
      falseAlarmReason: 'Recorded by the project team.',
      createdAt: new Date('2026-10-20T08:00:00.000Z'),
    },
  });
  const earlierCheck = await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: permit.id,
      teamId: team.id,
      permitNumber,
      sourceUrl: oldUrl,
      status: 'Initial Review',
      result: 'checked',
      checkedAt: new Date('2026-10-21T08:00:00.000Z'),
      sourceFetchedAt: new Date('2026-10-21T07:59:00.000Z'),
      redlineResult: 'not_connected',
    },
  });
  const originalEvents = await prisma.permitStatusEvent.findMany({
    where: { permitId: permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const detailsUrl = `${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`;
  const permitApiUrl = `${origin}/api/permits/${encodeURIComponent(permit.id)}`;
  await memberPage.goto(detailsUrl);
  const details = memberPage.locator('article').filter({
    has: memberPage.getByRole('heading', { name: 'QA Permit Details Kitchen Remodel' }),
  });
  await expect(details).toBeVisible();
  await expect(details.getByText(/saved portal URL is unsupported/i)).toBeVisible();
  await details.getByRole('button', { name: 'Add portal URL' }).click();
  const portalInput = details.getByLabel('Official City of Tampa Accela Building record URL');
  await expect(portalInput).toHaveValue(oldUrl);

  const unsupportedUrl = 'https://example.invalid.attacker.example/record/2026-070707';
  await portalInput.fill(unsupportedUrl);
  await details.getByRole('button', { name: 'Save portal URL' }).click();
  await expect(details.getByRole('alert')).toContainText(
    'Enter a direct City of Tampa Building record URL',
  );
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(oldUrl);

  const invalidApiResponse = await memberPage.request.patch(permitApiUrl, {
    headers: { origin },
    data: { portalUrl: unsupportedUrl },
  });
  expect(invalidApiResponse.status()).toBe(400);
  expect(await invalidApiResponse.json()).toMatchObject({
    errors: { portalUrl: expect.stringContaining('direct City of Tampa Building record URL') },
  });

  const crossOriginResponse = await memberPage.request.patch(permitApiUrl, {
    headers: { origin: 'https://attacker.example' },
    data: { portalUrl: newUrl },
  });
  expect(crossOriginResponse.status()).toBe(403);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(oldUrl);

  await portalInput.fill(newUrl);
  await details.getByRole('button', { name: 'Save portal URL' }).click();
  await expect(details.getByRole('link', { name: 'Open City permit record' })).toHaveAttribute(
    'href',
    newUrl,
  );
  await expect(memberPage.getByText('Permit portal URL saved.')).toBeVisible();
  const savedPermit = await prisma.permit.findUnique({
    where: { id: permit.id },
    include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  expect(savedPermit?.portalUrl).toBe(newUrl);
  expect(savedPermit?.status).toBe('Under review');
  expect(savedPermit?.statusEvents).toEqual(originalEvents);

  await memberPage.reload();
  const reopenedDetails = memberPage.locator('article').filter({
    has: memberPage.getByRole('heading', { name: 'QA Permit Details Kitchen Remodel' }),
  });
  await reopenedDetails.getByRole('button', { name: 'Edit portal URL' }).click();
  await expect(
    reopenedDetails.getByLabel('Official City of Tampa Accela Building record URL'),
  ).toHaveValue(newUrl);

  const outsiderContext = await browser.newContext();
  fixtureBrowserContexts.push(outsiderContext);
  const outsiderPage = await outsiderContext.newPage();
  const outsiderUserId = await signIn(outsiderPage, origin);
  const outsiderTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Unrelated Permit Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: outsiderUserId,
    },
  });
  fixtureTeamIds.push(outsiderTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: outsiderTeam.id, userId: outsiderUserId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: outsiderTeam.id,
      userId: outsiderUserId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  const outsiderUpdate = await outsiderPage.request.patch(permitApiUrl, {
    headers: { origin },
    data: { portalUrl: tampaRecordUrl('2026-070707', { source: 'unauthorized' }) },
  });
  expect(outsiderUpdate.status()).toBe(403);
  expect(await outsiderUpdate.json()).toMatchObject({ error: 'team_membership_required' });
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.portalUrl).toBe(newUrl);

  await writeFile(FETCH_CALL_LOG_PATH, '', 'utf8');
  await memberPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const permitCard = memberPage.locator('article').filter({
    has: memberPage.getByRole('heading', { name: 'QA Permit Details Kitchen Remodel' }),
  });
  await permitCard.getByRole('button', { name: 'Run public check' }).click();
  await expect(
    permitCard.getByRole('link', { name: 'Open City of Tampa source' }).first(),
  ).toHaveAttribute('href', newUrl);
  const fetchCalls = (await readFile(FETCH_CALL_LOG_PATH, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { url: string; waitMs: number });
  expect(fetchCalls).toContainEqual({ url: newUrl, waitMs: 5000 });

  const checks = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id, teamId: team.id },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
  });
  expect(checks).toHaveLength(2);
  expect(checks[0]).toMatchObject({ sourceUrl: newUrl, result: 'unavailable' });
  expect(checks[1]).toMatchObject({ id: earlierCheck.id, sourceUrl: oldUrl, status: 'Initial Review' });
  const permitAfterCheck = await prisma.permit.findUnique({
    where: { id: permit.id },
    include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  expect(permitAfterCheck?.status).toBe('Under review');
  expect(permitAfterCheck?.statusEvents).toEqual(originalEvents);

  await memberPage.goto(detailsUrl);
  const finalDetails = memberPage.locator('article').filter({
    has: memberPage.getByRole('heading', { name: 'QA Permit Details Kitchen Remodel' }),
  });
  await finalDetails.getByRole('button', { name: 'Edit portal URL' }).click();
  await expect(
    finalDetails.getByLabel('Official City of Tampa Accela Building record URL'),
  ).toHaveValue(newUrl);
  await capturePortalEditor(memberPage, testInfo);
});
