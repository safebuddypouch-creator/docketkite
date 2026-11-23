// @polsia:user-owned — on-demand portal status transition email journey.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PermitPortalCheckList } from '@/lib/contracts/permit-portal-check';
import { PermitPortalCheckMutation } from '@/lib/contracts/permit-portal-check';
import { PermitStatusDetectionList } from '@/lib/contracts/permit-status-detection';
import { TeamStatusAlertRecipientsResponse } from '@/lib/contracts/team-status-alert-recipients';
import { tampaRecordUrl } from './permit-test-helpers';

const prisma = new PrismaClient();
const EMAIL_CAPTURE_PATH = '/tmp/polsia-permit-status-email-capture.ndjson';
const PORTAL_FETCH_CAPTURE_PATH = '/tmp/polsia-portal-fetch-calls.ndjson';
const fixtureTeamIds: string[] = [];
const fixtureUserIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  html: string;
}

async function capturedProjectEmails(projectName: string): Promise<CapturedEmail[]> {
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

async function portalFetchCount(fixture: string): Promise<number> {
  const contents = await readFile(PORTAL_FETCH_CAPTURE_PATH, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  });
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { url?: string })
    .filter((call) => {
      if (!call.url) return false;
      return new URL(call.url).searchParams.get('fixture') === fixture;
    }).length;
}

async function createFixtureUser(email: string, name: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: { id, name, email, emailVerified: true, createdAt: now, updatedAt: now },
  });
  fixtureUserIds.push(id);
  return id;
}

async function setSubscriptionState(email: string, active: boolean | 'unavailable') {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  await writeFile(
    `/tmp/polsia-subscription-state-${digest}.json`,
    JSON.stringify({ active: active === true, unavailable: active === 'unavailable' }),
    'utf8',
  );
}

async function openSignedInAccount(
  browser: Browser,
  origin: string,
  email: string,
  name: string,
): Promise<{ page: Page; userId: string; email: string }> {
  const password = `Qa-${randomUUID()}-9a`;
  const storageStatePath = `/tmp/polsia-portal-transition-${randomUUID()}.json`;
  execFileSync(
    'node',
    [
      '.agents/auth-session.cjs',
      '--as',
      'user',
      '--base-url',
      origin,
      '--email',
      email,
      '--password',
      password,
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
  if (!userId) throw new Error('The test account session did not include a user id.');
  fixtureUserIds.push(userId);
  return { page, userId, email };
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  if (fixtureTeamIds.length > 0) {
    await prisma.permit.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamStatusAlertRecipient.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
    await prisma.teamStatusAlertPreference.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
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

test('simulated portal snapshots save history and notify the assigned manager on a verified transition', async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const owner = await openSignedInAccount(
    browser,
    origin,
    `qa-portal-transition-owner-${randomUUID()}@example.test`,
    'QA Permit Owner',
  );
  const page = owner.page;
  const ownerId = owner.userId;

  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Portal Notification Team',
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
  await setSubscriptionState(owner.email, true);

  const managerEmail = `qa-assigned-portal-manager-${randomUUID()}@example.test`;
  const manager = await openSignedInAccount(
    browser,
    origin,
    managerEmail,
    'Assigned QA Project Manager',
  );
  const managerId = manager.userId;
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: managerId, role: 'project_manager' },
  });
  const unassignedManagerEmail = `qa-unassigned-portal-manager-${randomUUID()}@example.test`;
  const unassignedManagerId = await createFixtureUser(
    unassignedManagerEmail,
    'Unassigned QA Project Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: unassignedManagerId, role: 'project_manager' },
  });

  const permitNumber = `2026-${randomBytes(3).toString('hex').toUpperCase()}`;
  const projectName = `QA public status transition ${randomUUID()}`;
  const permit = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: team.id,
      assignedProjectManagerUserId: managerId,
      projectName,
      address: '101 Test Street, Tampa',
      permitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: 'Manual team status must remain separate.',
      portalUrl: tampaRecordUrl(permitNumber, { fixture: `status-notification-${randomUUID()}` }),
    },
  });

  const snapshotItems = [
    {
      id: 'controlled-letter-step-1',
      action: 'Add the missing fixture schedule',
      location: 'Electrical plan set',
      planReference: 'E-2',
    },
    {
      id: 'controlled-letter-step-2',
      action: 'Provide the requested equipment specifications',
      location: null,
      planReference: null,
    },
  ];
  const testLetter = await prisma.permitLetter.create({
    data: {
      permitId: permit.id,
      teamId: team.id,
      uploadedByUserId: ownerId,
      uploadId: 1,
      fileKey: `qa/${randomUUID()}/controlled-test-snapshot.txt`,
      fileUrl: 'https://storage.example.test/controlled-test-snapshot.txt',
      fileName: 'controlled-test-snapshot.txt',
      mimeType: 'text/plain',
      size: 1,
      correctionDraft: {
        create: {
          status: 'confirmed',
          items: snapshotItems,
          reviewedItems: snapshotItems,
          reviewedByUserId: ownerId,
          reviewedAt: new Date(),
          confirmedAt: new Date(),
          createdByUserId: ownerId,
        },
      },
    },
  });
  await prisma.permitCorrectionChecklist.create({
    data: {
      permitLetterId: testLetter.id,
      permitId: permit.id,
      teamId: team.id,
      createdByUserId: ownerId,
      items: {
        create: snapshotItems.map((item, position) => ({
          sourceLetterId: testLetter.id,
          sourceItemId: item.id,
          position,
          action: item.action,
          location: item.location,
          planReference: item.planReference,
        })),
      },
    },
  });

  async function runCheckFor(permitId: string) {
    const response = await page.request.post(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permitId)}`,
      { headers: { origin }, data: { teamId: team.id } },
    );
    const body: unknown = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    return PermitPortalCheckMutation.parse(body);
  }

  async function runCheck() {
    return runCheckFor(permit.id);
  }

  const baseline = await runCheck();
  expect(baseline.check).toMatchObject({ result: 'checked', status: 'In Process' });
  expect(await capturedProjectEmails(projectName)).toEqual([]);

  const firstTransition = await runCheck();
  expect(firstTransition.check).toMatchObject({ result: 'checked', status: 'Awaiting Client Reply' });
  const firstEmail = await capturedProjectEmails(projectName);
  expect(firstEmail).toHaveLength(1);
  expect(managerEmail).toMatch(/@example\.test$/);
  expect(firstEmail[0]).toMatchObject({
    to: managerEmail,
    subject: `Public permit status changed: ${projectName}`,
  });
  expect(firstEmail[0]?.body).toContain('Detected public status: Awaiting Client Reply');
  expect(firstEmail[0]?.body).toContain('Record Status changed from In Process to Awaiting Client Reply.');
  expect(firstEmail[0]?.body).toContain(`Checked at (UTC): ${firstTransition.check.checkedAt}`);
  expect(firstEmail[0]?.body).toContain('1. Add the missing fixture schedule (Electrical plan set; Plan E-2)');
  expect(firstEmail[0]?.body).toContain('2. Provide the requested equipment specifications');
  expect(firstEmail[0]?.body).toContain(`Official City of Tampa record: ${permit.portalUrl}`);
  const firstLink = firstEmail[0]?.html.match(/href="([^"]+)"/)?.[1];
  expect(firstLink).toBeTruthy();
  if (!firstLink) throw new Error('The portal status email did not include its permit link.');
  const firstLinkUrl = new URL(firstLink.replace(/&amp;/g, '&'));
  expect(firstLinkUrl.origin).toBe('https://aca-prod.accela.com');
  expect(firstLinkUrl.pathname).toBe('/TAMPA/Cap/CapDetail.aspx');
  expect(firstLinkUrl.searchParams.get('agencyCode')).toBe('TAMPA');
  expect(firstLinkUrl.searchParams.get('capID3')).toBe(permitNumber);

  const historyResponse = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
  );
  expect(historyResponse.status()).toBe(200);
  const history = PermitPortalCheckList.parse(await historyResponse.json());
  const savedTransition = history.items.find((check) => check.id === firstTransition.check.id);
  expect(savedTransition).toMatchObject({
    permitNumber,
    sourceUrl: permit.portalUrl,
    result: 'checked',
    status: 'Awaiting Client Reply',
    checkedAt: firstTransition.check.checkedAt,
    sourceFetchedAt: firstTransition.check.sourceFetchedAt,
  });
  expect(savedTransition?.sourceFetchedAt).toBeTruthy();

  const detectionsResponse = await page.request.get(
    `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(detectionsResponse.status()).toBe(200);
  const detections = PermitStatusDetectionList.parse(await detectionsResponse.json());
  expect(detections.items.find((item) => item.permitId === permit.id)).toMatchObject({
    previousStatus: 'In Process',
    newStatus: 'Awaiting Client Reply',
  });

  const repeated = await runCheck();
  expect(repeated.check).toMatchObject({ result: 'checked', status: 'AWAITING CLIENT REPLY' });
  expect(await capturedProjectEmails(projectName)).toHaveLength(1);

  const overlapping = await Promise.all([runCheck(), runCheck()]);
  expect(overlapping.map((outcome) => outcome.check.status)).toEqual(['In Process', 'In Process']);
  expect(await capturedProjectEmails(projectName)).toHaveLength(2);

  const unverified = await runCheck();
  expect(unverified.check.result).toBe('unverified');
  const unavailable = await runCheck();
  expect(unavailable.check.result).toBe('unavailable');
  expect(await capturedProjectEmails(projectName)).toHaveLength(2);

  const laterTransition = await runCheck();
  expect(laterTransition.check).toMatchObject({ result: 'checked', status: 'Awaiting Client Reply' });
  const emails = await capturedProjectEmails(projectName);
  expect(emails).toHaveLength(3);
  expect(emails.map((sent) => sent.to)).toEqual([managerEmail, managerEmail, managerEmail]);
  expect(emails.map((sent) => sent.body.match(/Detected public status: (.+)/)?.[1])).toEqual([
    'Awaiting Client Reply',
    'In Process',
    'Awaiting Client Reply',
  ]);
  expect(emails.every((sent) => sent.to !== unassignedManagerEmail)).toBe(true);

  const savedPermit = await prisma.permit.findUnique({ where: { id: permit.id } });
  expect(savedPermit).toMatchObject({
    status: 'Planning',
    notes: 'Manual team status must remain separate.',
  });
  expect(await prisma.permitStatusEvent.count({ where: { permitId: permit.id } })).toBe(0);
  expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id } })).toBe(8);

  const reversedFixture = randomUUID();
  const reversedProjectName = `QA reversed portal response ${reversedFixture}`;
  const reversedPermitNumber = `2026-${randomBytes(3).toString('hex').toUpperCase()}`;
  const reversedPermit = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: team.id,
      assignedProjectManagerUserId: managerId,
      projectName: reversedProjectName,
      address: '102 Test Street, Tampa',
      permitNumber: reversedPermitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: 'Manual team status must remain separate.',
      portalUrl: tampaRecordUrl(reversedPermitNumber, { fixture: `status-notification-reversed-${reversedFixture}` }),
    },
  });

  const reversedBaseline = await runCheckFor(reversedPermit.id);
  expect(reversedBaseline.check).toMatchObject({ result: 'checked', status: 'In Process' });
  expect(await capturedProjectEmails(reversedProjectName)).toEqual([]);

  // The test proxy delays request 2 after logging it, so request 3 can be saved first.
  const earlierStartedCheck = runCheckFor(reversedPermit.id);
  await expect.poll(() => portalFetchCount(`status-notification-reversed-${reversedFixture}`), {
    timeout: 10_000,
  }).toBe(2);
  const laterStartedCheck = await runCheckFor(reversedPermit.id);
  expect(laterStartedCheck.check.status).toBe('Awaiting Client Reply');
  const laterEmail = await capturedProjectEmails(reversedProjectName);
  expect(laterEmail).toHaveLength(1);
  expect(laterEmail[0]?.body).toContain('Detected public status: Awaiting Client Reply');

  const earlierStartedOutcome = await earlierStartedCheck;
  expect(earlierStartedOutcome.check.status).toBe('In Process');
  expect(Date.parse(earlierStartedOutcome.check.checkedAt)).toBeLessThan(
    Date.parse(laterStartedCheck.check.checkedAt),
  );
  expect(await capturedProjectEmails(reversedProjectName)).toHaveLength(1);
  const reversedHistory = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: reversedPermit.id },
    orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
    select: { status: true, requestSequence: true },
  });
  expect(reversedHistory.map((check) => check.status)).toEqual([
    'Awaiting Client Reply',
    'In Process',
    'In Process',
  ]);
  expect(reversedHistory.map((check) => check.requestSequence)).toEqual([3, 2, 1]);

  const equalFixture = randomUUID();
  const equalProjectName = `QA equal timestamp portal transition ${equalFixture}`;
  const equalPermitNumber = `2026-${randomBytes(3).toString('hex').toUpperCase()}`;
  const equalPermit = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: team.id,
      assignedProjectManagerUserId: managerId,
      projectName: equalProjectName,
      address: '103 Test Street, Tampa',
      permitNumber: equalPermitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: 'Manual team status must remain separate.',
      portalUrl: tampaRecordUrl(equalPermitNumber, { fixture: `status-notification-equal-${equalFixture}` }),
    },
  });
  const equalBaseline = await runCheckFor(equalPermit.id);
  expect(equalBaseline.check.status).toBe('In Process');

  const tiedTransitionRequest = runCheckFor(equalPermit.id);
  await expect
    .poll(async () => {
      const reservation = await prisma.permitPortalCheckCounter.findUnique({
        where: { permitId: equalPermit.id },
        select: { sequence: true, checkedAt: true },
      });
      return reservation?.sequence === 2 ? reservation.checkedAt.toISOString() : null;
    })
    .not.toBeNull();
  const reservation = await prisma.permitPortalCheckCounter.findUnique({
    where: { permitId: equalPermit.id },
    select: { sequence: true, checkedAt: true },
  });
  expect(reservation?.sequence).toBe(2);
  if (!reservation) throw new Error('The tied portal check did not reserve its saved order.');
  await prisma.permitPortalStatusCheck.update({
    where: { id: equalBaseline.check.id },
    data: { checkedAt: reservation.checkedAt },
  });

  const tiedTransition = await tiedTransitionRequest;
  expect(tiedTransition.check.status).toBe('Awaiting Client Reply');
  expect(tiedTransition.check.checkedAt).toBe(reservation.checkedAt.toISOString());
  const equalEmails = await capturedProjectEmails(equalProjectName);
  expect(equalEmails).toHaveLength(1);
  expect(equalEmails[0]?.body).toContain('Detected public status: Awaiting Client Reply');

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByRole('heading', { name: reversedProjectName })).toBeVisible();
});

test('paid owners can save current team recipients while nonowners and locked billing states cannot read or change them', async (
  { browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000').origin;
  const owner = await openSignedInAccount(
    browser,
    origin,
    `qa-alert-owner-${randomUUID()}@example.test`,
    'QA Status Alert Owner',
  );
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Status Alert Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: owner.userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: owner.userId, role: 'owner' },
  });
  const checkout = await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId: owner.userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  await setSubscriptionState(owner.email, true);

  const assignedManager = await openSignedInAccount(
    browser,
    origin,
    `qa-alert-manager-${randomUUID()}@example.test`,
    'QA Assigned Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: assignedManager.userId, role: 'project_manager' },
  });
  const selectedRecipientEmail = `qa-alert-recipient-${randomUUID()}@example.test`;
  const selectedRecipientId = await createFixtureUser(selectedRecipientEmail, 'QA Recipient');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: selectedRecipientId, role: 'purchaser' },
  });
  const unrelatedOwner = await openSignedInAccount(
    browser,
    origin,
    `qa-alert-outsider-${randomUUID()}@example.test`,
    'QA Other Team Owner',
  );
  const otherTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Separate Alert Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: unrelatedOwner.userId,
    },
  });
  fixtureTeamIds.push(otherTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: otherTeam.id, userId: unrelatedOwner.userId, role: 'owner' },
  });

  const settingsUrl = `${origin}/api/team-status-alert-recipients?teamId=${encodeURIComponent(team.id)}`;
  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();
  const anonymousRead = await anonymousPage.request.get(settingsUrl, { headers: { origin } });
  expect(anonymousRead.status()).toBe(401);
  const anonymousWrite = await anonymousPage.request.put(
    `${origin}/api/team-status-alert-recipients`,
    {
      headers: { origin },
      data: {
        action: 'save',
        teamId: team.id,
        recipientUserIds: [owner.userId],
      },
    },
  );
  expect(anonymousWrite.status()).toBe(401);

  const initialResponse = await owner.page.request.get(settingsUrl, { headers: { origin } });
  const initialBody: unknown = await initialResponse.json();
  expect(initialResponse.status(), JSON.stringify(initialBody)).toBe(200);
  const initial = TeamStatusAlertRecipientsResponse.parse(initialBody);
  expect(initial).toMatchObject({
    teamId: team.id,
    recipientUserIds: [],
    usesAssignedProjectManagerDefault: true,
  });
  expect(initial.members.map((member) => member.userId)).toEqual(
    expect.arrayContaining([owner.userId, assignedManager.userId, selectedRecipientId]),
  );
  expect(initial.members.find((member) => member.userId === selectedRecipientId)?.role).toBe(
    'purchaser',
  );

  const nonOwnerRead = await assignedManager.page.request.get(settingsUrl, { headers: { origin } });
  expect(nonOwnerRead.status()).toBe(403);
  const nonOwnerWrite = await assignedManager.page.request.put(
    `${origin}/api/team-status-alert-recipients`,
    {
      headers: { origin },
      data: {
        action: 'save',
        teamId: team.id,
        recipientUserIds: [assignedManager.userId],
      },
    },
  );
  expect(nonOwnerWrite.status()).toBe(403);

  const page = owner.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Status alert recipients' })).toBeVisible();
  await expect(
    page.getByText('Current setting: assigned project manager on each permit.'),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'QA Recipient (purchaser)' }).check();
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(page.getByRole('status').getByText('Custom recipients saved for this team.')).toBeVisible();

  const savedResponse = await page.request.get(settingsUrl, { headers: { origin } });
  expect(savedResponse.status()).toBe(200);
  const saved = TeamStatusAlertRecipientsResponse.parse(await savedResponse.json());
  expect(saved).toMatchObject({
    recipientUserIds: [selectedRecipientId],
    usesAssignedProjectManagerDefault: false,
  });

  const unrelatedOwnerRead = await unrelatedOwner.page.request.get(settingsUrl, { headers: { origin } });
  expect(unrelatedOwnerRead.status()).toBe(403);
  const unrelatedOwnerReadBody: unknown = await unrelatedOwnerRead.json();
  expect(unrelatedOwnerReadBody).not.toHaveProperty('members');
  expect(unrelatedOwnerReadBody).not.toHaveProperty('recipientUserIds');

  const unrelatedOwnerWrite = await unrelatedOwner.page.request.put(
    `${origin}/api/team-status-alert-recipients`,
    {
      headers: { origin },
      data: {
        action: 'save',
        teamId: team.id,
        recipientUserIds: [owner.userId],
      },
    },
  );
  expect(unrelatedOwnerWrite.status()).toBe(403);
  expect(
    await prisma.teamStatusAlertRecipient.findMany({
      where: { teamId: team.id },
      select: { userId: true },
    }),
  ).toEqual([{ userId: selectedRecipientId }]);

  const invalidCrossTeamWrite = await page.request.put(`${origin}/api/team-status-alert-recipients`, {
    headers: { origin },
    data: {
      action: 'save',
      teamId: team.id,
      recipientUserIds: [unrelatedOwner.userId],
    },
  });
  expect(invalidCrossTeamWrite.status()).toBe(400);
  expect(
    await prisma.teamStatusAlertRecipient.findMany({
      where: { teamId: team.id },
      select: { userId: true },
    }),
  ).toEqual([{ userId: selectedRecipientId }]);

  const permitNumber = `2026-${randomBytes(3).toString('hex').toUpperCase()}`;
  const fixtureId = `status-notification-custom-${randomUUID()}`;
  const projectName = `QA custom status recipients ${randomUUID()}`;
  const permit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: team.id,
      assignedProjectManagerUserId: assignedManager.userId,
      projectName,
      address: '201 Test Street, Tampa',
      permitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      portalUrl: tampaRecordUrl(permitNumber, { fixture: fixtureId }),
    },
  });

  async function checkPermit() {
    const response = await page.request.post(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
      { headers: { origin }, data: { teamId: team.id } },
    );
    const body: unknown = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    return PermitPortalCheckMutation.parse(body);
  }

  const baseline = await checkPermit();
  expect(baseline.check).toMatchObject({ result: 'checked', status: 'In Process' });
  expect(await capturedProjectEmails(projectName)).toEqual([]);
  const transition = await checkPermit();
  expect(transition.check).toMatchObject({ result: 'checked', status: 'Awaiting Client Reply' });
  expect(await capturedProjectEmails(projectName)).toMatchObject([
    { to: selectedRecipientEmail, subject: `Public permit status changed: ${projectName}` },
  ]);
  expect(await capturedProjectEmails(projectName)).toHaveLength(1);
  expect(await capturedProjectEmails(projectName)).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ to: assignedManager.email })]),
  );

  async function expectLockedSetting(status: number, paymentStatus: string) {
    const read = await page.request.get(settingsUrl, { headers: { origin } });
    expect(read.status()).toBe(status);
    const body: unknown = await read.json();
    expect(body).toMatchObject({
      error: status === 503 ? 'billing_status_unavailable' : 'team_subscription_required',
      paymentStatus,
    });
    expect(body).not.toHaveProperty('members');
    expect(body).not.toHaveProperty('recipientUserIds');
    const write = await page.request.put(`${origin}/api/team-status-alert-recipients`, {
      headers: { origin },
      data: { action: 'use_assigned_project_manager', teamId: team.id },
    });
    expect(write.status()).toBe(status);
    expect(
      await prisma.teamStatusAlertRecipient.findMany({
        where: { teamId: team.id },
        select: { userId: true },
      }),
    ).toEqual([{ userId: selectedRecipientId }]);
  }

  await prisma.teamCheckout.update({
    where: { id: checkout.id },
    data: { status: 'failed', grossAmountUsd: null, verifiedAt: null },
  });
  const pendingCheckout = await prisma.teamCheckout.create({
    data: { teamId: team.id, userId: owner.userId, status: 'pending' },
  });
  await expectLockedSetting(402, 'pending');
  await prisma.teamCheckout.update({ where: { id: pendingCheckout.id }, data: { status: 'failed' } });
  await expectLockedSetting(402, 'unpaid');
  await prisma.teamCheckout.update({
    where: { id: checkout.id },
    data: { status: 'unverified', grossAmountUsd: 299, verifiedAt: null },
  });
  await expectLockedSetting(402, 'unpaid');
  await prisma.teamCheckout.update({
    where: { id: checkout.id },
    data: { status: 'verified', grossAmountUsd: 299, verifiedAt: new Date() },
  });
  await setSubscriptionState(owner.email, false);
  await expectLockedSetting(402, 'inactive');
  await setSubscriptionState(owner.email, 'unavailable');
  await expectLockedSetting(503, 'unavailable');

  await setSubscriptionState(owner.email, true);
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Status alert recipients' })).toBeVisible();
  await expect(page.getByText('Current setting: custom team recipients.')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('status-alert-recipients-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Status alert recipients' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('status-alert-recipients-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole('checkbox', { name: 'QA Recipient (purchaser)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save recipients' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('status-alert-recipients-320.png'), fullPage: true });
});
