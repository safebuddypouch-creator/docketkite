// @polsia:user-owned — bulk permit archive journey and authorization checks.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

async function setSubscriptionState(email: string, state: 'inactive' | 'unavailable') {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  await writeFile(
    `/tmp/polsia-subscription-state-${digest}.json`,
    JSON.stringify({ active: false, unavailable: state === 'unavailable', status: 'canceled' }),
    'utf8',
  );
}

async function signIn(page: Page, origin: string, emailPrefix = 'qa-bulk-archive') {
  const email = `${emailPrefix}-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const signUp = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'QA Permit Owner', email, password },
  });
  expect(signUp.status(), await signUp.text()).toBe(200);

  const signupSession = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const signupBody = (await signupSession.json()) as { user?: { id?: string } };
  const userId = signupBody.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not create a signed-in user.');

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signInResponse = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signInResponse.status(), await signInResponse.text()).toBe(200);
  fixtureUserIds.push(userId);
  return { userId, email };
}

async function createTeam(userId: string, name: string, paid: 'active' | 'pending' | 'unpaid') {
  const team = await prisma.teamSpace.create({
    data: {
      name,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  if (paid === 'active') {
    await prisma.teamCheckout.create({
      data: {
        teamId: team.id,
        userId,
        status: 'verified',
        grossAmountUsd: 299,
        verifiedAt: new Date(),
      },
    });
  } else if (paid === 'pending') {
    await prisma.teamCheckout.create({ data: { teamId: team.id, userId, status: 'pending' } });
  }
  return team;
}

async function createPermit(
  userId: string,
  teamId: string,
  projectName: string,
  archivedAt: Date | null = null,
) {
  return prisma.permit.create({
    data: {
      userId,
      teamId,
      projectName,
      address: '101 QA Remodel Lane, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      archivedAt,
    },
  });
}

async function capturePermitList(page: Page, testInfo: TestInfo, prefix: string) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(
      page.getByRole('checkbox', { name: /Select .* for bulk archive/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Archive selected \(1\)/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`${prefix}-${viewport.name}.png`),
      fullPage: true,
    });
  }
}

async function bulkArchive(page: Page, origin: string, teamId: string, permitIds: string[]) {
  return page.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: { action: 'archiveBulk', teamId, permitIds },
  });
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  if (fixtureTeamIds.length > 0) {
    await prisma.permit.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamCheckout.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamInvitation.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamMembership.deleteMany({
      where: { OR: [{ teamId: { in: fixtureTeamIds } }, { userId: { in: fixtureUserIds } }] },
    });
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

test('team owners can cancel or confirm a counted bulk archive and keep other permits active', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const { userId } = await signIn(page, origin);
  const team = await createTeam(userId, 'QA Bulk Archive Team', 'active');
  const selectedFirst = await createPermit(userId, team.id, 'QA Selected Kitchen Permit');
  const selectedSecond = await createPermit(userId, team.id, 'QA Selected Bathroom Permit');
  const untouched = await createPermit(userId, team.id, 'QA Unselected Roof Permit');
  const alreadyArchived = await createPermit(
    userId,
    team.id,
    'QA Previously Archived Permit',
    new Date('2026-01-01T12:00:00.000Z'),
  );

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Select QA Selected Kitchen Permit for bulk archive' })
    .check();
  await page
    .getByRole('checkbox', { name: 'Select QA Selected Bathroom Permit for bulk archive' })
    .check();
  await page.getByRole('button', { name: 'Archive selected (2)' }).click();
  await expect(page.getByRole('heading', { name: 'Archive 2 selected permits?' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  const canceledRecords = await prisma.permit.findMany({
    where: { id: { in: [selectedFirst.id, selectedSecond.id] } },
    select: { archivedAt: true },
  });
  expect(canceledRecords.map((permit) => permit.archivedAt)).toEqual([null, null]);
  await expect(page.getByRole('heading', { name: 'QA Selected Kitchen Permit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Selected Bathroom Permit' })).toBeVisible();

  await page.getByRole('button', { name: 'Archive selected (2)' }).click();
  const confirmArchive = page.getByRole('button', { name: 'Confirm archive 2 permits' }).click();
  await expect(page.getByText('Archiving 2 permits…')).toBeVisible();
  await confirmArchive;
  await expect(page.getByText('2 permits moved to Archived.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Selected Kitchen Permit' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'QA Selected Bathroom Permit' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'QA Unselected Roof Permit' })).toBeVisible();

  const afterArchive = await prisma.permit.findMany({
    where: { id: { in: [selectedFirst.id, selectedSecond.id, untouched.id, alreadyArchived.id] } },
    select: { id: true, archivedAt: true },
  });
  const archivedById = new Map(afterArchive.map((permit) => [permit.id, permit.archivedAt]));
  expect(archivedById.get(selectedFirst.id)).not.toBeNull();
  expect(archivedById.get(selectedSecond.id)).not.toBeNull();
  expect(archivedById.get(untouched.id)).toBeNull();
  expect(archivedById.get(alreadyArchived.id)?.toISOString()).toBe('2026-01-01T12:00:00.000Z');

  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QA Selected Kitchen Permit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Selected Bathroom Permit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Unselected Roof Permit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Select QA Unselected Roof Permit for bulk archive' })
    .check();
  await expect(page.getByText('2 permits moved to Archived.')).toHaveCount(0);
  await capturePermitList(page, testInfo, 'bulk-archive-active-owner');
});

test('bulk archive rejects callers without active paid owner access and rejects out-of-scope ids atomically', async ({
  browser,
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const owner = await signIn(page, origin);
  const paidTeam = await createTeam(owner.userId, 'QA Bulk Archive Paid Team', 'active');
  const activePermit = await createPermit(owner.userId, paidTeam.id, 'QA Protected Active Permit');
  const archivedPermit = await createPermit(
    owner.userId,
    paidTeam.id,
    'QA Protected Archived Permit',
    new Date('2026-02-01T12:00:00.000Z'),
  );
  const otherTeam = await createTeam(owner.userId, 'QA Other Paid Team', 'active');
  const otherTeamPermit = await createPermit(owner.userId, otherTeam.id, 'QA Other Team Permit');
  const unpaidTeam = await createTeam(owner.userId, 'QA Unpaid Archive Team', 'unpaid');
  const unpaidPermit = await createPermit(owner.userId, unpaidTeam.id, 'QA Unpaid Active Permit');
  const pendingTeam = await createTeam(owner.userId, 'QA Pending Archive Team', 'pending');
  const pendingPermit = await createPermit(
    owner.userId,
    pendingTeam.id,
    'QA Pending Active Permit',
  );

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();
  const noSessionResponse = await bulkArchive(anonymousPage, origin, paidTeam.id, [
    activePermit.id,
  ]);
  expect(noSessionResponse.status()).toBe(401);

  const nonmemberContext = await browser.newContext();
  fixtureContexts.push(nonmemberContext);
  const nonmemberPage = await nonmemberContext.newPage();
  await signIn(nonmemberPage, origin);
  const nonmemberResponse = await bulkArchive(nonmemberPage, origin, paidTeam.id, [
    activePermit.id,
  ]);
  expect(nonmemberResponse.status()).toBe(403);

  const purchaserContext = await browser.newContext();
  fixtureContexts.push(purchaserContext);
  const purchaserPage = await purchaserContext.newPage();
  const purchaser = await signIn(purchaserPage, origin);
  await prisma.teamMembership.create({
    data: { teamId: paidTeam.id, userId: purchaser.userId, role: 'purchaser' },
  });
  await purchaserPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(paidTeam.id)}`);
  await expect(purchaserPage.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await expect(purchaserPage.getByRole('checkbox')).toHaveCount(0);
  const purchaserResponse = await bulkArchive(purchaserPage, origin, paidTeam.id, [
    activePermit.id,
  ]);
  expect(purchaserResponse.status()).toBe(403);
  expect((await purchaserResponse.json()).error).toBe('team_owner_required');

  for (const [team, permit, expectedStatus, expectedPaymentStatus] of [
    [unpaidTeam, unpaidPermit, 402, 'unpaid'],
    [pendingTeam, pendingPermit, 402, 'pending'],
  ] as const) {
    const response = await bulkArchive(page, origin, team.id, [permit.id]);
    expect(response.status()).toBe(expectedStatus);
    expect((await response.json()).paymentStatus).toBe(expectedPaymentStatus);
    expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.archivedAt).toBeNull();
  }

  for (const [emailPrefix, expectedStatus, expectedPaymentStatus] of [
    ['qa-bulk-archive-inactive', 402, 'inactive'],
    ['qa-bulk-archive-unavailable', 503, 'unavailable'],
  ] as const) {
    const context = await browser.newContext();
    fixtureContexts.push(context);
    const statusPage = await context.newPage();
    const statusOwner = await signIn(statusPage, origin, emailPrefix);
    await setSubscriptionState(statusOwner.email, expectedPaymentStatus);
    const team = await createTeam(
      statusOwner.userId,
      `QA ${expectedPaymentStatus} Archive Team`,
      'active',
    );
    const permit = await createPermit(
      statusOwner.userId,
      team.id,
      `QA ${expectedPaymentStatus} Permit`,
    );
    const response = await bulkArchive(statusPage, origin, team.id, [permit.id]);
    expect(response.status()).toBe(expectedStatus);
    expect((await response.json()).paymentStatus).toBe(expectedPaymentStatus);
    expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.archivedAt).toBeNull();
  }

  const crossTeamResponse = await bulkArchive(page, origin, paidTeam.id, [
    activePermit.id,
    otherTeamPermit.id,
  ]);
  expect(crossTeamResponse.status()).toBe(409);
  expect(
    (await prisma.permit.findUnique({ where: { id: activePermit.id } }))?.archivedAt,
  ).toBeNull();
  expect(
    (await prisma.permit.findUnique({ where: { id: otherTeamPermit.id } }))?.archivedAt,
  ).toBeNull();

  const archivedSelectionResponse = await bulkArchive(page, origin, paidTeam.id, [
    activePermit.id,
    archivedPermit.id,
  ]);
  expect(archivedSelectionResponse.status()).toBe(409);
  expect(
    (await prisma.permit.findUnique({ where: { id: activePermit.id } }))?.archivedAt,
  ).toBeNull();
  expect(
    (
      await prisma.permit.findUnique({ where: { id: archivedPermit.id } })
    )?.archivedAt?.toISOString(),
  ).toBe('2026-02-01T12:00:00.000Z');

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(paidTeam.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
});

test('a changed selection fails without partially archiving its still-active permits', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const owner = await signIn(page, origin);
  const team = await createTeam(owner.userId, 'QA Bulk Archive Conflict Team', 'active');
  const first = await createPermit(owner.userId, team.id, 'QA Conflict First Permit');
  const second = await createPermit(owner.userId, team.id, 'QA Conflict Second Permit');

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Select QA Conflict First Permit for bulk archive' })
    .check();
  await page
    .getByRole('checkbox', { name: 'Select QA Conflict Second Permit for bulk archive' })
    .check();
  await page.getByRole('button', { name: 'Archive selected (2)' }).click();
  await prisma.permit.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
  await page.getByRole('button', { name: 'Confirm archive 2 permits' }).click();
  await expect(
    page.getByText(
      'Could not archive the selected permits. No permits were changed. Please try again.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Archive 2 selected permits?' })).toBeVisible();
  expect((await prisma.permit.findUnique({ where: { id: second.id } }))?.archivedAt).toBeNull();
});
