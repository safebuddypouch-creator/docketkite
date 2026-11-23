// @polsia:user-owned — interrupted public-check retry from permit details.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { tampaRecordUrl } from './permit-test-helpers';

const prisma = new PrismaClient();
const fixtureContexts: BrowserContext[] = [];
const fixtureTeamIds: string[] = [];
const fixtureUserIds: string[] = [];
const subscriptionStatePaths: string[] = [];

async function createProjectManagerAccount(browser: Browser, origin: string) {
  const email = `qa-permit-retry-manager-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const storageStatePath = `/tmp/polsia-permit-retry-manager-${randomUUID()}.json`;
  execFileSync(
    'node',
    [
      '.agents/auth-session.cjs',
      '--as',
      'user',
      '--email',
      email,
      '--password',
      password,
      '--out',
      storageStatePath,
      '--base-url',
      origin,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
  const context = await browser.newContext({ storageState: storageStatePath });
  fixtureContexts.push(context);
  const page = await context.newPage();
  const response = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(response.status()).toBe(200);
  const session = (await response.json()) as { user?: { id?: string } };
  const userId = session.user?.id;
  if (!userId) throw new Error('The project-manager session did not include a user id.');
  fixtureUserIds.push(userId);
  return { page, userId };
}

function linearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${color}`);
  return (
    0.2126 * linearChannel(channels[0] ?? 0) +
    0.7152 * linearChannel(channels[1] ?? 0) +
    0.0722 * linearChannel(channels[2] ?? 0)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (first, second) => second - first,
  );
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
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
  await Promise.all(subscriptionStatePaths.map((path) => unlink(path).catch(() => undefined)));
  subscriptionStatePaths.length = 0;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('only a paid team owner can retry an interrupted permit check and a failure preserves the last verified result', async (
  { browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const email = `qa-permit-retry-${randomUUID()}@example.test`;
  const subscriptionDigest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const subscriptionStatePath = `/tmp/polsia-subscription-state-${subscriptionDigest}.json`;
  subscriptionStatePaths.push(subscriptionStatePath);
  await writeFile(
    subscriptionStatePath,
    JSON.stringify({ active: true, unavailable: false }),
    'utf8',
  );
  const password = `Qa-${randomUUID()}-9a`;
  const storageStatePath = `/tmp/polsia-permit-retry-${randomUUID()}.json`;
  execFileSync(
    'node',
    [
      '.agents/auth-session.cjs',
      '--as',
      'user',
      '--email',
      email,
      '--password',
      password,
      '--out',
      storageStatePath,
      '--base-url',
      origin,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
  const context = await browser.newContext({ storageState: storageStatePath });
  fixtureContexts.push(context);
  const page: Page = await context.newPage();
  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(sessionResponse.status()).toBe(200);
  const sessionBody = (await sessionResponse.json()) as { user?: { id?: string } };
  const userId = sessionBody.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('The authenticated session did not include a user id.');
  fixtureUserIds.push(userId);

  const paidTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Permit Retry Paid Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(paidTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: paidTeam.id, userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: paidTeam.id,
      userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });

  const permitNumber = `QA-${randomUUID()}`;
  const sourceUrl = tampaRecordUrl(permitNumber, { fixture: `retry-unavailable-${randomUUID()}` });
  const priorCheckAt = new Date(Date.now() - 60_000);
  const interruptionReason = 'The public City record could not be read.';
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: paidTeam.id,
      projectName: 'QA Interrupted Permit Retry',
      address: '101 Test Street, Tampa',
      permitNumber,
      permitType: 'Building',
      status: 'Under review',
      notes: 'Keep this team note unchanged after the retry.',
      portalUrl: sourceUrl,
      portalMonitoringInterruptedAt: priorCheckAt,
      portalMonitoringReason: interruptionReason,
    },
  });
  await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: permit.id,
      teamId: paidTeam.id,
      permitNumber,
      sourceUrl,
      status: 'Approved — last verified result',
      result: 'checked',
      checkedAt: priorCheckAt,
      sourceFetchedAt: priorCheckAt,
      requestSequence: 3,
      redlineResult: 'not_connected',
    },
  });
  await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: permit.id,
      teamId: paidTeam.id,
      permitNumber,
      sourceUrl,
      result: 'unavailable',
      message: interruptionReason,
      checkedAt: priorCheckAt,
      requestSequence: 4,
      redlineResult: 'not_connected',
    },
  });

  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  const monitor = page.getByRole('region', {
    name: `Public City status for permit ${permitNumber}`,
  });
  const retryButton = monitor.getByRole('button', { name: 'Retry check', exact: true });
  await expect(retryButton).toBeVisible();
  await expect(monitor.getByText('Approved — last verified result', { exact: true }).first()).toBeVisible();
  await expect(
    monitor.getByText(`Permit ${permitNumber} · Checked ${priorCheckAt.toLocaleString()}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    monitor.getByRole('link', { name: 'Open official City record used for this check' }),
  ).toHaveAttribute('href', sourceUrl);
  const retryButtonColors = await retryButton.evaluate((button) => {
    const computed = getComputedStyle(button);
    return { foreground: computed.color, background: computed.backgroundColor };
  });
  expect(contrastRatio(retryButtonColors.foreground, retryButtonColors.background)).toBeGreaterThanOrEqual(
    4.5,
  );
  await expect(monitor.getByText(interruptionReason, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Under review', { exact: true })).toBeVisible();
  await expect(page.getByText('Keep this team note unchanged after the retry.')).toBeVisible();

  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${origin}/api/permit-portal-checks`) &&
      response.request().method() === 'POST',
  );
  await retryButton.click();
  const retryFeedback = monitor.getByText('Retrying the public City of Tampa record check…', {
    exact: true,
  });
  await expect(retryFeedback).toHaveAttribute('aria-live', 'polite');
  await expect(retryFeedback).toBeVisible();
  const response = await retryResponse;
  expect(response.status()).toBe(201);
  const outcome = (await response.json()) as {
    check: { id: string; result: string; message: string | null; checkedAt: string; sourceUrl: string };
    monitoring: { interruptedAt: string | null; reason: string | null };
  };
  expect(outcome.check).toMatchObject({
    result: 'unavailable',
    message: 'The public City record page could not be read.',
    sourceUrl,
  });
  const recordedFetches = (await readFile('/tmp/polsia-portal-fetch-calls.ndjson', 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { url: string; waitMs: number });
  expect(recordedFetches).toContainEqual({ url: sourceUrl, waitMs: 5000 });
  expect(new Date(outcome.check.checkedAt).getTime()).toBeGreaterThan(priorCheckAt.getTime());
  expect(outcome.monitoring).toEqual({
    lastSuccessfulPortalCheckAt: priorCheckAt.toISOString(),
    interruptedAt: outcome.check.checkedAt,
    reason: outcome.check.message,
  });
  await expect(retryButton).toBeVisible();
  await expect(
    monitor.getByText(outcome.check.message ?? '', { exact: true }).first(),
  ).toBeVisible();
  await expect(monitor.getByText('Approved — last verified result', { exact: true }).first()).toBeVisible();
  await expect(
    monitor.getByText(`Permit ${permitNumber} · Checked ${priorCheckAt.toLocaleString()}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    monitor.getByRole('link', { name: 'Open official City record used for this check' }),
  ).toHaveAttribute('href', sourceUrl);

  const refreshedHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(paidTeam.id)}`,
    { headers: { origin } },
  );
  expect(refreshedHistory.status()).toBe(200);
  expect(await refreshedHistory.json()).toMatchObject({
    canRetry: true,
    latestVerified: {
      permitNumber,
      status: 'Approved — last verified result',
      sourceUrl,
      checkedAt: priorCheckAt.toISOString(),
    },
  });
  await expect(
    monitor.getByText(`Checked ${new Date(outcome.check.checkedAt).toLocaleString()} · Permit ${permitNumber}`, {
      exact: true,
    }),
  ).toBeVisible();

  const persistedChecks = await prisma.permitPortalStatusCheck.findMany({
    where: { permitId: permit.id, teamId: paidTeam.id },
    orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }],
  });
  expect(persistedChecks).toHaveLength(3);
  expect(persistedChecks[0]).toMatchObject({
    id: outcome.check.id,
    result: 'unavailable',
    message: outcome.check.message,
    sourceUrl,
  });
  expect(persistedChecks[0]?.checkedAt.toISOString()).toBe(outcome.check.checkedAt);
  expect(await prisma.permit.findUnique({ where: { id: permit.id } })).toMatchObject({
    status: 'Under review',
    notes: 'Keep this team note unchanged after the retry.',
    portalMonitoringInterruptedAt: new Date(outcome.check.checkedAt),
    portalMonitoringReason: outcome.check.message,
  });

  const manager = await createProjectManagerAccount(browser, origin);
  await prisma.teamMembership.create({
    data: { teamId: paidTeam.id, userId: manager.userId, role: 'project_manager' },
  });
  await manager.page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  const managerMonitor = manager.page.getByRole('region', {
    name: `Public City status for permit ${permitNumber}`,
  });
  await expect(
    managerMonitor.getByText('Approved — last verified result', { exact: true }).first(),
  ).toBeVisible();
  await expect(managerMonitor.getByRole('button', { name: 'Retry check' })).toHaveCount(0);
  const managerHistory = await manager.page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}&teamId=${encodeURIComponent(paidTeam.id)}`,
    { headers: { origin } },
  );
  expect(managerHistory.status()).toBe(200);
  expect(await managerHistory.json()).toMatchObject({ canRetry: false });
  const countRecordedFetchesForSource = async () => {
    const contents = await readFile('/tmp/polsia-portal-fetch-calls.ndjson', 'utf8');
    return contents
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { url: string })
      .filter((call) => call.url === sourceUrl).length;
  };
  const fetchCountBeforeDeniedRetry = await countRecordedFetchesForSource();
  const deniedRetry = await manager.page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(permit.id)}`,
    { headers: { origin }, data: { teamId: paidTeam.id } },
  );
  expect(deniedRetry.status()).toBe(403);
  expect(await deniedRetry.json()).toMatchObject({ error: 'team_owner_required' });
  expect(await countRecordedFetchesForSource()).toBe(fetchCountBeforeDeniedRetry);
  expect(await prisma.permitPortalStatusCheck.count({ where: { permitId: permit.id } })).toBe(3);

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await retryButton.scrollIntoViewIfNeeded();
    await expect(retryButton).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`permit-retry-${viewport.name}.png`),
      fullPage: true,
    });
  }

  const unpaidTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Permit Retry Unpaid Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(unpaidTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: unpaidTeam.id, userId, role: 'owner' },
  });
  const unpaidPermit = await prisma.permit.create({
    data: {
      userId,
      teamId: unpaidTeam.id,
      projectName: 'QA Unpaid Retry Is Locked',
      address: '102 Test Street, Tampa',
      permitNumber: `QA-${randomUUID()}`,
      permitType: 'Building',
      status: 'Submitted',
      notes: '',
      portalUrl: sourceUrl,
    },
  });
  const unpaidCheck = await prisma.permitPortalStatusCheck.create({
    data: {
      permitId: unpaidPermit.id,
      teamId: unpaidTeam.id,
      permitNumber: unpaidPermit.permitNumber,
      sourceUrl,
      result: 'unavailable',
      message: interruptionReason,
      checkedAt: priorCheckAt,
      requestSequence: 1,
      redlineResult: 'not_connected',
    },
  });
  const unpaidHistory = await page.request.get(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(unpaidPermit.id)}&teamId=${encodeURIComponent(unpaidTeam.id)}`,
    { headers: { origin } },
  );
  expect(unpaidHistory.status()).toBe(402);
  const unpaidRetry = await page.request.post(
    `${origin}/api/permit-portal-checks?permitId=${encodeURIComponent(unpaidPermit.id)}`,
    { headers: { origin }, data: { teamId: unpaidTeam.id } },
  );
  expect(unpaidRetry.status()).toBe(402);
  expect(
    await prisma.permitPortalStatusCheck.count({ where: { permitId: unpaidPermit.id } }),
  ).toBe(1);
  expect(await prisma.permitPortalStatusCheck.findUnique({ where: { id: unpaidCheck.id } })).not.toBeNull();
});
