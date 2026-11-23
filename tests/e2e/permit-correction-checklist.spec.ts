// @polsia:user-owned — verifies the paid, source-linked checklist workflow against synthetic records.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { PDFArray, PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

const prisma = new PrismaClient();
const CHECKLIST_EMAIL_CAPTURE_PATH = '/tmp/polsia-correction-checklist-email-capture.ndjson';
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
  html: string;
}

interface SubscriptionStandIn {
  active: boolean;
  unavailable: boolean;
  status?: string;
  plan?: string;
  monthly_amount?: number;
}

async function setSubscriptionState(email: string, state: SubscriptionStandIn) {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  await writeFile(
    `/tmp/polsia-subscription-state-${digest}.json`,
    JSON.stringify(state),
    'utf8',
  );
}

async function signUp(
  page: Page,
  origin: string,
  prefix: 'qa-active' | 'qa-inactive' | 'qa-unavailable' | 'qa-mismatch' = 'qa-active',
) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'QA Checklist Member', email, password },
  });
  expect(signup.status(), await signup.text()).toBe(200);

  const initialSession = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const initialBody = (await initialSession.json()) as { user?: { id?: string } };
  const userId = initialBody.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not return a session user.');

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signin = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signin.status(), await signin.text()).toBe(200);
  fixtureUserIds.push(userId);
  await setSubscriptionState(
    email,
    prefix === 'qa-unavailable'
      ? { active: false, unavailable: true }
      : prefix === 'qa-inactive'
        ? { active: false, unavailable: false, status: 'canceled' }
        : prefix === 'qa-mismatch'
          ? { active: true, unavailable: false, plan: 'Different test subscription' }
          : { active: true, unavailable: false },
  );
  return { userId, email };
}

async function createTeam(userId: string, name: string) {
  const team = await prisma.teamSpace.create({
    data: {
      name,
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: userId,
    },
  });
  fixtureTeamIds.push(team.id);
  return team;
}

async function createLetterFixture({
  userId,
  teamId,
  status,
  draftStatus = 'confirmed',
  reviewedItems,
  permitNumber = 'QA-TAMPA-CHECKLIST',
}: {
  userId: string;
  teamId: string;
  status: 'pending' | 'canceled' | 'verified';
  draftStatus?: 'draft' | 'confirmed';
  reviewedItems?: unknown;
  permitNumber?: string;
}) {
  const permit = await prisma.permit.create({
    data: {
      userId,
      teamId,
      projectName: `QA checklist ${randomUUID().slice(0, 8)}`,
      address: '101 Test Street, Tampa',
      permitNumber,
      permitType: 'Building',
      status: 'Corrections requested',
      notes: '',
    },
  });
  const letter = await prisma.permitLetter.create({
    data: {
      permitId: permit.id,
      teamId,
      uploadedByUserId: userId,
      uploadId: (randomBytes(4).readUInt32BE(0) % 1_000_000) + 10_000,
      fileKey: `qa/${randomUUID()}/permit-letter.pdf`,
      fileUrl: 'https://files.example.test/qa/permit-letter.pdf',
      fileName: 'permit-review-letter.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    },
  });
  const extractionDraft = [
    {
      id: 'draft-only-item',
      action: 'Draft-only extraction request that must not be copied.',
      location: 'Unconfirmed room',
      planReference: 'D0.0',
    },
    {
      id: 'reviewed-item-1',
      action: 'Revise the north elevation notes.',
      location: 'North elevation',
      planReference: 'A2.1',
    },
  ];
  const confirmedReview = reviewedItems ?? [
    {
      id: 'reviewed-item-1',
      action: 'Revise the north elevation notes.',
      location: 'North elevation',
      planReference: 'A2.1',
    },
  ];
  await prisma.permitCorrectionDraft.create({
    data: {
      permitLetterId: letter.id,
      createdByUserId: userId,
      status: draftStatus,
      items: extractionDraft,
      reviewedItems: draftStatus === 'confirmed' ? confirmedReview : Prisma.DbNull,
      fieldErrors: [],
      reviewedAt: draftStatus === 'confirmed' ? new Date() : null,
      reviewedByUserId: draftStatus === 'confirmed' ? userId : null,
      confirmedAt: draftStatus === 'confirmed' ? new Date() : null,
    },
  });

  const checkout = await prisma.teamCheckout.create({
    data: {
      teamId,
      userId,
      status,
      grossAmountUsd: status === 'verified' ? 299 : null,
      verifiedAt: status === 'verified' ? new Date() : null,
      stripeSessionId: status === 'pending' ? `cs_unverified_${randomUUID()}` : null,
    },
  });
  return { permit, letter, checkout };
}

async function createSavedChecklistItem({
  userId,
  teamId,
  permitId,
  letterId,
}: {
  userId: string;
  teamId: string;
  permitId: string;
  letterId: string;
}) {
  const checklist = await prisma.permitCorrectionChecklist.create({
    data: {
      permitLetterId: letterId,
      permitId,
      teamId,
      createdByUserId: userId,
      items: {
        create: {
          sourceLetterId: letterId,
          sourceItemId: 'reviewed-item-1',
          action: 'Revise the north elevation notes.',
          location: 'North elevation',
          planReference: 'A2.1',
        },
      },
    },
    include: { items: true },
  });
  const item = checklist.items.at(0);
  if (!item) throw new Error('The saved checklist fixture needs an item.');
  return { checklist, item };
}

function checklistApi(letterId: string, permitId: string): string {
  const query = new URLSearchParams({ permitId });
  return `/api/permit-letters/${encodeURIComponent(letterId)}/checklist?${query.toString()}`;
}

function checklistPdfApi(letterId: string, permitId: string): string {
  const query = new URLSearchParams({ permitId });
  return `/api/permit-letters/${encodeURIComponent(letterId)}/checklist-pdf?${query.toString()}`;
}

function sourceLetterApi(letterId: string, permitId: string, teamId: string): string {
  const query = new URLSearchParams({ permitId, teamId });
  return `/api/permit-letters/${encodeURIComponent(letterId)}/source?${query.toString()}`;
}

async function sourceLinksInPdf(bytes: Buffer): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPages().at(-1);
  if (!page) throw new Error('The generated checklist PDF has no pages.');
  const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray);
  return annotations.asArray().flatMap((annotationRef) => {
    const annotation = pdf.context.lookup(annotationRef, PDFDict);
    const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
    const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString);
    return uri ? [uri.decodeText()] : [];
  });
}

async function checklistEmailsFor(reference: string): Promise<CapturedEmail[]> {
  const contents = await readFile(CHECKLIST_EMAIL_CAPTURE_PATH, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  });
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail)
    .filter((email) => email.subject.includes(reference));
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

async function toggleChecklistItem(page: Page, checkbox: Locator) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'PATCH',
  );
  await checkbox.click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
}

async function captureViewports(
  page: Page,
  testInfo: TestInfo,
  filenamePrefix = 'permit-checklist',
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath(`${filenamePrefix}-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath(`${filenamePrefix}-mobile.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath(`${filenamePrefix}-320.png`),
    fullPage: true,
  });
}

test.afterEach(async () => {
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
  if (fixtureTeamIds.length > 0) {
    await prisma.permitCorrectionChecklist.deleteMany({
      where: { teamId: { in: fixtureTeamIds } },
    });
    await prisma.permitLetter.deleteMany({ where: { teamId: { in: fixtureTeamIds } } });
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

test('checklist creation emails only its assigned same-team project manager', async (
  { page, browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const owner = await signUp(page, origin);
  const team = await createTeam(owner.userId, 'QA Checklist Notification Team');
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

  const managerContext = await browser.newContext();
  fixtureContexts.push(managerContext);
  const managerPage = await managerContext.newPage();
  const manager = await signUp(managerPage, origin);
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: manager.userId, role: 'project_manager' },
  });

  const otherSameTeamManagerId = await createFixtureUser(
    `qa-other-manager-${randomUUID()}@example.test`,
    'Unassigned Same-team Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: otherSameTeamManagerId, role: 'project_manager' },
  });
  const purchaserId = await createFixtureUser(
    `qa-purchaser-${randomUUID()}@example.test`,
    'Same-team Purchaser',
  );
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: purchaserId, role: 'purchaser' },
  });
  const otherTeam = await createTeam(owner.userId, 'QA Checklist Other Team');
  const otherTeamManagerId = await createFixtureUser(
    `qa-cross-team-manager-${randomUUID()}@example.test`,
    'Other-team Project Manager',
  );
  await prisma.teamMembership.create({
    data: { teamId: otherTeam.id, userId: otherTeamManagerId, role: 'project_manager' },
  });

  const permitNumber = `DK-${randomUUID().slice(0, 10).toUpperCase()}`;
  const projectName = `QA correction project ${randomUUID().slice(0, 8)}`;
  const fixture = await createLetterFixture({
    userId: owner.userId,
    teamId: team.id,
    status: 'verified',
    draftStatus: 'draft',
    permitNumber,
  });
  await prisma.permit.update({
    where: { id: fixture.permit.id },
    data: { assignedProjectManagerUserId: manager.userId, projectName },
  });

  const checklistPath = `/dashboard/permits/${fixture.permit.id}/letters/${fixture.letter.id}/checklist`;
  const unconfirmed = await page.request.post(checklistApi(fixture.letter.id, fixture.permit.id), {
    headers: { origin },
    data: { teamId: team.id, permitId: fixture.permit.id },
  });
  expect(unconfirmed.status()).toBe(409);
  expect(await checklistEmailsFor(permitNumber)).toHaveLength(0);

  await page.goto(
    `${origin}/dashboard/permits/${encodeURIComponent(fixture.permit.id)}/letters/${encodeURIComponent(fixture.letter.id)}/review`,
  );
  await expect(page.getByRole('button', { name: 'Save review' })).toBeVisible();
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByText('Review changes saved.')).toBeVisible();
  expect(await checklistEmailsFor(permitNumber)).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm reviewed items' }).click();
  await expect(page.getByText('Correction review confirmed.')).toBeVisible();
  expect(await checklistEmailsFor(permitNumber)).toHaveLength(0);

  await page.getByRole('button', { name: 'Create correction checklist' }).click();
  await expect(page).toHaveURL(new RegExp(`${checklistPath}$`));
  await expect(page.getByRole('heading', { name: 'Correction checklist' })).toBeVisible();

  const createdEmails = await checklistEmailsFor(permitNumber);
  expect(createdEmails).toHaveLength(1);
  expect(createdEmails[0]).toMatchObject({
    to: manager.email,
    subject: `Correction checklist created: ${permitNumber}`,
  });
  expect(createdEmails[0]?.body).toContain(`permit ${permitNumber}`);
  const checklistUrl = `${origin}${checklistPath}`;
  expect(createdEmails[0]?.body).toContain(checklistUrl);
  expect(createdEmails[0]?.html).toContain(`href="${checklistUrl}"`);

  await managerPage.goto(checklistUrl);
  await expect(managerPage.getByRole('heading', { name: 'Correction checklist' })).toBeVisible();

  const completion = page.getByRole('checkbox', {
    name: 'Completion status for Revise the north elevation notes.',
  });
  await toggleChecklistItem(page, completion);
  await expect(completion).toBeChecked();
  expect(await checklistEmailsFor(permitNumber)).toHaveLength(1);

  const duplicate = await page.request.post(checklistApi(fixture.letter.id, fixture.permit.id), {
    headers: { origin },
    data: { teamId: team.id, permitId: fixture.permit.id },
  });
  expect(duplicate.status()).toBe(200);
  expect(await checklistEmailsFor(permitNumber)).toHaveLength(1);

  const noNotificationCases = [
    { label: 'unassigned', managerId: null },
    { label: 'purchaser-assigned', managerId: purchaserId },
    { label: 'other-team-manager-assigned', managerId: otherTeamManagerId },
  ] as const;
  for (const candidate of noNotificationCases) {
    const noRecipientFixture = await createLetterFixture({
      userId: owner.userId,
      teamId: team.id,
      status: 'verified',
      permitNumber: '',
    });
    const noRecipientProject = `QA ${candidate.label} ${randomUUID().slice(0, 8)}`;
    await prisma.permit.update({
      where: { id: noRecipientFixture.permit.id },
      data: {
        projectName: noRecipientProject,
        assignedProjectManagerUserId: candidate.managerId,
      },
    });
    const response = await page.request.post(
      checklistApi(noRecipientFixture.letter.id, noRecipientFixture.permit.id),
      {
        headers: { origin },
        data: { teamId: team.id, permitId: noRecipientFixture.permit.id },
      },
    );
    expect(response.status(), candidate.label).toBe(201);
    expect(await checklistEmailsFor(noRecipientProject), candidate.label).toHaveLength(0);
  }

  const noPermitNumberName = `QA permit-name fallback ${randomUUID().slice(0, 8)}`;
  const noPermitNumberFixture = await createLetterFixture({
    userId: owner.userId,
    teamId: team.id,
    status: 'verified',
    permitNumber: '',
  });
  await prisma.permit.update({
    where: { id: noPermitNumberFixture.permit.id },
    data: {
      projectName: noPermitNumberName,
      assignedProjectManagerUserId: manager.userId,
    },
  });
  const fallbackResponse = await page.request.post(
    checklistApi(noPermitNumberFixture.letter.id, noPermitNumberFixture.permit.id),
    {
      headers: { origin },
      data: { teamId: team.id, permitId: noPermitNumberFixture.permit.id },
    },
  );
  expect(fallbackResponse.status()).toBe(201);
  const fallbackEmails = await checklistEmailsFor(noPermitNumberName);
  expect(fallbackEmails).toHaveLength(1);
  expect(fallbackEmails[0]?.to).toBe(manager.email);
  expect(fallbackEmails[0]?.body).toContain(noPermitNumberName);
  expect(fallbackEmails[0]?.html).toContain(
    `href="${origin}/dashboard/permits/${noPermitNumberFixture.permit.id}/letters/${noPermitNumberFixture.letter.id}/checklist"`,
  );

  const managerCreatedProject = `QA manager-created ${randomUUID().slice(0, 8)}`;
  const managerCreatedFixture = await createLetterFixture({
    userId: owner.userId,
    teamId: team.id,
    status: 'verified',
    permitNumber: `DK-${randomUUID().slice(0, 10).toUpperCase()}`,
  });
  await prisma.permit.update({
    where: { id: managerCreatedFixture.permit.id },
    data: {
      projectName: managerCreatedProject,
      assignedProjectManagerUserId: manager.userId,
    },
  });
  const managerCreated = await managerPage.request.post(
    checklistApi(managerCreatedFixture.letter.id, managerCreatedFixture.permit.id),
    {
      headers: { origin },
      data: { teamId: team.id, permitId: managerCreatedFixture.permit.id },
    },
  );
  expect(managerCreated.status()).toBe(201);
  expect(await checklistEmailsFor(managerCreatedProject)).toHaveLength(0);

  await page.goto(checklistUrl);
  await expect(page.getByRole('heading', { name: 'Correction checklist' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('correction-checklist-notification.png') });
});

test('the paid permit list shows saved checklist progress linked to its source letter', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const user = await signUp(page, origin);
  const team = await createTeam(user.userId, 'QA Checklist Progress Team');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: user.userId, role: 'owner' },
  });
  const fixture = await createLetterFixture({
    userId: user.userId,
    teamId: team.id,
    status: 'verified',
    draftStatus: 'draft',
  });
  const permitWithoutLetter = await prisma.permit.create({
    data: {
      userId: user.userId,
      teamId: team.id,
      projectName: `QA no-letter permit ${randomUUID().slice(0, 8)}`,
      address: '102 Test Street, Tampa',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });

  const letterListUrl = `${origin}/api/permit-letters?teamId=${encodeURIComponent(team.id)}`;
  const draftOnlyList = await page.request.get(letterListUrl, { headers: { origin } });
  expect(draftOnlyList.status()).toBe(200);
  const draftOnlyBody = (await draftOnlyList.json()) as {
    items: Array<{ id: string; correctionChecklist: unknown }>;
  };
  expect(draftOnlyBody.items.find((letter) => letter.id === fixture.letter.id)?.correctionChecklist)
    .toBeNull();

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: fixture.permit.projectName })).toBeVisible();
  const noChecklistState = page.getByTestId(`correction-checklist-none-${fixture.letter.id}`);
  await expect(noChecklistState).toHaveText('No saved checklist');
  await expect(page.getByText('No letters attached yet. No saved correction checklist.'))
    .toBeVisible();
  await expect(page.getByRole('heading', { name: permitWithoutLetter.projectName })).toBeVisible();

  const confirmedAt = new Date();
  await prisma.permitCorrectionDraft.update({
    where: { permitLetterId: fixture.letter.id },
    data: {
      status: 'confirmed',
      reviewedItems: [
        {
          id: 'reviewed-item-1',
          action: 'Revise the north elevation notes.',
          location: 'North elevation',
          planReference: 'A2.1',
        },
      ],
      reviewedAt: confirmedAt,
      reviewedByUserId: user.userId,
      confirmedAt,
    },
  });
  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByTestId(`correction-checklist-none-${fixture.letter.id}`)).toHaveText(
    'No saved checklist',
  );
  await expect(
    page.getByText('Review the confirmed items to create a saved team checklist.'),
  ).toBeVisible();

  const saved = await createSavedChecklistItem({
    userId: user.userId,
    teamId: team.id,
    permitId: fixture.permit.id,
    letterId: fixture.letter.id,
  });
  const savedList = await page.request.get(letterListUrl, { headers: { origin } });
  expect(savedList.status()).toBe(200);
  const savedBody = (await savedList.json()) as {
    items: Array<{
      id: string;
      correctionChecklist: {
        id: string;
        sourceLetterId: string;
        completedCount: number;
        totalCount: number;
      } | null;
    }>;
  };
  expect(savedBody.items.find((letter) => letter.id === fixture.letter.id)?.correctionChecklist)
    .toEqual({
      id: saved.checklist.id,
      sourceLetterId: fixture.letter.id,
      completedCount: 0,
      totalCount: 1,
    });

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const checklistSummary = page.getByTestId(`correction-checklist-summary-${fixture.letter.id}`);
  await expect(checklistSummary).toContainText('0 of 1 complete');
  await expect(
    page.getByText('Review the confirmed items to create a saved team checklist.'),
  ).toHaveCount(0);
  await expect(checklistSummary).toHaveAttribute(
    'href',
    `/dashboard/permits/${fixture.permit.id}/letters/${fixture.letter.id}/checklist`,
  );
  await checklistSummary.click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/permits/${fixture.permit.id}/letters/${fixture.letter.id}/checklist$`),
  );
  const task = page.getByRole('checkbox', {
    name: 'Completion status for Revise the north elevation notes.',
  });
  await toggleChecklistItem(page, task);
  await expect(task).toBeChecked();
  expect(
    (await prisma.permitCorrectionChecklistItem.findUnique({ where: { id: saved.item.id } }))
      ?.completed,
  ).toBe(true);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const completedSummary = page.getByTestId(`correction-checklist-summary-${fixture.letter.id}`);
  await expect(completedSummary).toContainText('1 of 1 complete');
  await completedSummary.click();
  const reopenedTask = page.getByRole('checkbox', {
    name: 'Completion status for Revise the north elevation notes.',
  });
  await expect(reopenedTask).toBeChecked();
  await toggleChecklistItem(page, reopenedTask);
  await expect(reopenedTask).not.toBeChecked();
  expect(
    (await prisma.permitCorrectionChecklistItem.findUnique({ where: { id: saved.item.id } }))
      ?.completed,
  ).toBe(false);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  const reopenedSummary = page.getByTestId(`correction-checklist-summary-${fixture.letter.id}`);
  await expect(reopenedSummary).toContainText('0 of 1 complete');
  await reopenedSummary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permit-list-checklist-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await reopenedSummary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permit-list-checklist-mobile.png') });
  await page.setViewportSize({ width: 320, height: 844 });
  await reopenedSummary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permit-list-checklist-320.png') });
});

test('a paid member creates a checklist from confirmed review items with a source link on every item', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const user = await signUp(page, origin);
  const team = await createTeam(user.userId, 'QA Paid Checklist Team');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: user.userId, role: 'owner' },
  });
  const fixture = await createLetterFixture({
    userId: user.userId,
    teamId: team.id,
    status: 'verified',
    reviewedItems: [
      {
        id: 'reviewed-item-1',
        action: 'Revise the north elevation notes.',
        location: 'North elevation',
        planReference: 'A2.1',
      },
      {
        id: 'reviewed-item-2',
        action: 'Clarify the window schedule.',
        location: 'West elevation',
        planReference: 'A3.2',
      },
    ],
  });

  const paidPermitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
    { headers: { origin } },
  );
  expect(paidPermitList.status()).toBe(200);
  const paidPermitItems = (await paidPermitList.json()) as { items: Array<{ id: string }> };
  expect(paidPermitItems.items.map((permit) => permit.id)).toContain(fixture.permit.id);

  await page.goto(
    `${origin}/dashboard/permits/${encodeURIComponent(fixture.permit.id)}/letters/${encodeURIComponent(fixture.letter.id)}/review`,
  );
  await expect(page.getByRole('heading', { name: 'Review correction items' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create correction checklist' })).toBeVisible();
  await page.getByRole('button', { name: 'Create correction checklist' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/permits/${fixture.permit.id}/letters/${fixture.letter.id}/checklist$`),
  );
  await expect(page.getByRole('heading', { name: 'Correction checklist' })).toBeVisible();
  await expect(page.getByText('Revise the north elevation notes.')).toBeVisible();
  await expect(page.getByText('Clarify the window schedule.')).toBeVisible();
  await expect(page.getByText(/Draft-only extraction request/)).toHaveCount(0);
  await expect(page.getByText(/does not monitor permit portals or send alerts/)).toBeVisible();
  await expect(page.getByText(/team task update only.*never changes the permit’s manually maintained status/i)).toBeVisible();

  const sourceLinks = page.getByRole('link', { name: 'Source: permit-review-letter.pdf' });
  await expect(sourceLinks).toHaveCount(2);
  await expect(sourceLinks.first()).toHaveAttribute(
    'href',
    new RegExp(`/api/permit-letters/${fixture.letter.id}/source\\?`),
  );

  const saved = await prisma.permitCorrectionChecklist.findUnique({
    where: { permitLetterId: fixture.letter.id },
    include: { items: true },
  });
  expect(saved?.createdByUserId).toBe(user.userId);
  expect(saved?.items).toHaveLength(2);
  expect(saved?.items.map((item) => item.sourceItemId).sort()).toEqual([
    'reviewed-item-1',
    'reviewed-item-2',
  ]);
  expect(saved?.items.every((item) => item.sourceLetterId === fixture.letter.id)).toBe(true);
  expect(saved?.items.some((item) => item.sourceItemId === 'draft-only-item')).toBe(false);

  const firstTaskCheckbox = page.getByRole('checkbox', {
    name: 'Completion status for Revise the north elevation notes.',
  });
  const secondTaskCheckbox = page.getByRole('checkbox', {
    name: 'Completion status for Clarify the window schedule.',
  });
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(firstTaskCheckbox).not.toBeChecked();
  await expect(secondTaskCheckbox).not.toBeChecked();
  await toggleChecklistItem(page, firstTaskCheckbox);
  await expect(firstTaskCheckbox).toBeChecked();
  const firstCompletedItem = await prisma.permitCorrectionChecklistItem.findFirst({
    where: { checklistId: saved?.id, sourceItemId: 'reviewed-item-1' },
  });
  expect(firstCompletedItem?.completed).toBe(true);
  await toggleChecklistItem(page, secondTaskCheckbox);
  await expect(secondTaskCheckbox).toBeChecked();
  const secondCompletedItem = await prisma.permitCorrectionChecklistItem.findFirst({
    where: { checklistId: saved?.id, sourceItemId: 'reviewed-item-2' },
  });
  expect(secondCompletedItem?.completed).toBe(true);
  expect((await prisma.permit.findUnique({ where: { id: fixture.permit.id } }))?.status).toBe(
    'Corrections requested',
  );
  await captureViewports(page, testInfo, 'permit-checklist-complete');

  await page.reload();
  const reopenedFirstCheckbox = page.getByRole('checkbox', {
    name: 'Completion status for Revise the north elevation notes.',
  });
  const reopenedSecondCheckbox = page.getByRole('checkbox', {
    name: 'Completion status for Clarify the window schedule.',
  });
  await expect(reopenedFirstCheckbox).toBeChecked();
  await expect(reopenedSecondCheckbox).toBeChecked();
  await toggleChecklistItem(page, reopenedFirstCheckbox);
  await expect(reopenedFirstCheckbox).not.toBeChecked();
  const reopenedFirstItem = await prisma.permitCorrectionChecklistItem.findFirst({
    where: { checklistId: saved?.id, sourceItemId: 'reviewed-item-1' },
  });
  expect(reopenedFirstItem?.completed).toBe(false);
  expect(
    (
      await prisma.permitCorrectionChecklistItem.findFirst({
        where: { checklistId: saved?.id, sourceItemId: 'reviewed-item-2' },
      })
    )?.completed,
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole('checkbox', {
      name: 'Completion status for Revise the north elevation notes.',
    }),
  ).not.toBeChecked();
  const persistedSecondCheckbox = page.getByRole('checkbox', {
    name: 'Completion status for Clarify the window schedule.',
  });
  await expect(persistedSecondCheckbox).toBeChecked();
  await toggleChecklistItem(page, persistedSecondCheckbox);
  await expect(persistedSecondCheckbox).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByRole('checkbox', {
      name: 'Completion status for Revise the north elevation notes.',
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', {
      name: 'Completion status for Clarify the window schedule.',
    }),
  ).not.toBeChecked();
  expect((await prisma.permit.findUnique({ where: { id: fixture.permit.id } }))?.status).toBe(
    'Corrections requested',
  );

  const duplicate = await page.request.post(checklistApi(fixture.letter.id, fixture.permit.id), {
    headers: { origin },
    data: { teamId: team.id, permitId: fixture.permit.id },
  });
  expect(duplicate.status()).toBe(200);
  const duplicateBody = (await duplicate.json()) as { checklist: { id: string } };
  expect(duplicateBody.checklist.id).toBe(saved?.id);

  const draftOnly = await createLetterFixture({
    userId: user.userId,
    teamId: team.id,
    status: 'verified',
    draftStatus: 'draft',
  });
  const unconfirmedResponse = await page.request.post(
    checklistApi(draftOnly.letter.id, draftOnly.permit.id),
    { headers: { origin }, data: { teamId: team.id, permitId: draftOnly.permit.id } },
  );
  expect(unconfirmedResponse.status()).toBe(409);
  expect((await unconfirmedResponse.json()).error).toBe('correction_review_not_confirmed');
  expect(
    await prisma.permitCorrectionChecklist.count({ where: { permitLetterId: draftOnly.letter.id } }),
  ).toBe(0);

  await captureViewports(page, testInfo, 'permit-checklist-open');
});

test('a paid team member downloads a current checklist PDF with a protected source link', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const user = await signUp(page, origin);
  const team = await createTeam(user.userId, 'QA Checklist PDF Team');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: user.userId, role: 'owner' },
  });
  const permitNumber = `TAMPA-${randomUUID().slice(0, 8).toUpperCase()}`;
  const fixture = await createLetterFixture({
    userId: user.userId,
    teamId: team.id,
    status: 'verified',
    permitNumber,
    reviewedItems: [
      {
        id: 'pdf-item-1',
        action: 'Revise the north elevation notes.',
        location: 'North elevation',
        planReference: 'A2.1',
      },
      {
        id: 'pdf-item-2',
        action: 'Clarify the window schedule.',
        location: 'West elevation',
        planReference: null,
      },
      {
        id: 'pdf-item-3',
        action: 'Add the revised stair detail.',
        location: 'Second floor',
        planReference: 'S3.0',
      },
    ],
  });
  const created = await page.request.post(checklistApi(fixture.letter.id, fixture.permit.id), {
    headers: { origin },
    data: { teamId: team.id, permitId: fixture.permit.id },
  });
  const createdBody = await created.json().catch(() => null) as {
    checklist?: { items?: Array<{ action: string }> };
  } | null;
  expect(created.status()).toBe(201);
  expect(createdBody?.checklist?.items?.map((item) => item.action)).toEqual([
    'Revise the north elevation notes.',
    'Clarify the window schedule.',
    'Add the revised stair detail.',
  ]);

  const checklistUrl = `${origin}/dashboard/permits/${encodeURIComponent(fixture.permit.id)}/letters/${encodeURIComponent(fixture.letter.id)}/checklist`;
  await page.goto(checklistUrl);
  await expect(page.getByRole('heading', { name: 'Correction checklist' })).toBeVisible();
  const downloadButton = page.getByRole('button', { name: 'Download PDF' });
  await expect(downloadButton).toBeVisible();
  await expect(page.getByText('Clarify the window schedule.')).toBeVisible();

  const firstTask = page.getByRole('checkbox', {
    name: 'Completion status for Revise the north elevation notes.',
  });
  await toggleChecklistItem(page, firstTask);
  await expect(firstTask).toBeChecked();
  const savedItems = await prisma.permitCorrectionChecklistItem.findMany({
    where: { checklist: { permitLetterId: fixture.letter.id } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(savedItems.map((item) => item.position)).toEqual([0, 1, 2]);
  expect(savedItems.map((item) => item.completed)).toEqual([true, false, false]);

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^correction-checklist-TAMPA-[A-Z0-9]+\.pdf$/);
  const savedPdfPath = testInfo.outputPath('current-permit-checklist.pdf');
  await download.saveAs(savedPdfPath);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('The checklist PDF download did not produce a file.');
  const pdfBytes = await readFile(downloadPath);
  expect(pdfBytes.toString('ascii', 0, 5)).toBe('%PDF-');
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);

  const sourceLink = (await sourceLinksInPdf(pdfBytes)).at(0);
  expect(sourceLink).toBeTruthy();
  if (!sourceLink) throw new Error('The PDF source page has no protected link annotation.');
  const linkedSource = new URL(sourceLink);
  expect(linkedSource.pathname).toBe(
    `/api/permit-letters/${encodeURIComponent(fixture.letter.id)}/source`,
  );
  expect(linkedSource.searchParams.get('teamId')).toBe(team.id);
  expect(linkedSource.searchParams.get('permitId')).toBe(fixture.permit.id);

  const wrongPermit = await page.request.get(checklistPdfApi(fixture.letter.id, 'other-permit'), {
    headers: { origin },
  });
  expect(wrongPermit.status()).toBe(404);
  expect((await wrongPermit.json()).error).toBe('permit_letter_not_found');

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();
  const anonymousPdf = await anonymousPage.request.get(
    `${origin}${checklistPdfApi(fixture.letter.id, fixture.permit.id)}`,
  );
  expect(anonymousPdf.status()).toBe(401);
  const anonymousSource = await anonymousPage.request.get(
    `${origin}${sourceLetterApi(fixture.letter.id, fixture.permit.id, team.id)}`,
  );
  expect(anonymousSource.status()).toBe(401);

  await expect(page.getByText('Checklist PDF download started.')).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('permit-checklist-pdf-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('permit-checklist-pdf-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('permit-checklist-pdf-320.png'), fullPage: true });
});

test('a different active subscription does not unlock team permit access', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const user = await signUp(page, origin, 'qa-mismatch');
  const team = await createTeam(user.userId, 'QA Mismatched Subscription Team');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: user.userId, role: 'owner' },
  });
  const fixture = await createLetterFixture({
    userId: user.userId,
    teamId: team.id,
    status: 'verified',
  });

  const deniedPdf = await page.request.get(checklistPdfApi(fixture.letter.id, fixture.permit.id), {
    headers: { origin },
  });
  expect(deniedPdf.status()).toBe(402);
  expect((await deniedPdf.json()).error).toBe('team_subscription_required');

  const permitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
    { headers: { origin } },
  );
  expect(permitList.status()).toBe(402);
  expect((await permitList.json()).paymentStatus).toBe('inactive');

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await expect(page.getByText(/team subscription is not active/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mismatched-subscription-locked.png'), fullPage: true });
});

test('pending, canceled, unverifiable, and nonmember access cannot create a checklist', async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const user = await signUp(page, origin, 'qa-inactive');

  const checkDenied = async (
    status: 'pending' | 'canceled' | 'verified',
    teamName: string,
    includeMembership: boolean,
    removeCheckout = false,
  ) => {
    const team = await createTeam(user.userId, teamName);
    if (includeMembership) {
      await prisma.teamMembership.create({
        data: { teamId: team.id, userId: user.userId, role: 'owner' },
      });
    }
    const fixture = await createLetterFixture({
      userId: user.userId,
      teamId: team.id,
      status,
    });
    if (removeCheckout) {
      await prisma.teamCheckout.delete({ where: { id: fixture.checkout.id } });
    }
    const saved = await createSavedChecklistItem({
      userId: user.userId,
      teamId: team.id,
      permitId: fixture.permit.id,
      letterId: fixture.letter.id,
    });
    const response = await page.request.post(
      checklistApi(fixture.letter.id, fixture.permit.id),
      { headers: { origin }, data: { teamId: team.id, permitId: fixture.permit.id } },
    );
    const checklistRead = await page.request.get(checklistApi(fixture.letter.id, fixture.permit.id), {
      headers: { origin },
    });
    const checklistPdf = await page.request.get(
      checklistPdfApi(fixture.letter.id, fixture.permit.id),
      { headers: { origin } },
    );
    const sourceLetter = await page.request.get(
      sourceLetterApi(fixture.letter.id, fixture.permit.id, team.id),
      { headers: { origin } },
    );
    const completionUpdate = await page.request.patch(
      checklistApi(fixture.letter.id, fixture.permit.id),
      {
        headers: { origin },
        data: { itemId: saved.item.id, completed: true },
      },
    );
    const permitList = await page.request.get(
      `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
      { headers: { origin } },
    );
    const letterList = await page.request.get(
      `${origin}/api/permit-letters?teamId=${encodeURIComponent(team.id)}`,
      { headers: { origin } },
    );
    const permitUpdate = await page.request.patch(`${origin}/api/permits`, {
      headers: { origin },
      data: {
        action: 'update',
        id: fixture.permit.id,
        teamId: team.id,
        data: {
          projectName: 'Attempted locked permit edit',
          address: '101 Test Street, Tampa',
          permitNumber: 'QA-UNSUPPORTED-ATTEMPT',
          permitType: 'Building',
          status: 'Issued',
          notes: '',
        },
      },
    });
    const persistedItem = await prisma.permitCorrectionChecklistItem.findUnique({
      where: { id: saved.item.id },
    });
    const persistedPermit = await prisma.permit.findUnique({ where: { id: fixture.permit.id } });
    return {
      response,
      fixture,
      team,
      checklistRead,
      checklistPdf,
      sourceLetter,
      completionUpdate,
      permitList,
      letterList,
      permitUpdate,
      persistedItem,
      persistedPermit,
    };
  };

  const pending = await checkDenied('pending', 'QA Pending Checkout', true);
  expect(pending.response.status()).toBe(402);
  expect((await pending.response.json()).error).toBe('team_subscription_required');
  expect(pending.completionUpdate.status()).toBe(402);
  expect(pending.checklistRead.status()).toBe(402);
  expect(pending.checklistPdf.status()).toBe(402);
  expect(pending.sourceLetter.status()).toBe(402);
  expect(pending.permitList.status()).toBe(402);
  expect(pending.letterList.status()).toBe(402);
  expect(pending.permitUpdate.status()).toBe(402);
  expect(pending.persistedItem?.completed).toBe(false);
  expect(pending.persistedPermit?.projectName).not.toBe('Attempted locked permit edit');

  const canceled = await checkDenied('canceled', 'QA Canceled Checkout', true);
  expect(canceled.response.status()).toBe(402);
  expect((await canceled.response.json()).error).toBe('team_subscription_required');
  expect(canceled.completionUpdate.status()).toBe(402);
  expect(canceled.checklistRead.status()).toBe(402);
  expect(canceled.checklistPdf.status()).toBe(402);
  expect(canceled.sourceLetter.status()).toBe(402);
  expect(canceled.permitList.status()).toBe(402);
  expect(canceled.letterList.status()).toBe(402);
  expect(canceled.permitUpdate.status()).toBe(402);
  expect(canceled.persistedItem?.completed).toBe(false);
  expect(canceled.persistedPermit?.projectName).not.toBe('Attempted locked permit edit');

  const unverifiable = await checkDenied('verified', 'QA Unverified Subscription', true);
  expect(unverifiable.response.status()).toBe(402);
  expect((await unverifiable.response.json()).error).toBe('team_subscription_required');
  expect(unverifiable.completionUpdate.status()).toBe(402);
  expect(unverifiable.checklistRead.status()).toBe(402);
  expect(unverifiable.checklistPdf.status()).toBe(402);
  expect(unverifiable.sourceLetter.status()).toBe(402);
  expect(unverifiable.permitList.status()).toBe(402);
  expect(unverifiable.letterList.status()).toBe(402);
  expect(unverifiable.permitUpdate.status()).toBe(402);
  expect(unverifiable.persistedItem?.completed).toBe(false);
  expect(unverifiable.persistedPermit?.projectName).not.toBe('Attempted locked permit edit');

  const nonmember = await checkDenied('verified', 'QA Nonmember Team', false);
  expect(nonmember.response.status()).toBe(403);
  expect((await nonmember.response.json()).error).toBe('team_membership_required');
  expect(nonmember.completionUpdate.status()).toBe(403);
  expect(nonmember.checklistRead.status()).toBe(403);
  expect(nonmember.checklistPdf.status()).toBe(403);
  expect(nonmember.sourceLetter.status()).toBe(403);
  expect(nonmember.permitList.status()).toBe(403);
  expect(nonmember.letterList.status()).toBe(403);
  expect(nonmember.persistedItem?.completed).toBe(false);

  await page.goto(
    `${origin}/dashboard/permits/${encodeURIComponent(pending.fixture.permit.id)}/letters/${encodeURIComponent(pending.fixture.letter.id)}/checklist`,
  );
  await expect(page.getByRole('heading', { name: 'Checklist unavailable' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);

  const pendingSessionId = pending.fixture.checkout.stripeSessionId;
  expect(pendingSessionId).toBeTruthy();
  if (!pendingSessionId) throw new Error('Pending checkout did not store a session id.');
  const failedVerification = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: pendingSessionId },
  });
  expect(failedVerification.status()).toBe(409);
  expect((await failedVerification.json()).error).toBe('payment_not_verified');
  expect(
    (await prisma.teamCheckout.findUnique({ where: { id: pending.fixture.checkout.id } }))?.status,
  ).toBe('pending');
  const stillLocked = await page.request.post(
    checklistApi(pending.fixture.letter.id, pending.fixture.permit.id),
    {
      headers: { origin },
      data: { teamId: pending.team.id, permitId: pending.fixture.permit.id },
    },
  );
  expect(stillLocked.status()).toBe(402);
  await prisma.teamCheckout.delete({ where: { id: pending.fixture.checkout.id } });
  const unpaidPdf = await page.request.get(
    checklistPdfApi(pending.fixture.letter.id, pending.fixture.permit.id),
    { headers: { origin } },
  );
  expect(unpaidPdf.status()).toBe(402);
  expect((await unpaidPdf.json()).paymentStatus).toBe('unpaid');
  const unpaidSource = await page.request.get(
    sourceLetterApi(pending.fixture.letter.id, pending.fixture.permit.id, pending.team.id),
    { headers: { origin } },
  );
  expect(unpaidSource.status()).toBe(402);
  expect(
    await prisma.permitCorrectionChecklist.count({ where: { teamId: { in: fixtureTeamIds } } }),
  ).toBe(4);
  expect(
    await prisma.permitCorrectionChecklistItem.count({
      where: { checklist: { teamId: { in: fixtureTeamIds } }, completed: true },
    }),
  ).toBe(0);

  await page.goto(
    `${origin}/dashboard?teamId=${encodeURIComponent(canceled.team.id)}&checkout=cancelled`,
  );
  await expect(
    page.getByText('Checkout was canceled. Team monitoring is still locked until payment is verified.'),
  ).toBeVisible();
  await captureViewports(page, testInfo);
});

test('an unavailable subscription status keeps checklist access locked', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const user = await signUp(page, origin, 'qa-unavailable');
  const team = await createTeam(user.userId, 'QA Unavailable Billing Team');
  await prisma.teamMembership.create({
    data: { teamId: team.id, userId: user.userId, role: 'owner' },
  });
  const fixture = await createLetterFixture({
    userId: user.userId,
    teamId: team.id,
    status: 'verified',
  });

  const response = await page.request.post(
    checklistApi(fixture.letter.id, fixture.permit.id),
    { headers: { origin }, data: { teamId: team.id, permitId: fixture.permit.id } },
  );
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toBe('billing_status_unavailable');
  const permitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
    { headers: { origin } },
  );
  const permitUpdate = await page.request.patch(`${origin}/api/permits`, {
    headers: { origin },
    data: {
      action: 'update',
      id: fixture.permit.id,
      teamId: team.id,
      data: {
        projectName: 'Attempted unavailable permit edit',
        address: '101 Test Street, Tampa',
        permitNumber: 'QA-UNSUPPORTED-ATTEMPT',
        permitType: 'Building',
        status: 'Issued',
        notes: '',
      },
    },
  });
  expect(permitList.status()).toBe(503);
  expect(permitUpdate.status()).toBe(503);
  expect((await prisma.permit.findUnique({ where: { id: fixture.permit.id } }))?.projectName).not.toBe(
    'Attempted unavailable permit edit',
  );
  expect(
    await prisma.permitCorrectionChecklist.count({ where: { teamId: team.id } }),
  ).toBe(0);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  await captureViewports(page, testInfo);
});
