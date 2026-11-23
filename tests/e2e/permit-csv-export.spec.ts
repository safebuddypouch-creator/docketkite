// @polsia:user-owned — authenticated permit CSV export journey and scope regression.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { decodeCell } from '@/modules/csv-export/serialization';
import { RESERVED_COLUMNS } from '@/modules/csv-export/contracts';
import { tampaRecordUrl } from './permit-test-helpers';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

async function setSubscriptionState(email: string, active: boolean) {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  await writeFile(
    `/tmp/polsia-subscription-state-${digest}.json`,
    JSON.stringify({ active, unavailable: false }),
    'utf8',
  );
}

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

  const capturedVerification = async () => {
    const contents = await readFile('/tmp/polsia-csv-export-emails.ndjson', 'utf8').catch(
      (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
        throw error;
      },
    );
    const matches = contents
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { to: string; body: string; subject: string })
      .filter((message) => message.to === email && message.subject === 'Verify your email');
    return matches[matches.length - 1] ?? null;
  };
  await expect.poll(async () => Boolean(await capturedVerification())).toBe(true);
  const verificationEmail = await capturedVerification();
  if (!verificationEmail) throw new Error('Sign-up verification email was not captured.');
  const verificationUrl = verificationEmail.body.match(
    /https?:\/\/\S+\/api\/auth\/verify-email\?[^\s]+/,
  )?.[0];
  expect(verificationUrl).toBeTruthy();
  if (!verificationUrl) throw new Error('The captured email did not include its verification link.');
  const verification = await page.request.get(verificationUrl, { headers: { origin } });
  expect(verification.status(), await verification.text()).toBe(200);

  const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signin.status(), await signin.text()).toBe(200);
  fixtureUserIds.push(userId);
  return userId;
}

function parseCsv(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => {
      const cells: string[] = [];
      let index = 0;
      while (index < line.length) {
        if (line[index] !== '"') throw new Error('CSV cell did not start with a quote.');
        index += 1;
        let cell = '';
        let closed = false;
        while (index < line.length) {
          const character = line[index];
          if (character === '"') {
            if (line[index + 1] === '"') {
              cell += '"';
              index += 2;
              continue;
            }
            index += 1;
            closed = true;
            break;
          }
          cell += character;
          index += 1;
        }
        if (!closed) throw new Error('CSV cell did not end with a quote.');
        cells.push(cell);
        if (line[index] === ',') index += 1;
      }
      return cells;
    });
}

async function exportCsv(page: Page, testInfo: TestInfo, name: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('permits.csv');
  const path = await download.path();
  expect(path).toBeTruthy();
  if (!path) throw new Error('The browser did not save the CSV download.');
  const rows = parseCsv(await readFile(path, 'utf8'));
  const headers = rows[0];
  if (!headers) throw new Error('The CSV did not include a header row.');
  const fields = new Map(headers.map((header, index) => [header, index]));
  const exported = rows.slice(1).map((row) => {
    const field = (key: string) => {
      const index = fields.get(key);
      if (index === undefined) throw new Error(`Missing CSV column: ${key}`);
      const value = row[index];
      if (value === undefined) throw new Error(`Missing CSV value: ${key}`);
      return decodeCell(value);
    };
    return {
      format: field(RESERVED_COLUMNS[0]),
      scope: field(RESERVED_COLUMNS[3]),
      permitId: field('permit_id'),
      projectName: field('project_name'),
      address: field('address'),
      permitNumber: field('permit_number'),
      permitType: field('permit_type'),
      status: field('status'),
      projectManager: field('project_manager'),
      portalUrl: field('portal_url'),
    };
  });
  await expect(page.getByText(`${exported.length} records exported.`, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  return exported;
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

test('private permit exports follow team, view, and project-manager assignment filters', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const ownerEmail = `qa-permit-export-${randomUUID()}@example.test`;
  const ownerId = await signIn(page, origin, ownerEmail, 'CSV Export Owner');
  await setSubscriptionState(ownerEmail, true);
  const activePermitNumber = 'DK-TAMPA-CSV-101';
  const activePortalUrl = tampaRecordUrl(activePermitNumber);
  const team = await prisma.teamSpace.create({
    data: {
      name: 'QA Permit CSV Export Team',
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

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const managerId = await signIn(
    managerPage,
    origin,
    `qa-permit-export-manager-${randomUUID()}@example.test`,
    'CSV Export Project Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: managerId, role: 'project_manager' },
  });

  const otherTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Separate CSV Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: ownerId,
    },
  });
  fixtureTeamIds.push(otherTeam.id);

  const activeAssigned = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: team.id,
      assignedProjectManagerUserId: managerId,
      projectName: 'QA Active Assigned Project',
      address: '101 Test Street Tampa',
      permitNumber: activePermitNumber,
      permitType: 'Building',
      status: 'Under review',
      notes: 'Not part of the export contract.',
      portalUrl: activePortalUrl,
      portalMonitoringInterruptedAt: new Date(),
    },
  });
  const activeUnassigned = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: team.id,
      projectName: 'QA Active Unassigned Project',
      address: '102 Test Street Tampa',
      permitNumber: 'DK-TAMPA-CSV-102',
      permitType: 'Electrical',
      status: 'Planning',
      notes: '',
    },
  });
  const archivedAssigned = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: team.id,
      assignedProjectManagerUserId: managerId,
      projectName: 'QA Archived Assigned Project',
      address: '103 Test Street Tampa',
      permitNumber: 'DK-TAMPA-CSV-103',
      permitType: 'Plumbing',
      status: 'Issued',
      notes: '',
      archivedAt: new Date(),
    },
  });
  await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: otherTeam.id,
      projectName: 'QA Hidden Different Team Project',
      address: '999 Other Team Road',
      permitNumber: 'DK-TAMPA-CSV-HIDDEN',
      permitType: 'Other',
      status: 'Submitted',
      notes: '',
    },
  });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

  const descriptionResponse = await page.request.get(`${origin}/api/csv-export?source=permits`, {
    headers: { origin },
  });
  expect(descriptionResponse.status()).toBe(200);
  const description = (await descriptionResponse.json()) as {
    data: {
      format: string;
      limits: {
        records: number;
        bytes: number;
        columns: number;
        cellCharacters: number;
        requestBytes: number;
        readMilliseconds: number;
      };
      columns: { key: string }[];
    };
  };
  expect(description.data.format).toBe('polsia-csv-v2');
  expect(description.data.limits).toEqual({
    records: 10_000,
    bytes: 10_485_760,
    columns: 50,
    cellCharacters: 16_384,
    requestBytes: 65_536,
    readMilliseconds: 30_000,
  });
  expect(description.data.columns.map((column) => column.key).sort()).toEqual(
    [
      'permit_id',
      'project_name',
      'address',
      'permit_number',
      'permit_type',
      'status',
      'project_manager',
      'portal_url',
    ].sort(),
  );

  const active = await exportCsv(page, testInfo, 'permit-csv-active-desktop');
  expect(active).toHaveLength(2);
  expect(active.map((row) => row.projectName).sort()).toEqual(
    ['QA Active Assigned Project', 'QA Active Unassigned Project'].sort(),
  );
  const activeManagerRow = active.find((row) => row.projectName === 'QA Active Assigned Project');
  expect(activeManagerRow).toEqual({
    format: 'polsia-csv-v2',
    scope: team.id,
    permitId: activeAssigned.id,
    projectName: 'QA Active Assigned Project',
    address: '101 Test Street Tampa',
    permitNumber: activePermitNumber,
    permitType: 'Building',
    status: 'Under review',
    projectManager: 'CSV Export Project Manager',
    portalUrl: activePortalUrl,
  });
  const activeUnassignedRow = active.find((row) => row.projectName === 'QA Active Unassigned Project');
  expect(activeUnassignedRow?.projectManager).toBe('');
  expect(activeUnassignedRow?.portalUrl).toBe('');
  expect(JSON.stringify(active)).not.toContain('QA Hidden Different Team Project');

  await page.getByRole('link', { name: 'View 1 Under review permit' }).click();
  await expect(page.getByRole('heading', { name: 'QA Active Assigned Project' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Active Unassigned Project' })).toHaveCount(0);
  const statusFiltered = await exportCsv(page, testInfo, 'permit-csv-status-filter-desktop');
  expect(statusFiltered.map((row) => row.projectName)).toEqual(['QA Active Assigned Project']);

  await page.getByRole('link', { name: 'Clear status filter' }).click();
  const search = page.getByRole('searchbox', { name: 'Search permits' });
  await search.fill('102 Test Street Tampa');
  await expect(page.getByRole('heading', { name: 'QA Active Unassigned Project' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Active Assigned Project' })).toHaveCount(0);
  const addressSearch = await exportCsv(page, testInfo, 'permit-csv-address-search-desktop');
  expect(addressSearch.map((row) => row.projectName)).toEqual(['QA Active Unassigned Project']);

  await search.fill(activePermitNumber);
  await expect(page.getByRole('heading', { name: 'QA Active Assigned Project' })).toBeVisible();
  const permitReferenceSearch = await exportCsv(
    page,
    testInfo,
    'permit-csv-reference-search-desktop',
  );
  expect(permitReferenceSearch.map((row) => row.permitNumber)).toEqual([activePermitNumber]);

  await search.fill('no matching permit');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'There are no permits to export with these filters.',
  );
  await search.fill('');
  await page.getByRole('button', { name: 'Interrupted monitoring' }).click();
  await expect(page.getByRole('heading', { name: 'QA Active Assigned Project' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Active Unassigned Project' })).toHaveCount(0);
  const interrupted = await exportCsv(page, testInfo, 'permit-csv-interrupted-filter-desktop');
  expect(interrupted.map((row) => row.projectName)).toEqual(['QA Active Assigned Project']);

  const deniedField = await page.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: { teamId: team.id, view: 'active', assignedToMe: false },
      columns: ['notes'],
    },
  });
  expect(deniedField.status()).toBe(403);

  await page.getByRole('button', { name: 'Interrupted monitoring' }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  const archived = await exportCsv(page, testInfo, 'permit-csv-archived-desktop');
  expect(archived).toHaveLength(1);
  expect(archived[0]?.projectName).toBe('QA Archived Assigned Project');
  expect(archived[0]?.status).toBe('Issued');

  await managerPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(managerPage.getByRole('heading', { name: 'Your permits' })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Assigned to me' }).click();
  const assignedActive = await exportCsv(managerPage, testInfo, 'permit-csv-assigned-active-desktop');
  expect(assignedActive).toHaveLength(1);
  expect(assignedActive[0]?.projectName).toBe(activeAssigned.projectName);

  await managerPage.getByRole('button', { name: 'Archived', exact: true }).click();
  const assignedArchived = await exportCsv(
    managerPage,
    testInfo,
    'permit-csv-assigned-archived-desktop',
  );
  expect(assignedArchived).toHaveLength(1);
  expect(assignedArchived[0]?.projectName).toBe(archivedAssigned.projectName);

  const crossTeam = await managerPage.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: { teamId: otherTeam.id, view: 'active', assignedToMe: false },
    },
  });
  expect(crossTeam.status()).toBe(403);
  const crossTeamBody = await crossTeam.text();
  expect(crossTeamBody).not.toContain('QA Hidden Different Team Project');
  expect(crossTeamBody).not.toContain('"csv"');

  const unpaidTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Unpaid CSV Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: ownerId,
    },
  });
  fixtureTeamIds.push(unpaidTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: unpaidTeam.id, userId: ownerId, role: 'owner' },
  });
  const unpaidPermit = await prisma.permit.create({
    data: {
      userId: ownerId,
      teamId: unpaidTeam.id,
      projectName: 'QA Unpaid Permit Must Stay Private',
      address: '401 Locked Team Lane',
      permitNumber: 'QA-LOCKED-CSV-400',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });
  const unpaid = await page.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: { teamId: unpaidTeam.id, view: 'active', assignedToMe: false },
    },
  });
  expect(unpaid.status()).toBe(402);
  const unpaidBody = await unpaid.text();
  expect(unpaidBody).not.toContain(unpaidPermit.projectName);
  expect(unpaidBody).not.toContain(unpaidPermit.permitNumber);
  expect(unpaidBody).not.toContain('"csv"');

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymous = await anonymousContext.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: { teamId: team.id, view: 'active', assignedToMe: false },
    },
  });
  expect(anonymous.status()).toBe(401);
  const anonymousBody = await anonymous.text();
  expect(anonymousBody).not.toContain('QA Active Assigned Project');
  expect(anonymousBody).not.toContain('"csv"');

  for (const viewport of [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await managerPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await managerPage.getByRole('button', { name: 'Export CSV' }).scrollIntoViewIfNeeded();
    await managerPage.screenshot({
      path: testInfo.outputPath(`permit-csv-assigned-archived-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await managerPage.setViewportSize({ width: 390, height: 844 });

  expect(await prisma.permit.findUnique({ where: { id: activeUnassigned.id } })).toMatchObject({
    status: 'Planning',
  });
});
