// @polsia:user-owned — private letter upload and no-team checkout journeys.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureBrowserContexts: BrowserContext[] = [];

async function signUp(page: Page, origin: string) {
  const email = `qa-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const response = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'QA Permit Member', email, password },
  });
  expect(response.status(), await response.text()).toBe(200);

  const signupSession = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(signupSession.status()).toBe(200);
  const signupBody = (await signupSession.json()) as { user?: { id?: string; email?: string } };
  expect(signupBody.user?.id).toBeTruthy();
  expect(signupBody.user?.email).toBe(email);
  const userId = signupBody.user?.id;
  if (!userId) throw new Error('The sign-up route did not return a session user.');

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signInResponse = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signInResponse.status(), await signInResponse.text()).toBe(200);
  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as { user?: { id?: string; email?: string } };
  expect(session.user?.id).toBe(userId);
  expect(session.user?.email).toBe(email);

  fixtureUserIds.push(userId);
  return { userId, email };
}

async function captureViewports(page: Page, testInfo: TestInfo, filename: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath(`${filename}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath(`${filename}-mobile.png`), fullPage: true });
}

test.afterEach(async () => {
  await Promise.all(fixtureBrowserContexts.map((context) => context.close()));
  fixtureBrowserContexts.length = 0;
  if (fixtureUserIds.length === 0) return;
  const teams = await prisma.teamSpace.findMany({
    where: {
      OR: [
        { createdByUserId: { in: fixtureUserIds } },
        { id: { in: fixtureTeamIds } },
      ],
    },
    select: { id: true },
  });
  const teamIds = teams.map((team) => team.id);

  await prisma.permitLetter.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { uploadedByUserId: { in: fixtureUserIds } }] },
  });
  await prisma.permitUploadIntent.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: fixtureUserIds } }] },
  });
  await prisma.permit.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: fixtureUserIds } }] },
  });
  await prisma.teamCheckout.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.teamInvitation.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.teamMembership.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: fixtureUserIds } }] },
  });
  await prisma.teamSpace.deleteMany({ where: { id: { in: teamIds } } });
  await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
  fixtureUserIds.length = 0;
  fixtureTeamIds.length = 0;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a signed-in user without a team can create one and reach its checkout', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto(`${origin}/login`);
  const { userId } = await signUp(page, origin);
  await page.goto(`${origin}/dashboard`);

  const noWorkspaceTeamId = 'qa-team-before-membership';
  expect(await prisma.teamMembership.count({ where: { userId } })).toBe(0);
  expect(await prisma.teamSpace.count({ where: { createdByUserId: userId } })).toBe(0);
  const noWorkspacePermitRead = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(noWorkspaceTeamId)}`,
    { headers: { origin } },
  );
  expect(noWorkspacePermitRead.status()).toBe(403);
  const noWorkspacePermitWrite = await page.request.post(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      teamId: noWorkspaceTeamId,
      projectName: 'Blocked before checkout',
      address: '100 Test Street, Tampa',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });
  expect(noWorkspacePermitWrite.status()).toBe(403);
  expect(await prisma.permit.count({ where: { projectName: 'Blocked before checkout' } })).toBe(0);
  const noWorkspaceLetters = await page.request.get(
    `${origin}/api/permit-letters?teamId=${encodeURIComponent(noWorkspaceTeamId)}`,
    { headers: { origin } },
  );
  expect(noWorkspaceLetters.status()).toBe(403);

  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(page.getByLabel('Team name')).toBeVisible();
  await expect(page.getByLabel('Team invite code')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join team' })).toBeVisible();

  const noTeamUpload = await page.request.post(`${origin}/api/upload`, {
    headers: { origin },
    data: { filename: 'correction-letter.pdf', mime_type: 'application/pdf', size: 4 },
  });
  expect(noTeamUpload.status()).toBe(401);

  await page.getByLabel('Team name').fill('QA Remodel Team');
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByText('Workspace created.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  await expect(page.getByLabel('Add a correction letter')).toHaveCount(0);
  const team = await prisma.teamSpace.findFirst({
    where: { createdByUserId: userId, name: 'QA Remodel Team' },
  });
  expect(team).not.toBeNull();
  if (!team) throw new Error('The team creation flow did not persist its team.');
  fixtureTeamIds.push(team.id);
  await expect
    .poll(() => prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId: team.id, userId } } }))
    .toMatchObject({ teamId: team.id, userId, role: 'owner' });

  const unpaidTeamUpload = await page.request.post(`${origin}/api/upload`, {
    headers: { origin },
    data: { filename: 'correction-letter.pdf', mime_type: 'application/pdf', size: 4 },
  });
  expect(unpaidTeamUpload.status()).toBe(401);

  await page.route('https://checkout.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Hosted checkout test stand-in</title><main>Hosted checkout test stand-in</main>',
    }),
  );
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(`https://checkout.example.test/session/${team.id}`);
  await expect(page.getByText('Hosted checkout test stand-in')).toBeVisible();
  const checkout = await prisma.teamCheckout.findFirst({ where: { teamId: team.id } });
  expect(checkout?.status).toBe('pending');
  expect(checkout?.stripeSessionId).toBe(`cs_test_${checkout?.id}`);
  const checkoutRequest = JSON.parse(
    await readFile(`/tmp/polsia-team-checkout-${team.id}.json`, 'utf8'),
  ) as {
    amount?: number;
    recurring?: { interval?: string };
    client_reference_id?: string;
    metadata?: { teamId?: string; userId?: string; teamCheckoutId?: string };
  };
  expect(checkoutRequest).toMatchObject({
    amount: 299,
    recurring: { interval: 'month' },
    client_reference_id: team.id,
    metadata: { teamId: team.id, userId, teamCheckoutId: checkout?.id },
  });
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  await captureViewports(page, testInfo, 'no-team-checkout');
});

test('a signed-in user without a team can join by invite code and reach checkout', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const joinCode = randomBytes(6).toString('hex').toUpperCase();
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Joinable Team',
      joinCode,
      createdByUserId: 'qa-existing-owner',
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: 'qa-existing-owner', role: 'owner' },
  });

  await page.goto(`${origin}/login`);
  const { userId } = await signUp(page, origin);
  await page.goto(`${origin}/dashboard`);

  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(page.getByLabel('Team invite code')).toBeVisible();
  await page.getByLabel('Team invite code').fill(joinCode);
  await page.getByRole('button', { name: 'Join team' }).click();
  await expect(page.getByText('You joined the team with purchaser access.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();

  await page.route('https://checkout.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Hosted checkout test stand-in</title><main>Hosted checkout test stand-in</main>',
    }),
  );
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(`https://checkout.example.test/session/${team.id}`);
  await expect(page.getByText('Hosted checkout test stand-in')).toBeVisible();
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: team.id, userId } },
  });
  expect(membership?.role).toBe('purchaser');
  const checkout = await prisma.teamCheckout.findFirst({ where: { teamId: team.id } });
  expect(checkout?.status).toBe('pending');
  expect(checkout?.stripeSessionId).toBe(`cs_test_${checkout?.id}`);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  await captureViewports(page, testInfo, 'joined-team-checkout');
});

test('disabled hosted payments are shown and leave the team unpaid', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto(`${origin}/login`);
  const { userId } = await signUp(page, origin);
  const team = await prisma.teamSpace.create({
    data: {
      id: 'qa_checkout_provider_not_enabled',
      name: 'QA Checkout Error Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId, role: 'owner' },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(
    page.getByText(
      'Runtime payments are not enabled for this app yet. Ask the owner to finish Stripe onboarding on the Polsia dashboard Payments page, or contact Polsia support.',
    ),
  ).toBeVisible();
  const checkout = await prisma.teamCheckout.findFirst({ where: { teamId: team.id } });
  expect(checkout?.status).toBe('failed');
  expect(checkout?.stripeSessionId).toBeNull();
  await captureViewports(page, testInfo, 'checkout-provider-error');
});

test('a paid team member can attach and open letters while unpaid and nonmember access is denied', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto(`${origin}/login`);
  const { userId } = await signUp(page, origin);

  const createTeam = async (name: string) =>
    prisma.teamSpace.create({
      data: {
        name,
        joinCode: randomBytes(6).toString('hex').toUpperCase(),
        createdByUserId: userId,
      },
    });

  const paidTeam = await createTeam('QA Paid Team');
  await prisma.teamMembership.create({
    data: { teamId: paidTeam.id, userId, role: 'purchaser' },
  });
  await prisma.teamCheckout.create({
    data: { teamId: paidTeam.id, userId, status: 'verified', grossAmountUsd: 299, verifiedAt: new Date() },
  });
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: paidTeam.id,
      projectName: 'QA kitchen correction',
      address: '101 Test Street, Tampa',
      permitNumber: 'QA-TAMPA-1001',
      permitType: 'Building',
      status: 'Corrections requested',
      notes: '',
    },
  });

  const unpaidTeam = await createTeam('QA Unpaid Team');
  await prisma.teamMembership.create({ data: { teamId: unpaidTeam.id, userId, role: 'purchaser' } });
  const unpaidPermit = await prisma.permit.create({
    data: {
      userId,
      teamId: unpaidTeam.id,
      projectName: 'QA unpaid permit',
      address: '102 Test Street, Tampa',
      permitType: 'Building',
      status: 'Corrections requested',
      notes: '',
    },
  });
  const unpaidLetter = await prisma.permitLetter.create({
    data: {
      permitId: unpaidPermit.id,
      teamId: unpaidTeam.id,
      uploadedByUserId: userId,
      uploadId: 9801,
      fileKey: 'permit-letters/qa-unpaid/correction-letter.pdf',
      fileUrl: 'https://files.example.test/qa/unpaid-correction-letter.pdf',
      fileName: 'unpaid-correction-letter.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    },
  });
  const nonmemberTeam = await createTeam('QA Unjoined Team');

  const unscopedPaidUpload = await page.request.post(`${origin}/api/upload`, {
    headers: { origin },
    data: { filename: 'unscoped-letter.pdf', mime_type: 'application/pdf', size: 4 },
  });
  expect(unscopedPaidUpload.status()).toBe(401);

  const unpaidAuthorize = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: { action: 'authorize', teamId: unpaidTeam.id, permitId: unpaidPermit.id },
  });
  expect(unpaidAuthorize.status()).toBe(402);

  const forgedScope = Buffer.from(
    JSON.stringify({
      userId,
      teamId: unpaidTeam.id,
      permitId: unpaidPermit.id,
      expiresAt: Date.now() + 30 * 60 * 1000,
    }),
  ).toString('base64url');
  const scopedUnpaidUpload = await page.request.post(`${origin}/api/upload`, {
    headers: {
      origin,
      cookie: `docketkite_permit_upload_scope=${forgedScope}`,
    },
    data: { filename: 'unpaid-letter.pdf', mime_type: 'application/pdf', size: 4 },
  });
  expect(scopedUnpaidUpload.status()).toBe(401);

  const unpaidAttach = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: {
      action: 'attach',
      teamId: unpaidTeam.id,
      permitId: unpaidPermit.id,
      uploadId: 999_999,
    },
  });
  expect(unpaidAttach.status()).toBe(402);

  const nonmemberAuthorize = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: { action: 'authorize', teamId: nonmemberTeam.id, permitId: permit.id },
  });
  expect(nonmemberAuthorize.status()).toBe(403);

  const unpaidList = await page.request.get(
    `${origin}/api/permit-letters?teamId=${encodeURIComponent(unpaidTeam.id)}`,
    { headers: { origin } },
  );
  expect(unpaidList.status()).toBe(402);
  const unpaidSource = await page.request.get(
    `${origin}/api/permit-letters/${encodeURIComponent(unpaidLetter.id)}/source?teamId=${encodeURIComponent(unpaidTeam.id)}&permitId=${encodeURIComponent(unpaidPermit.id)}`,
    { headers: { origin } },
  );
  expect(unpaidSource.status()).toBe(402);
  const unpaidPermitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(unpaidTeam.id)}`,
    { headers: { origin } },
  );
  expect(unpaidPermitList.status()).toBe(402);
  const unpaidPermitUpdate = await page.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      action: 'update',
      id: unpaidPermit.id,
      teamId: unpaidTeam.id,
      data: {
        projectName: 'Attempted unpaid edit',
        address: '102 Test Street, Tampa',
        permitNumber: '',
        permitType: 'Building',
        status: 'Issued',
        notes: '',
      },
    },
  });
  expect(unpaidPermitUpdate.status()).toBe(402);
  expect((await prisma.permit.findUnique({ where: { id: unpaidPermit.id } }))?.projectName).toBe(
    'QA unpaid permit',
  );
  const unpaidReview = await page.request.get(
    `${origin}/api/permit-letters/${encodeURIComponent(unpaidLetter.id)}/review?permitId=${encodeURIComponent(unpaidPermit.id)}`,
    { headers: { origin } },
  );
  expect(unpaidReview.status()).toBe(402);
  const unpaidReviewUpdate = await page.request.patch(
    `${origin}/api/permit-letters/${encodeURIComponent(unpaidLetter.id)}/review?permitId=${encodeURIComponent(unpaidPermit.id)}`,
    {
      headers: { origin },
      data: { action: 'confirm', items: [] },
    },
  );
  expect(unpaidReviewUpdate.status()).toBe(402);
  const unpaidExtraction = await page.request.post(
    `${origin}/api/permit-letters/${encodeURIComponent(unpaidLetter.id)}/extract`,
    {
      headers: { origin },
      data: { teamId: unpaidTeam.id, permitId: unpaidPermit.id },
    },
  );
  expect(unpaidExtraction.status()).toBe(402);
  expect(
    await prisma.permitCorrectionDraft.count({ where: { permitLetterId: unpaidLetter.id } }),
  ).toBe(0);
  expect((await prisma.permit.findUnique({ where: { id: unpaidPermit.id } }))?.status).toBe(
    'Corrections requested',
  );

  const paidAuthorize = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: {
      action: 'authorize',
      teamId: paidTeam.id,
      permitId: permit.id,
      file: { filename: 'forged.pdf', mime_type: 'application/pdf', size: 4 },
    },
  });
  expect(paidAuthorize.status()).toBe(200);
  const forgedUrlAttach = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: {
      action: 'attach',
      teamId: paidTeam.id,
      permitId: permit.id,
      file: {
        key: 'permit-letters/forged.pdf',
        url: 'https://files.example.test/forged.pdf',
        filename: 'forged.pdf',
        mime_type: 'application/pdf',
        size: 4,
      },
    },
  });
  expect(forgedUrlAttach.status()).toBe(400);
  const unregisteredUploadAttach = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: { action: 'attach', teamId: paidTeam.id, permitId: permit.id, uploadId: 999_999 },
  });
  expect(unregisteredUploadAttach.status()).toBe(422);
  expect(await prisma.permitLetter.count({ where: { permitId: permit.id } })).toBe(0);

  await page.route('https://storage.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 test stand-in' }),
  );
  await page.route('https://files.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 stored file stand-in' }),
  );
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(paidTeam.id)}`);
  await expect(page.getByRole('heading', { name: 'QA kitchen correction' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Correction letters' })).toBeVisible();

  await page.getByLabel('Add a correction letter').setInputFiles({
    name: 'correction-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF'),
  });
  await expect(page.getByText('correction-letter.pdf').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'correction-letter.pdf' })).toHaveAttribute(
    'target',
    '_blank',
  );

  await page.reload();
  await expect(page.getByText('correction-letter.pdf').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'correction-letter.pdf' })).toBeVisible();
  await expect(page.getByLabel('Add a correction letter')).toBeVisible();
  const savedLetter = await prisma.permitLetter.findFirst({ where: { permitId: permit.id } });
  expect(savedLetter).toMatchObject({
    fileName: 'correction-letter.pdf',
    mimeType: 'application/pdf',
    size: 4,
  });
  expect(savedLetter?.fileUrl).toMatch(
    /^https:\/\/storage\.test\/permit-letters\/qa-upload-\d+\/correction-letter\.pdf$/,
  );
  expect(savedLetter?.fileKey).toMatch(/^permit-letters\/qa-upload-\d+\/correction-letter\.pdf$/);
  const registeredSequence = Number(savedLetter?.fileKey?.split('/')[1]?.slice('qa-upload-'.length));
  expect(savedLetter?.uploadId).toBe(7000 + registeredSequence);
  const letterListResponse = await page.request.get(
    `${origin}/api/permit-letters?teamId=${encodeURIComponent(paidTeam.id)}`,
    { headers: { origin } },
  );
  expect(letterListResponse.status()).toBe(200);
  const letterList = (await letterListResponse.json()) as {
    items: Array<Record<string, unknown>>;
  };
  expect(letterList.items[0]).not.toHaveProperty('fileUrl');
  expect(letterList.items[0]).not.toHaveProperty('fileKey');

  const sourceHref = await page
    .getByRole('link', { name: 'correction-letter.pdf' })
    .getAttribute('href');
  expect(sourceHref).toContain(
    `/api/permit-letters/${encodeURIComponent(savedLetter?.id ?? '')}/source?`,
  );
  const sourceResponse = await page.request.get(new URL(sourceHref ?? '', origin).toString());
  expect(sourceResponse.status()).toBe(200);
  expect(sourceResponse.headers()['content-type']).toContain('application/pdf');
  expect(sourceResponse.headers()['content-disposition']).toContain('inline;');
  expect(sourceResponse.headers()['cache-control']).toContain('private');
  expect(await sourceResponse.text()).toBe('%PDF-1.4 test stand-in');

  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.status).toBe(
    'Corrections requested',
  );
  const uploadAfterAttach = await page.request.post(`${origin}/api/upload`, {
    headers: { origin },
    data: { filename: 'unscoped-after-attach.pdf', mime_type: 'application/pdf', size: 4 },
  });
  expect(uploadAfterAttach.status()).toBe(401);

  await page.getByLabel('Add a correction letter').setInputFiles({
    name: 'provider-failure.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF'),
  });
  await expect(page.getByText('The upload was rejected.')).toBeVisible();
  expect(await prisma.permitLetter.count({ where: { permitId: permit.id } })).toBe(1);
  await expect(page.getByText('The upload was rejected.')).toBeHidden({ timeout: 10_000 });
  await captureViewports(page, testInfo, 'paid-permit-letters');
});

test('paid team members can edit, remove, save, and confirm letter-linked correction items', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto(`${origin}/login`);
  const { userId } = await signUp(page, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Draft Review Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: { teamId: team.id, userId, status: 'verified', grossAmountUsd: 299, verifiedAt: new Date() },
  });
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA letter review permit',
      address: '105 Test Street, Tampa',
      permitNumber: 'QA-TAMPA-1005',
      permitType: 'Building',
      status: 'Corrections requested',
      notes: '',
    },
  });
  const letter = await prisma.permitLetter.create({
    data: {
      permitId: permit.id,
      teamId: team.id,
      uploadedByUserId: userId,
      uploadId: 9805,
      fileKey: 'permit-letters/qa-review/source-letter.pdf',
      fileUrl: 'https://files.example.test/qa/source-letter.pdf',
      fileName: 'source-letter.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    },
  });
  const draft = await prisma.permitCorrectionDraft.create({
    data: {
      permitLetterId: letter.id,
      createdByUserId: userId,
      items: [
        {
          id: 'qa-correction-1',
          action: 'Revise the north elevation notes.',
          location: 'North elevation',
          planReference: 'A2.1',
        },
        {
          id: 'qa-correction-2',
          action: 'Clarify the window schedule.',
          location: 'West elevation',
          planReference: 'A3.2',
        },
      ],
      fieldErrors: [],
    },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'QA letter review permit' })).toBeVisible();
  await page.getByRole('link', { name: 'Review draft' }).click();
  await expect(page.getByRole('heading', { name: 'Review correction items' })).toBeVisible();
  await expect(page.getByText('source-letter.pdf').first()).toBeVisible();
  await expect(page.getByText(/does not monitor permit portals or change the permit’s manually maintained status/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open source letter' })).toHaveAttribute(
    'href',
    new RegExp(`/api/permit-letters/${letter.id}/source\\?`),
  );

  const firstItem = page.getByRole('region', { name: 'Correction item 1' });
  await firstItem.getByLabel('Correction request').fill('Revise the north elevation notes and dimensions.');
  await firstItem.getByLabel('Location Optional').fill('North and west elevations');
  await page.getByRole('button', { name: 'Remove correction item 2' }).click();
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByText('Review changes saved.')).toBeVisible();

  const savedDraft = await prisma.permitCorrectionDraft.findUnique({ where: { id: draft.id } });
  expect(savedDraft?.permitLetterId).toBe(letter.id);
  expect(savedDraft?.status).toBe('draft');
  expect(savedDraft?.reviewedItems).toMatchObject([
    {
      id: 'qa-correction-1',
      action: 'Revise the north elevation notes and dimensions.',
      location: 'North and west elevations',
      planReference: 'A2.1',
    },
  ]);
  expect(savedDraft?.reviewedAt).toBeInstanceOf(Date);

  await page.reload();
  const reloadedFirstItem = page.getByRole('region', { name: 'Correction item 1' });
  await expect(reloadedFirstItem.getByLabel('Correction request')).toHaveValue(
    'Revise the north elevation notes and dimensions.',
  );
  await expect(page.getByRole('region', { name: 'Correction item 2' })).toHaveCount(0);
  await captureViewports(page, testInfo, 'letter-correction-review');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('letter-correction-review-320.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Confirm reviewed items' }).click();
  await expect(page.getByText('This review is confirmed.')).toBeVisible();
  await expect(page.getByText(/no checklist was created/i)).toBeVisible();
  const confirmedDraft = await prisma.permitCorrectionDraft.findUnique({ where: { id: draft.id } });
  expect(confirmedDraft?.status).toBe('confirmed');
  expect(confirmedDraft?.confirmedAt).toBeInstanceOf(Date);
  expect(confirmedDraft?.permitLetterId).toBe(letter.id);
  expect(confirmedDraft?.reviewedItems).toMatchObject([
    {
      id: 'qa-correction-1',
      action: 'Revise the north elevation notes and dimensions.',
      location: 'North and west elevations',
      planReference: 'A2.1',
    },
  ]);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.status).toBe(
    'Corrections requested',
  );
  await expect(page.getByText('Correction review confirmed.')).toBeHidden({ timeout: 10_000 });
  await captureViewports(page, testInfo, 'letter-correction-confirmed');
});

test('a parsing failure is shown without saving a correction draft or changing permit status', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto(`${origin}/login`);
  const { userId } = await signUp(page, origin);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Parse Failure Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  await prisma.teamMembership.create({ data: { teamId: team.id, userId, role: 'owner' } });
  await prisma.teamCheckout.create({
    data: { teamId: team.id, userId, status: 'verified', grossAmountUsd: 299, verifiedAt: new Date() },
  });
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA parsing retry permit',
      address: '103 Test Street, Tampa',
      permitType: 'Building',
      status: 'Corrections requested',
      notes: '',
    },
  });
  const letter = await prisma.permitLetter.create({
    data: {
      permitId: permit.id,
      teamId: team.id,
      uploadedByUserId: userId,
      uploadId: 9802,
      fileKey: 'permit-letters/qa-parse-failure/parse-failure.pdf',
      fileUrl: 'https://files.example.test/qa/parse-failure.pdf',
      fileName: 'parse-failure.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByText('parse-failure.pdf').first()).toBeVisible();
  await page.getByRole('button', { name: 'Extract correction items' }).click();
  await expect(
    page.getByRole('alert').getByText('Document parsing is temporarily unavailable. Try again later.'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('region', { name: 'Correction item draft from parse-failure.pdf' }),
  ).toHaveCount(0);
  expect(await prisma.permitCorrectionDraft.count({ where: { permitLetterId: letter.id } })).toBe(0);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.status).toBe(
    'Corrections requested',
  );
  await captureViewports(page, testInfo, 'permit-letter-parse-error');
});

test('a paid member cannot attach or extract another team’s letter', async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const otherContext = await browser.newContext();
  fixtureBrowserContexts.push(otherContext);
  const otherPage = await otherContext.newPage();

  await otherPage.goto(`${origin}/login`);
  const otherUser = await signUp(otherPage, origin);
  await page.goto(`${origin}/login`);
  const currentUser = await signUp(page, origin);

  const createPaidPermit = async (userId: string, name: string) => {
    const team = await prisma.teamSpace.create({
      data: {
        name,
        joinCode: randomBytes(6).toString('hex').toUpperCase(),
        createdByUserId: userId,
      },
    });
    fixtureTeamIds.push(team.id);
    await prisma.teamMembership.create({
      data: { teamId: team.id, userId, role: 'owner' },
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
    const permit = await prisma.permit.create({
      data: {
        userId,
        teamId: team.id,
        projectName: `${name} correction`,
        address: '104 Test Street, Tampa',
        permitType: 'Building',
        status: 'Corrections requested',
        notes: '',
      },
    });
    return { team, permit };
  };

  const other = await createPaidPermit(otherUser.userId, 'QA Other User Team');
  const current = await createPaidPermit(currentUser.userId, 'QA Current User Team');

  const authorize = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: {
      action: 'authorize',
      teamId: current.team.id,
      permitId: current.permit.id,
      file: { filename: 'other-user-letter.pdf', mime_type: 'application/pdf', size: 10 },
    },
  });
  expect(authorize.status()).toBe(200);

  await otherPage.route('https://storage.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 other user' }),
  );
  await otherPage.route('https://files.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 other stored file' }),
  );
  await otherPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(other.team.id)}`);
  await otherPage.getByLabel('Add a correction letter').setInputFiles({
    name: 'other-user-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF other'),
  });
  await expect(otherPage.getByText('other-user-letter.pdf').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(otherPage.getByRole('link', { name: 'other-user-letter.pdf' })).toBeVisible();
  const otherUserLetter = await prisma.permitLetter.findFirst({
    where: { permitId: other.permit.id, uploadedByUserId: otherUser.userId },
  });
  expect(otherUserLetter).not.toBeNull();
  if (!otherUserLetter) throw new Error('The other user upload was not registered.');

  const nonmemberExtraction = await page.request.post(
    `${origin}/api/permit-letters/${encodeURIComponent(otherUserLetter.id)}/extract`,
    {
      headers: { origin },
      data: { teamId: other.team.id, permitId: other.permit.id },
    },
  );
  expect(nonmemberExtraction.status()).toBe(403);
  expect(
    await prisma.permitCorrectionDraft.count({ where: { permitLetterId: otherUserLetter.id } }),
  ).toBe(0);
  const nonmemberSource = await page.request.get(
    `${origin}/api/permit-letters/${encodeURIComponent(otherUserLetter.id)}/source?teamId=${encodeURIComponent(other.team.id)}&permitId=${encodeURIComponent(other.permit.id)}`,
  );
  expect(nonmemberSource.status()).toBe(403);
  const nonmemberReview = await page.request.get(
    `${origin}/api/permit-letters/${encodeURIComponent(otherUserLetter.id)}/review?permitId=${encodeURIComponent(other.permit.id)}`,
    { headers: { origin } },
  );
  expect(nonmemberReview.status()).toBe(403);
  const nonmemberReviewUpdate = await page.request.patch(
    `${origin}/api/permit-letters/${encodeURIComponent(otherUserLetter.id)}/review?permitId=${encodeURIComponent(other.permit.id)}`,
    {
      headers: { origin },
      data: { action: 'confirm', items: [] },
    },
  );
  expect(nonmemberReviewUpdate.status()).toBe(403);

  const attachOtherUserFile = await page.request.post(`${origin}/api/permit-letters`, {
    headers: { origin },
    data: {
      action: 'attach',
      teamId: current.team.id,
      permitId: current.permit.id,
      uploadId: otherUserLetter.uploadId,
    },
  });
  expect(attachOtherUserFile.status()).toBe(422);
  expect(await prisma.permitLetter.count({ where: { permitId: current.permit.id } })).toBe(0);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(current.team.id)}`);
  await expect(page.getByRole('heading', { name: 'QA Current User Team correction' })).toBeVisible();
  await captureViewports(page, testInfo, 'cross-user-upload-rejected');
});
