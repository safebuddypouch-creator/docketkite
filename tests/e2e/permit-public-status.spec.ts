// @polsia:user-owned — authenticated public permit monitoring journey.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { tampaRecordUrl } from './permit-test-helpers';

const prisma = new PrismaClient();
const EMAIL_CAPTURE_PATH = '/tmp/polsia-permit-status-email-capture.ndjson';
const fixtureTeamIds: string[] = [];
const fixtureUserIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  html: string;
}

async function capturedEmails(): Promise<CapturedEmail[]> {
  const contents = await readFile(EMAIL_CAPTURE_PATH, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  });
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail);
}

async function capturedEmailsFor(recipient: string): Promise<CapturedEmail[]> {
  return (await capturedEmails()).filter((email) => email.to === recipient);
}

async function interruptionEmailsForPermit(permitId: string): Promise<CapturedEmail[]> {
  const permitPath = `/dashboard/permits/${encodeURIComponent(permitId)}`;
  return (await capturedEmails()).filter(
    (email) =>
      email.subject.startsWith('Permit monitoring interrupted:') &&
      email.body.includes(permitPath),
  );
}

async function recordedPortalFetchesFor(sourceUrl: string): Promise<number> {
  const contents = await readFile('/tmp/polsia-portal-fetch-calls.ndjson', 'utf8').catch(
    (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    },
  );
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { url?: string })
    .filter((call) => call.url === sourceUrl).length;
}

async function openSignedInWorkspace(
  browser: Browser,
  origin: string,
  credentials?: { email: string; password: string; storageStatePath: string },
) {
  const authArgs = ['.agents/auth-session.cjs', '--as', 'user', '--base-url', origin];
  if (credentials) {
    authArgs.push(
      '--email',
      credentials.email,
      '--password',
      credentials.password,
      '--out',
      credentials.storageStatePath,
    );
  }
  execFileSync('node', authArgs, {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const context = await browser.newContext({
    storageState: credentials?.storageStatePath ?? '/tmp/polsia-auth.json',
  });
  fixtureContexts.push(context);
  const page = await context.newPage();
  const session = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  if (session.status() !== 200) {
    throw new Error(`Sign-in session request failed with HTTP ${session.status()}.`);
  }
  const sessionBody = (await session.json()) as { user?: { id?: string } };
  const userId = sessionBody.user?.id;
  if (!userId) throw new Error('The authenticated session did not include a user id.');
  return { page, userId };
}

async function captureMonitorViews(
  page: Page,
  testInfo: TestInfo,
  permitCard: Locator,
  state: string,
) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await permitCard.getByRole('heading', { name: 'Watcher health' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`permit-watcher-health-${state}-${viewport.name}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await permitCard.getByRole('heading', { name: 'Watcher health' }).scrollIntoViewIfNeeded();
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
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('paid team members can check a public City status and retain a separate manual status', async ({
  browser,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { page, userId } = await openSignedInWorkspace(browser, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Public Permit Monitoring',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  const firstOwner = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!firstOwner) throw new Error('The signed-in team owner was not found.');
  const secondOwnerEmail = `qa-second-owner-${randomUUID()}@example.test`;
  const secondOwnerId = randomUUID();
  const secondOwnerCreatedAt = new Date();
  await prisma.user.create({
    data: {
      id: secondOwnerId,
      name: 'QA Second Team Owner',
      email: secondOwnerEmail,
      emailVerified: true,
      createdAt: secondOwnerCreatedAt,
      updatedAt: secondOwnerCreatedAt,
    },
  });
  fixtureUserIds.push(secondOwnerId);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: secondOwnerId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: team.id,
      userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  const permitNumber = '2026-010101';
  const sourceUrl = tampaRecordUrl(permitNumber, {
    fixture: `owner-interruption-${randomBytes(8).toString('hex')}`,
  });
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Public Status Record',
      address: '101 Test Street, Tampa',
      permitNumber,
      permitType: 'Building',
      status: 'Planning',
      notes: 'Keep the team note intact after a portal check.',
      portalUrl: sourceUrl,
    },
  });
  const interruptedOnlyPermit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Interrupted-Only Portal Record',
      address: '102 Test Street, Tampa',
      permitNumber: '2026-010102',
      permitType: 'Building',
      status: 'Under review',
      notes: '',
      portalUrl: sourceUrl.replace(permitNumber, '2026-010102'),
      lastSuccessfulPortalCheckAt: new Date('2026-10-01T03:00:00.000Z'),
      portalMonitoringInterruptedAt: new Date('2026-10-02T03:00:00.000Z'),
      portalMonitoringReason: 'Stale summary data must not replace saved outcomes.',
    },
  });
  const interruptedReason = 'The City portal returned no readable public record.';
  await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: interruptedOnlyPermit.id,
      teamId: team.id,
      permitNumber: interruptedOnlyPermit.permitNumber,
      sourceUrl: sourceUrl.replace(permitNumber, interruptedOnlyPermit.permitNumber),
      status: null,
      result: 'unavailable',
      message: interruptedReason,
      checkedAt: new Date('2026-10-03T03:00:00.000Z'),
      redlineResult: 'not_connected',
    },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const permitCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'QA Public Status Record' }),
  });
  await expect(permitCard).toBeVisible();
  await expect(permitCard.getByRole('heading', { name: 'Watcher health' })).toBeVisible();
  await expect(permitCard.getByRole('button', { name: 'Run public check' })).toBeEnabled();

  const racingPermit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Concurrent Portal Check',
      address: '103 Test Street, Tampa',
      permitNumber: '2026-020202',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      portalUrl: tampaRecordUrl('2026-020202', { fixture: 'racing' }),
    },
  });
  let releaseConcurrentSuccess!: () => void;
  const concurrentSuccessGate = new Promise<void>((resolve) => {
    releaseConcurrentSuccess = resolve;
  });
  let signalLockAcquired!: () => void;
  const lockAcquired = new Promise<void>((resolve) => {
    signalLockAcquired = resolve;
  });
  const concurrentSuccessAt = new Date(Date.now() + 10_000);
  const concurrentSuccessTransaction = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${racingPermit.id}, 0))::text AS locked
    `;
      signalLockAcquired();
      await concurrentSuccessGate;
      await transaction.permitPortalStatusCheck.create({
        data: {
          permitId: racingPermit.id,
          teamId: team.id,
          permitNumber: racingPermit.permitNumber,
          sourceUrl: tampaRecordUrl(racingPermit.permitNumber),
          status: 'In Process',
          result: 'checked',
          checkedAt: concurrentSuccessAt,
          sourceFetchedAt: new Date('2026-10-01T03:00:00.000Z'),
          redlineResult: 'not_connected',
        },
      });
      await transaction.permit.update({
        where: { id: racingPermit.id },
        data: { lastSuccessfulPortalCheckAt: concurrentSuccessAt },
      });
    },
    { timeout: 45_000 },
  );
  await lockAcquired;
  const overlappingFailedCheck = page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(racingPermit.id)}`,
    { headers: { origin }, data: { teamId: team.id } },
  );
  try {
    await expect
      .poll(
        async () => {
          const [lock] = await prisma.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND granted = false
          AND classid = ((hashtextextended(${racingPermit.id}, 0) >> 32) & 4294967295)::oid
          AND objid = (hashtextextended(${racingPermit.id}, 0) & 4294967295)::oid
          AND objsubid = 1
      `;
          return lock?.waiting ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  } finally {
    releaseConcurrentSuccess();
  }
  await concurrentSuccessTransaction;
  const overlappingFailureResponse = await overlappingFailedCheck;
  expect(overlappingFailureResponse.status()).toBe(201);
  const overlappingFailure = await overlappingFailureResponse.json();
  expect(overlappingFailure.check.result).toBe('unavailable');
  expect(overlappingFailure.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: concurrentSuccessAt.toISOString(),
    interruptedAt: null,
    reason: null,
  });
  const racingHistory = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: racingPermit.id, teamId: team.id },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
  });
  expect(racingHistory.map((check) => check.result)).toEqual(['checked', 'unavailable']);
  expect(await prisma.permit.findUnique({ where: { id: racingPermit.id } })).toMatchObject({
    lastSuccessfulPortalCheckAt: concurrentSuccessAt,
    portalMonitoringInterruptedAt: null,
    portalMonitoringReason: null,
  });

  const unauthenticated = await browser.newContext();
  const publicHistory = await unauthenticated.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
  );
  expect(publicHistory.status()).toBe(401);
  const historyBeforeUnauthenticatedCheck = await prisma.permitPortalStatusCheck.count({
    where: { permitId: permit.id, teamId: team.id },
  });
  const fetchesBeforeUnauthenticatedCheck = await recordedPortalFetchesFor(sourceUrl);
  const emailsBeforeUnauthenticatedCheck = await interruptionEmailsForPermit(permit.id);
  const unauthenticatedCheck = await unauthenticated.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
    { headers: { origin }, data: { teamId: team.id } },
  );
  expect(unauthenticatedCheck.status()).toBe(401);
  expect(
    await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id, teamId: team.id } }),
  ).toBe(historyBeforeUnauthenticatedCheck);
  expect(await recordedPortalFetchesFor(sourceUrl)).toBe(fetchesBeforeUnauthenticatedCheck);
  expect(await interruptionEmailsForPermit(permit.id)).toEqual(emailsBeforeUnauthenticatedCheck);
  await unauthenticated.close();

  const nonmemberHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=unrelated-team`,
  );
  expect(nonmemberHistory.status()).toBe(403);
  const initialHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
  );
  expect(initialHistory.status()).toBe(200);
  const initialHistoryBody = await initialHistory.json();
  expect(initialHistoryBody.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: null,
    interruptedAt: null,
    reason: null,
  });
  expect(initialHistoryBody.latestVerified).toBeNull();
  await expect(permitCard.getByText('No successful checks yet', { exact: true })).toBeVisible();
  await expect(
    permitCard.getByText('No successful City of Tampa result has been verified yet.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(permitCard.getByText('No saved outcomes yet', { exact: true })).toBeVisible();
  const ownerEmails = [firstOwner.email, secondOwnerEmail].sort();
  expect(await interruptionEmailsForPermit(permit.id)).toEqual([]);
  const interruptedOnlyCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'QA Interrupted-Only Portal Record' }),
  });
  await expect(interruptedOnlyCard.getByRole('heading', { name: 'Watcher health' })).toBeVisible();
  await expect(
    interruptedOnlyCard.getByText('No successful checks yet', { exact: true }),
  ).toBeVisible();
  await expect(interruptedOnlyCard.getByText(/Interrupted ·/)).toBeVisible();
  const interruptedReasonText = interruptedOnlyCard.getByText(interruptedReason, { exact: true });
  await expect(interruptedReasonText).toHaveCount(2);
  await expect(interruptedReasonText.first()).toBeVisible();
  const interruptedOnlyHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(interruptedOnlyPermit.id)}&teamId=${encodeURIComponent(team.id)}`,
  );
  expect(interruptedOnlyHistory.status()).toBe(200);
  expect((await interruptedOnlyHistory.json()).monitoring).toEqual({
    lastSuccessfulPortalCheckAt: null,
    interruptedAt: '2026-10-03T03:00:00.000Z',
    reason: interruptedReason,
  });
  const unpaidTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Unpaid Permit Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(unpaidTeam.id);
  await prisma.teamMembership.create({ data: { teamId: unpaidTeam.id, userId, role: 'owner' } });
  const unpaidHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(unpaidTeam.id)}`,
  );
  expect(unpaidHistory.status()).toBe(402);
  const unpaidCheck = await page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
    { headers: { origin }, data: { teamId: unpaidTeam.id } },
  );
  expect(unpaidCheck.status()).toBe(402);
  expect(await interruptionEmailsForPermit(permit.id)).toHaveLength(0);
  const crossOriginCheck = await page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
    { headers: { origin: 'https://untrusted.example' }, data: { teamId: team.id } },
  );
  expect(crossOriginCheck.status()).toBe(403);

  const legacySuccessfulCheckAt = new Date('2026-10-01T03:00:00.000Z');
  const legacyPermit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Legacy Portal History',
      address: '102 Test Street, Tampa',
      permitNumber: '2025-020202',
      permitType: 'Building',
      status: 'Under review',
      notes: '',
      portalUrl: null,
      lastSuccessfulPortalCheckAt: legacySuccessfulCheckAt,
    },
  });
  await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: legacyPermit.id,
      teamId: team.id,
      permitNumber: legacyPermit.permitNumber,
      sourceUrl: 'https://permits.sanjoseca.gov/legacy/2025-020202',
      status: 'Technical Review',
      result: 'checked',
      checkedAt: legacySuccessfulCheckAt,
      sourceFetchedAt: new Date('2026-09-30T03:00:00.000Z'),
      redlineResult: 'not_connected',
    },
  });
  const legacyPermitBefore = await prisma.permit.findUnique({ where: { id: legacyPermit.id } });
  const legacyChecksBefore = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: legacyPermit.id },
  });
  const legacyFailureResponse = await page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(legacyPermit.id)}`,
    { headers: { origin }, data: { teamId: team.id } },
  );
  expect(legacyFailureResponse.status()).toBe(422);
  const legacyFailure = await legacyFailureResponse.json();
  expect(legacyFailure).toMatchObject({
    error: 'invalid_portal_url',
    message:
      'This saved link is outside active City of Tampa coverage. Edit the permit and save its direct record URL from the official City of Tampa Accela portal before checking it.',
  });
  expect(await prisma.permit.findUnique({ where: { id: legacyPermit.id } })).toEqual(
    legacyPermitBefore,
  );
  expect(
    await prisma.permitPortalStatusCheck.findMany({ where: { permitId: legacyPermit.id } }),
  ).toEqual(legacyChecksBefore);
  expect(await prisma.permitStatusEvent.count({ where: { permitId: legacyPermit.id } })).toBe(0);
  expect(legacyPermitBefore).toMatchObject({
    status: 'Under review',
    lastSuccessfulPortalCheckAt: legacySuccessfulCheckAt,
    portalMonitoringInterruptedAt: null,
    portalMonitoringReason: null,
  });
  const legacyHistoryResponse = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(legacyPermit.id)}&teamId=${encodeURIComponent(team.id)}`,
  );
  const legacyHistory = await legacyHistoryResponse.json();
  expect(legacyHistory.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: null,
    interruptedAt: null,
    reason: null,
  });
  expect(legacyHistory.latestVerified).toBeNull();

  const firstCheckResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await permitCard.getByRole('button', { name: 'Run public check' }).click();
  const firstOutcome = await (await firstCheckResponse).json();
  const firstCheck = firstOutcome.check;
  expect(firstCheck.result, JSON.stringify(firstCheck)).toBe('checked');
  expect(firstCheck.status, JSON.stringify(firstCheck)).toBe('In Process');
  expect(firstOutcome.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: firstCheck.checkedAt,
    interruptedAt: null,
    reason: null,
  });
  expect(firstCheck.checkedAt).not.toBe(firstCheck.sourceFetchedAt);
  expect(await prisma.permit.findUnique({ where: { id: permit.id } })).toMatchObject({
    lastSuccessfulPortalCheckAt: new Date(firstCheck.checkedAt),
    portalMonitoringInterruptedAt: null,
    portalMonitoringReason: null,
  });
  const latestVerifiedSummary = permitCard.locator(
    '[aria-label="Latest verified City of Tampa portal result"]',
  );
  await expect(latestVerifiedSummary.getByText('In Process', { exact: true })).toBeVisible();
  await expect(latestVerifiedSummary.locator('time')).toHaveAttribute(
    'dateTime',
    firstCheck.checkedAt,
  );
  await expect(
    latestVerifiedSummary.getByRole('link', {
      name: 'Open official City record used for this check',
    }),
  ).toHaveAttribute('href', sourceUrl);
  await expect(permitCard.getByText('Public Record Status')).toBeVisible();
  await expect(permitCard.getByText('In Process', { exact: true })).toHaveCount(3);
  await expect(
    permitCard.getByText('Stored public field matches the value read from this page.'),
  ).toBeVisible();
  await expect(permitCard.getByText(/Redline: no status available · not connected/)).toBeVisible();
  await expect(permitCard.getByText(/No Redline source is connected/)).toBeVisible();

  const secondCheckResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await permitCard.getByRole('button', { name: 'Run public check' }).click();
  const secondOutcome = await (await secondCheckResponse).json();
  const secondCheck = secondOutcome.check;
  expect(secondCheck.result).toBe('checked');
  expect(await interruptionEmailsForPermit(permit.id)).toEqual([]);
  expect(secondOutcome.monitoring.lastSuccessfulPortalCheckAt).toBe(secondCheck.checkedAt);
  await expect(latestVerifiedSummary.getByText('Awaiting Client Reply', { exact: true })).toBeVisible();
  await expect(latestVerifiedSummary.locator('time')).toHaveAttribute(
    'dateTime',
    secondCheck.checkedAt,
  );
  await expect(permitCard.getByText('Awaiting Client Reply', { exact: true })).toHaveCount(3);
  await expect(permitCard.getByText('In Process', { exact: true })).toHaveCount(2);

  const savedChecks = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id },
  });
  expect(savedChecks).toHaveLength(2);
  expect(savedChecks.map((check) => check.status).sort()).toEqual(
    ['Awaiting Client Reply', 'In Process'].sort(),
  );
  for (const check of savedChecks) {
    expect(check).toMatchObject({
      permitNumber,
      sourceUrl,
      result: 'checked',
      redlineStatus: null,
      redlineResult: 'not_connected',
    });
    expect(check.checkedAt).toBeInstanceOf(Date);
  }

  const unavailableCheckResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await permitCard.getByRole('button', { name: 'Run public check' }).click();
  const unavailableCheck = await (await unavailableCheckResponse).json();
  expect(unavailableCheck.check).toMatchObject({
    result: 'unavailable',
    status: null,
    message: 'The public City record page could not be read.',
    redlineResult: 'not_connected',
  });
  expect(unavailableCheck.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: secondCheck.checkedAt,
    interruptedAt: unavailableCheck.check.checkedAt,
    reason: unavailableCheck.check.message,
  });
  await expect(permitCard.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(permitCard.getByText('No status verified', { exact: true })).toBeVisible();
  await expect(permitCard.getByText(unavailableCheck.check.message, { exact: true })).toBeVisible();
  await expect(latestVerifiedSummary.getByText('Awaiting Client Reply', { exact: true })).toBeVisible();
  await expect(latestVerifiedSummary.locator('time')).toHaveAttribute(
    'dateTime',
    secondCheck.checkedAt,
  );
  const unavailableOwnerEmails = await interruptionEmailsForPermit(permit.id);
  expect(unavailableOwnerEmails).toHaveLength(2);
  expect(unavailableOwnerEmails.map((email) => email.to).sort()).toEqual(ownerEmails);
  for (const email of unavailableOwnerEmails) {
    expect(email.subject).toBe(`Permit monitoring interrupted: ${permitNumber}`);
    expect(email.body).toContain(`Permit ${permitNumber}`);
    expect(email.body).toContain('Saved outcome: unavailable');
    expect(email.body).toContain(`Reason: ${unavailableCheck.check.message}`);
    expect(email.body).toContain(`Checked at (UTC): ${unavailableCheck.check.checkedAt}`);
    expect(email.body).toContain(`/dashboard/permits/${encodeURIComponent(permit.id)}`);
    expect(email.html).toContain(
      `href="${origin}/dashboard/permits/${encodeURIComponent(permit.id)}"`,
    );
  }

  const repeatedUnavailableResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await permitCard.getByRole('button', { name: 'Run public check' }).click();
  const repeatedUnavailable = await (await repeatedUnavailableResponse).json();
  expect(repeatedUnavailable.check).toMatchObject({
    result: 'unavailable',
    message: unavailableCheck.check.message,
  });
  expect(repeatedUnavailable.monitoring).toMatchObject({
    lastSuccessfulPortalCheckAt: secondCheck.checkedAt,
    reason: unavailableCheck.check.message,
  });
  expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id } })).toBe(4);
  expect(await interruptionEmailsForPermit(permit.id)).toHaveLength(2);
  expect((await interruptionEmailsForPermit(permit.id)).map((email) => email.to).sort()).toEqual(
    ownerEmails,
  );

  const unverifiedCheckResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await permitCard.getByRole('button', { name: 'Run public check' }).click();
  const unverifiedOutcome = await (await unverifiedCheckResponse).json();
  expect(unverifiedOutcome.check).toMatchObject({ result: 'unverified', status: null });
  expect(unverifiedOutcome.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: secondCheck.checkedAt,
    interruptedAt: unverifiedOutcome.check.checkedAt,
    reason: unverifiedOutcome.check.message,
  });
  expect(await prisma.permit.findUnique({ where: { id: permit.id } })).toMatchObject({
    lastSuccessfulPortalCheckAt: new Date(secondCheck.checkedAt),
    portalMonitoringInterruptedAt: new Date(unverifiedOutcome.check.checkedAt),
    portalMonitoringReason: unverifiedOutcome.check.message,
  });
  await expect(permitCard.getByText('Unverified', { exact: true })).toBeVisible();
  await expect(
    permitCard.getByText(unverifiedOutcome.check.message, { exact: true }),
  ).toBeVisible();
  const changedOwnerEmails = await interruptionEmailsForPermit(permit.id);
  expect(changedOwnerEmails).toHaveLength(4);
  const unverifiedOwnerEmails = changedOwnerEmails.slice(2);
  expect(unverifiedOwnerEmails.map((email) => email.to).sort()).toEqual(ownerEmails);
  for (const email of unverifiedOwnerEmails) {
    expect(email.subject).toBe(`Permit monitoring interrupted: ${permitNumber}`);
    expect(email.body).toContain('Saved outcome: unverified');
    expect(email.body).toContain(`Reason: ${unverifiedOutcome.check.message}`);
    expect(email.body).toContain(`Checked at (UTC): ${unverifiedOutcome.check.checkedAt}`);
    expect(email.body).toContain(`/dashboard/permits/${encodeURIComponent(permit.id)}`);
  }

  const allChecks = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id },
    orderBy: { checkedAt: 'desc' },
  });
  expect(allChecks).toHaveLength(5);
  expect(allChecks[0]).toMatchObject({ result: 'unverified', status: null });
  expect(allChecks.map((check) => check.status).sort()).toEqual(
    [null, null, null, 'Awaiting Client Reply', 'In Process'].sort(),
  );

  const memberBEmail = `qa-permit-cross-team-${randomBytes(8).toString('hex')}@example.test`;
  const memberBPassword = `Qa-${randomBytes(12).toString('hex')}-9a`;
  const memberBStorage = `/tmp/polsia-cross-team-${randomBytes(8).toString('hex')}.json`;
  const { page: memberBPage, userId: memberBUserId } = await openSignedInWorkspace(
    browser,
    origin,
    {
      email: memberBEmail,
      password: memberBPassword,
      storageStatePath: memberBStorage,
    },
  );
  fixtureUserIds.push(memberBUserId);
  const teamB = await prisma.teamSpace.create({
    data: {
      name: 'QA Separate Permit Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: memberBUserId,
    },
  });
  fixtureTeamIds.push(teamB.id);
  await prisma.teamMembership.create({
    data: { teamId: teamB.id, userId: memberBUserId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: teamB.id,
      userId: memberBUserId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const ownTeamCrossPermitRead = await memberBPage.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(teamB.id)}`,
    { headers: { origin } },
  );
  expect(ownTeamCrossPermitRead.status()).toBe(404);
  const teamAHistoryRead = await memberBPage.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
    { headers: { origin } },
  );
  expect(teamAHistoryRead.status()).toBe(403);
  const teamACheckAttempt = await memberBPage.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
    { headers: { origin }, data: { teamId: team.id } },
  );
  expect(teamACheckAttempt.status()).toBe(403);
  expect(await interruptionEmailsForPermit(permit.id)).toHaveLength(4);
  expect(
    await prisma.permitPortalStatusCheck.count({
      where: { permitId: permit.id, teamId: teamB.id },
    }),
  ).toBe(0);
  expect(
    await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id, teamId: team.id } }),
  ).toBe(5);

  const unchangedPermit = await prisma.permit.findUnique({ where: { id: permit.id } });
  expect(unchangedPermit).toMatchObject({
    status: 'Planning',
    notes: 'Keep the team note intact after a portal check.',
    portalUrl: sourceUrl,
  });
  expect(await prisma.permitStatusEvent.count({ where: { permitId: permit.id } })).toBe(0);

  await page.reload();
  const reloadedCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'QA Public Status Record' }),
  });
  await expect(reloadedCard.getByText('Awaiting Client Reply', { exact: true })).toHaveCount(3);
  await expect(reloadedCard.getByText('In Process', { exact: true })).toHaveCount(2);
  await expect(reloadedCard.getByText('No status verified', { exact: true })).toHaveCount(3);
  await expect(reloadedCard.getByText(/Interrupted ·/)).toBeVisible();
  const reloadedVerifiedSummary = reloadedCard.locator(
    '[aria-label="Latest verified City of Tampa portal result"]',
  );
  await expect(
    reloadedVerifiedSummary.getByText('Awaiting Client Reply', { exact: true }),
  ).toBeVisible();
  await expect(reloadedVerifiedSummary.locator('time')).toHaveAttribute(
    'dateTime',
    secondCheck.checkedAt,
  );
  await expect(
    reloadedCard.getByText(unverifiedOutcome.check.message, { exact: true }),
  ).toHaveCount(1);
  expect(await interruptionEmailsForPermit(permit.id)).toHaveLength(4);
  await expect(
    reloadedCard.getByText(new Date(secondCheck.checkedAt).toLocaleString(), { exact: true }),
  ).toHaveCount(2);
  await expect(
    reloadedCard.getByText('Keep the team note intact after a portal check.'),
  ).toBeVisible();
  await expect(
    reloadedCard.getByRole('link', { name: 'Open City of Tampa source' }).first(),
  ).toHaveAttribute('href', sourceUrl);

  const recoveryResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await reloadedCard.getByRole('button', { name: 'Run public check' }).click();
  const recoveryOutcome = await (await recoveryResponse).json();
  expect(recoveryOutcome.check.result).toBe('checked');
  expect(recoveryOutcome.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: recoveryOutcome.check.checkedAt,
    interruptedAt: null,
    reason: null,
  });
  expect(await prisma.permit.findUnique({ where: { id: permit.id } })).toMatchObject({
    lastSuccessfulPortalCheckAt: new Date(recoveryOutcome.check.checkedAt),
    portalMonitoringInterruptedAt: null,
    portalMonitoringReason: null,
  });
  await expect(reloadedCard.getByText('No interruption recorded', { exact: true })).toBeVisible();
  const recoveredHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
  );
  expect((await recoveredHistory.json()).monitoring).toEqual(recoveryOutcome.monitoring);
  expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id } })).toBe(6);
  expect(await prisma.permitStatusEvent.count({ where: { permitId: permit.id } })).toBe(0);
  expect(await interruptionEmailsForPermit(permit.id)).toHaveLength(4);

  const managerEmail = `qa-portal-monitor-manager-${randomUUID()}@example.test`;
  const managerId = randomUUID();
  const managerCreatedAt = new Date();
  await prisma.user.create({
    data: {
      id: managerId,
      name: 'QA Project Manager',
      email: managerEmail,
      emailVerified: true,
      createdAt: managerCreatedAt,
      updatedAt: managerCreatedAt,
    },
  });
  fixtureUserIds.push(managerId);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: managerId, role: 'project_manager' },
  });

  const manualStatusChange = await page.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      action: 'update',
      id: permit.id,
      teamId: team.id,
      data: {
        projectName: permit.projectName,
        address: permit.address,
        permitNumber: permit.permitNumber,
        permitType: permit.permitType,
        status: 'Submitted',
        notes: permit.notes,
        portalUrl: permit.portalUrl,
      },
      falseAlarmReason: 'The team confirmed the status change.',
    },
  });
  expect(manualStatusChange.status()).toBe(200);
  expect(await manualStatusChange.json()).toMatchObject({
    status: 'Submitted',
    statusEvents: [
      { status: 'Submitted', falseAlarmReason: 'The team confirmed the status change.' },
    ],
  });
  expect(await prisma.permitStatusEvent.count({ where: { permitId: permit.id } })).toBe(1);
  const managerAlerts = await capturedEmailsFor(managerEmail);
  expect(managerAlerts).toHaveLength(1);
  expect(managerAlerts[0]).toMatchObject({
    to: managerEmail,
    subject: 'Permit status changed: QA Public Status Record',
  });
  expect(managerAlerts[0]?.body).toContain('Planning');
  expect(managerAlerts[0]?.body).toContain('Submitted');
  const permitAfterManualStatusChange = await prisma.permit.findUnique({
    where: { id: permit.id },
  });
  expect(permitAfterManualStatusChange).toMatchObject({
    status: 'Submitted',
    lastSuccessfulPortalCheckAt: new Date(recoveryOutcome.check.checkedAt),
    portalMonitoringInterruptedAt: null,
    portalMonitoringReason: null,
  });
  expect(
    (
      await (
        await page.request.get(
          `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
        )
      ).json()
    ).monitoring,
  ).toEqual(recoveryOutcome.monitoring);
  await captureMonitorViews(page, testInfo, reloadedCard, 'successful');
  await captureMonitorViews(page, testInfo, interruptedOnlyCard, 'interrupted-only');
  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  const detailsSummary = page.getByRole('region', {
    name: 'Latest verified City of Tampa portal result',
  });
  await expect(detailsSummary).toBeVisible();
  await expect(
    detailsSummary.getByText('Record Status reported by the City of Tampa portal'),
  ).toBeVisible();
  await expect(detailsSummary.getByText(recoveryOutcome.check.status, { exact: true })).toBeVisible();
  await expect(detailsSummary.locator('time')).toHaveAttribute(
    'dateTime',
    recoveryOutcome.check.checkedAt,
  );
  await expect(
    detailsSummary.getByRole('link', {
      name: 'Open official City record used for this check',
    }),
  ).toHaveAttribute('href', sourceUrl);
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await detailsSummary.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`permit-detail-tampa-result-${viewport.name}.png`),
    });
  }
});

test('Run public check explains unsupported saved links without changing permit history', async (
  { browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { page, userId } = await openSignedInWorkspace(browser, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Unsupported Portal URL',
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

  const lastSuccessfulPortalCheckAt = new Date('2026-10-01T03:00:00.000Z');
  const portalMonitoringInterruptedAt = new Date('2026-10-02T03:00:00.000Z');
  const portalMonitoringReason = 'Existing public portal retrieval interruption.';
  const invalidPortalUrl = 'https://permits.sanjoseca.gov/record/2026-040404';
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Unsupported Saved Portal Link',
      address: '104 Test Street, Tampa',
      permitNumber: '2026-040404',
      permitType: 'Building',
      status: 'Corrections requested',
      notes: 'Team status history stays unchanged.',
      portalUrl: invalidPortalUrl,
      lastSuccessfulPortalCheckAt,
      portalMonitoringInterruptedAt,
      portalMonitoringReason,
    },
  });
  await prisma.permitStatusEvent.create({
    data: {
      permitId: permit.id,
      status: 'Corrections requested',
      falseAlarmReason: 'The team confirmed the correction notice.',
      createdAt: new Date('2026-10-01T02:00:00.000Z'),
    },
  });
  await prisma.permitPortalStatusCheck.createMany({
    data: [
      {
        permitId: permit.id,
        teamId: team.id,
        permitNumber: permit.permitNumber,
        sourceUrl: 'https://permits.sanjoseca.gov/record/2026-040404',
        status: 'Technical Review',
        result: 'checked',
        checkedAt: lastSuccessfulPortalCheckAt,
        sourceFetchedAt: new Date('2026-10-01T02:55:00.000Z'),
        redlineResult: 'not_connected',
      },
      {
        permitId: permit.id,
        teamId: team.id,
        permitNumber: permit.permitNumber,
        sourceUrl: 'https://permits.sanjoseca.gov/record/2026-040404',
        status: null,
        result: 'unavailable',
        message: portalMonitoringReason,
        checkedAt: portalMonitoringInterruptedAt,
        redlineResult: 'not_connected',
      },
    ],
  });

  const permitBefore = await prisma.permit.findUnique({ where: { id: permit.id } });
  const statusEventsBefore = await prisma.permitStatusEvent.findMany({
    where: { permitId: permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const checksBefore = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id, teamId: team.id },
    orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const permitCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'QA Unsupported Saved Portal Link' }),
  });
  await expect(permitCard).toBeVisible();
  await expect(permitCard.getByRole('button', { name: 'Run public check' })).toBeDisabled();
  await expect(
    permitCard.getByRole('link', { name: 'Official City of Tampa Accela record' }),
  ).toHaveCount(0);

  const response = await page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
    { headers: { origin }, data: { teamId: team.id } },
  );
  expect(response.status()).toBe(422);
  expect(await response.json()).toMatchObject({
    error: 'invalid_portal_url',
    message:
      'This saved link is outside active City of Tampa coverage. Edit the permit and save its direct record URL from the official City of Tampa Accela portal before checking it.',
  });
  const historicalNote = permitCard.getByText(/San José record and its check history are retained/i);
  await expect(historicalNote).toBeVisible();

  expect(await prisma.permit.findUnique({ where: { id: permit.id } })).toEqual(permitBefore);
  expect(
    await prisma.permitStatusEvent.findMany({
      where: { permitId: permit.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ).toEqual(statusEventsBefore);
  expect(
    await prisma.permitPortalStatusCheck.findMany({
      where: { permitId: permit.id, teamId: team.id },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    }),
  ).toEqual(checksBefore);
  expect(permitBefore).toMatchObject({
    status: 'Corrections requested',
    lastSuccessfulPortalCheckAt,
    portalMonitoringInterruptedAt,
    portalMonitoringReason,
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await historicalNote.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`unsupported-portal-${viewport.name}.png`) });
  }
});

test('status-change summaries include active Tampa records and omit historical San José records', async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { page, userId } = await openSignedInWorkspace(browser, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Tampa Detection Coverage',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: { teamId: team.id, userId, status: 'verified', grossAmountUsd: 299, verifiedAt: new Date() },
  });

  const checkedAt = new Date(Date.now() - 60_000);
  async function createRecord(input: {
    permitNumber: string;
    portalUrl: string;
    archivedAt?: Date;
    statuses: [string, string];
  }) {
    const permit = await prisma.permit.create({
      data: {
        userId,
        teamId: team.id,
        projectName: `QA ${input.permitNumber}`,
        address: '100 Sample Street, Tampa, FL',
        permitNumber: input.permitNumber,
        permitType: 'Building',
        status: 'Under review',
        notes: '',
        portalUrl: input.portalUrl,
        ...(input.archivedAt ? { archivedAt: input.archivedAt } : {}),
      },
    });
    await prisma.permitPortalStatusCheck.createMany({
      data: input.statuses.map((status, index) => ({
        permitId: permit.id,
        teamId: team.id,
        permitNumber: input.permitNumber,
        sourceUrl: input.portalUrl,
        status,
        result: 'checked',
        checkedAt: new Date(checkedAt.getTime() + index * 1_000),
        sourceFetchedAt: new Date(checkedAt.getTime() + index * 1_000),
        requestSequence: index + 1,
        redlineResult: 'not_connected',
      })),
    });
    return permit;
  }

  const activePermit = await createRecord({
    permitNumber: 'BLD-27-0529173',
    portalUrl: tampaRecordUrl('BLD-27-0529173'),
    statuses: ['In Process', 'Awaiting Client Reply'],
  });
  const historicalPermit = await createRecord({
    permitNumber: 'LEGACY-SJ-0529173',
    portalUrl: 'https://permits.sanjoseca.gov/record/LEGACY-SJ-0529173',
    statuses: ['In Review', 'Corrections'],
  });
  const archivedPermit = await createRecord({
    permitNumber: 'BLD-27-0529182',
    portalUrl: tampaRecordUrl('BLD-27-0529182'),
    archivedAt: new Date(),
    statuses: ['In Process', 'Awaiting Client Reply'],
  });

  const response = await page.request.get(
    `${origin}/api/permit-status-detections?teamId=${encodeURIComponent(team.id)}`,
    { headers: { origin } },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    items: Array<{ permitId: string; previousStatus: string; newStatus: string }>;
  };
  expect(body.items).toEqual([
    expect.objectContaining({
      permitId: activePermit.id,
      previousStatus: 'In Process',
      newStatus: 'Awaiting Client Reply',
    }),
  ]);
  expect(body.items.some((item) => item.permitId === historicalPermit.id)).toBe(false);
  expect(body.items.some((item) => item.permitId === archivedPermit.id)).toBe(false);
});

test('locked billing states deny portal history and checks without City reads or owner email', async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;

  async function createOwner(prefix: string) {
    const email = `${prefix}-${randomUUID()}@example.test`;
    const credentials = {
      email,
      password: `Qa-${randomBytes(12).toString('hex')}-9a`,
      storageStatePath: `/tmp/polsia-locked-billing-${randomUUID()}.json`,
    };
    const owner = await openSignedInWorkspace(browser, origin, credentials);
    fixtureUserIds.push(owner.userId);
    await prisma.user.update({ where: { id: owner.userId }, data: { emailVerified: true } });
    return owner;
  }

  async function assertLockedCase(input: {
    label: string;
    page: Page;
    userId: string;
    checkoutStatus: 'pending' | 'failed' | 'unverified' | 'verified';
    verified: boolean;
    expectedStatus: 402 | 503;
    expectedPaymentStatus: 'pending' | 'unpaid' | 'inactive' | 'unavailable';
  }) {
    const team = await prisma.teamSpace.create({
      data: {
        name: `QA ${input.label} Billing Team`,
        joinCode: randomBytes(6).toString('hex').toUpperCase(),
        createdByUserId: input.userId,
      },
    });
    fixtureTeamIds.push(team.id);
    await prisma.teamMembership.create({
      data: { teamId: team.id, userId: input.userId, role: 'owner' },
    });
    await prisma.teamCheckout.create({
      data: {
        teamId: team.id,
        userId: input.userId,
        status: input.checkoutStatus,
        grossAmountUsd: input.verified || input.checkoutStatus === 'unverified' ? 299 : null,
        verifiedAt: input.verified ? new Date() : null,
      },
    });

    const permitNumber = `QA-${input.label}-${randomUUID()}`;
      const sourceUrl = tampaRecordUrl(permitNumber, { fixture: `locked-${input.label}` });
    const permit = await prisma.permit.create({
      data: {
        userId: input.userId,
        teamId: team.id,
        projectName: `QA ${input.label} Locked Permit`,
        address: '105 Test Street, Tampa',
        permitNumber,
        permitType: 'Building',
        status: 'Planning',
        notes: '',
        portalUrl: sourceUrl,
      },
    });
    await prisma.permitPortalStatusCheck.create({
      data: {
        permitId: permit.id,
        teamId: team.id,
        permitNumber,
        sourceUrl,
        status: null,
        result: 'unavailable',
        message: 'Previously saved test interruption.',
        checkedAt: new Date('2026-10-01T08:00:00.000Z'),
        redlineResult: 'not_connected',
      },
    });

    const historyResponse = await input.page.request.get(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(team.id)}`,
      { headers: { origin } },
    );
    expect(historyResponse.status()).toBe(input.expectedStatus);
    const historyBody = (await historyResponse.json()) as {
      error?: string;
      paymentStatus?: string;
      items?: unknown[];
    };
    expect(historyBody).toMatchObject({ paymentStatus: input.expectedPaymentStatus });
    expect(historyBody.items).toBeUndefined();

    const checkResponse = await input.page.request.post(
      `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
      { headers: { origin }, data: { teamId: team.id } },
    );
    expect(checkResponse.status()).toBe(input.expectedStatus);
    const checkBody = (await checkResponse.json()) as {
      error?: string;
      paymentStatus?: string;
      check?: unknown;
    };
    expect(checkBody).toMatchObject({ paymentStatus: input.expectedPaymentStatus });
    expect(checkBody.check).toBeUndefined();
    expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id } })).toBe(1);
    expect(await recordedPortalFetchesFor(sourceUrl)).toBe(0);
    expect(await interruptionEmailsForPermit(permit.id)).toHaveLength(0);
  }

  const defaultOwner = await createOwner('qa-billing-unpaid-state');
  for (const locked of [
    { label: 'pending', checkoutStatus: 'pending', expectedPaymentStatus: 'pending' },
    { label: 'failed', checkoutStatus: 'failed', expectedPaymentStatus: 'unpaid' },
    { label: 'unverified', checkoutStatus: 'unverified', expectedPaymentStatus: 'unpaid' },
  ] as const) {
    await assertLockedCase({
      ...locked,
      page: defaultOwner.page,
      userId: defaultOwner.userId,
      verified: false,
      expectedStatus: 402,
    });
  }

  const inactiveOwner = await createOwner('qa-inactive');
  await assertLockedCase({
    label: 'inactive',
    checkoutStatus: 'verified',
    page: inactiveOwner.page,
    userId: inactiveOwner.userId,
    verified: true,
    expectedStatus: 402,
    expectedPaymentStatus: 'inactive',
  });

  const unavailableOwner = await createOwner('qa-unavailable');
  await assertLockedCase({
    label: 'unavailable',
    checkoutStatus: 'verified',
    page: unavailableOwner.page,
    userId: unavailableOwner.userId,
    verified: true,
    expectedStatus: 503,
    expectedPaymentStatus: 'unavailable',
  });
});
