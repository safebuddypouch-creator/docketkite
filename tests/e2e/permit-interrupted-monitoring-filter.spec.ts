// @polsia:user-owned — saved interrupted-monitoring permit filter journey.
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

async function signIn(page: Page, origin: string, email: string, name: string) {
  const password = `QA-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name, email, password },
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
  const session = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const sessionBody = (await session.json()) as { user?: { id?: string; email?: string } };
  expect(sessionBody.user?.id).toBe(userId);
  expect(sessionBody.user?.email).toBe(email);
  fixtureUserIds.push(userId);
  return { userId, email };
}

async function createPaidTeam(name: string, ownerId: string) {
  const team = await prisma.teamSpace.create({
    data: {
      name,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: ownerId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId: ownerId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: ownerId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  return team;
}

async function createPermit(input: {
  teamId: string;
  ownerId: string;
  projectName: string;
  assignedTo?: string;
  archived?: boolean;
  outcome?: 'interrupted' | 'cleared';
  permitNumber?: string;
  address?: string;
  updatedAt?: Date;
}) {
  const permitNumber = `QA-${randomUUID()}`;
  const failedAt = new Date(Date.now() - 60_000);
  const successfulAt = new Date(Date.now() - 30_000);
  const interrupted = input.outcome === 'interrupted';
  const cleared = input.outcome === 'cleared';
  const permit = await prisma.permit.create({
    data: {
      userId: input.ownerId,
      teamId: input.teamId,
      assignedProjectManagerUserId: input.assignedTo,
      projectName: input.projectName,
      address: input.address ?? '100 Test Avenue, Tampa',
      permitNumber: input.permitNumber ?? permitNumber,
      permitType: 'Building',
      status: 'Under review',
      notes: '',
      archivedAt: input.archived ? new Date() : null,
      updatedAt: input.updatedAt,
      lastSuccessfulPortalCheckAt: interrupted ? failedAt : cleared ? successfulAt : null,
      portalMonitoringInterruptedAt: interrupted ? successfulAt : null,
      portalMonitoringReason: interrupted
        ? 'Synthetic interrupted watcher state for this test.'
        : null,
    },
  });
  if (input.outcome) {
    await prisma.permitPortalStatusCheck.createMany({
      data:
        interrupted
          ? [
              {
                permitId: permit.id,
                teamId: input.teamId,
                permitNumber,
                result: 'checked',
                status: 'Under review',
                checkedAt: failedAt,
              },
              {
                permitId: permit.id,
                teamId: input.teamId,
                permitNumber,
                result: 'unavailable',
                message: 'Synthetic interrupted watcher state for this test.',
                checkedAt: successfulAt,
              },
            ]
          : [
              {
                permitId: permit.id,
                teamId: input.teamId,
                permitNumber,
                result: 'unavailable',
                message: 'Older synthetic interruption cleared by a later check.',
                checkedAt: failedAt,
              },
              {
                permitId: permit.id,
                teamId: input.teamId,
                permitNumber,
                result: 'checked',
                status: 'Under review',
                checkedAt: successfulAt,
              },
            ],
    });
  }
  return permit;
}

async function permitIds(page: Page, origin: string, query: URLSearchParams) {
  const response = await page.request.get(`${origin}/api/permits?${query.toString()}`, {
    headers: { origin },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { items: { id: string }[] };
  return body.items.map((item) => item.id).sort();
}

async function captureFilterScreens(page: Page, testInfo: TestInfo) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    const overflow = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('*')]
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: typeof element.className === 'string' ? element.className : '',
            text: element.textContent?.trim().slice(0, 80) ?? '',
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
          };
        })
        .filter((element) => element.right > viewportWidth || element.left < 0)
        .slice(0, 12);
    });
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      overflow,
      `Horizontal overflow at ${viewport.width}px (${documentWidth}px document width): ${JSON.stringify(overflow)}`,
    ).toEqual([]);
    const interruptedFilter = page.getByRole('button', {
      name: 'Interrupted monitoring',
      exact: true,
    });
    await interruptedFilter.scrollIntoViewIfNeeded();
    await expect(
      interruptedFilter,
    ).toBeInViewport();
    const outcomeFilter = page.getByRole('combobox', { name: 'Latest monitoring outcome' });
    await outcomeFilter.scrollIntoViewIfNeeded();
    await expect(outcomeFilter).toBeInViewport();
    const assignedFilter = page.getByRole('button', { name: 'Assigned to me', exact: true });
    await assignedFilter.scrollIntoViewIfNeeded();
    await expect(assignedFilter).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`permit-interrupted-filter-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('heading', { name: 'No permits match these filters in Archived.' })
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

test('permit monitoring outcome filters use each selected team’s newest saved check in active and archived views', async (
  { page, browser, baseURL },
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signIn(
    page,
    origin,
    `qa-outcome-owner-${randomUUID()}@example.test`,
    'QA Outcome Owner',
  );
  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const manager = await signIn(
    managerPage,
    origin,
    `qa-outcome-manager-${randomUUID()}@example.test`,
    'QA Outcome Manager',
  );

  const team = await createPaidTeam('QA Outcome Team', owner.userId);
  const otherTeam = await createPaidTeam('QA Other Outcome Team', owner.userId);
  await prisma.teamMembership.createMany({
    data: [
      { teamId: team.id, userId: manager.userId, role: 'project_manager' },
      { teamId: otherTeam.id, userId: manager.userId, role: 'project_manager' },
    ],
  });

  const activeSuccessful = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Successful Outcome',
    outcome: 'cleared',
  });
  const activeFailed = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Failed Outcome',
    outcome: 'interrupted',
  });
  const activeUnverified = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Unverified Outcome',
  });
  await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: activeUnverified.id,
      teamId: team.id,
      permitNumber: activeUnverified.permitNumber,
      result: 'unverified',
      checkedAt: new Date(),
      requestSequence: 1,
    },
  });
  const activeNotChecked = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Not Yet Checked',
  });
  const archivedSuccessful = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Archived Successful Outcome',
    archived: true,
    outcome: 'cleared',
  });
  const archivedFailed = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Archived Failed Outcome',
    archived: true,
    outcome: 'interrupted',
  });
  const archivedNotChecked = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Archived Not Yet Checked',
    archived: true,
  });
  const combinedFailed = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Outcome Combined Filter Target',
    assignedTo: manager.userId,
    outcome: 'interrupted',
    permitNumber: `QA-OUTCOME-COMBINED-${randomUUID()}`,
  });
  await prisma.permit.update({
    where: { id: combinedFailed.id },
    data: { status: 'Issued' },
  });
  const foreignSuccessful = await createPermit({
    teamId: otherTeam.id,
    ownerId: owner.userId,
    projectName: 'QA Foreign Team Successful Outcome',
    outcome: 'cleared',
  });

  const idsForOutcome = async (
    selectedTeamId: string,
    outcome: 'successful' | 'failed' | 'not_checked',
    view: 'active' | 'archived' = 'active',
  ) => {
    const query = new URLSearchParams({ teamId: selectedTeamId, monitoringOutcome: outcome, view });
    return permitIds(page, origin, query);
  };

  expect(await idsForOutcome(team.id, 'successful')).toEqual([activeSuccessful.id]);
  expect(await idsForOutcome(team.id, 'failed')).toEqual(
    [activeFailed.id, activeUnverified.id, combinedFailed.id].sort(),
  );
  expect(await idsForOutcome(team.id, 'not_checked')).toEqual([activeNotChecked.id]);
  expect(await idsForOutcome(team.id, 'successful', 'archived')).toEqual([archivedSuccessful.id]);
  expect(await idsForOutcome(team.id, 'failed', 'archived')).toEqual([archivedFailed.id]);
  expect(await idsForOutcome(team.id, 'not_checked', 'archived')).toEqual([archivedNotChecked.id]);
  expect(await idsForOutcome(otherTeam.id, 'successful')).toEqual([foreignSuccessful.id]);

  const combinedQuery = new URLSearchParams({
    teamId: team.id,
    view: 'active',
    monitoringOutcome: 'failed',
    status: 'Issued',
    search: 'QA-OUTCOME-COMBINED',
    assignedToMe: 'true',
    interruptedMonitoring: 'true',
  });
  expect(await permitIds(managerPage, origin, combinedQuery)).toEqual([combinedFailed.id]);

  const observedTeamIds: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/permits?')) return;
    const requestTeamId = new URL(request.url()).searchParams.get('teamId');
    if (requestTeamId) observedTeamIds.push(requestTeamId);
  });
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const outcomeFilter = page.getByRole('combobox', { name: 'Latest monitoring outcome' });
  await expect(outcomeFilter).toBeVisible();
  await outcomeFilter.selectOption('successful');
  await expect(page.getByRole('heading', { name: activeSuccessful.projectName })).toBeVisible();
  await expect(page.getByRole('heading', { name: foreignSuccessful.projectName })).toHaveCount(0);
  await outcomeFilter.selectOption('failed');
  await expect(page.getByRole('heading', { name: activeFailed.projectName })).toBeVisible();
  await expect(page.getByRole('heading', { name: activeUnverified.projectName })).toBeVisible();
  await outcomeFilter.selectOption('not_checked');
  await expect(page.getByRole('heading', { name: activeNotChecked.projectName })).toBeVisible();
  await outcomeFilter.selectOption('');
  await expect(page.getByRole('heading', { name: activeSuccessful.projectName })).toBeVisible();
  expect(observedTeamIds.length).toBeGreaterThan(0);
  expect(observedTeamIds.every((observedTeamId) => observedTeamId === team.id)).toBe(true);

  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await outcomeFilter.selectOption('failed');
  await expect(page.getByRole('heading', { name: archivedFailed.projectName })).toBeVisible();
  await expect(page.getByRole('heading', { name: activeFailed.projectName })).toHaveCount(0);
  expect(observedTeamIds.every((observedTeamId) => observedTeamId === team.id)).toBe(true);

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.getByRole('combobox', { name: 'Latest monitoring outcome' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/docketkite-outcome-${viewport.name}.png`,
      fullPage: true,
    });
  }
});

test('team members filter saved interrupted monitoring within view and assignment filters', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signIn(
    page,
    origin,
    `qa-interrupted-owner-${randomUUID()}@example.test`,
    'QA Permit Owner',
  );
  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const manager = await signIn(
    managerPage,
    origin,
    `qa-interrupted-manager-${randomUUID()}@example.test`,
    'QA Project Manager',
  );

  const team = await createPaidTeam('QA Interrupted Monitoring Team', owner.userId);
  const otherTeam = await createPaidTeam('QA Other Monitoring Team', owner.userId);
  await prisma.teamMembership.createMany({
    data: [
      { teamId: team.id, userId: manager.userId, role: 'project_manager' },
      { teamId: otherTeam.id, userId: manager.userId, role: 'project_manager' },
    ],
  });

  const activeInterruptedAssigned = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Interrupted Assigned',
    assignedTo: manager.userId,
    outcome: 'interrupted',
  });
  const activeInterruptedUnassigned = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Interrupted Unassigned',
    outcome: 'interrupted',
  });
  const activeNoOutcomeAssigned = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active No Saved Outcome',
    assignedTo: manager.userId,
  });
  const activeClearedAssigned = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Active Cleared Outcome',
    assignedTo: manager.userId,
    outcome: 'cleared',
  });
  const archivedInterruptedUnassigned = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Archived Interrupted Unassigned',
    archived: true,
    outcome: 'interrupted',
  });
  const archivedClearedAssigned = await createPermit({
    teamId: team.id,
    ownerId: owner.userId,
    projectName: 'QA Archived Cleared Assigned',
    assignedTo: manager.userId,
    archived: true,
    outcome: 'cleared',
  });
  const otherTeamInterrupted = await createPermit({
    teamId: otherTeam.id,
    ownerId: owner.userId,
    projectName: 'QA Other Team Interrupted Permit',
    assignedTo: manager.userId,
    outcome: 'interrupted',
  });

  const sortSearch = `QA Sort ${randomUUID()}`;
  const sortReferenceA = await createPermit({
    teamId: otherTeam.id,
    ownerId: owner.userId,
    projectName: `${sortSearch} Reference A`,
    permitNumber: `${sortSearch}-A`,
    address: `${sortSearch} Zebra Avenue, Tampa`,
    assignedTo: manager.userId,
    archived: true,
    outcome: 'interrupted',
    updatedAt: new Date(Date.now() - 10_000),
  });
  const sortReferenceB = await createPermit({
    teamId: otherTeam.id,
    ownerId: owner.userId,
    projectName: `${sortSearch} Reference B`,
    permitNumber: `${sortSearch}-B`,
    address: `${sortSearch} Alpha Avenue, Tampa`,
    assignedTo: manager.userId,
    archived: true,
    outcome: 'interrupted',
    updatedAt: new Date(Date.now() - 30_000),
  });
  const sortReferenceC = await createPermit({
    teamId: otherTeam.id,
    ownerId: owner.userId,
    projectName: `${sortSearch} Reference C`,
    permitNumber: `${sortSearch}-C`,
    address: `${sortSearch} Maple Avenue, Tampa`,
    assignedTo: manager.userId,
    archived: true,
    outcome: 'interrupted',
    updatedAt: new Date(Date.now() - 20_000),
  });

  const matchingSortPermits = [sortReferenceA, sortReferenceB, sortReferenceC];
  const sortQuery = new URLSearchParams({
    teamId: otherTeam.id,
    view: 'archived',
    assignedToMe: 'true',
    interruptedMonitoring: 'true',
    search: sortSearch,
  });
  const getSortedReferences = async (sort?: string) => {
    const query = new URLSearchParams(sortQuery);
    if (sort) query.set('sort', sort);
    const response = await managerPage.request.get(`${origin}/api/permits?${query.toString()}`, {
      headers: { origin },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { items: { permitNumber: string }[] };
    return body.items.map((item) => item.permitNumber);
  };
  const activityOrder = [sortReferenceA, sortReferenceC, sortReferenceB].map(
    (permit) => permit.permitNumber,
  );
  expect(await getSortedReferences()).toEqual(activityOrder);
  expect(await getSortedReferences('reference')).toEqual(
    matchingSortPermits.map((permit) => permit.permitNumber),
  );
  expect(await getSortedReferences('address')).toEqual([
    sortReferenceB.permitNumber,
    sortReferenceC.permitNumber,
    sortReferenceA.permitNumber,
  ]);
  expect(await getSortedReferences('activity')).toEqual(activityOrder);

  const startingCheckCount = await prisma.permitPortalStatusCheck.count({
    where: { teamId: { in: [team.id, otherTeam.id] } },
  });
  const activeInterruptedQuery = new URLSearchParams({
    teamId: team.id,
    view: 'active',
    interruptedMonitoring: 'true',
  });
  expect(await permitIds(managerPage, origin, activeInterruptedQuery)).toEqual(
    [activeInterruptedAssigned.id, activeInterruptedUnassigned.id].sort(),
  );

  const activeAssignedAndInterruptedQuery = new URLSearchParams({
    teamId: team.id,
    view: 'active',
    assignedToMe: 'true',
    interruptedMonitoring: 'true',
  });
  expect(await permitIds(managerPage, origin, activeAssignedAndInterruptedQuery)).toEqual([
    activeInterruptedAssigned.id,
  ]);

  const activeAssignedQuery = new URLSearchParams({
    teamId: team.id,
    view: 'active',
    assignedToMe: 'true',
  });
  expect(await permitIds(managerPage, origin, activeAssignedQuery)).toEqual(
    [activeInterruptedAssigned.id, activeNoOutcomeAssigned.id, activeClearedAssigned.id].sort(),
  );

  const archivedInterruptedQuery = new URLSearchParams({
    teamId: team.id,
    view: 'archived',
    interruptedMonitoring: 'true',
  });
  expect(await permitIds(managerPage, origin, archivedInterruptedQuery)).toEqual([
    archivedInterruptedUnassigned.id,
  ]);

  const archivedCombinedQuery = new URLSearchParams({
    teamId: team.id,
    view: 'archived',
    assignedToMe: 'true',
    interruptedMonitoring: 'true',
  });
  expect(await permitIds(managerPage, origin, archivedCombinedQuery)).toEqual([]);

  const otherTeamQuery = new URLSearchParams({
    teamId: otherTeam.id,
    view: 'active',
    assignedToMe: 'true',
    interruptedMonitoring: 'true',
  });
  expect(await permitIds(managerPage, origin, otherTeamQuery)).toEqual([otherTeamInterrupted.id]);
  expect(
    await prisma.permitPortalStatusCheck.count({
      where: { teamId: { in: [team.id, otherTeam.id] } },
    }),
  ).toBe(startingCheckCount);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(
    page.getByRole('button', { name: 'Interrupted monitoring', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assigned to me' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Interrupted monitoring', exact: true }).click();
  await expect(page.getByRole('heading', { name: activeInterruptedAssigned.projectName })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: activeInterruptedUnassigned.projectName }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: activeClearedAssigned.projectName })).toHaveCount(0);

  await managerPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(managerPage.getByRole('heading', { name: activeInterruptedAssigned.projectName })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Interrupted monitoring', exact: true }).click();
  await expect(
    managerPage.getByRole('heading', { name: activeInterruptedUnassigned.projectName }),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('heading', { name: activeNoOutcomeAssigned.projectName }),
  ).toHaveCount(0);
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    managerPage.getByRole('heading', { name: activeInterruptedAssigned.projectName }),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('heading', { name: activeInterruptedUnassigned.projectName }),
  ).toHaveCount(0);
  await managerPage.getByRole('button', { name: 'Archived' }).click();
  await expect(
    managerPage.getByRole('heading', {
      name: 'No permits match these filters in Archived.',
    }),
  ).toBeVisible();
  await expect(
    managerPage.getByText('Filters: Interrupted monitoring and Assigned to me.'),
  ).toBeVisible();
  await expect(managerPage.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  await expect(managerPage.getByRole('button', { name: 'Show full team list' })).toHaveCount(0);
  await expect(
    managerPage.getByRole('button', { name: 'Add your first permit' }),
  ).toHaveCount(0);

  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    managerPage.getByRole('heading', { name: archivedInterruptedUnassigned.projectName }),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('heading', { name: archivedClearedAssigned.projectName }),
  ).toHaveCount(0);
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    managerPage.getByRole('heading', {
      name: 'No permits match these filters in Archived.',
    }),
  ).toBeVisible();
  await captureFilterScreens(managerPage, testInfo);

  await managerPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(otherTeam.id)}`);
  await expect(
    managerPage.getByRole('heading', { name: otherTeamInterrupted.projectName }),
  ).toBeVisible();
  await managerPage.getByRole('button', { name: 'Interrupted monitoring', exact: true }).click();
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await managerPage.getByRole('button', { name: 'Archived' }).click();
  await expect(managerPage.getByRole('heading', { name: sortReferenceA.projectName })).toBeVisible();

  const sortControl = managerPage.getByRole('combobox', { name: 'Sort permits' });
  await expect(sortControl).toHaveValue('activity');
  await managerPage.getByRole('searchbox', { name: 'Search permits' }).fill(sortSearch);

  const archivedCardNames = async () =>
    managerPage
      .locator('section[aria-label="Archived permits"] > article h2')
      .allTextContents();
  const referenceProjectNames = matchingSortPermits.map((permit) => permit.projectName);
  const activityProjectNames = [sortReferenceA, sortReferenceC, sortReferenceB].map(
    (permit) => permit.projectName,
  );
  const addressProjectNames = [sortReferenceB, sortReferenceC, sortReferenceA].map(
    (permit) => permit.projectName,
  );
  await expect.poll(archivedCardNames).toEqual(activityProjectNames);

  expect(new URL(managerPage.url()).searchParams.get('teamId')).toBe(otherTeam.id);
  await expect(managerPage.getByRole('button', { name: 'Archived' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(managerPage.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    managerPage.getByRole('button', { name: 'Interrupted monitoring', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(managerPage.getByRole('searchbox', { name: 'Search permits' })).toHaveValue(
    sortSearch,
  );

  await sortControl.focus();
  await sortControl.press('Home');
  await expect(sortControl).toHaveValue('reference');
  await expect.poll(archivedCardNames).toEqual(referenceProjectNames);
  await sortControl.press('ArrowDown');
  await expect(sortControl).toHaveValue('address');
  await expect.poll(archivedCardNames).toEqual(addressProjectNames);
  await sortControl.press('End');
  await expect(sortControl).toHaveValue('activity');
  await expect.poll(archivedCardNames).toEqual(activityProjectNames);
  expect(new URL(managerPage.url()).searchParams.get('teamId')).toBe(otherTeam.id);

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await managerPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await sortControl.scrollIntoViewIfNeeded();
    await expect(sortControl).toBeInViewport();
    expect(
      await managerPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await managerPage.screenshot({
      path: testInfo.outputPath(`permit-sorting-filtered-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await managerPage.setViewportSize({ width: 1440, height: 900 });
  await sortControl.scrollIntoViewIfNeeded();
  expect(
    await prisma.permitPortalStatusCheck.count({
      where: { teamId: { in: [team.id, otherTeam.id] } },
    }),
  ).toBe(startingCheckCount);
});
