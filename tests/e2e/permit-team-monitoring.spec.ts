// @polsia:user-owned — paid team monitoring view and access-control journey.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Browser, type BrowserContext, type TestInfo } from '@playwright/test';
import { tampaRecordUrl } from './permit-test-helpers';

const prisma = new PrismaClient();
const fixtureTeamIds: string[] = [];
const fixtureUserIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

async function openSignedInPage(browser: Browser, origin: string) {
  const storageStatePath = '/tmp/polsia-team-monitoring-auth.json';
  execFileSync(
    'node',
    [
      '.agents/auth-session.cjs',
      '--as',
      'user',
      '--base-url',
      origin,
      '--out',
      storageStatePath,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
  const context = await browser.newContext({ storageState: storageStatePath });
  fixtureContexts.push(context);
  const page = await context.newPage();
  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const userId = session.user?.id;
  if (!userId) throw new Error('The authenticated session did not include a user id.');
  return { page, userId };
}

async function createTeam(userId: string, name: string) {
  const team = await prisma.teamSpace.create({
    data: {
      name,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  return team;
}

async function addPaidMembership(teamId: string, userId: string, purchaserUserId = userId) {
  await prisma.teamMembership.create({ data: { teamId, userId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: {
      teamId,
      userId: purchaserUserId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
}

async function createFixtureUser(email: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: { id, name: 'QA Subscription Purchaser', email, emailVerified: true, createdAt: now, updatedAt: now },
  });
  fixtureUserIds.push(id);
  return id;
}

async function createPermit(input: {
  userId: string;
  teamId: string;
  projectName: string;
  permitNumber: string;
  assignedProjectManagerUserId?: string;
}) {
  return prisma.permit.create({
    data: {
      userId: input.userId,
      teamId: input.teamId,
      projectName: input.projectName,
      address: `101 ${input.projectName} Street, Tampa`,
      permitNumber: input.permitNumber,
      permitType: 'Building',
      status: 'Planning',
      portalUrl: tampaRecordUrl(input.permitNumber),
      assignedProjectManagerUserId: input.assignedProjectManagerUserId,
    },
  });
}

async function addObservation(
  permit: { id: string; teamId: string | null; permitNumber: string },
  status: string | null,
  result: 'checked' | 'unverified' | 'unavailable',
  checkedAt: string,
) {
  if (!permit.teamId) throw new Error('The fixture permit must belong to a team.');
  return prisma.permitPortalStatusCheck.create({
    data: {
      permitId: permit.id,
      teamId: permit.teamId,
      permitNumber: permit.permitNumber,
      sourceUrl: tampaRecordUrl(permit.permitNumber),
      status,
      result,
      message: result === 'checked' ? null : 'This saved fixture is not a successful status check.',
      checkedAt: new Date(checkedAt),
      sourceFetchedAt: result === 'checked' ? new Date(checkedAt) : null,
    },
  });
}

async function captureMonitoringView(
  page: Awaited<ReturnType<Browser['newPage']>>,
  testInfo: TestInfo,
) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page
      .getByRole('heading', { name: 'Public status changes', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: 'Public status changes', exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`team-monitoring-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('heading', { name: 'Public status changes', exact: true })
    .scrollIntoViewIfNeeded();
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  if (fixtureTeamIds.length > 0) {
    await prisma.permit.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamCheckout.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamInvitation.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
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

test('shows team-wide successful portal status changes and links to manual event history', async (
  { browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { page, userId } = await openSignedInPage(browser, origin);
  const team = await createTeam(userId, 'QA Team Monitoring');
  await addPaidMembership(team.id, userId);

  const managerId = await createFixtureUser(`qa-manager-${randomUUID()}@example.test`);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: managerId, role: 'project_manager' },
  });

  const permit = await createPermit({
    userId,
    teamId: team.id,
    projectName: 'Willow Kitchen Remodel',
    permitNumber: `QA-${randomUUID().slice(0, 8)}`,
  });
  const assignedPermit = await createPermit({
    userId,
    teamId: team.id,
    projectName: 'Cedar Bathroom Addition',
    permitNumber: `QA-${randomUUID().slice(0, 8)}`,
    assignedProjectManagerUserId: managerId,
  });
  const manualEvent = await prisma.permitStatusEvent.create({
    data: { permitId: permit.id, status: 'Ready to submit', falseAlarmReason: null },
  });

  await addObservation(permit, 'Submitted', 'checked', '2026-10-01T08:00:00.000Z');
  await addObservation(permit, null, 'unavailable', '2026-10-01T09:00:00.000Z');
  await addObservation(permit, 'Submitted', 'checked', '2026-10-01T10:00:00.000Z');
  const correctionsCheck = await addObservation(
    permit,
    'Corrections requested',
    'checked',
    '2026-10-02T08:00:00.000Z',
  );
  await addObservation(permit, null, 'unverified', '2026-10-02T09:00:00.000Z');
  const issuedCheck = await addObservation(permit, 'Issued', 'checked', '2026-10-03T08:00:00.000Z');
  await addObservation(assignedPermit, 'Under review', 'checked', '2026-10-01T08:30:00.000Z');
  const assignedIssuedCheck = await addObservation(
    assignedPermit,
    'Issued',
    'checked',
    '2026-10-04T08:00:00.000Z',
  );

  const otherTeam = await createTeam(userId, 'QA Other Monitoring Team');
  await addPaidMembership(otherTeam.id, userId);
  const otherPermit = await createPermit({
    userId,
    teamId: otherTeam.id,
    projectName: 'Other Team Record',
    permitNumber: `QA-${randomUUID().slice(0, 8)}`,
  });
  await addObservation(otherPermit, 'Submitted', 'checked', '2026-10-01T07:00:00.000Z');
  await addObservation(otherPermit, 'Issued', 'checked', '2026-10-05T08:00:00.000Z');

  const response = await page.request.get(
    `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(response.status()).toBe(200);
  const result = (await response.json()) as {
    items: Array<{
      id: string;
      permitId: string;
      previousStatus: string;
      newStatus: string;
      detectedAt: string;
    }>;
  };
  expect(result.items.map((item) => item.id)).toEqual([
    assignedIssuedCheck.id,
    issuedCheck.id,
    correctionsCheck.id,
  ]);
  expect(result.items.map(({ previousStatus, newStatus }) => [previousStatus, newStatus])).toEqual([
    ['Under review', 'Issued'],
    ['Corrections requested', 'Issued'],
    ['Submitted', 'Corrections requested'],
  ]);
  expect(result.items.map((item) => item.permitId)).toEqual([
    assignedPermit.id,
    permit.id,
    permit.id,
  ]);
  expect(result.items.some((item) => item.permitId === otherPermit.id)).toBe(false);
  expect(await prisma.permitStatusEvent.count({ where: { permitId: permit.id } })).toBe(1);

  await page.goto(`${origin}/dashboard/monitoring?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Public status changes' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Monitoring' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(`status-change-${assignedIssuedCheck.id}`)).toBeVisible();
  await expect(page.getByTestId(`status-change-${issuedCheck.id}`)).toContainText('Corrections requested');
  await expect(page.getByTestId(`status-change-${issuedCheck.id}`)).toContainText('Issued');
  await expect(page.getByTestId(`status-change-${correctionsCheck.id}`)).toContainText('Submitted');
  await expect(page.getByTestId(`status-change-${assignedIssuedCheck.id}`)).toContainText(
    'Cedar Bathroom Addition',
  );
  await expect(page.getByText('Other Team Record')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'View status history for Willow Kitchen Remodel' }).first(),
  ).toHaveAttribute('href', new RegExp(`/dashboard/permits/${permit.id}\\?teamId=${team.id}`));

  await page
    .getByRole('link', { name: 'View status history for Willow Kitchen Remodel' })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Status history' })).toBeVisible();
  await expect(page.getByText('Ready to submit', { exact: true })).toBeVisible();
  expect(await prisma.permitStatusEvent.findUnique({ where: { id: manualEvent.id } })).not.toBeNull();

  await page.goto(`${origin}/dashboard/monitoring?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByTestId(`status-change-${assignedIssuedCheck.id}`)).toBeVisible();
  await captureMonitoringView(page, testInfo);
});

test('shows the empty state and returns no monitoring rows without paid team membership', async (
  { browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { page, userId } = await openSignedInPage(browser, origin);
  const emptyTeam = await createTeam(userId, 'QA Empty Monitoring Team');
  await addPaidMembership(emptyTeam.id, userId);
  const baselinePermit = await createPermit({
    userId,
    teamId: emptyTeam.id,
    projectName: 'Baseline Only Permit',
    permitNumber: `QA-${randomUUID().slice(0, 8)}`,
  });
  await addObservation(baselinePermit, 'Submitted', 'checked', '2026-10-01T08:00:00.000Z');

  const nonmemberTeam = await createTeam(userId, 'QA Nonmember Team');
  const unpaidTeam = await createTeam(userId, 'QA Unpaid Team');
  await prisma.teamMembership.create({
    data: { teamId: unpaidTeam.id, userId, role: 'owner' },
  });
  const pendingTeam = await createTeam(userId, 'QA Pending Team');
  await prisma.teamMembership.create({
    data: { teamId: pendingTeam.id, userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: { teamId: pendingTeam.id, userId, status: 'pending', grossAmountUsd: 299 },
  });
  const inactiveTeam = await createTeam(userId, 'QA Inactive Team');
  const inactivePurchaserId = await createFixtureUser(`qa-inactive-${randomUUID()}@example.test`);
  await addPaidMembership(inactiveTeam.id, userId, inactivePurchaserId);

  const emptyResponse = await page.request.get(
    `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(emptyTeam.id)}`,
  );
  expect(emptyResponse.status()).toBe(200);
  expect(await emptyResponse.json()).toEqual({ items: [] });

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousResponse = await anonymousContext.request.get(
    `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(emptyTeam.id)}`,
  );
  expect(anonymousResponse.status()).toBe(401);
  expect(await anonymousResponse.json()).not.toHaveProperty('items');

  const accessCases = [
    { teamId: nonmemberTeam.id, status: 403, error: 'team_membership_required' },
    { teamId: unpaidTeam.id, status: 402, error: 'team_subscription_required' },
    { teamId: pendingTeam.id, status: 402, error: 'team_subscription_required' },
    { teamId: inactiveTeam.id, status: 402, error: 'team_subscription_required' },
  ] as const;
  for (const accessCase of accessCases) {
    const denied = await page.request.get(
      `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(accessCase.teamId)}`,
    );
    expect(denied.status()).toBe(accessCase.status);
    const body = (await denied.json()) as { error?: string; paymentStatus?: string };
    expect(body.error).toBe(accessCase.error);
    expect(body).not.toHaveProperty('items');
    if (accessCase.teamId === pendingTeam.id) expect(body.paymentStatus).toBe('pending');
    if (accessCase.teamId === inactiveTeam.id) expect(body.paymentStatus).toBe('inactive');
  }

  await page.goto(`${origin}/dashboard/monitoring?teamId=${encodeURIComponent(emptyTeam.id)}`);
  await expect(page.getByRole('heading', { name: 'No public status changes detected' })).toBeVisible();
  await expect(page.getByText('Baseline Only Permit')).toHaveCount(0);
  await captureMonitoringView(page, testInfo);
});

