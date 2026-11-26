// @polsia:user-owned — owner-managed project-manager permit assignment journey.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

async function signIn(page: Page, origin: string, email: string, name: string) {
  const password = `Qa-${randomUUID()}-9a`;
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

async function createFixtureUser(email: string, name: string) {
  const userId = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: { id: userId, email, name, emailVerified: true, createdAt: now, updatedAt: now },
  });
  fixtureUserIds.push(userId);
  return userId;
}

async function captureAssignmentScreens(page: Page, testInfo: TestInfo, prefix: string) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({
      path: testInfo.outputPath(`permit-assignment-${prefix}-${viewport.name}.png`),
      fullPage: true,
    });
  }
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

test('only the team owner can assign a permit to an accepted project manager in that team', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signIn(
    page,
    origin,
    `qa-assignment-owner-${randomUUID()}@example.test`,
    'QA Team Owner',
  );

  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Permit Assignment Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: owner.userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: owner.userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const permit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Assignment Kitchen Remodel',
      address: '101 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const managerEmail = `qa-manager-${randomUUID()}@example.test`;
  const manager = await signIn(managerPage, origin, managerEmail, 'Accepted Project Manager');
  const invitationToken = randomBytes(32).toString('base64url');
  await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      invitedByUserId: owner.userId,
      invitedEmail: managerEmail,
      tokenHash: createHash('sha256').update(invitationToken).digest('hex'),
      role: 'project_manager',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const acceptInvite = await managerPage.request.post(`${origin}/api/team-invitations/accept`, {
    headers: { origin },
    data: { token: invitationToken },
  });
  expect(acceptInvite.status(), await acceptInvite.text()).toBe(200);
  expect(
    (await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: manager.userId } },
    }))?.role,
  ).toBe('project_manager');

  const pendingEmail = `qa-pending-${randomUUID()}@example.test`;
  const pendingUserId = await createFixtureUser(pendingEmail, 'Pending Project Manager');
  await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      invitedByUserId: owner.userId,
      invitedEmail: pendingEmail,
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      role: 'project_manager',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const purchaserId = await createFixtureUser(
    `qa-purchaser-${randomUUID()}@example.test`,
    'Team Purchaser',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: purchaserId, role: 'purchaser' },
  });

  const otherTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Other Assignment Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(otherTeam.id);
  const otherManagerId = await createFixtureUser(
    `qa-other-manager-${randomUUID()}@example.test`,
    'Other Team Project Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: otherTeam.id, userId: otherManagerId, role: 'project_manager' },
  });
  await prisma.teamMembership.create({
    data: { teamId: otherTeam.id, userId: manager.userId, role: 'project_manager' },
  });
  const otherTeamPermit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: otherTeam.id,
      projectName: 'QA Permit In Another Team',
      address: '202 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      assignedProjectManagerUserId: manager.userId,
    },
  });
  await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Unassigned Active Permit',
      address: '103 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });
  const archivedAssignedPermit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Archived Assigned Permit',
      address: '104 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      assignedProjectManagerUserId: manager.userId,
      archivedAt: new Date(),
    },
  });
  const archivedUnassignedPermit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Archived Unassigned Permit',
      address: '105 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      archivedAt: new Date(),
    },
  });

  const listResponse = await page.request.get(`${origin}/api/permits?teamId=${team.id}`, {
    headers: { origin },
  });
  expect(listResponse.status(), await listResponse.text()).toBe(200);
  const permitList = (await listResponse.json()) as {
    items: { id: string; assignedProjectManager: { id: string; name: string } | null }[];
    projectManagers: { id: string; name: string }[];
  };
  expect(permitList.projectManagers.map((item) => item.id)).toEqual([manager.userId]);
  expect(permitList.items).toHaveLength(2);
  expect(permitList.items.every((item) => item.assignedProjectManager === null)).toBe(true);

  const ownerFilteredResponse = await page.request.get(
    `${origin}/api/permits?teamId=${team.id}&assignedToMe=true&userId=${manager.userId}`,
    { headers: { origin } },
  );
  expect(ownerFilteredResponse.status(), await ownerFilteredResponse.text()).toBe(200);
  expect(((await ownerFilteredResponse.json()) as { items: unknown[] }).items).toHaveLength(2);

  const deniedTeamResponse = await page.request.get(
    `${origin}/api/permits?teamId=${otherTeam.id}&assignedToMe=true&userId=${manager.userId}`,
    { headers: { origin } },
  );
  expect(deniedTeamResponse.status(), await deniedTeamResponse.text()).toBe(403);

  const assignmentUrl = `${origin}/api/permits`;
  for (const ineligibleUserId of [pendingUserId, purchaserId, otherManagerId]) {
    const response = await page.request.patch(assignmentUrl, {
      headers: { origin },
      data: {
        action: 'assign',
        id: permit.id,
        teamId: team.id,
        projectManagerUserId: ineligibleUserId,
      },
    });
    expect(response.status(), await response.text()).toBe(422);
  }
  expect(
    (await prisma.permit.findUnique({ where: { id: permit.id } }))?.assignedProjectManagerUserId,
  ).toBeNull();

  const managerListResponse = await managerPage.request.get(
    `${origin}/api/permits?teamId=${team.id}`,
    { headers: { origin } },
  );
  expect(managerListResponse.status(), await managerListResponse.text()).toBe(200);
  const managerList = (await managerListResponse.json()) as {
    items: { id: string }[];
    projectManagers: unknown[];
  };
  expect(managerList.projectManagers).toEqual([]);
  expect(managerList.items).toHaveLength(2);

  const spoofedManagerFilter = await managerPage.request.get(
    `${origin}/api/permits?teamId=${team.id}&assignedToMe=true&userId=${owner.userId}`,
    { headers: { origin } },
  );
  expect(spoofedManagerFilter.status(), await spoofedManagerFilter.text()).toBe(200);
  expect(((await spoofedManagerFilter.json()) as { items: unknown[] }).items).toEqual([]);

  await managerPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(managerPage.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  const managerFilter = managerPage.getByRole('button', { name: 'Assigned to me' });
  await expect(managerFilter).toHaveAttribute('aria-pressed', 'false');
  await managerFilter.click();
  await expect(
    managerPage.getByRole('heading', { name: 'No permits are assigned to you in Active.' }),
  ).toBeVisible();
  await expect(
    managerPage.getByText('Turn off Assigned to me to return to the full team list.'),
  ).toBeVisible();
  await managerPage.getByRole('button', { name: 'Show full team list' }).click();
  await expect(managerPage.getByRole('heading', { name: permit.projectName })).toBeVisible();
  await expect(managerPage.getByRole('heading', { name: 'QA Unassigned Active Permit' })).toBeVisible();

  const managerAssignment = await managerPage.request.patch(assignmentUrl, {
    headers: { origin },
    data: {
      action: 'assign',
      id: permit.id,
      teamId: team.id,
      projectManagerUserId: manager.userId,
    },
  });
  expect(managerAssignment.status(), await managerAssignment.text()).toBe(403);
  expect(
    (await prisma.permit.findUnique({ where: { id: permit.id } }))?.assignedProjectManagerUserId,
  ).toBeNull();

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assigned to me' })).toHaveCount(0);
  const assignedPermitCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: permit.projectName }) });
  await expect(assignedPermitCard.getByLabel('Change assignment')).toBeVisible();
  await assignedPermitCard.getByLabel('Change assignment').selectOption(manager.userId);
  await assignedPermitCard.getByRole('button', { name: 'Save assignment' }).click();
  await expect(page.getByText('Project manager assignment saved.')).toBeVisible();
  await expect(
    assignedPermitCard.locator('p').filter({ hasText: 'Project manager:' }),
  ).toContainText('Accepted Project Manager');
  expect(
    (await prisma.permit.findUnique({ where: { id: permit.id } }))?.assignedProjectManagerUserId,
  ).toBe(manager.userId);

  const filteredManagerResponse = await managerPage.request.get(
    `${origin}/api/permits?teamId=${team.id}&view=active&assignedToMe=true&userId=${owner.userId}`,
    { headers: { origin } },
  );
  expect(filteredManagerResponse.status(), await filteredManagerResponse.text()).toBe(200);
  const filteredManagerItems = (await filteredManagerResponse.json()) as {
    items: { id: string }[];
  };
  expect(filteredManagerItems.items.map((item) => item.id)).toEqual([permit.id]);
  expect(filteredManagerItems.items.map((item) => item.id)).not.toContain(otherTeamPermit.id);

  const filteredArchivedResponse = await managerPage.request.get(
    `${origin}/api/permits?teamId=${team.id}&view=archived&assignedToMe=true`,
    { headers: { origin } },
  );
  expect(filteredArchivedResponse.status(), await filteredArchivedResponse.text()).toBe(200);
  expect(
    ((await filteredArchivedResponse.json()) as { items: { id: string }[] }).items.map(
      (item) => item.id,
    ),
  ).toEqual([archivedAssignedPermit.id]);

  const archivedFullResponse = await managerPage.request.get(
    `${origin}/api/permits?teamId=${team.id}&view=archived`,
    { headers: { origin } },
  );
  expect(archivedFullResponse.status(), await archivedFullResponse.text()).toBe(200);
  expect(
    ((await archivedFullResponse.json()) as { items: { id: string }[] }).items.map(
      (item) => item.id,
    ),
  ).toEqual(expect.arrayContaining([archivedAssignedPermit.id, archivedUnassignedPermit.id]));

  await managerPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(managerPage.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await expect(managerPage.getByRole('heading', { name: permit.projectName })).toBeVisible();
  await expect(managerPage.getByRole('heading', { name: 'QA Unassigned Active Permit' })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(managerPage.getByRole('heading', { name: permit.projectName })).toBeVisible();
  await expect(managerPage.getByRole('heading', { name: 'QA Unassigned Active Permit' })).toHaveCount(0);
  await managerPage.getByRole('button', { name: 'Archived' }).click();
  await expect(
    managerPage.getByRole('heading', { name: archivedAssignedPermit.projectName }),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('heading', { name: archivedUnassignedPermit.projectName }),
  ).toHaveCount(0);
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    managerPage.getByRole('heading', { name: archivedAssignedPermit.projectName }),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('heading', { name: archivedUnassignedPermit.projectName }),
  ).toBeVisible();
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    managerPage.getByRole('heading', { name: archivedAssignedPermit.projectName }),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('heading', { name: archivedUnassignedPermit.projectName }),
  ).toHaveCount(0);
  await expect(
    managerPage
      .locator('article')
      .filter({ has: managerPage.getByRole('heading', { name: archivedAssignedPermit.projectName }) })
      .locator('p')
      .filter({ hasText: 'Project manager:' }),
  ).toContainText('Accepted Project Manager');
  await expect(managerPage.getByLabel('Change assignment')).toHaveCount(0);
  await expect(page.getByText('Project manager assignment saved.')).toBeHidden();
  await captureAssignmentScreens(page, testInfo, 'owner');
  await captureAssignmentScreens(managerPage, testInfo, 'manager');
});

test('project managers can turn off the filter when Active or Archived has no assignments', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const ownerContext = await browser.newContext();
  fixtureContexts.push(ownerContext);
  const ownerPage = await ownerContext.newPage();
  const owner = await signIn(
    ownerPage,
    origin,
    `qa-empty-assignment-owner-${randomUUID()}@example.test`,
    'QA Empty-State Owner',
  );
  const manager = await signIn(
    page,
    origin,
    `qa-empty-manager-${randomUUID()}@example.test`,
    'Empty-State Project Manager',
  );

  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Empty Assignment Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: owner.userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: owner.userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const invitationToken = randomBytes(32).toString('base64url');
  await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      invitedByUserId: owner.userId,
      invitedEmail: manager.email,
      tokenHash: createHash('sha256').update(invitationToken).digest('hex'),
      role: 'project_manager',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const acceptInvite = await page.request.post(`${origin}/api/team-invitations/accept`, {
    headers: { origin },
    data: { token: invitationToken },
  });
  expect(acceptInvite.status(), await acceptInvite.text()).toBe(200);

  await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Permit Without an Assignment',
      address: '301 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });
  await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Archived Permit Without an Assignment',
      address: '302 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      archivedAt: new Date(),
    },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    page.getByRole('heading', { name: 'No permits are assigned to you in Active.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show full team list' }).click();
  await expect(page.getByRole('heading', { name: 'QA Permit Without an Assignment' })).toBeVisible();

  await page.getByRole('button', { name: 'Assigned to me' }).click();
  await page.getByRole('button', { name: 'Archived' }).click();
  await expect(
    page.getByRole('heading', { name: 'No permits are assigned to you in Archived.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show full team list' }).click();
  await expect(
    page.getByRole('heading', { name: 'QA Archived Permit Without an Assignment' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(
    page.getByRole('heading', { name: 'No permits are assigned to you in Archived.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await captureAssignmentScreens(page, testInfo, 'empty-manager');
});

test('permit search composes with team, Active or Archived, and Assigned to me scopes', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const ownerContext = await browser.newContext();
  fixtureContexts.push(ownerContext);
  const ownerPage = await ownerContext.newPage();
  const owner = await signIn(
    ownerPage,
    origin,
    `qa-search-owner-${randomUUID()}@example.test`,
    'Search Fixture Owner',
  );
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Permit Search Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: owner.userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: owner.userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const managerPage = page;
  const manager = await signIn(
    managerPage,
    origin,
    `qa-search-manager-${randomUUID()}@example.test`,
    'Search Fixture Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: manager.userId, role: 'project_manager' },
  });

  const outsiderContext = await browser.newContext();
  fixtureContexts.push(outsiderContext);
  const outsiderPage = await outsiderContext.newPage();
  const outsider = await signIn(
    outsiderPage,
    origin,
    `qa-search-outsider-${randomUUID()}@example.test`,
    'Search Fixture Outsider',
  );

  const matchingActive = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Willow Kitchen',
      address: '101 Willow Avenue, Tampa',
      permitNumber: 'BLD-25-001',
      permitType: 'Building',
      status: 'Under review',
      notes: '',
      assignedProjectManagerUserId: manager.userId,
    },
  });
  const unassignedActive = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Mission Bathroom',
      address: '202 Mission Street, Tampa',
      permitNumber: 'BLD-25-002',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });
  const matchingArchived = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Archived Remodel',
      address: '303 Archive Lane, Tampa',
      permitNumber: 'BLD-24-003',
      permitType: 'Building',
      status: 'Issued',
      notes: '',
      assignedProjectManagerUserId: manager.userId,
      archivedAt: new Date(),
    },
  });
  const otherTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Separate Search Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(otherTeam.id);
  const otherTeamPermit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: otherTeam.id,
      projectName: 'QA Other Team Willow Kitchen',
      address: '101 Willow Avenue, Tampa',
      permitNumber: 'BLD-25-001',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });

  const teamQuery = `teamId=${encodeURIComponent(team.id)}`;
  const numberSearch = await ownerPage.request.get(
    `${origin}/api/permits?${teamQuery}&view=active&status=Under%20review&search=bld-25-00`,
  );
  expect(numberSearch.status()).toBe(200);
  const numberSearchItems = ((await numberSearch.json()) as { items: { id: string }[] }).items;
  expect(numberSearchItems.map((item) => item.id)).toEqual([matchingActive.id]);
  expect(numberSearchItems.map((item) => item.id)).not.toContain(otherTeamPermit.id);

  const addressSearch = await ownerPage.request.get(
    `${origin}/api/permits?${teamQuery}&view=active&search=mission`,
  );
  expect(addressSearch.status()).toBe(200);
  expect(((await addressSearch.json()) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
    unassignedActive.id,
  ]);

  const archivedSearch = await ownerPage.request.get(
    `${origin}/api/permits?${teamQuery}&view=archived&search=archive`,
  );
  expect(archivedSearch.status()).toBe(200);
  expect(((await archivedSearch.json()) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
    matchingArchived.id,
  ]);

  const assignedSearch = await managerPage.request.get(
    `${origin}/api/permits?${teamQuery}&view=active&assignedToMe=true&userId=${encodeURIComponent(owner.userId)}&search=BLD-25`,
  );
  expect(assignedSearch.status()).toBe(200);
  expect(((await assignedSearch.json()) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
    matchingActive.id,
  ]);

  const assignedArchivedSearch = await managerPage.request.get(
    `${origin}/api/permits?${teamQuery}&view=archived&assignedToMe=true&search=archive`,
  );
  expect(assignedArchivedSearch.status()).toBe(200);
  expect(
    ((await assignedArchivedSearch.json()) as { items: { id: string }[] }).items.map((item) => item.id),
  ).toEqual([matchingArchived.id]);

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();
  const anonymousSearch = await anonymousPage.request.get(
    `${origin}/api/permits?${teamQuery}&search=BLD-25-001`,
  );
  expect(anonymousSearch.status()).toBe(401);
  expect((await anonymousSearch.json()).items).toBeUndefined();

  const nonMemberSearch = await outsiderPage.request.get(
    `${origin}/api/permits?${teamQuery}&search=BLD-25-001`,
  );
  expect(nonMemberSearch.status()).toBe(403);
  expect((await nonMemberSearch.json()).items).toBeUndefined();

  const otherTeamSearch = await ownerPage.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(otherTeam.id)}&search=BLD-25-001`,
  );
  expect(otherTeamSearch.status()).toBe(403);
  expect((await otherTeamSearch.json()).items).toBeUndefined();

  await managerPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(managerPage.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  const searchField = managerPage.getByRole('searchbox', { name: 'Search permits' });
  await expect(searchField).toBeVisible();
  await searchField.fill('Willow Avenue');
  await expect(managerPage.getByRole('heading', { name: 'QA Willow Kitchen' })).toBeVisible();
  await expect(managerPage.getByRole('heading', { name: 'QA Mission Bathroom' })).toHaveCount(0);

  await managerPage.getByRole('button', { name: 'Archived' }).click();
  await searchField.fill('Archive Lane');
  await expect(managerPage.getByRole('heading', { name: 'QA Archived Remodel' })).toBeVisible();
  await expect(managerPage.getByRole('button', { name: 'Archived' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(managerPage.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await searchField.fill('No match');
  await expect(
    managerPage.getByRole('heading', {
      name: 'No permits match “No match” in your Archived list for Assigned to me.',
    }),
  ).toBeVisible();
  await expect(
    managerPage.getByText(/search checks this team's selected list by permit reference or property address/i),
  ).toBeVisible();
  await managerPage.getByRole('button', { name: 'Clear search' }).click();
  await expect(searchField).toHaveValue('');
  await expect(managerPage.getByRole('heading', { name: 'QA Archived Remodel' })).toBeVisible();

  await searchField.fill('No match');
  await expect(
    managerPage.getByRole('heading', {
      name: 'No permits match “No match” in your Archived list for Assigned to me.',
    }),
  ).toBeVisible();

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await managerPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(searchField).toBeVisible();
    await expect(managerPage.getByRole('button', { name: 'Clear search' })).toBeVisible();
    if (viewport.width < 768) {
      await expect(managerPage.getByRole('button', { name: 'Archived' })).toBeVisible();
      await expect(managerPage.getByRole('button', { name: 'Assigned to me' })).toBeVisible();
      const horizontalOverflow = await managerPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(horizontalOverflow, `permit search overflow at ${viewport.width}px`).toBe(0);
    }
    await managerPage.screenshot({
      path: testInfo.outputPath(`permit-search-empty-${viewport.name}.png`),
      fullPage: true,
    });
  }

  await managerPage.setViewportSize({ width: 390, height: 844 });
});

test('a verified $299 checkout stays locked until the team subscription is active', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const inactiveEmail = `qa-search-inactive-${randomUUID()}@example.test`;
  const owner = await signIn(page, origin, inactiveEmail, 'Inactive Subscription Owner');
  const inactiveDigest = createHash('sha256').update(inactiveEmail.toLowerCase()).digest('hex');
  writeFileSync(
    `/tmp/polsia-subscription-state-${inactiveDigest}.json`,
    JSON.stringify({ active: false, unavailable: false, status: 'canceled' }),
  );
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Inactive Subscription Search Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: owner.userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: owner.userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  const permit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      projectName: 'QA Paid but Inactive Search Permit',
      address: '88 Inactive Subscription Way, Tampa',
      permitNumber: 'QA-INACTIVE-299',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });

  const teamQuery = `teamId=${encodeURIComponent(team.id)}`;
  for (const search of ['', '&search=QA-INACTIVE-299']) {
    const response = await page.request.get(`${origin}/api/permits?${teamQuery}${search}`);
    expect(response.status()).toBe(402);
    const body = (await response.json()) as { paymentStatus?: string; items?: unknown[] };
    expect(body.paymentStatus).toBe('inactive');
    expect(body.items).toBeUndefined();
  }

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(page.getByText(/the team subscription is not active/i)).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search permits' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('inactive-subscription-search-locked.png'), fullPage: true });

  const activeEmail = `qa-search-active-${randomUUID()}@example.test`;
  await prisma.user.update({ where: { id: owner.userId }, data: { email: activeEmail } });
  const activeDigest = createHash('sha256').update(activeEmail.toLowerCase()).digest('hex');
  writeFileSync(
    `/tmp/polsia-subscription-state-${activeDigest}.json`,
    JSON.stringify({ active: true, unavailable: false, status: 'active' }),
  );
  const activeSearch = await page.request.get(
    `${origin}/api/permits?${teamQuery}&search=QA-INACTIVE-299`,
  );
  expect(activeSearch.status()).toBe(200);
  expect(((await activeSearch.json()) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
    permit.id,
  ]);

  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search permits' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search permits' }).fill('QA-INACTIVE-299');
  await expect(page.getByRole('heading', { name: 'QA Paid but Inactive Search Permit' })).toBeVisible();
});
