// @polsia:user-owned — owner-only test access stays separate from customer billing.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { tampaRecordUrl } from './permit-test-helpers';
import type { CsvMapping } from '@/modules/csv-import/contracts';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];
const subscriptionStatePaths: string[] = [];
const ownerPassword = 'Qa-Owner-Testing-Account-9a';
const EMAIL_CAPTURE_PATH = '/tmp/polsia-permit-status-email-capture.ndjson';

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  html: string;
}

interface SessionResponse {
  user?: { id?: string; email?: string };
}

interface TeamListResponse {
  items: Array<{
    id: string;
    role: 'owner' | 'purchaser' | 'project_manager';
    accessActive: boolean;
    accessMode: 'paid_subscription' | 'owner_testing' | 'subscription_required';
    paymentStatus: 'unpaid' | 'pending' | 'active' | 'inactive' | 'unavailable';
  }>;
}

async function signInNewAccount(page: Page, origin: string, email: string, name: string) {
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name, email, password },
  });
  expect(signup.status(), await signup.text()).toBe(200);

  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const session = (await sessionResponse.json()) as SessionResponse;
  const userId = session.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not return a session user.');
  fixtureUserIds.push(userId);

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signin.status(), await signin.text()).toBe(200);
  return userId;
}

async function signInConfiguredOwner(page: Page, origin: string) {
  const email = process.env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('POLSIA_OWNER_EMAIL must identify the synthetic test owner.');

  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'DocketKite Test Owner', email, password: ownerPassword },
  });
  if (signup.status() === 200) {
    const initialSession = await page.request.get(`${origin}/api/auth/get-session`, {
      headers: { origin },
    });
    const initialBody = (await initialSession.json()) as SessionResponse;
    const createdId = initialBody.user?.id;
    expect(createdId).toBeTruthy();
  }

  await prisma.user.updateMany({ where: { email }, data: { emailVerified: true } });
  let signinStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
      headers: { origin },
      data: { email, password: ownerPassword, callbackURL: '/' },
    });
    signinStatus = signin.status();
    if (signinStatus === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(signinStatus, 'the configured owner must sign in through the app auth route').toBe(200);

  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const session = (await sessionResponse.json()) as SessionResponse;
  expect(session.user?.email?.trim().toLowerCase()).toBe(email.toLowerCase());
  if (!session.user?.id) throw new Error('Owner sign-in did not return a session user.');
  fixtureUserIds.push(session.user.id);
  return session.user.id;
}

async function createTeam(page: Page, origin: string, name: string) {
  const response = await page.request.post(`${origin}/api/teams`, {
    headers: { origin },
    data: { action: 'create', name },
  });
  expect(response.status(), await response.text()).toBe(201);
  const team = (await response.json()) as { id: string };
  fixtureTeamIds.push(team.id);
  return team;
}

async function capturedStatusEmails(projectName: string): Promise<CapturedEmail[]> {
  const contents = await readFile(EMAIL_CAPTURE_PATH, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  });
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail)
    .filter((email) => email.subject === `Public permit status changed: ${projectName}`);
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
  await Promise.all(subscriptionStatePaths.map((path) => unlink(path).catch(() => undefined)));
  subscriptionStatePaths.length = 0;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function setSubscriptionState(email: string, active: boolean) {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const path = `/tmp/polsia-subscription-state-${digest}.json`;
  subscriptionStatePaths.push(path);
  await writeFile(
    path,
    JSON.stringify({ active, unavailable: false }),
    'utf8',
  );
}

test('the configured owner can test without checkout while customer teams stay gated', async (
  { browser, page, baseURL },
  testInfo: TestInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const ownerEmail = process.env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) throw new Error('POLSIA_OWNER_EMAIL must identify the synthetic test owner.');
  const ownerId = await signInConfiguredOwner(page, origin);
  expect(await prisma.teamMembership.count({ where: { userId: ownerId } })).toBe(0);
  expect(await prisma.teamSpace.count({ where: { createdByUserId: ownerId } })).toBe(0);

  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  const teamName = `Owner test ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Team name').fill(teamName);
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(
    page.getByText(
      'Owner test workspace created without checkout. Other team members remain behind the paid access gate.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Owner-only test workspace')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();

  const teamsResponse = await page.request.get(`${origin}/api/teams`, { headers: { origin } });
  expect(teamsResponse.status()).toBe(200);
  const teams = (await teamsResponse.json()) as TeamListResponse;
  const ownerTestTeam = teams.items.find((team) => team.role === 'owner');
  expect(ownerTestTeam).toMatchObject({
    accessActive: true,
    accessMode: 'owner_testing',
    paymentStatus: 'unpaid',
  });
  if (!ownerTestTeam) throw new Error('The created owner test workspace was not returned to its owner.');
  fixtureTeamIds.push(ownerTestTeam.id);
  expect(await prisma.teamCheckout.count({ where: { teamId: ownerTestTeam.id } })).toBe(0);
  const ownerPermitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTestTeam.id)}`,
    { headers: { origin } },
  );
  expect(ownerPermitList.status()).toBe(200);

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const managerEmail = `qa-owner-testing-manager-${randomUUID()}@example.test`;
  const managerUserId = await signInNewAccount(
    managerPage,
    origin,
    managerEmail,
    'Synthetic Assigned Project Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: ownerTestTeam.id, userId: managerUserId, role: 'project_manager' },
  });
  const publicPermitUrl =
    'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02LZA&agencyCode=TAMPA&IsToShowInspection=';
  const publicPermit = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: ownerTestTeam.id,
      assignedProjectManagerUserId: managerUserId,
      projectName: 'Tampa public record verification',
      address: 'City of Tampa public record; address omitted in test workspace',
      permitNumber: 'TWN-26-0000005-MS',
      permitType: 'Building',
      status: 'Under review',
      notes: 'Disposable public-record verification fixture.',
      portalUrl: publicPermitUrl,
    },
  });
  const ownerRecordListResponse = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTestTeam.id)}`,
    { headers: { origin } },
  );
  expect(ownerRecordListResponse.status()).toBe(200);
  const ownerRecordList = (await ownerRecordListResponse.json()) as {
    items: Array<{
      id: string;
      permitNumber: string;
      portalUrl: string;
      assignedProjectManager: { id: string; name: string } | null;
    }>;
  };
  expect(ownerRecordList.items.find((item) => item.id === publicPermit.id)).toMatchObject({
    permitNumber: 'TWN-26-0000005-MS',
    portalUrl: publicPermitUrl,
    assignedProjectManager: {
      id: managerUserId,
      name: 'Synthetic Assigned Project Manager',
    },
  });
  const ownerRecordHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(publicPermit.id)}&teamId=${encodeURIComponent(ownerTestTeam.id)}`,
    { headers: { origin } },
  );
  expect(ownerRecordHistory.status()).toBe(200);
  const ownerTestMemberDenied = await managerPage.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTestTeam.id)}`,
    { headers: { origin } },
  );
  expect(ownerTestMemberDenied.status()).toBe(402);
  await prisma.permit.delete({ where: { id: publicPermit.id } });

  // Turn this synthetic fixture into an ordinary customer team so the existing
  // checkout assertions continue to exercise the paid gate independently.
  await prisma.teamSpace.update({ where: { id: ownerTestTeam.id }, data: { ownerTesting: false } });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  const refreshedTeamsResponse = await page.request.get(`${origin}/api/teams`, { headers: { origin } });
  const refreshedTeams = (await refreshedTeamsResponse.json()) as TeamListResponse;
  const ownerTeam = refreshedTeams.items.find((team) => team.id === ownerTestTeam.id);
  expect(ownerTeam).toMatchObject({
    accessActive: false,
    accessMode: 'subscription_required',
    paymentStatus: 'unpaid',
  });
  if (!ownerTeam) throw new Error('The customer billing workspace was not returned to its owner.');

  await page.route('https://checkout.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Hosted checkout test stand-in</title><main>Hosted checkout test stand-in</main>',
    }),
  );
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(`https://checkout.example.test/session/${ownerTeam.id}`);
  await expect(page.getByText('Hosted checkout test stand-in')).toBeVisible();
  const pendingCheckout = await prisma.teamCheckout.findFirst({ where: { teamId: ownerTeam.id } });
  expect(pendingCheckout).toMatchObject({ status: 'pending', grossAmountUsd: null, verifiedAt: null });
  if (!pendingCheckout?.stripeSessionId) throw new Error('Checkout did not save its hosted session.');
  const pendingAccess = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTeam.id)}`,
    { headers: { origin } },
  );
  expect(pendingAccess.status()).toBe(402);
  expect(await pendingAccess.json()).toMatchObject({ paymentStatus: 'pending' });

  const unverifiedCheckout = await prisma.teamCheckout.create({
    data: {
      teamId: ownerTeam.id,
      userId: ownerId,
      status: 'pending',
      stripeSessionId: `cs_unverified_${randomUUID()}`,
    },
  });
  const unverifiedResult = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: unverifiedCheckout.stripeSessionId },
  });
  expect(unverifiedResult.status()).toBe(409);
  expect(await unverifiedResult.json()).toMatchObject({ error: 'payment_not_verified' });
  expect(await prisma.teamCheckout.findUnique({ where: { id: unverifiedCheckout.id } })).toMatchObject({
    status: 'pending',
    grossAmountUsd: null,
    verifiedAt: null,
  });
  const accessAfterUnverifiedResult = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTeam.id)}`,
    { headers: { origin } },
  );
  expect(accessAfterUnverifiedResult.status()).toBe(402);
  expect(await accessAfterUnverifiedResult.json()).toMatchObject({ paymentStatus: 'pending' });
  await setSubscriptionState(ownerEmail, false);

  const verification = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: pendingCheckout.stripeSessionId },
  });
  expect(verification.status(), await verification.text()).toBe(200);
  expect(await verification.json()).toMatchObject({
    verified: false,
    reason: 'subscription_inactive',
  });
  const verifiedCheckout = await prisma.teamCheckout.findUnique({ where: { id: pendingCheckout.id } });
  expect(verifiedCheckout).toMatchObject({
    status: 'pending',
    grossAmountUsd: null,
    verifiedAt: null,
  });
  const verifiedWithoutSubscription = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTeam.id)}`,
    { headers: { origin } },
  );
  expect(verifiedWithoutSubscription.status()).toBe(402);
  expect(await verifiedWithoutSubscription.json()).toMatchObject({ paymentStatus: 'pending' });

  const canceledTeam = await prisma.teamSpace.create({
    data: {
      name: `Canceled checkout ${randomUUID().slice(0, 8)}`,
      joinCode: randomUUID().slice(0, 12).toUpperCase(),
      createdByUserId: ownerId,
    },
  });
  fixtureTeamIds.push(canceledTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: canceledTeam.id, userId: ownerId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: { teamId: canceledTeam.id, userId: ownerId, status: 'canceled' },
  });
  const canceledAccess = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(canceledTeam.id)}`,
    { headers: { origin } },
  );
  expect(canceledAccess.status()).toBe(402);
  expect(await canceledAccess.json()).toMatchObject({ paymentStatus: 'unpaid' });

  await setSubscriptionState(ownerEmail, true);
  const activeVerification = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: pendingCheckout.stripeSessionId },
  });
  expect(activeVerification.status(), await activeVerification.text()).toBe(200);
  expect(await activeVerification.json()).toMatchObject({ verified: true });

  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  const ownerTeamButton = page.getByRole('button', { name: new RegExp(teamName) });
  await expect(ownerTeamButton).toBeVisible();
  await ownerTeamButton.click();
  await expect(page.getByText('Paid access active')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();

  const purchaserContext = await browser.newContext();
  fixtureContexts.push(purchaserContext);
  const purchaserPage = await purchaserContext.newPage();
  const purchaserUserId = await signInNewAccount(
    purchaserPage,
    origin,
    `qa-owner-testing-purchaser-${randomUUID()}@example.test`,
    'Synthetic Owner Workspace Purchaser',
  );
  await prisma.teamMembership.create({
    data: { teamId: ownerTeam.id, userId: purchaserUserId, role: 'purchaser' },
  });

  const projectName = `QA owner testing sample ${randomUUID().slice(0, 8)}`;
  const permitNumber = `SAMPLE-${randomUUID().slice(0, 8)}`;
  const portalUrl = tampaRecordUrl(permitNumber, { fixture: `owner-testing-${randomUUID()}` });

  const permitResponse = await page.request.post(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      projectName,
      address: '100 Sample Street, Tampa, FL 33602',
      permitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: 'Synthetic test record.',
      portalUrl,
      teamId: ownerTeam.id,
    },
  });
  expect(permitResponse.status(), await permitResponse.text()).toBe(201);
  const permit = (await permitResponse.json()) as { id: string };
  await prisma.permit.update({
    where: { id: permit.id },
    data: { assignedProjectManagerUserId: managerUserId },
  });
  await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: permit.id,
      teamId: ownerTeam.id,
      permitNumber,
      sourceUrl: portalUrl,
      result: 'unavailable',
      message: 'The public City record could not be read.',
      checkedAt: new Date(Date.now() - 60_000),
      requestSequence: 1,
      redlineResult: 'not_connected',
    },
  });

  const controlProjectName = `QA owner testing unchanged control ${randomUUID()}`;
  const controlPermitNumber = `SAMPLE-CONTROL-${randomUUID().slice(0, 8)}`;
  const controlPermitUrl = tampaRecordUrl(controlPermitNumber, {
    fixture: `owner-control-${randomUUID()}`,
  });
  const controlPermit = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: ownerTeam.id,
      assignedProjectManagerUserId: managerUserId,
      projectName: controlProjectName,
      address: '101 Sample Street, Tampa, FL 33602',
      permitNumber: controlPermitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: 'Synthetic unchanged-status control record.',
      portalUrl: controlPermitUrl,
    },
  });

  const permitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTeam.id)}`,
  );
  expect(permitList.status()).toBe(200);
  expect(await permitList.text()).toContain('QA owner testing sample');

  const permitStatusCounts = await page.request.get(
    `${origin}/api/permit-status-counts?teamId=${encodeURIComponent(ownerTeam.id)}`,
  );
  expect(permitStatusCounts.status()).toBe(200);
  expect((await permitStatusCounts.json()).items).toEqual([
    { status: 'Planning', count: 2 },
    { status: 'Ready to submit', count: 0 },
    { status: 'Submitted', count: 0 },
    { status: 'Under review', count: 0 },
    { status: 'Corrections requested', count: 0 },
    { status: 'Issued', count: 0 },
  ]);
  expect(await prisma.teamCheckout.count({ where: { teamId: ownerTeam.id } })).toBe(2);

  const noteResponse = await page.request.post(`${origin}/api/permits/${permit.id}/notes`, {
    headers: { origin },
    data: { body: 'Synthetic owner testing note.' },
  });
  expect(noteResponse.status()).toBe(201);
  const noteList = await page.request.get(`${origin}/api/permits/${permit.id}/notes`);
  expect(noteList.status()).toBe(200);
  expect(await noteList.text()).toContain('Synthetic owner testing note.');

  for (const role of ['project_manager', 'purchaser'] as const) {
    const restrictedTeam = await prisma.teamSpace.create({
      data: {
        name: `Owner role boundary ${role} ${randomUUID().slice(0, 8)}`,
        joinCode: randomUUID().slice(0, 12).toUpperCase(),
        createdByUserId: ownerId,
      },
    });
    fixtureTeamIds.push(restrictedTeam.id);
    await prisma.teamMembership.create({
      data: { teamId: restrictedTeam.id, userId: ownerId, role },
    });
    const restrictedProject = `QA owner role boundary ${role}`;
    const restrictedPermitNumber = `SAMPLE-LOCKED-${randomUUID().slice(0, 8)}`;
    const restrictedPortalUrl = tampaRecordUrl(restrictedPermitNumber);
    const restrictedPermit = await prisma.permit.create({
      data: {
        userId: ownerId,
        teamId: restrictedTeam.id,
        projectName: restrictedProject,
        address: '102 Sample Street, Tampa, FL 33602',
        permitNumber: restrictedPermitNumber,
        permitType: 'Building',
        status: 'Planning',
        notes: 'Synthetic locked membership record.',
        portalUrl: restrictedPortalUrl,
      },
    });

    const listedTeams = await page.request.get(`${origin}/api/teams`, { headers: { origin } });
    expect(listedTeams.status()).toBe(200);
    const restrictedTeamState = ((await listedTeams.json()) as TeamListResponse).items.find(
      (team) => team.id === restrictedTeam.id,
    );
    expect(restrictedTeamState).toMatchObject({
      role,
      accessActive: false,
      accessMode: 'subscription_required',
      paymentStatus: 'unpaid',
    });

    const permitList = await page.request.get(
      `${origin}/api/permits?teamId=${encodeURIComponent(restrictedTeam.id)}`,
      { headers: { origin } },
    );
    expect(permitList.status()).toBe(402);
    expect(await permitList.text()).not.toContain(restrictedProject);

    const historyRead = await page.request.get(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(restrictedPermit.id)}&teamId=${encodeURIComponent(restrictedTeam.id)}`,
      { headers: { origin } },
    );
    expect(historyRead.status()).toBe(402);
    expect(await historyRead.text()).not.toContain(restrictedProject);

    const monitoringRead = await page.request.get(
      `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(restrictedTeam.id)}`,
      { headers: { origin } },
    );
    expect(monitoringRead.status()).toBe(402);
    expect(await monitoringRead.text()).not.toContain(restrictedProject);

    const sourceCheckWrite = await page.request.post(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(restrictedPermit.id)}`,
      { headers: { origin }, data: { teamId: restrictedTeam.id } },
    );
    expect(sourceCheckWrite.status()).toBe(402);
    expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: restrictedPermit.id } })).toBe(0);
  }

  for (const [memberPage, expectedRole] of [
    [managerPage, 'project_manager'],
    [purchaserPage, 'purchaser'],
  ] as const) {
    const memberTeamsResponse = await memberPage.request.get(`${origin}/api/teams`, {
      headers: { origin },
    });
    expect(memberTeamsResponse.status()).toBe(200);
    const memberTeamState = ((await memberTeamsResponse.json()) as TeamListResponse).items.find(
      (team) => team.id === ownerTeam.id,
    );
    expect(memberTeamState).toMatchObject({
      role: expectedRole,
      accessActive: true,
      accessMode: 'paid_subscription',
      paymentStatus: 'active',
    });

    const memberPermitRead = await memberPage.request.get(
      `${origin}/api/permits?teamId=${encodeURIComponent(ownerTeam.id)}`,
      { headers: { origin } },
    );
    expect(memberPermitRead.status()).toBe(200);
    expect(await memberPermitRead.text()).toContain(projectName);

    const memberHistoryRead = await memberPage.request.get(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(ownerTeam.id)}`,
      { headers: { origin } },
    );
    expect(memberHistoryRead.status()).toBe(200);

    const memberCheckWrite = await memberPage.request.post(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
      { headers: { origin }, data: { teamId: ownerTeam.id } },
    );
    expect(memberCheckWrite.status()).toBe(403);
    expect(await memberCheckWrite.json()).toMatchObject({ error: 'team_owner_required' });
    expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id } })).toBe(1);
  }

  expect(await prisma.teamCheckout.count({ where: { teamId: ownerTeam.id } })).toBe(2);

  await page.route('https://storage.test/**', async (route) => {
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'PUT, OPTIONS',
      'access-control-allow-headers': '*',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...headers, 'content-type': 'application/pdf' },
      body: '%PDF-1.4 synthetic test file',
    });
  });
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(ownerTeam.id)}`);
  const correctionLetterRegion = page.getByRole('region', {
    name: `Correction letters for ${projectName}`,
  });
  await expect(correctionLetterRegion.getByLabel('Add a correction letter')).toBeVisible();
  await correctionLetterRegion.getByLabel('Add a correction letter').setInputFiles({
    name: 'sample-correction-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic test file'),
  });
  await expect(
    correctionLetterRegion.getByRole('link', { name: 'sample-correction-letter.pdf' }),
  ).toBeVisible({ timeout: 20_000 });
  const letter = await prisma.permitLetter.findFirst({ where: { permitId: permit.id } });
  expect(letter).toMatchObject({
    teamId: ownerTeam.id,
    uploadedByUserId: ownerId,
    fileName: 'sample-correction-letter.pdf',
    mimeType: 'application/pdf',
  });
  if (!letter) throw new Error('The owner could not attach the synthetic permit letter.');
  const reviewItems = [
    {
      id: 'sample-correction-item',
      action: 'Review the sample plan note.',
      location: 'North elevation',
      planReference: 'A2.1',
    },
  ];
  await prisma.permitCorrectionDraft.create({
    data: {
      permitLetterId: letter.id,
      createdByUserId: ownerId,
      status: 'draft',
      items: reviewItems,
      reviewedItems: Prisma.DbNull,
      fieldErrors: [],
    },
  });
  const letterList = await page.request.get(
    `${origin}/api/permit-letters?teamId=${encodeURIComponent(ownerTeam.id)}`,
  );
  expect(letterList.status()).toBe(200);

  const reviewUrl = `${origin}/api/permit-letters/${letter.id}/review?permitId=${permit.id}`;
  const reviewDetails = await page.request.get(reviewUrl);
  expect(reviewDetails.status()).toBe(200);
  const reviewed = await page.request.patch(reviewUrl, {
    headers: { origin },
    data: { action: 'confirm', items: reviewItems },
  });
  expect(reviewed.status()).toBe(200);
  expect(await reviewed.json()).toMatchObject({ draft: { status: 'confirmed' } });

  const checklistUrl = `${origin}/api/permit-letters/${letter.id}/checklist`;
  const checklist = await page.request.post(checklistUrl, {
    headers: { origin },
    data: { teamId: ownerTeam.id, permitId: permit.id },
  });
  expect(checklist.status()).toBe(201);
  expect(await checklist.json()).toMatchObject({
    checklist: { sourceFileName: 'sample-correction-letter.pdf', items: [{ completed: false }] },
  });

  const ownerMonitor = page.getByRole('region', {
    name: `Public City status for permit ${permitNumber}`,
  });
  await expect(ownerMonitor.getByRole('heading', { name: 'Watcher health' })).toBeVisible();
  const ownerCheckButton = ownerMonitor.getByRole('button', { name: 'Run public check' });
  await expect(ownerCheckButton).toBeVisible();
  await ownerCheckButton.click();
  await expect(ownerMonitor.getByText('In Process', { exact: true }).first()).toBeVisible();
  await ownerMonitor.getByRole('button', { name: 'Run public check' }).click();
  await expect(
    ownerMonitor.getByText('Awaiting Client Reply', { exact: true }).first(),
  ).toBeVisible();
  await expect(ownerMonitor.getByText('No interruption recorded', { exact: true })).toBeVisible();
  await expect(ownerMonitor.getByText(/Portal page read/).first()).toBeVisible();

  const historyResponse = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(ownerTeam.id)}`,
    { headers: { origin } },
  );
  expect(historyResponse.status()).toBe(200);
  const historyBody = (await historyResponse.json()) as {
    items: Array<{
      id: string;
      result: string;
      status: string | null;
      sourceUrl: string | null;
      sourceFetchedAt: string | null;
    }>;
  };
  const savedTransition = historyBody.items.find(
    (check) => check.result === 'checked' && check.status === 'Awaiting Client Reply',
  );
  expect(savedTransition).toMatchObject({ result: 'checked', status: 'Awaiting Client Reply', sourceUrl: portalUrl });
  expect(savedTransition?.sourceFetchedAt).toBeTruthy();

  const detectionsResponse = await page.request.get(
    `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(ownerTeam.id)}`,
    { headers: { origin } },
  );
  expect(detectionsResponse.status()).toBe(200);
  const detections = (await detectionsResponse.json()) as {
    items: Array<{ permitId: string; previousStatus: string; newStatus: string }>;
  };
  expect(detections.items.find((item) => item.permitId === permit.id)).toMatchObject({
    previousStatus: 'In Process',
    newStatus: 'Awaiting Client Reply',
  });
  const statusEmails = await capturedStatusEmails(projectName);
  expect(statusEmails).toHaveLength(1);
  expect(statusEmails[0]).toMatchObject({
    to: managerEmail,
    subject: `Public permit status changed: ${projectName}`,
  });
  expect(statusEmails[0]?.body).toContain('Detected public status: Awaiting Client Reply');
  expect(statusEmails[0]?.body).toContain(`Official City of Tampa record: ${portalUrl}`);
  expect(statusEmails[0]?.body).toContain('1. Review the sample plan note. (North elevation; Plan A2.1)');

  const controlMonitor = page.getByRole('region', {
    name: `Public City status for permit ${controlPermitNumber}`,
  });
  const controlCheckButton = controlMonitor.getByRole('button', { name: 'Run public check' });
  await expect(controlCheckButton).toBeVisible();
  await controlCheckButton.click();
  await expect(controlMonitor.getByText('In Process', { exact: true }).first()).toBeVisible();
  const repeatedControlCheckResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await controlMonitor.getByRole('button', { name: 'Run public check' }).click();
  const repeatedControlCheck = await repeatedControlCheckResponse;
  expect(repeatedControlCheck.status(), await repeatedControlCheck.text()).toBe(201);
  await expect(controlMonitor.getByText('In Process', { exact: true }).first()).toBeVisible();
  expect(await capturedStatusEmails(controlProjectName)).toHaveLength(0);
  expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: controlPermit.id } })).toBe(2);
  expect(await prisma.teamCheckout.count({ where: { teamId: ownerTeam.id } })).toBe(2);

  const headers = [
    'project_name',
    'job_address',
    'permit_number',
    'permit_type',
    'status',
    'notes',
    'portal_url',
  ];
  const importPermitNumber = `SAMPLE-IMPORT-${randomUUID().slice(0, 8)}`;
  const importCsv =
    `${headers.join(',')}\n` +
    `"Owner test imported row","102 Sample Street, Tampa, FL 33602",${importPermitNumber},Building,Planning,"Synthetic test record.",`;
  const mapping: CsvMapping = {
    project_name: 0,
    job_address: 1,
    permit_number: 2,
    permit_type: 3,
    status: 4,
    notes: 5,
    portal_url: 6,
  };
  const importEndpoint = `${origin}/api/csv-import?teamId=${encodeURIComponent(ownerTeam.id)}`;
  const preview = await page.request.post(importEndpoint, {
    headers: { origin },
    data: { action: 'preview', targetId: 'tampa-city-permits', csv: importCsv, delimiter: ',', mapping },
  });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({ ok: true, data: { toCreate: 1 } });
  const committed = await page.request.post(importEndpoint, {
    headers: { origin },
    data: { action: 'commit', targetId: 'tampa-city-permits', csv: importCsv, delimiter: ',', mapping },
  });
  expect(committed.status()).toBe(200);
  expect(await committed.json()).toMatchObject({ ok: true, data: { created: 1, skipped: 0 } });

  const exported = await page.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: {
        teamId: ownerTeam.id,
        view: 'active',
        assignedToMe: false,
        interruptedMonitoring: false,
      },
    },
  });
  expect(exported.status()).toBe(200);
  expect(await exported.json()).toMatchObject({
    ok: true,
    data: { records: 3 },
  });
  expect(await exported.text()).toContain('Owner test imported row');

  const outsiderContext = await browser.newContext();
  fixtureContexts.push(outsiderContext);
  const outsiderPage = await outsiderContext.newPage();
  const outsiderEmail = `qa-owner-testing-outsider-${randomUUID()}@example.test`;
  const outsiderId = await signInNewAccount(
    outsiderPage,
    origin,
    outsiderEmail,
    'QA Customer Team Owner',
  );
  const forgedClaims = `&userId=${encodeURIComponent(ownerId)}&accessMode=paid_subscription&accessActive=true`;
  const outsiderRead = await outsiderPage.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(ownerTeam.id)}${forgedClaims}`,
  );
  expect(outsiderRead.status()).toBe(403);
  const forgedOwnerWrite = await outsiderPage.request.post(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      projectName: 'Forged owner claim must stay locked',
      address: '103 Sample Street, Tampa, FL 33602',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      portalUrl: '',
      teamId: ownerTeam.id,
      userId: ownerId,
      accessMode: 'paid_subscription',
      accessActive: true,
    },
  });
  expect(forgedOwnerWrite.status()).toBe(403);
  expect(
    await prisma.permit.count({ where: { projectName: 'Forged owner claim must stay locked' } }),
  ).toBe(0);
  const outsiderImport = await outsiderPage.request.post(importEndpoint, {
    headers: { origin },
    data: { action: 'preview', targetId: 'tampa-city-permits', csv: importCsv, delimiter: ',', mapping },
  });
  expect(outsiderImport.status()).toBe(403);
  const ownerTeamExport = await outsiderPage.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: {
        teamId: ownerTeam.id,
        view: 'active',
        assignedToMe: false,
        interruptedMonitoring: false,
      },
    },
  });
  expect(ownerTeamExport.status()).toBe(403);
  const ownerTeamExportBody = (await ownerTeamExport.json()) as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string };
  };
  expect(ownerTeamExportBody).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(ownerTeamExportBody.data).toBeUndefined();
  expect(JSON.stringify(ownerTeamExportBody)).not.toContain('Owner test imported row');

  const customerTeam = await createTeam(outsiderPage, origin, `Customer team ${randomUUID().slice(0, 8)}`);
  await prisma.teamMembership.create({
    data: { teamId: customerTeam.id, userId: ownerId, role: 'owner' },
  });
  const ownerOnCustomerTeam = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(customerTeam.id)}`,
  );
  expect(ownerOnCustomerTeam.status()).toBe(402);
  const customerExport = await page.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: {
        teamId: customerTeam.id,
        view: 'active',
        assignedToMe: false,
        interruptedMonitoring: false,
      },
    },
  });
  expect(customerExport.status()).toBe(402);
  expect(await prisma.teamCheckout.count({ where: { teamId: ownerTeam.id } })).toBe(2);

  const customerTeamsResponse = await outsiderPage.request.get(`${origin}/api/teams`, {
    headers: { origin },
  });
  const customerTeams = (await customerTeamsResponse.json()) as TeamListResponse;
  expect(customerTeams.items.find((team) => team.id === customerTeam.id)).toMatchObject({
    accessActive: false,
    accessMode: 'subscription_required',
    paymentStatus: 'unpaid',
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await ownerMonitor.scrollIntoViewIfNeeded();
    await expect(ownerMonitor.getByRole('heading', { name: 'Watcher health' })).toBeVisible();
    await expect(ownerMonitor.getByRole('button', { name: 'Run public check' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await page.screenshot({
      path: testInfo.outputPath(`owner-monitor-${viewport.name}.png`),
      fullPage: true,
    });
  }
});
