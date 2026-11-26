// @polsia:user-owned — real authenticated team import journeys and access checks.
import { createHash, randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { CsvMapping } from '@/modules/csv-import/contracts';
import { tampaRecordUrl } from './permit-test-helpers';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];
const subscriptionStatePaths: string[] = [];
const targetId = 'tampa-city-permits';
const importPermitNumber = `SAMPLE-${randomUUID()}`;
const importPortalUrl = tampaRecordUrl(importPermitNumber);
const headers = [
  'project_name',
  'job_address',
  'permit_number',
  'permit_type',
  'status',
  'notes',
  'portal_url',
];
const mapping: CsvMapping = {
  project_name: 0,
  job_address: 1,
  permit_number: 2,
  permit_type: 3,
  status: 4,
  notes: 5,
  portal_url: 6,
};
const validCsv =
  `${headers.join(',')}\n` +
  `Kitchen remodel,"101 Sample Street, Tampa, FL 33602",${importPermitNumber},Building,Planning,Sample only,${importPortalUrl}\n`;
const invalidCsv =
  `${headers.join(',')}\n` +
  `Kitchen remodel,"101 Sample Street, Tampa, FL 33602",${importPermitNumber},Building,Planning,Sample only,${importPortalUrl}\n` +
  `Bathroom addition,"102 Sample Street, Tampa, FL 33602",${importPermitNumber}-2,Solar,Planning,Sample only,${tampaRecordUrl(`${importPermitNumber}-2`)}\n` +
  `Garage conversion,"103 Sample Street, Tampa, FL 33602",${importPermitNumber}-3,Building,Planning,Sample only,\n` +
  `Garage conversion,"103 Sample Street, Tampa, FL 33602",${importPermitNumber}-4,Building,Planning,Sample only,https://example.invalid/about\n` +
  `Basement remodel,"104 Sample Street, Tampa, FL 33602",${importPermitNumber}-5,Building,Planning,Sample only,https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building\n`;

interface SessionResponse {
  user?: { id?: string; email?: string; role?: string };
}

interface TeamResponse {
  id: string;
  name?: string;
}

async function signUp(page: Page, origin: string, prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'QA Permit Importer', email, password },
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
  return { userId, email };
}

async function createTeam(page: Page, origin: string, name: string) {
  const response = await page.request.post(`${origin}/api/teams`, {
    headers: { origin },
    data: { action: 'create', name },
  });
  expect(response.status(), await response.text()).toBe(201);
  const team = (await response.json()) as TeamResponse;
  expect(team.id).toBeTruthy();
  if (!team.id) throw new Error('Team creation did not return a team id.');
  fixtureTeamIds.push(team.id);
  return team;
}

async function createVerifiedCheckout(teamId: string, userId: string) {
  await prisma.teamCheckout.create({
    data: {
      teamId,
      userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
}

async function setSubscriptionState(email: string, active: boolean) {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const path = `/tmp/polsia-subscription-state-${digest}.json`;
  subscriptionStatePaths.push(path);
  await writeFile(path, JSON.stringify({ active, unavailable: false }), 'utf8');
}

function importEndpoint(origin: string, teamId: string) {
  return `${origin}/api/csv-import?teamId=${encodeURIComponent(teamId)}`;
}

async function postImport(
  page: Page,
  origin: string,
  teamId: string,
  action: 'preview' | 'commit',
  csv = validCsv,
  extra: Record<string, unknown> = {},
) {
  return page.request.post(importEndpoint(origin, teamId), {
    headers: { origin },
    data: { action, targetId, csv, delimiter: ',', mapping, ...extra },
  });
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  await Promise.all(subscriptionStatePaths.map((path) => unlink(path).catch(() => undefined)));
  subscriptionStatePaths.length = 0;

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

test('an owner sees row-level errors and cannot commit an invalid CSV', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'qa-import-owner');
  const firstTeam = await createTeam(page, origin, 'QA Tampa Import Team');
  await createVerifiedCheckout(firstTeam.id, owner.userId);
  await setSubscriptionState(owner.email, true);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(firstTeam.id ?? '')}`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page.getByText('Import permits from CSV', { exact: true }).click();
  const file = page.getByLabel('CSV file');
  await expect(file).toBeVisible();

  await file.setInputFiles({
    name: 'sample-permits.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(invalidCsv, 'utf8'),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('4 rows need attention.')).toBeVisible();
  await expect(page.getByText(/Row 3 · Permit type: Use one of these permit types/)).toBeVisible();
  await expect(page.getByText(/Row 4 · Florida Accela Building record URL: Use a nonempty, direct Florida Accela Building record URL/)).toBeVisible();
  await expect(page.getByText(/Row 5 · Florida Accela Building record URL: Use a nonempty, direct Florida Accela Building record URL/)).toBeVisible();
  await expect(page.getByText(/Row 6 · Florida Accela Building record URL: Use a nonempty, direct Florida Accela Building record URL/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 row' })).toBeDisabled();

  const rejectedCommit = await postImport(page, origin, firstTeam.id ?? '', 'commit', invalidCsv);
  expect(rejectedCommit.status()).toBe(422);
  expect((await rejectedCommit.json()).error.code).toBe('INVALID_ROWS');
  expect(await prisma.permit.count({ where: { teamId: firstTeam.id } })).toBe(0);

  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('permit-import-invalid-320.png'), fullPage: true });
  await page.setViewportSize(
    testInfo.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await page.getByText(/Row 6 · Florida Accela Building record URL:/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permit-import-invalid-preview.png') });
  await page.getByRole('button', { name: 'Start over' }).click();
  const linklessHeaders = headers.slice(0, 6);
  const linklessCsv =
    `${linklessHeaders.join(',')}\n` +
    `No link column,"105 Sample Street, Tampa, FL 33602",${importPermitNumber}-6,Building,Planning,Sample only\n`;
  await file.setInputFiles({
    name: 'missing-record-link.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(linklessCsv, 'utf8'),
  });
  await expect(page.getByRole('button', { name: 'Check file' })).toBeEnabled();
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(
    page.getByText(/Row 2 · Florida Accela Building record URL: Use a nonempty, direct Florida Accela Building record URL/),
  ).toBeVisible();

  const mappingWithoutLink = { ...mapping };
  delete mappingWithoutLink.portal_url;
  const missingLinkPreview = await postImport(
    page,
    origin,
    firstTeam.id ?? '',
    'preview',
    linklessCsv,
    { mapping: mappingWithoutLink },
  );
  expect(missingLinkPreview.status()).toBe(200);
  const missingPreviewBody = (await missingLinkPreview.json()) as {
    data?: {
      invalid?: number;
      issues?: Array<{ record: number | null; field: string | null; message: string }>;
    };
  };
  expect(missingPreviewBody.data?.invalid).toBe(1);
  expect(missingPreviewBody.data?.issues).toContainEqual({
    record: 2,
    field: 'portal_url',
    message: expect.any(String),
  });
  const missingLinkCommit = await postImport(
    page,
    origin,
    firstTeam.id ?? '',
    'commit',
    linklessCsv,
    { mapping: mappingWithoutLink },
  );
  expect(missingLinkCommit.status()).toBe(422);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
});

test('an owner confirms create-only imports and uniqueness stays within the selected team', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'qa-import-owner');
  const firstTeam = await createTeam(page, origin, 'QA Tampa Import Team');
  await createVerifiedCheckout(firstTeam.id, owner.userId);
  await setSubscriptionState(owner.email, true);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(firstTeam.id)}`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page.getByText('Import permits from CSV', { exact: true }).click();
  const file = page.getByLabel('CSV file');
  await expect(file).toBeVisible();
  await file.setInputFiles({
    name: 'sample-permits.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(validCsv, 'utf8'),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('1 row will be created.')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText('1 created, 0 skipped.')).toBeVisible();

  const createdPermit = await prisma.permit.findFirst({
    where: { teamId: firstTeam.id, permitNumber: importPermitNumber },
  });
  expect(createdPermit).toMatchObject({
    teamId: firstTeam.id,
    userId: owner.userId,
    projectName: 'Kitchen remodel',
    address: '101 Sample Street, Tampa, FL 33602',
    permitType: 'Building',
    status: 'Planning',
    portalUrl: importPortalUrl,
  });
  await expect(page.getByText('Kitchen remodel', { exact: true })).toBeVisible();
  expect(await prisma.permitImportIdentity.count({ where: { teamId: firstTeam.id } })).toBe(1);
  const importedPermitCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'Kitchen remodel' }),
  });
  await importedPermitCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permit-import-saved-permit.png') });

  await page.getByRole('button', { name: 'Import another file' }).click();
  await file.setInputFiles({
    name: 'duplicate-sample-permit.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(validCsv.replace('Kitchen remodel', 'Changed duplicate'), 'utf8'),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('These records are already present.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 row' })).toHaveCount(0);
  expect(await prisma.permit.count({ where: { teamId: firstTeam.id } })).toBe(1);
  expect(
    (await prisma.permit.findFirst({ where: { teamId: firstTeam.id } }))?.projectName,
  ).toBe('Kitchen remodel');

  const secondTeam = await createTeam(page, origin, 'QA Second Tampa Team');
  await createVerifiedCheckout(secondTeam.id, owner.userId);
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(secondTeam.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page.getByText('Import permits from CSV', { exact: true }).click();
  const secondTeamFile = page.getByLabel('CSV file');
  await secondTeamFile.setInputFiles({
    name: 'same-sample-permit.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(validCsv, 'utf8'),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('1 row will be created.')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText('1 created, 0 skipped.')).toBeVisible();
  expect(await prisma.permit.count({ where: { permitNumber: importPermitNumber } })).toBe(2);
  expect(
    await prisma.permitImportIdentity.count({ where: { teamId: secondTeam.id } }),
  ).toBe(1);
  await expect(importedPermitCard.getByRole('heading', { name: 'Watcher health' })).toBeVisible();
  await expect(importedPermitCard.getByText('No successful checks yet', { exact: true })).toBeVisible();
  await expect(importedPermitCard.getByText('No saved outcomes yet', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('permit-import-complete-320.png'), fullPage: true });
  await page.setViewportSize(
    testInfo.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
});

test('an owner can choose unmatched CSV columns and save the selected permit values', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'qa-import-mapped-owner');
  const team = await createTeam(page, origin, 'QA Tampa Mapped Import Team');
  await createVerifiedCheckout(team.id, owner.userId);
  await setSubscriptionState(owner.email, true);

  const selected = {
    projectName: 'Selected kitchen remodel',
    address: '201 Selected Street, Tampa, FL 33602',
    permitNumber: `MAPPED-${randomUUID()}`,
    permitType: 'Building',
    status: 'Submitted',
    notes: 'Selected team note',
    portalUrl: tampaRecordUrl(`MAPPED-${randomUUID()}`),
  };
  const sourceHeaders = [
    'ignored_project_title',
    'chosen_project_title',
    'ignored_job_site',
    'chosen_job_site',
    'ignored_record_number',
    'chosen_record_number',
    'ignored_permit_category',
    'chosen_permit_category',
    'ignored_review_stage',
    'chosen_review_stage',
    'ignored_team_note',
    'chosen_team_note',
    'chosen_tampa_record_link',
  ];
  const mappedCsv =
    `${sourceHeaders.join(',')}\n` +
    [
      'Discarded project title',
      selected.projectName,
      '999 Unselected Avenue, Tampa, FL',
      selected.address,
      'UNSELECTED-PERMIT',
      selected.permitNumber,
      'Electrical',
      selected.permitType,
      'Issued',
      selected.status,
      'Discarded note',
      selected.notes,
      selected.portalUrl,
    ]
      .map((value) => `"${value.replaceAll('"', '""')}"`)
      .join(',') + '\n';

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await page.getByText('Import permits from CSV', { exact: true }).click();
  const file = page.getByLabel('CSV file');
  await file.setInputFiles({
    name: 'custom-source-columns.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(mappedCsv, 'utf8'),
  });

  await page.getByLabel('Project name column (required)').selectOption({
    label: 'chosen_project_title',
  });
  await page.getByLabel('Job address column (required)').selectOption({ label: 'chosen_job_site' });
  await page.getByLabel('Permit number column').selectOption({ label: 'chosen_record_number' });
  await page.getByLabel('Permit type column (required)').selectOption({
    label: 'chosen_permit_category',
  });
  await page.getByLabel('Status column (required)').selectOption({ label: 'chosen_review_stage' });
  await page.getByLabel('Notes column').selectOption({ label: 'chosen_team_note' });
  await page.getByLabel('Florida Accela Building record URL column (required)').selectOption({
    label: 'chosen_tampa_record_link',
  });

  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('1 row will be created.')).toBeVisible();
  const previewContent =
    testInfo.project.name === 'mobile'
      ? page.getByRole('region', { name: 'CSV row preview' })
      : page.getByRole('row').filter({ hasText: selected.projectName });
  for (const value of [
    selected.projectName,
    selected.address,
    selected.permitNumber,
    selected.permitType,
    selected.status,
    selected.notes,
  ]) {
    await expect(previewContent.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(previewContent.getByText('Discarded project title', { exact: true })).toHaveCount(0);
  await expect(previewContent.getByText('UNSELECTED-PERMIT', { exact: true })).toHaveCount(0);
  await previewContent.getByText(selected.projectName, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permit-import-mapped-preview.png') });

  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText('1 created, 0 skipped.')).toBeVisible();
  const savedPermit = await prisma.permit.findFirst({
    where: { teamId: team.id, permitNumber: selected.permitNumber },
  });
  expect(savedPermit).toMatchObject({
    teamId: team.id,
    userId: owner.userId,
    projectName: selected.projectName,
    address: selected.address,
    permitNumber: selected.permitNumber,
    permitType: selected.permitType,
    status: selected.status,
    notes: selected.notes,
    portalUrl: selected.portalUrl,
  });
  await expect(page.getByRole('heading', { name: selected.projectName })).toBeVisible();
});

test('only paid team owners can preview or commit imports for the selected team', async ({
  browser,
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin, 'qa-import-active');
  const paidTeam = await createTeam(page, origin, 'QA Import Access Team');
  await createVerifiedCheckout(paidTeam.id ?? '', owner.userId);
  await setSubscriptionState(owner.email, true);

  const foreignContext = await browser.newContext();
  fixtureContexts.push(foreignContext);
  const foreignPage = await foreignContext.newPage();
  await signUp(foreignPage, origin, 'qa-import-foreign');
  const foreignTeam = await createTeam(foreignPage, origin, 'QA Foreign Import Team');

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const manager = await signUp(managerPage, origin, 'qa-import-manager');
  await prisma.teamMembership.create({
    data: { teamId: paidTeam.id ?? '', userId: manager.userId, role: 'project_manager' },
  });

  const purchaserContext = await browser.newContext();
  fixtureContexts.push(purchaserContext);
  const purchaserPage = await purchaserContext.newPage();
  const purchaser = await signUp(purchaserPage, origin, 'qa-import-purchaser');
  await prisma.teamMembership.create({
    data: { teamId: paidTeam.id ?? '', userId: purchaser.userId, role: 'purchaser' },
  });

  const unpaidContext = await browser.newContext();
  fixtureContexts.push(unpaidContext);
  const unpaidPage = await unpaidContext.newPage();
  const unpaid = await signUp(unpaidPage, origin, 'qa-import-unpaid');
  const unpaidTeam = await createTeam(unpaidPage, origin, 'QA Unpaid Import Team');

  const inactiveContext = await browser.newContext();
  fixtureContexts.push(inactiveContext);
  const inactivePage = await inactiveContext.newPage();
  const inactive = await signUp(inactivePage, origin, 'qa-import-inactive');
  const inactiveTeam = await createTeam(inactivePage, origin, 'QA Inactive Import Team');
  await createVerifiedCheckout(inactiveTeam.id, inactive.userId);
  await setSubscriptionState(inactive.email, false);

  const pendingContext = await browser.newContext();
  fixtureContexts.push(pendingContext);
  const pendingPage = await pendingContext.newPage();
  const pending = await signUp(pendingPage, origin, 'qa-import-pending');
  const pendingTeam = await createTeam(pendingPage, origin, 'QA Pending Import Team');
  await prisma.teamCheckout.create({
    data: { teamId: pendingTeam.id, userId: pending.userId, status: 'pending' },
  });

  const unverifiedContext = await browser.newContext();
  fixtureContexts.push(unverifiedContext);
  const unverifiedPage = await unverifiedContext.newPage();
  const unverified = await signUp(unverifiedPage, origin, 'qa-import-unverified');
  const unverifiedTeam = await createTeam(unverifiedPage, origin, 'QA Unverified Import Team');
  await prisma.teamCheckout.create({
    data: {
      teamId: unverifiedTeam.id,
      userId: unverified.userId,
      status: 'unverified',
      grossAmountUsd: 299,
    },
  });

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();

  const anonymousDescription = await anonymousPage.request.get(
    `${origin}/api/csv-import?target=${targetId}&teamId=${encodeURIComponent(paidTeam.id ?? '')}`,
  );
  expect(anonymousDescription.status()).toBe(401);

  const managerPageUrl = `${origin}/dashboard?teamId=${encodeURIComponent(paidTeam.id ?? '')}`;
  await managerPage.goto(managerPageUrl);
  await expect(managerPage.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await expect(managerPage.getByText('Import permits from CSV', { exact: true })).toHaveCount(0);
  const managerDescription = await managerPage.request.get(
    `${origin}/api/csv-import?target=${targetId}&teamId=${encodeURIComponent(paidTeam.id ?? '')}`,
  );
  expect(managerDescription.status()).toBe(403);
  for (const action of ['preview', 'commit'] as const) {
    const denied = await postImport(managerPage, origin, paidTeam.id ?? '', action);
    expect(denied.status()).toBe(403);
    const purchaserDenied = await postImport(purchaserPage, origin, paidTeam.id ?? '', action);
    expect(purchaserDenied.status()).toBe(403);
  }

  for (const action of ['preview', 'commit'] as const) {
    const unpaidRequest = await postImport(unpaidPage, origin, unpaidTeam.id ?? '', action);
    expect(unpaidRequest.status()).toBe(403);
    const inactiveRequest = await postImport(inactivePage, origin, inactiveTeam.id, action);
    expect(inactiveRequest.status()).toBe(403);
    const pendingRequest = await postImport(pendingPage, origin, pendingTeam.id, action);
    expect(pendingRequest.status()).toBe(403);
    const unverifiedRequest = await postImport(unverifiedPage, origin, unverifiedTeam.id, action);
    expect(unverifiedRequest.status()).toBe(403);
    const nonmemberRequest = await postImport(page, origin, foreignTeam.id ?? '', action);
    expect(nonmemberRequest.status()).toBe(403);
  }

  const substitutedBodyTeam = await postImport(page, origin, paidTeam.id ?? '', 'preview', validCsv, {
    teamId: foreignTeam.id,
  });
  expect(substitutedBodyTeam.status()).toBe(400);
  expect(
    await prisma.permit.count({ where: { teamId: { in: [paidTeam.id ?? '', foreignTeam.id ?? ''] } } }),
  ).toBe(0);
  expect(
    await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: unpaidTeam.id ?? '', userId: unpaid.userId } },
    }),
  ).toMatchObject({ role: 'owner' });
});
