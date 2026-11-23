// @polsia:user-owned — status-change emails for private team permit managers.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const EMAIL_CAPTURE_PATH = '/tmp/polsia-permit-status-email-capture.ndjson';
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  html: string;
}

async function signUp(
  page: Page,
  origin: string,
  options: { email?: string; name?: string } = {},
) {
  const email = options.email ?? `qa-permit-status-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: options.name ?? 'QA Permit Owner', email, password },
  });
  expect(signup.status(), await signup.text()).toBe(200);

  const initialSession = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(initialSession.status()).toBe(200);
  const initialBody = (await initialSession.json()) as { user?: { id?: string } };
  const userId = initialBody.user?.id;
  if (!userId) throw new Error('Sign-up did not return a session user.');
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });

  const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signin.status(), await signin.text()).toBe(200);
  fixtureUserIds.push(userId);
  return { userId, email, password };
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

async function createTeam(createdByUserId: string, name: string) {
  const team = await prisma.teamSpace.create({
    data: {
      name,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId,
    },
  });
  fixtureTeamIds.push(team.id);
  return team;
}

async function capturedEmails(projectName: string): Promise<CapturedEmail[]> {
  const contents = await readFile(EMAIL_CAPTURE_PATH, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  });
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail)
    .filter((email) => email.subject === `Permit status changed: ${projectName}`);
}

async function rejectedEmails(projectName: string): Promise<CapturedEmail[]> {
  const contents = await readFile('/tmp/polsia-permit-status-email-failures.ndjson', 'utf8').catch(
    (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    },
  );
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail)
    .filter((email) => email.subject === `Permit status changed: ${projectName}`);
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

test('permit status changes notify only project managers on the same paid private team', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto(`${origin}/login`);
  const owner = await signUp(page, origin);

  const team = await createTeam(owner.userId, 'QA Permit Notification Team');
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

  const sameTeamManagerEmail = `qa-manager-${randomUUID()}@example.test`;
  const sameTeamManagerContext = await browser.newContext();
  fixtureContexts.push(sameTeamManagerContext);
  const sameTeamManagerPage = await sameTeamManagerContext.newPage();
  const sameTeamManager = await signUp(sameTeamManagerPage, origin, {
    email: sameTeamManagerEmail,
    name: 'QA Project Manager',
  });
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: sameTeamManager.userId, role: 'project_manager' },
  });

  const sameTeamPurchaserEmail = `qa-purchaser-${randomUUID()}@example.test`;
  const sameTeamPurchaserId = await createFixtureUser(sameTeamPurchaserEmail, 'QA Purchaser');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: sameTeamPurchaserId, role: 'purchaser' },
  });

  const otherTeam = await createTeam(owner.userId, 'QA Other Private Team');
  const otherTeamManagerEmail = `qa-other-manager-${randomUUID()}@example.test`;
  const otherTeamManagerContext = await browser.newContext();
  fixtureContexts.push(otherTeamManagerContext);
  const otherTeamManagerPage = await otherTeamManagerContext.newPage();
  const otherTeamManager = await signUp(otherTeamManagerPage, origin, {
    email: otherTeamManagerEmail,
    name: 'Other Team Manager',
  });
  await prisma.teamMembership.create({
    data: {
      teamId: otherTeam.id,
      userId: otherTeamManager.userId,
      role: 'project_manager',
    },
  });
  const otherTeamPermit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: otherTeam.id,
      projectName: 'Nonmember guard sample',
      address: '102 Test Street, Tampa',
      permitType: 'Building',
      status: 'Planning',
    },
  });

  const unpaidTeam = await createTeam(owner.userId, 'QA Unpaid Private Team');
  await prisma.teamMembership.create({
    data: { teamId: unpaidTeam.id, userId: owner.userId, role: 'owner' },
  });
  const unpaidPermit = await prisma.permit.create({
    data: {
      userId: owner.userId,
      teamId: unpaidTeam.id,
      projectName: 'Unpaid guard sample',
      address: '103 Test Street, Tampa',
      permitType: 'Building',
      status: 'Planning',
    },
  });

  const projectName = `Permit status notice sample ${randomUUID()}`;
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page.getByRole('button', { name: 'Add permit' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Job address').fill('101 Test Street, Tampa');
  await page.locator('#permit-status').selectOption('Planning');
  await page.getByRole('button', { name: 'Add permit' }).click();

  const permitHeading = page.getByRole('heading', { name: projectName });
  await expect(permitHeading).toBeVisible();
  const permitCard = page.locator('article').filter({ has: permitHeading });
  const statusHistory = permitCard.getByRole('region', {
    name: `Status history for ${projectName}`,
  });
  await expect(statusHistory.getByRole('heading', { name: 'Status history' })).toBeVisible();
  await expect(statusHistory.getByText('No status changes have been recorded yet.')).toBeVisible();
  expect(await capturedEmails(projectName)).toEqual([]);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#permit-status').selectOption('Submitted');
  const falseAlarmReason = 'The public page briefly showed an outdated status.';
  await page.getByLabel('False-alarm reason').fill(falseAlarmReason);
  await page.locator('#permit-notes').fill('Status changed by the permit editor.');
  const statusChangeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/permits') &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await statusChangeResponse;
  await expect(statusHistory.getByText('Submitted', { exact: true })).toBeVisible();

  const savedPermit = await prisma.permit.findFirst({
    where: { teamId: team.id, projectName },
  });
  if (!savedPermit) throw new Error('The updated permit was not persisted.');
  expect(savedPermit.status).toBe('Submitted');
  const savedStatusEvents = await prisma.permitStatusEvent.findMany({
    where: { permitId: savedPermit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(savedStatusEvents).toHaveLength(1);
  const firstStatusEvent = savedStatusEvents[0];
  if (!firstStatusEvent) throw new Error('The status event was not persisted.');
  expect(firstStatusEvent).toMatchObject({ status: 'Submitted', falseAlarmReason });
  await expect(statusHistory.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(statusHistory.getByText(falseAlarmReason)).toBeVisible();
  await expect(statusHistory.locator('time')).toHaveAttribute(
    'datetime',
    firstStatusEvent.createdAt.toISOString(),
  );

  const failedEventFunction = `reject_status_event_${randomBytes(5).toString('hex')}`;
  const failedEventTrigger = `reject_status_event_insert_${randomBytes(5).toString('hex')}`;
  const eventTableSchemas = await prisma.$queryRaw<Array<{ tableSchema: string }>>`
    SELECT table_schema AS "tableSchema"
    FROM information_schema.tables
    WHERE table_name = 'PermitStatusEvent' AND table_type = 'BASE TABLE'
    LIMIT 1
  `;
  const eventTableSchema = eventTableSchemas[0]?.tableSchema;
  if (!eventTableSchema) throw new Error('The permit status event table was not found.');
  const schemaIdentifier = `"${eventTableSchema.replaceAll('"', '""')}"`;
  const eventTable = `${schemaIdentifier}."PermitStatusEvent"`;
  const eventFunction = `${schemaIdentifier}."${failedEventFunction}"`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${eventFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."permitId" = '${savedPermit.id}' THEN RAISE EXCEPTION 'intentional event insert failure'; END IF; RETURN NEW; END; $$`,
  );
  let eventTriggerCreated = false;
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${failedEventTrigger}" BEFORE INSERT ON ${eventTable} FOR EACH ROW EXECUTE FUNCTION ${eventFunction}()`,
    );
    eventTriggerCreated = true;
    const failedTransition = await page.request.patch(`${origin}/api/permits`, {
      headers: { origin },
      data: {
        action: 'update',
        id: savedPermit.id,
        teamId: team.id,
        falseAlarmReason: 'This attempted event should roll back.',
        data: {
          projectName,
          address: '101 Test Street, Tampa',
          permitNumber: '',
          permitType: 'Building',
          status: 'Issued',
          notes: 'Status changed by the permit editor.',
        },
      },
    });
    expect(failedTransition.status()).toBe(500);
  } finally {
    if (eventTriggerCreated) {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${failedEventTrigger}" ON ${eventTable}`,
      );
    }
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${eventFunction}()`);
  }
  expect((await prisma.permit.findUnique({ where: { id: savedPermit.id } }))?.status).toBe(
    'Submitted',
  );
  expect(await prisma.permitStatusEvent.count({ where: { permitId: savedPermit.id } })).toBe(1);

  const emailsAfterStatusChange = await capturedEmails(projectName);
  expect(emailsAfterStatusChange).toHaveLength(1);
  expect(emailsAfterStatusChange.map((email) => email.to)).toEqual([sameTeamManagerEmail]);
  expect(emailsAfterStatusChange[0]?.subject).toBe(`Permit status changed: ${projectName}`);
  expect(emailsAfterStatusChange[0]?.body).toContain('QA Permit Notification Team');
  expect(emailsAfterStatusChange[0]?.body).toContain('Planning to Submitted');
  expect(emailsAfterStatusChange[0]?.body).toContain('101 Test Street, Tampa');
  const permitUrl = `${origin}/dashboard/permits/${encodeURIComponent(savedPermit.id)}`;
  const permitApiUrl = `${origin}/api/permits/${encodeURIComponent(savedPermit.id)}`;
  expect(emailsAfterStatusChange[0]?.body).toContain(permitUrl);
  expect(emailsAfterStatusChange[0]?.html).toContain(`href="${permitUrl}"`);

  const forwardedLinkResponse = await otherTeamManagerPage.request.get(permitApiUrl);
  expect(forwardedLinkResponse.status()).toBe(403);
  expect(await forwardedLinkResponse.json()).toEqual({ error: 'team_membership_required' });
  await otherTeamManagerPage.goto(permitUrl);
  await expect(otherTeamManagerPage.getByRole('heading', { name: 'Permit unavailable' })).toBeVisible();
  await expect(otherTeamManagerPage.getByRole('heading', { name: projectName })).toBeHidden();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#permit-status').selectOption('Under review');
  await expect(page.getByLabel('False-alarm reason')).toBeVisible();
  const secondStatusChangeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/permits') &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await secondStatusChangeResponse;
  const chronologicalEvents = await prisma.permitStatusEvent.findMany({
    where: { permitId: savedPermit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(chronologicalEvents.map((event) => event.status)).toEqual(['Submitted', 'Under review']);
  expect(chronologicalEvents[1]?.falseAlarmReason).toBeNull();
  expect(chronologicalEvents[0]?.createdAt.getTime()).toBeLessThanOrEqual(
    chronologicalEvents[1]?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  const historyRows = await statusHistory.locator('ol > li').allTextContents();
  expect(historyRows).toHaveLength(2);
  expect(historyRows[0]).toContain('Submitted');
  expect(historyRows[1]).toContain('Under review');

  const teamPermitList = await page.request.get(
    `${origin}/api/permits?${new URLSearchParams({ view: 'active', teamId: team.id })}`,
  );
  expect(teamPermitList.status()).toBe(200);
  const teamPermitListBody = (await teamPermitList.json()) as {
    items: Array<{ id: string; statusEvents: Array<{ status: string }> }>;
  };
  expect(
    teamPermitListBody.items
      .find((item) => item.id === savedPermit.id)
      ?.statusEvents.map((event) => event.status),
  ).toEqual(['Submitted', 'Under review']);
  const allStatusChangeEmails = await capturedEmails(projectName);
  expect(allStatusChangeEmails).toHaveLength(2);
  expect(allStatusChangeEmails.map((email) => email.to)).toEqual([
    sameTeamManagerEmail,
    sameTeamManagerEmail,
  ]);
  expect(allStatusChangeEmails[1]?.body).toContain('Submitted to Under review');

  const failingManagerEmail = `qa-email-failure-${randomUUID()}@example.test`;
  const failingManagerId = await createFixtureUser(failingManagerEmail, 'QA Email Failure Manager');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: failingManagerId, role: 'project_manager' },
  });
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#permit-status').selectOption('Corrections requested');
  const thirdStatusChangeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/permits') &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await thirdStatusChangeResponse;
  const statusAfterEmailFailure = await prisma.permit.findUnique({
    where: { id: savedPermit.id },
    include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  expect(statusAfterEmailFailure?.status).toBe('Corrections requested');
  expect(statusAfterEmailFailure?.statusEvents.map((event) => event.status)).toEqual([
    'Submitted',
    'Under review',
    'Corrections requested',
  ]);
  const successfulEmailsAfterPartialFailure = await capturedEmails(projectName);
  expect(successfulEmailsAfterPartialFailure).toHaveLength(3);
  expect(successfulEmailsAfterPartialFailure.map((email) => email.to)).toEqual([
    sameTeamManagerEmail,
    sameTeamManagerEmail,
    sameTeamManagerEmail,
  ]);
  expect(successfulEmailsAfterPartialFailure[2]?.body).toContain(
    'Under review to Corrections requested',
  );
  for (const email of successfulEmailsAfterPartialFailure) {
    expect(email.subject).toBe(`Permit status changed: ${projectName}`);
    expect(email.body).toContain(permitUrl);
    expect(email.html).toContain(`href="${permitUrl}"`);
    expect(email.body).toContain('QA Permit Notification Team');
    expect(email.body).toContain('101 Test Street, Tampa');
  }
  const failedManagerEmails = await rejectedEmails(projectName);
  expect(failedManagerEmails).toHaveLength(1);
  expect(failedManagerEmails[0]?.to).toBe(failingManagerEmail);
  expect(failedManagerEmails[0]?.body).toContain('Under review to Corrections requested');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#permit-notes').fill('An unrelated note edit only.');
  const unchangedStatusResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/permits') &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await unchangedStatusResponse;
  expect(await prisma.permitStatusEvent.count({ where: { permitId: savedPermit.id } })).toBe(3);
  expect(await capturedEmails(projectName)).toHaveLength(3);
  expect(await rejectedEmails(projectName)).toHaveLength(1);

  const nonmemberUpdate = await page.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      action: 'update',
      id: otherTeamPermit.id,
      teamId: otherTeam.id,
      data: {
        projectName: 'Nonmember guard sample',
        address: '102 Test Street, Tampa',
        permitNumber: '',
        permitType: 'Building',
        status: 'Issued',
        notes: '',
      },
    },
  });
  expect(nonmemberUpdate.status()).toBe(403);
  expect((await prisma.permit.findUnique({ where: { id: otherTeamPermit.id } }))?.status).toBe(
    'Planning',
  );
  const nonmemberPermitList = await page.request.get(
    `${origin}/api/permits?${new URLSearchParams({ view: 'active', teamId: otherTeam.id })}`,
  );
  expect(nonmemberPermitList.status()).toBe(403);

  const unpaidUpdate = await page.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      action: 'update',
      id: unpaidPermit.id,
      teamId: unpaidTeam.id,
      data: {
        projectName: 'Unpaid guard sample',
        address: '103 Test Street, Tampa',
        permitNumber: '',
        permitType: 'Building',
        status: 'Issued',
        notes: '',
      },
    },
  });
  expect(unpaidUpdate.status()).toBe(402);
  expect((await prisma.permit.findUnique({ where: { id: unpaidPermit.id } }))?.status).toBe(
    'Planning',
  );
  const unpaidPermitDetails = await page.request.get(
    `${origin}/api/permits/${encodeURIComponent(unpaidPermit.id)}`,
  );
  expect(unpaidPermitDetails.status()).toBe(402);
  expect(await capturedEmails(projectName)).toHaveLength(3);
  expect(emailsAfterStatusChange[0]?.to).not.toBe(sameTeamPurchaserEmail);
  expect(emailsAfterStatusChange[0]?.to).not.toBe(otherTeamManagerEmail);

  const signOut = await sameTeamManagerPage.request.post(`${origin}/api/auth/sign-out`, {
    headers: { origin },
    data: {},
  });
  expect(signOut.status()).toBe(200);
  const anonymousPermitDetails = await sameTeamManagerPage.request.get(
    permitApiUrl,
    { headers: { origin } },
  );
  expect(anonymousPermitDetails.status()).toBe(401);
  await sameTeamManagerPage.goto(permitUrl);
  await expect(sameTeamManagerPage).toHaveURL(/\/login\?returnTo=/);
  await expect(sameTeamManagerPage.getByRole('heading', { name: projectName })).toBeHidden();
  await sameTeamManagerPage.getByLabel('Email address').fill(sameTeamManager.email);
  await sameTeamManagerPage.getByLabel('Password').fill(sameTeamManager.password);
  await sameTeamManagerPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(sameTeamManagerPage.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(
    sameTeamManagerPage.getByRole('list').getByText('Corrections requested', { exact: true }),
  ).toBeVisible();
  await expect(
    sameTeamManagerPage
      .getByRole('definition')
      .filter({ hasText: '101 Test Street, Tampa' }),
  ).toBeVisible();
  const managerPermitDetails = await sameTeamManagerPage.request.get(
    permitApiUrl,
  );
  expect(managerPermitDetails.status()).toBe(200);
  expect(await managerPermitDetails.json()).toMatchObject({
    id: savedPermit.id,
    projectName,
    address: '101 Test Street, Tampa',
    status: 'Corrections requested',
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await statusHistory.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`permit-status-history-${viewport.name}.png`),
      fullPage: true,
    });
    if (viewport.width <= 390) {
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    }
  }
  await page.goto(permitUrl);
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(
    page.getByRole('list').getByText('Corrections requested', { exact: true }),
  ).toBeVisible();
  for (const viewport of [
    { name: 'details-desktop', width: 1440, height: 900 },
    { name: 'details-mobile-390', width: 390, height: 844 },
    { name: 'details-mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({
      path: testInfo.outputPath(`permit-details-${viewport.name}.png`),
      fullPage: true,
    });
    if (viewport.width <= 390) {
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
});
