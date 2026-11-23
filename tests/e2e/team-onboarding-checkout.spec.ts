// @polsia:user-owned — unpaid members can establish team access before checkout.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { PermitStatus } from '@/lib/contracts/permit';

const prisma = new PrismaClient();
const fixtureUserIds: string[] = [];
const fixtureTeamIds: string[] = [];
const fixtureContexts: BrowserContext[] = [];

interface PricingProductData {
  description?: string;
  offers?: {
    name?: string;
    description?: string;
    price?: number;
    priceCurrency?: string;
    priceSpecification?: { unitCode?: string; billingDuration?: number };
  };
}

interface HostedCheckoutRequest {
  amount?: number;
  recurring?: { interval?: string };
  customer_email?: string;
  client_reference_id?: string;
  metadata?: { teamId?: string; userId?: string; teamCheckoutId?: string };
}

interface CheckoutSessionAudit {
  sessionId: string;
  teamId: string;
  checkoutId: string;
  email: string;
  amount: number;
  productName: string;
}

async function requestPermitExport(page: Page, origin: string, teamId: string) {
  return page.request.post(`${origin}/api/csv-export`, {
    headers: { origin },
    data: {
      sourceId: 'permits',
      filters: {
        teamId,
        view: 'active',
        sort: 'activity',
        status: null,
        assignedToMe: false,
        interruptedMonitoring: false,
        searchTerm: '',
      },
    },
  });
}

async function expectPermitExportLocked(
  page: Page,
  origin: string,
  teamId: string,
  permitValues: string[],
  expectedStatus: number,
) {
  const response = await requestPermitExport(page, origin, teamId);
  const body = await response.text();
  expect(response.status(), body).toBe(expectedStatus);
  for (const value of permitValues) expect(body).not.toContain(value);
  expect(body).not.toContain('"csv"');
  expect(body).not.toContain('"records"');
}

async function signUp(page: Page, origin: string) {
  const email = `qa-onboarding-${randomUUID()}@example.test`;
  const password = `Qa-${randomUUID()}-9a`;
  const response = await page.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { origin },
    data: { name: 'QA Team Member', email, password },
  });
  expect(response.status(), await response.text()).toBe(200);

  const sessionResponse = await page.request.get(`${origin}/api/auth/get-session`, {
    headers: { origin },
  });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  const userId = session.user?.id;
  expect(userId).toBeTruthy();
  if (!userId) throw new Error('Sign-up did not return a session user.');

  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const signIn = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, callbackURL: '/' },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);
  fixtureUserIds.push(userId);
  return { userId, email };
}

async function setSubscriptionState(
  email: string,
  active: boolean | 'unavailable',
  status?: 'canceled',
) {
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
  await writeFile(
    `/tmp/polsia-subscription-state-${digest}.json`,
    JSON.stringify({
      active: active === true,
      unavailable: active === 'unavailable',
      ...(status ? { status } : {}),
    }),
    'utf8',
  );
}

async function setCheckoutGrossAmount(sessionId: string, amount: number) {
  const auditPath = '/tmp/docketkite-qa-checkout-sessions.ndjson';
  const auditContents = await readFile(auditPath, 'utf8');
  let matched = false;
  const updatedLines = auditContents
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const session = JSON.parse(line) as CheckoutSessionAudit;
      if (session.sessionId !== sessionId) return line;
      matched = true;
      return JSON.stringify({ ...session, amount });
    });
  expect(matched, `checkout session ${sessionId} was captured by the provider stand-in`).toBe(true);
  await writeFile(auditPath, `${updatedLines.join('\n')}\n`, 'utf8');
}

async function setCheckoutCustomerEmail(sessionId: string, email: string) {
  const auditPath = '/tmp/docketkite-qa-checkout-sessions.ndjson';
  const auditContents = await readFile(auditPath, 'utf8');
  let matched = false;
  const updatedLines = auditContents
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const session = JSON.parse(line) as CheckoutSessionAudit;
      if (session.sessionId !== sessionId) return line;
      matched = true;
      return JSON.stringify({ ...session, email });
    });
  expect(matched, `checkout session ${sessionId} was captured by the provider stand-in`).toBe(true);
  await writeFile(auditPath, `${updatedLines.join('\n')}\n`, 'utf8');
}

async function emailSendCountFor(recipients: string[]) {
  const raw = await readFile('/tmp/polsia-email-send-audit.ndjson', 'utf8').catch(() => '');
  const recipientSet = new Set(recipients.map((recipient) => recipient.toLowerCase()));
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line))
    .filter(
      (entry): entry is { to: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        'to' in entry &&
        typeof entry.to === 'string',
    )
    .filter((entry) => recipientSet.has(entry.to.toLowerCase())).length;
}

async function expectHostedCheckout(page: Page, origin: string, teamId: string) {
  await page.route('https://checkout.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Hosted checkout test stand-in</title><main>Hosted checkout test stand-in</main>',
    }),
  );
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(`https://checkout.example.test/session/${teamId}`);
  await expect(page.getByText('Hosted checkout test stand-in')).toBeVisible();

  const checkout = await prisma.teamCheckout.findFirst({ where: { teamId } });
  expect(checkout?.status).toBe('pending');
  expect(checkout?.stripeSessionId).toBe(`cs_test_${checkout?.id}`);
  if (!checkout) throw new Error('The team checkout record was not persisted.');
  const purchaser = await prisma.user.findUnique({
    where: { id: checkout.userId },
    select: { email: true },
  });
  expect(purchaser?.email).toBeTruthy();
  const checkoutRequest = JSON.parse(
    await readFile(`/tmp/polsia-team-checkout-${teamId}.json`, 'utf8'),
  ) as HostedCheckoutRequest;
  expect(checkoutRequest.amount).toBe(299);
  expect(checkoutRequest.recurring?.interval).toBe('month');
  expect(checkoutRequest.customer_email).toBe(purchaser?.email);
  expect(checkoutRequest.client_reference_id).toBe(teamId);
  expect(checkoutRequest.metadata?.teamId).toBe(teamId);
  expect(checkoutRequest.metadata?.userId).toBe(checkout.userId);
  expect(checkoutRequest.metadata?.teamCheckoutId).toBe(checkout.id);

  const lockedPermitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(teamId)}`,
  );
  expect(lockedPermitList.status()).toBe(402);
  const lockedPermitListBody = (await lockedPermitList.json()) as {
    paymentStatus?: string;
    items?: unknown[];
  };
  expect(lockedPermitListBody.paymentStatus).toBe('pending');
  expect(lockedPermitListBody.items).toBeUndefined();

  const lockedStatusCounts = await page.request.get(
    `${origin}/api/permit-status-counts?teamId=${encodeURIComponent(teamId)}`,
  );
  expect(lockedStatusCounts.status()).toBe(402);
  expect((await lockedStatusCounts.json()).items).toBeUndefined();

  await page.goBack();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
}

async function continueFromPricing(page: Page, origin: string) {
  await page.goto(`${origin}/pricing`);
  await expect(page.getByRole('heading', { name: 'Private team workspace' })).toBeVisible();
  const setupLink = page.getByRole('link', { name: 'Create or join a team' });
  expect(await setupLink.getAttribute('href')).toBe('/dashboard');
  await setupLink.click();
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
}

async function captureWorkspace(page: Page, testInfo: TestInfo, prefix: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath(`${prefix}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath(`${prefix}-mobile.png`), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({ path: testInfo.outputPath(`${prefix}-320.png`), fullPage: true });
}

test.afterEach(async () => {
  if (fixtureTeamIds.length > 0 || fixtureUserIds.length > 0) {
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
    await prisma.permit.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.teamCheckout.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.teamInvitation.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.teamMembership.deleteMany({
      where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: fixtureUserIds } }] },
    });
    await prisma.teamSpace.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    fixtureTeamIds.length = 0;
    fixtureUserIds.length = 0;
  }
  await Promise.all(fixtureContexts.map((context) => context.close()));
  fixtureContexts.length = 0;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('the public pricing page describes live permit checks, saved-status emails, and planned SMS', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const homePricingLink = page.getByRole('link', { name: 'Pricing', exact: true });
  await expect(homePricingLink).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('pricing-entry-home-320.png'), fullPage: true });
  await page.getByRole('link', { name: 'Pricing', exact: true }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(
    page.getByRole('heading', { name: 'One private permit workspace for your team.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private team workspace' })).toBeVisible();
  await expect(page.getByText('$299', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Pilot terms: \$149 is the manual second-month offer for Days 11–30/),
  ).toBeVisible();
  await expect(
    page.getByText(/\$299\/month is the later Days 61–90 rate and longer-term target/),
  ).toBeVisible();
  await expect(
    page.getByText(/Pilot terms: \$149 is the manual second-month offer for Days 11–30/),
  ).toBeVisible();
  await expect(
    page.getByText(/\$299\/month is the later Days 61–90 rate and longer-term target/),
  ).toBeVisible();
  await expect(page.getByText('/month', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public checks and team status updates' })).toBeVisible();
  await expect(
    page.getByText(/A team member starts each check for a linked official City of Tampa public Accela record/i),
  ).toBeVisible();
  await expect(
    page.getByText(/Checks do not run continuously or on a schedule and do not access applicant-only information/i),
  ).toBeVisible();
  await expect(
    page.getByText(/A verified transition can email the assigned project manager/i),
  ).toBeVisible();
  await expect(
    page.getByText(/an interrupted check can email the team owner/i),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SMS alerts' })).toBeVisible();
  await expect(
    page.getByText(/SMS remains planned and unavailable/i),
  ).toBeVisible();
  expect(
    await page.getByRole('link', { name: 'Create or join a team' }).getAttribute('href'),
  ).toBe('/dashboard');
  const structuredData = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structuredData).not.toBeNull();
  if (!structuredData) throw new Error('The pricing page did not render its Product offer data.');
  const product = JSON.parse(structuredData) as PricingProductData;
  const productDescription = product.description ?? '';
  const offerDescription = product.offers?.description ?? '';
  expect(productDescription).toMatch(/on-demand check/i);
  expect(productDescription).toMatch(/can email the assigned project manager/i);
  expect(productDescription).toMatch(/SMS alerts are planned and unavailable today/i);
  expect(productDescription).not.toMatch(
    /permit portal monitoring.{0,30}planned|automated.*monitoring/i,
  );
  expect(product.offers?.name).toBe('Private team workspace');
  expect(offerDescription).toMatch(/on-demand checks of linked official public Accela records/i);
  expect(offerDescription).toMatch(
    /email alerts after a verified public status transition/i,
  );
  expect(offerDescription).not.toMatch(/monitoring.{0,30}planned|automated.*portal/i);
  expect(product.offers?.price).toBe(299);
  expect(product.offers?.priceCurrency).toBe('USD');
  expect(product.offers?.priceSpecification?.unitCode).toBe('MON');
  expect(product.offers?.priceSpecification?.billingDuration).toBe(1);

  for (const [width, height, name] of [
    [1440, 900, 'desktop'],
    [390, 844, 'mobile'],
    [320, 844, 'mobile-320'],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (width < 768) {
      const menuButton = page.getByRole('button', { name: 'Open menu' });
      await expect(menuButton).toBeVisible();
      await menuButton.click();
      const mobileNavigation = page.getByRole('navigation', { name: 'Mobile' });
      await expect(mobileNavigation.getByRole('link', { name: 'Pricing', exact: true })).toBeVisible();
      await expect(
        mobileNavigation.getByRole('link', { name: 'Compare permit options', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('link', { name: 'Create or join a team' })).toBeVisible();
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentWidth, `pricing page horizontal overflow at ${width}px`).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`pricing-${name}.png`),
      fullPage: true,
    });
  }
});

test('an ordinary unpaid signed-in account with no team can use visible controls to create an owner membership and reach hosted checkout', async (
  { page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { userId, email } = await signUp(page, origin);
  expect(await prisma.teamMembership.count({ where: { userId } })).toBe(0);
  expect(await prisma.teamSpace.count({ where: { createdByUserId: userId } })).toBe(0);

  await continueFromPricing(page, origin);
  await expect(page.getByRole('heading', { name: 'Team workspace' })).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByText('Team subscription · $299 / month')).toBeVisible();
    await expect(
      page.getByText('Stripe checkout becomes available after you select a team.'),
    ).toBeVisible();
    await expect(page.getByLabel('Team name')).toBeVisible();
    await expect(page.getByLabel('Team invite code')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join team' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }

  await page.getByLabel('Team name').fill('QA Onboarding Remodel Team');
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByText('Workspace created.')).toBeVisible();

  const team = await prisma.teamSpace.findFirst({
    where: { createdByUserId: userId, name: 'QA Onboarding Remodel Team' },
  });
  expect(team).not.toBeNull();
  if (!team) throw new Error('The create-team action did not persist its workspace.');
  const teamId = team.id;
  fixtureTeamIds.push(team.id);
  expect(
    (await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId } },
    }))?.role,
  ).toBe('owner');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }
  await expect(page.getByText('Import permits from CSV', { exact: true })).toHaveCount(0);
  const lockedImportDescription = await page.request.get(
    `${origin}/api/csv-import?target=tampa-city-permits&teamId=${encodeURIComponent(team.id)}`,
  );
  expect(lockedImportDescription.status()).toBe(403);

  await prisma.permit.create({
    data: {
      userId,
      teamId: team.id,
      projectName: 'QA Unpaid Saved Permit',
      address: '11 QA Search Lane, Tampa',
      permitNumber: 'QA-UNPAID-100',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
    },
  });

  const permit = await prisma.permit.findFirstOrThrow({
    where: { teamId: team.id, permitNumber: 'QA-UNPAID-100' },
  });
  await setSubscriptionState(email, false);

  async function expectDirectPermitDetailsLocked(
    paymentStatus: 'unpaid' | 'pending' | 'inactive' | 'unavailable',
  ) {
    const unavailable = paymentStatus === 'unavailable';
    const response = await page.request.get(
      `${origin}/api/permits/${encodeURIComponent(permit.id)}`,
    );
    expect(response.status()).toBe(unavailable ? 503 : 402);
    const body = (await response.json()) as { error?: string; paymentStatus?: string };
    expect(body).toMatchObject({
      error: unavailable ? 'billing_status_unavailable' : 'team_subscription_required',
      paymentStatus,
    });
    const serializedBody = JSON.stringify(body);
    for (const privateValue of [permit.projectName, permit.address, permit.permitNumber]) {
      expect(serializedBody).not.toContain(privateValue);
    }

    const summaryPdf = await page.request.get(
      `${origin}/api/permits/${encodeURIComponent(permit.id)}/summary-pdf`,
    );
    expect(summaryPdf.status()).toBe(unavailable ? 503 : 402);
    expect(await summaryPdf.json()).toMatchObject({
      error: unavailable ? 'billing_status_unavailable' : 'team_subscription_required',
      paymentStatus,
    });

    await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
    await expect(page.getByRole('heading', { name: 'Permit unavailable' })).toBeVisible();
    for (const privateValue of [permit.projectName, permit.address, permit.permitNumber]) {
      await expect(page.getByText(privateValue, { exact: true })).toHaveCount(0);
    }
    await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(teamId)}`);
  }

  await expectDirectPermitDetailsLocked('unpaid');

  const unpaidPermitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(unpaidPermitList.status()).toBe(402);
  expect((await unpaidPermitList.json()).paymentStatus).toBe('unpaid');
  const unpaidStatusCounts = await page.request.get(
    `${origin}/api/permit-status-counts?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(unpaidStatusCounts.status()).toBe(402);
  expect((await unpaidStatusCounts.json()).items).toBeUndefined();

  const unpaidSearch = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}&search=QA-UNPAID-100`,
  );
  expect(unpaidSearch.status()).toBe(402);
  const unpaidSearchBody = (await unpaidSearch.json()) as {
    paymentStatus?: string;
    items?: unknown[];
  };
  expect(unpaidSearchBody.paymentStatus).toBe('unpaid');
  expect(unpaidSearchBody.items).toBeUndefined();
  await expect(page.getByRole('searchbox', { name: 'Search permits' })).toHaveCount(0);
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 402);

  await expectHostedCheckout(page, origin, team.id);

  const pendingCheckout = await prisma.teamCheckout.findFirst({ where: { teamId: team.id } });
  expect(pendingCheckout?.stripeSessionId).toBeTruthy();
  if (!pendingCheckout?.stripeSessionId) throw new Error('Hosted checkout did not save a session.');
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.permitNumber], 402);
  await expectDirectPermitDetailsLocked('pending');
  const updateBody = {
    teamId: team.id,
    permitNumber: 'QA-UNLOCKED-ONLY-AFTER-ACTIVE',
    address: '12 QA Subscription Lane, Tampa',
  };
  const pendingEdit = await page.request.patch(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}/details`,
    { headers: { origin }, data: updateBody },
  );
  expect(pendingEdit.status()).toBe(402);
  expect(await pendingEdit.json()).toMatchObject({ paymentStatus: 'pending' });

  await setCheckoutGrossAmount(pendingCheckout.stripeSessionId, 298);
  const mismatchedGrossVerification = await page.request.post(
    `${origin}/api/team-checkout/verify`,
    {
      headers: { origin },
      data: { session_id: pendingCheckout.stripeSessionId },
    },
  );
  expect(mismatchedGrossVerification.status()).toBe(409);
  expect(await mismatchedGrossVerification.json()).toMatchObject({
    verified: false,
    error: 'payment_amount_unverified',
  });
  const mismatchedCheckout = await prisma.teamCheckout.findUniqueOrThrow({
    where: { id: pendingCheckout.id },
  });
  expect(mismatchedCheckout).toMatchObject({
    status: 'pending',
    grossAmountUsd: null,
    verifiedAt: null,
  });
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 402);

  await setCheckoutGrossAmount(pendingCheckout.stripeSessionId, 299);
  await setCheckoutCustomerEmail(pendingCheckout.stripeSessionId, 'different-purchaser@example.test');

  const mismatchedPurchaserVerification = await page.request.post(
    `${origin}/api/team-checkout/verify`,
    {
      headers: { origin },
      data: { session_id: pendingCheckout.stripeSessionId },
    },
  );
  expect(mismatchedPurchaserVerification.status()).toBe(403);
  expect(await mismatchedPurchaserVerification.json()).toMatchObject({
    verified: false,
    error: 'purchaser_email_mismatch',
  });
  const mismatchedPurchaserCheckout = await prisma.teamCheckout.findUniqueOrThrow({
    where: { id: pendingCheckout.id },
  });
  expect(mismatchedPurchaserCheckout).toMatchObject({
    status: 'pending',
    grossAmountUsd: null,
    verifiedAt: null,
  });
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 402);

  await setCheckoutCustomerEmail(pendingCheckout.stripeSessionId, email);

  const completedCheckout = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: pendingCheckout.stripeSessionId },
  });
  expect(completedCheckout.status()).toBe(200);
  expect(await completedCheckout.json()).toMatchObject({
    verified: false,
    reason: 'subscription_inactive',
  });
  const paymentOnlyCheckout = await prisma.teamCheckout.findUniqueOrThrow({
    where: { id: pendingCheckout.id },
  });
  expect(paymentOnlyCheckout).toMatchObject({ status: 'pending', verifiedAt: null });
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 402);
  await expectDirectPermitDetailsLocked('pending');

  await setSubscriptionState(email, true);
  const activeCheckoutVerification = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: pendingCheckout.stripeSessionId },
  });
  expect(activeCheckoutVerification.status(), await activeCheckoutVerification.text()).toBe(200);
  expect(await activeCheckoutVerification.json()).toMatchObject({ verified: true });
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(0);

  await setSubscriptionState(email, false, 'canceled');
  const verifiedButInactiveEdit = await page.request.patch(
    `${origin}/api/permits/${encodeURIComponent(permit.id)}/details`,
    { headers: { origin }, data: updateBody },
  );
  expect(verifiedButInactiveEdit.status()).toBe(402);
  expect(await verifiedButInactiveEdit.json()).toMatchObject({ paymentStatus: 'inactive' });
  const verifiedButInactiveList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(verifiedButInactiveList.status()).toBe(402);
  const verifiedButInactiveListBody = (await verifiedButInactiveList.json()) as {
    paymentStatus?: string;
    items?: unknown[];
  };
  expect(verifiedButInactiveListBody.paymentStatus).toBe('inactive');
  expect(verifiedButInactiveListBody.items).toBeUndefined();
  const verifiedButInactiveCounts = await page.request.get(
    `${origin}/api/permit-status-counts?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(verifiedButInactiveCounts.status()).toBe(402);
  expect((await verifiedButInactiveCounts.json()).items).toBeUndefined();
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.permitNumber], 402);
  expect((await prisma.permit.findUnique({ where: { id: permit.id } }))?.permitNumber).toBe(
    'QA-UNPAID-100',
  );
  await expectDirectPermitDetailsLocked('inactive');
  await setSubscriptionState(email, 'unavailable');
  await expectDirectPermitDetailsLocked('unavailable');
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 503);

  await setSubscriptionState(email, false, 'canceled');
  await expectDirectPermitDetailsLocked('inactive');
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.permitNumber], 402);

  const verifiedCheckout = await prisma.teamCheckout.findFirstOrThrow({
    where: { teamId: team.id, status: 'verified' },
  });
  await prisma.teamCheckout.update({
    where: { id: verifiedCheckout.id },
    data: { status: 'failed', grossAmountUsd: null, verifiedAt: null },
  });
  await expectDirectPermitDetailsLocked('unpaid');
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 402);

  await prisma.teamCheckout.update({
    where: { id: verifiedCheckout.id },
    data: { status: 'unverified', grossAmountUsd: 299, verifiedAt: null },
  });
  await expectDirectPermitDetailsLocked('unpaid');
  await expectPermitExportLocked(page, origin, team.id, [permit.projectName, permit.address], 402);

  await setSubscriptionState(email, true);
  const restoredVerification = await page.request.post(`${origin}/api/team-checkout/verify`, {
    headers: { origin },
    data: { session_id: pendingCheckout.stripeSessionId },
  });
  expect(restoredVerification.status(), await restoredVerification.text()).toBe(200);
  expect(await restoredVerification.json()).toMatchObject({ verified: true });
  const activePermitList = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(team.id)}`,
  );
  expect(activePermitList.status(), await activePermitList.text()).toBe(200);
  const activePermitListBody = (await activePermitList.json()) as {
    items: { id: string; permitNumber: string }[];
  };
  expect(activePermitListBody.items.map((item) => item.id)).toContain(permit.id);
  const activeExport = await requestPermitExport(page, origin, team.id);
  expect(activeExport.status(), await activeExport.text()).toBe(200);
  const activeExportBody = (await activeExport.json()) as {
    ok?: boolean;
    data?: { csv?: string; records?: number };
  };
  expect(activeExportBody.ok).toBe(true);
  expect(activeExportBody.data?.records).toBe(1);
  expect(activeExportBody.data?.csv).toContain(permit.projectName);
  expect(activeExportBody.data?.csv).toContain(permit.permitNumber);

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('searchbox', { name: 'Search permits' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort permits' })).toHaveValue('activity');
  await expect(page.getByRole('heading', { name: 'QA Unpaid Saved Permit' })).toBeVisible();

  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(permit.id)}`);
  await expect(page.getByRole('button', { name: 'Edit permit details' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit permit details' }).click();
  await page.getByRole('textbox', { name: 'Permit reference' }).fill('QA-UPDATED-100');
  await page.getByRole('textbox', { name: 'Job address' }).fill('12 QA Subscription Lane, Tampa');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('QA-UPDATED-100', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: '12 QA Subscription Lane, Tampa' }),
  ).toBeVisible();

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(team.id)}`);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('permits.csv');
  await expect(page.getByText('1 records exported.', { exact: true })).toBeVisible();

  await captureWorkspace(page, testInfo, 'verified-team-export');
});

test("a paid account cannot retrieve another team's permit by ID or direct detail URL", async (
  { browser, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const createPaidAccount = async (teamName: string, permitNumber: string) => {
    const context = await browser.newContext();
    fixtureContexts.push(context);
    const accountPage = await context.newPage();
    const account = await signUp(accountPage, origin);
    const team = await prisma.teamSpace.create({
      data: {
        name: teamName,
        joinCode: randomBytes(6).toString('hex').toUpperCase(),
        createdByUserId: account.userId,
      },
    });
    fixtureTeamIds.push(team.id);
    await prisma.teamMembership.create({
      data: { teamId: team.id, userId: account.userId, role: 'owner' },
    });
    await prisma.teamCheckout.create({
      data: {
        teamId: team.id,
        userId: account.userId,
        status: 'verified',
        grossAmountUsd: 299,
        verifiedAt: new Date(),
      },
    });
    await setSubscriptionState(account.email, true);
    const permit = await prisma.permit.create({
      data: {
        userId: account.userId,
        teamId: team.id,
        projectName: `${teamName} permit`,
        address: '21 QA Access Lane, Tampa',
        permitNumber,
        permitType: 'Building',
        status: 'Planning',
        notes: '',
      },
    });
    return { accountPage, permit };
  };

  const owner = await createPaidAccount('QA Private Permit Owner Team', 'QA-PRIVATE-OWNER-100');
  const unrelated = await createPaidAccount('QA Unrelated Paid Team', 'QA-UNRELATED-200');

  const ownPermitResponse = await unrelated.accountPage.request.get(
    `${origin}/api/permits/${encodeURIComponent(unrelated.permit.id)}`,
  );
  expect(ownPermitResponse.status(), await ownPermitResponse.text()).toBe(200);
  const ownPermitBody = (await ownPermitResponse.json()) as {
    projectName?: string;
    permitNumber?: string;
  };
  expect(ownPermitBody).toMatchObject({
    projectName: 'QA Unrelated Paid Team permit',
    permitNumber: 'QA-UNRELATED-200',
  });

  const otherPermitResponse = await unrelated.accountPage.request.get(
    `${origin}/api/permits/${encodeURIComponent(owner.permit.id)}`,
  );
  expect(otherPermitResponse.status()).toBe(403);
  const otherPermitBody = await otherPermitResponse.json();
  expect(otherPermitBody).toMatchObject({ error: 'team_membership_required' });
  const serializedOtherPermitBody = JSON.stringify(otherPermitBody);
  for (const privateValue of [owner.permit.projectName, owner.permit.address, owner.permit.permitNumber]) {
    expect(serializedOtherPermitBody).not.toContain(privateValue);
  }

  await unrelated.accountPage.goto(
    `${origin}/dashboard/permits/${encodeURIComponent(owner.permit.id)}`,
  );
  await expect(unrelated.accountPage.getByRole('heading', { name: 'Permit unavailable' })).toBeVisible();
  for (const privateValue of [owner.permit.projectName, owner.permit.address, owner.permit.permitNumber]) {
    await expect(unrelated.accountPage.getByText(privateValue, { exact: true })).toHaveCount(0);
  }
  await captureWorkspace(unrelated.accountPage, testInfo, 'unrelated-paid-account-permit-denied');
});

test('team dashboard counts and status links use only the selected team saved statuses', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const { userId, email } = await signUp(page, origin);
  expect(email.toLowerCase()).not.toBe(process.env.POLSIA_OWNER_EMAIL?.toLowerCase());

  const createPaidTeam = async (name: string) => {
    const team = await prisma.teamSpace.create({
      data: {
        name,
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
    return team;
  };

  const selectedTeam = await createPaidTeam('QA Selected Status Team');
  const otherTeam = await createPaidTeam('QA Other Status Team');
  const primaryPermits = new Map<string, string>();
  for (const status of PermitStatus.options) {
    if (status === 'Issued') continue;
    const permit = await prisma.permit.create({
      data: {
        userId,
        teamId: selectedTeam.id,
        projectName: `QA ${status} Permit`,
        address: '11 QA Team Status Lane, Tampa',
        permitNumber: `QA-${randomUUID().slice(0, 8)}`,
        permitType: 'Building',
        status,
      },
    });
    primaryPermits.set(status, permit.id);
  }
  for (const status of ['Planning', 'Issued'] as const) {
    await prisma.permit.create({
      data: {
        userId,
        teamId: otherTeam.id,
        projectName: `QA Other Team ${status} Permit`,
        address: '22 QA Other Team Lane, Tampa',
        permitNumber: `QA-${randomUUID().slice(0, 8)}`,
        permitType: 'Building',
        status,
      },
    });
  }
  await prisma.permit.create({
    data: {
      userId,
      teamId: selectedTeam.id,
      projectName: 'QA Archived Issued Permit',
      address: '33 QA Archived Status Lane, Tampa',
      permitNumber: 'QA-ARCHIVED-ISSUED',
      permitType: 'Building',
      status: 'Issued',
      archivedAt: new Date(),
    },
  });
  await setSubscriptionState(email, true);

  const countsResponse = await page.request.get(
    `${origin}/api/permit-status-counts?teamId=${encodeURIComponent(selectedTeam.id)}`,
  );
  expect(countsResponse.status(), await countsResponse.text()).toBe(200);
  const countsBody = (await countsResponse.json()) as {
    teamId: string;
    items: { status: string; count: number }[];
  };
  expect(countsBody.teamId).toBe(selectedTeam.id);
  expect(countsBody.items).toEqual([
    { status: 'Planning', count: 1 },
    { status: 'Ready to submit', count: 1 },
    { status: 'Submitted', count: 1 },
    { status: 'Under review', count: 1 },
    { status: 'Corrections requested', count: 1 },
    { status: 'Issued', count: 0 },
  ]);

  const filteredPlanning = await page.request.get(
    `${origin}/api/permits?teamId=${encodeURIComponent(selectedTeam.id)}&status=Planning`,
  );
  expect(filteredPlanning.status()).toBe(200);
  const filteredPlanningBody = (await filteredPlanning.json()) as {
    items: { id: string; teamId: string; status: string }[];
  };
  expect(
    filteredPlanningBody.items.map((item) => ({ id: item.id, teamId: item.teamId, status: item.status })),
  ).toEqual([
    { id: primaryPermits.get('Planning'), teamId: selectedTeam.id, status: 'Planning' },
  ]);

  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  for (const route of ['permit-status-counts', 'permits']) {
    const anonymousResponse = await anonymousContext.request.get(
      `${origin}/api/${route}?teamId=${encodeURIComponent(selectedTeam.id)}`,
    );
    expect(anonymousResponse.status()).toBe(401);
    expect((await anonymousResponse.json()).items).toBeUndefined();
  }

  const nonmemberContext = await browser.newContext();
  fixtureContexts.push(nonmemberContext);
  const nonmemberPage = await nonmemberContext.newPage();
  const projectManager = await signUp(nonmemberPage, origin);
  for (const route of ['permit-status-counts', 'permits']) {
    const nonmemberResponse = await nonmemberPage.request.get(
      `${origin}/api/${route}?teamId=${encodeURIComponent(selectedTeam.id)}`,
    );
    expect(nonmemberResponse.status()).toBe(403);
    expect((await nonmemberResponse.json()).items).toBeUndefined();
  }

  await page.goto(`${origin}/dashboard?teamId=${encodeURIComponent(selectedTeam.id)}`);
  await expect(page.getByRole('heading', { name: selectedTeam.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active permits by saved status' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View 0 Issued permits' })).toBeVisible();

  await page.getByRole('button', { name: /QA Other Status Team/ }).click();
  await expect(page.getByRole('heading', { name: otherTeam.name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View 1 Issued permit' })).toBeVisible();
  await page.getByRole('button', { name: /QA Selected Status Team/ }).click();
  await expect(page.getByRole('link', { name: 'View 0 Issued permits' })).toBeVisible();

  const correctionsLink = page.getByRole('link', {
    name: 'View 1 Corrections requested permit',
  });
  const correctionsHref = await correctionsLink.getAttribute('href');
  expect(correctionsHref).not.toBeNull();
  const correctionsUrl = new URL(correctionsHref ?? '', origin);
  expect(correctionsUrl.searchParams.get('teamId')).toBe(selectedTeam.id);
  expect(correctionsUrl.searchParams.get('status')).toBe('Corrections requested');
  await correctionsLink.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/dashboard' &&
      url.searchParams.get('teamId') === selectedTeam.id &&
      url.searchParams.get('status') === 'Corrections requested',
  );
  await expect(page.getByRole('heading', { name: selectedTeam.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Corrections requested Permit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA Other Team Planning Permit' })).toHaveCount(0);

  const permitCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'QA Corrections requested Permit' }),
  });
  await permitCard.getByRole('button', { name: 'Edit', exact: true }).click();
  await permitCard.getByLabel('Current status').selectOption('Issued');
  await permitCard.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('link', { name: 'View 0 Corrections requested permits' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View 1 Issued permit' })).toBeVisible();
  const correctionsPermitId = primaryPermits.get('Corrections requested');
  if (!correctionsPermitId) throw new Error('The selected team status fixture was not created.');
  expect((await prisma.permit.findUnique({ where: { id: correctionsPermitId } }))?.status).toBe(
    'Issued',
  );

  await prisma.teamMembership.create({
    data: { teamId: selectedTeam.id, userId: projectManager.userId, role: 'project_manager' },
  });
  await prisma.permit.update({
    where: { id: correctionsPermitId },
    data: { assignedProjectManagerUserId: projectManager.userId },
  });

  await nonmemberPage.goto(`${origin}/dashboard?teamId=${encodeURIComponent(selectedTeam.id)}`);
  await expect(nonmemberPage.getByRole('heading', { name: selectedTeam.name })).toBeVisible();
  await nonmemberPage.getByRole('button', { name: 'Archived', exact: true }).click();
  await nonmemberPage.getByRole('searchbox', { name: 'Search permits' }).fill('QA-ARCHIVED-ISSUED');
  await nonmemberPage.getByRole('button', { name: 'Assigned to me' }).click();
  await nonmemberPage.getByRole('button', { name: 'Interrupted monitoring' }).click();
  await expect(nonmemberPage.getByRole('heading', { name: 'QA Archived Issued Permit' })).toHaveCount(0);

  const issuedCountLink = nonmemberPage.getByRole('link', { name: 'View 1 Issued permit' });
  const issuedListResponse = nonmemberPage.waitForResponse((response) => {
    const url = new URL(response.url());
    const query = url.searchParams;
    return (
      url.pathname === '/api/permits' &&
      query.get('teamId') === selectedTeam.id &&
      query.get('view') === 'active' &&
      query.get('status') === 'Issued' &&
      !query.has('search') &&
      !query.has('assignedToMe') &&
      !query.has('interruptedMonitoring')
    );
  });
  await issuedCountLink.click();
  const issuedList = await issuedListResponse;
  expect(issuedList.status()).toBe(200);
  await expect(nonmemberPage).toHaveURL(
    (url) =>
      url.pathname === '/dashboard' &&
      url.searchParams.get('teamId') === selectedTeam.id &&
      url.searchParams.get('status') === 'Issued',
  );
  await expect(nonmemberPage.getByRole('heading', { name: 'QA Corrections requested Permit' })).toBeVisible();
  await expect(nonmemberPage.getByRole('heading', { name: 'QA Archived Issued Permit' })).toHaveCount(0);

  await page.getByRole('link', { name: 'View 1 Issued permit' }).click();
  await expect(page.getByRole('heading', { name: 'QA Corrections requested Permit' })).toBeVisible();
  await expect(page.getByText('Showing active permits with saved status Issued.')).toBeVisible();
  await captureWorkspace(page, testInfo, 'team-status-summary');

  await page.setViewportSize({ width: 390, height: 844 });
  const statusSummary = page.getByRole('region', { name: 'Active permits by saved status' });
  await statusSummary.scrollIntoViewIfNeeded();
  await expect(statusSummary).toBeInViewport({ ratio: 1 });
  for (const countLink of [
    'View 1 Planning permit',
    'View 1 Ready to submit permit',
    'View 1 Submitted permit',
    'View 1 Under review permit',
    'View 0 Corrections requested permits',
    'View 1 Issued permit',
  ]) {
    await expect(statusSummary.getByRole('link', { name: countLink })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('team-status-summary-viewport-390.png') });

  const unavailableContext = await browser.newContext();
  fixtureContexts.push(unavailableContext);
  const unavailablePage = await unavailableContext.newPage();
  const unavailableUser = await signUp(unavailablePage, origin);
  const unavailableTeam = await prisma.teamSpace.create({
    data: {
      name: 'QA Unavailable Status Team',
      joinCode: randomBytes(6).toString('hex').toUpperCase(),
      createdByUserId: unavailableUser.userId,
    },
  });
  fixtureTeamIds.push(unavailableTeam.id);
  await prisma.teamMembership.create({
    data: { teamId: unavailableTeam.id, userId: unavailableUser.userId, role: 'owner' },
  });
  await prisma.teamCheckout.create({
    data: {
      teamId: unavailableTeam.id,
      userId: unavailableUser.userId,
      status: 'verified',
      grossAmountUsd: 299,
      verifiedAt: new Date(),
    },
  });
  await setSubscriptionState(unavailableUser.email, 'unavailable');
  for (const route of ['permit-status-counts', 'permits']) {
    const unavailableResponse = await unavailablePage.request.get(
      `${origin}/api/${route}?teamId=${encodeURIComponent(unavailableTeam.id)}`,
    );
    expect(unavailableResponse.status()).toBe(503);
    expect((await unavailableResponse.json()).items).toBeUndefined();
  }
});

test('permit notes persist for paid team members and stay hidden from every locked or unrelated account', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const createContextUser = async (label: string) => {
    const context = await browser.newContext();
    fixtureContexts.push(context);
    const memberPage = await context.newPage();
    const account = await signUp(memberPage, origin);
    return { context, page: memberPage, ...account, label };
  };
  const createTeamPermit = async (
    account: { userId: string; email: string },
    name: string,
    checkoutStatus: 'unpaid' | 'pending' | 'unverified' | 'verified',
    subscriptionActive = false,
  ) => {
    const team = await prisma.teamSpace.create({
      data: {
        name,
        joinCode: randomBytes(6).toString('hex').toUpperCase(),
        createdByUserId: account.userId,
      },
    });
    fixtureTeamIds.push(team.id);
    await prisma.teamMembership.create({
      data: { teamId: team.id, userId: account.userId, role: 'owner' },
    });
    if (checkoutStatus !== 'unpaid') {
      await prisma.teamCheckout.create({
        data: {
          teamId: team.id,
          userId: account.userId,
          status: checkoutStatus,
          grossAmountUsd:
            checkoutStatus === 'verified' || checkoutStatus === 'unverified' ? 299 : null,
          verifiedAt: checkoutStatus === 'verified' ? new Date() : null,
        },
      });
    }
    const permit = await prisma.permit.create({
      data: {
        userId: account.userId,
        teamId: team.id,
        projectName: `${name} permit`,
        address: '21 QA Note Lane, Tampa',
        permitNumber: `QA-${name.replaceAll(' ', '-').toUpperCase()}`,
        permitType: 'Building',
        status: 'Under review',
        notes: '',
      },
    });
    if (checkoutStatus === 'verified') await setSubscriptionState(account.email, subscriptionActive);
    return { team, permit };
  };

  const owner = await signUp(page, origin);
  const teammate = await createContextUser('paid-teammate');
  const outsider = await createContextUser('other-paid-team');
  const inactive = await createContextUser('verified-inactive');
  const pending = await createContextUser('pending-checkout');
  const unverified = await createContextUser('unverified-checkout');
  const unpaid = await createContextUser('unpaid-team');
  const anonymousContext = await browser.newContext();
  fixtureContexts.push(anonymousContext);
  const anonymousPage = await anonymousContext.newPage();

  const main = await createTeamPermit(owner, 'QA Paid Notes Team', 'verified', true);
  await prisma.teamMembership.create({
    data: { teamId: main.team.id, userId: teammate.userId, role: 'project_manager' },
  });
  const other = await createTeamPermit(outsider, 'QA Separate Notes Team', 'verified', true);
  const inactiveTeam = await createTeamPermit(
    inactive,
    'QA Inactive Notes Team',
    'verified',
    false,
  );
  const pendingTeam = await createTeamPermit(pending, 'QA Pending Notes Team', 'pending');
  const unverifiedTeam = await createTeamPermit(
    unverified,
    'QA Unverified Notes Team',
    'unverified',
  );
  const unpaidTeam = await createTeamPermit(unpaid, 'QA Unpaid Notes Team', 'unpaid');
  const watchedRecipients = [owner.email, teammate.email];
  const emailBaseline = await emailSendCountFor(watchedRecipients);

  const permitListUrl = (teamId: string) =>
    `${origin}/api/permits?teamId=${encodeURIComponent(teamId)}`;
  const expectLockedPermitList = async (
    listPage: Page,
    teamId: string,
    status: number,
    paymentStatus?: string,
  ) => {
    const response = await listPage.request.get(permitListUrl(teamId));
    expect(response.status()).toBe(status);
    const body = (await response.json()) as {
      error?: string;
      paymentStatus?: string;
      items?: unknown[];
    };
    if (paymentStatus) expect(body.paymentStatus).toBe(paymentStatus);
    expect(body.items).toBeUndefined();
    return body;
  };

  await expectLockedPermitList(anonymousPage, main.team.id, 401);
  await expectLockedPermitList(unpaid.page, unpaidTeam.team.id, 402, 'unpaid');
  await expectLockedPermitList(pending.page, pendingTeam.team.id, 402, 'pending');
  const unverifiedCheckout = await prisma.teamCheckout.findFirstOrThrow({
    where: { teamId: unverifiedTeam.team.id, status: 'unverified' },
  });
  expect(unverifiedCheckout).toMatchObject({
    teamId: unverifiedTeam.team.id,
    userId: unverified.userId,
    status: 'unverified',
    grossAmountUsd: 299,
    verifiedAt: null,
  });
  await expectLockedPermitList(unverified.page, unverifiedTeam.team.id, 402, 'unpaid');
  await expectLockedPermitList(inactive.page, inactiveTeam.team.id, 402, 'inactive');
  expect((await expectLockedPermitList(outsider.page, main.team.id, 403)).error).toBe(
    'team_membership_required',
  );

  for (const memberPage of [page, teammate.page]) {
    const response = await memberPage.request.get(permitListUrl(main.team.id));
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([main.permit.id]);
  }

  const notesUrl = (permitId: string) => `${origin}/api/permits/${encodeURIComponent(permitId)}/notes`;
  const anonymousRead = await anonymousPage.request.get(notesUrl(main.permit.id));
  expect(anonymousRead.status()).toBe(401);
  const anonymousWrite = await anonymousPage.request.post(notesUrl(main.permit.id), {
    headers: { origin },
    data: { body: 'Must remain private.' },
  });
  expect(anonymousWrite.status()).toBe(401);

  const unpaidRead = await unpaid.page.request.get(notesUrl(unpaidTeam.permit.id));
  expect(unpaidRead.status()).toBe(402);
  expect((await unpaidRead.json()).paymentStatus).toBe('unpaid');
  const unpaidWrite = await unpaid.page.request.post(notesUrl(unpaidTeam.permit.id), {
    headers: { origin },
    data: { body: 'Must remain locked.' },
  });
  expect(unpaidWrite.status()).toBe(402);
  expect(await prisma.permitTeamNote.count({ where: { permitId: unpaidTeam.permit.id } })).toBe(0);

  const pendingRead = await pending.page.request.get(notesUrl(pendingTeam.permit.id));
  expect(pendingRead.status()).toBe(402);
  expect((await pendingRead.json()).paymentStatus).toBe('pending');
  const pendingWrite = await pending.page.request.post(notesUrl(pendingTeam.permit.id), {
    headers: { origin },
    data: { body: 'Must remain locked.' },
  });
  expect(pendingWrite.status()).toBe(402);

  const inactiveRead = await inactive.page.request.get(notesUrl(inactiveTeam.permit.id));
  expect(inactiveRead.status()).toBe(402);
  expect((await inactiveRead.json()).paymentStatus).toBe('inactive');
  const inactiveWrite = await inactive.page.request.post(notesUrl(inactiveTeam.permit.id), {
    headers: { origin },
    data: { body: 'Must remain locked.' },
  });
  expect(inactiveWrite.status()).toBe(402);

  const nonmemberRead = await outsider.page.request.get(notesUrl(main.permit.id));
  expect(nonmemberRead.status()).toBe(403);
  const nonmemberBody = await nonmemberRead.json();
  expect(nonmemberBody).toMatchObject({ error: 'team_membership_required' });
  expect(nonmemberBody.items).toBeUndefined();
  const nonmemberWrite = await outsider.page.request.post(notesUrl(main.permit.id), {
    headers: { origin },
    data: { body: 'Must stay private.' },
  });
  expect(nonmemberWrite.status()).toBe(403);

  await page.goto(`${origin}/dashboard/permits/${encodeURIComponent(main.permit.id)}`);
  await expect(page.getByRole('heading', { name: 'Internal team notes' })).toBeVisible();
  await expect(page.getByText('No internal notes yet.')).toBeVisible();
  await page
    .getByLabel('Write an internal note')
    .fill('Confirm the correction letter with the City counter.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(
    page.getByRole('listitem').filter({
      hasText: 'Confirm the correction letter with the City counter.',
    }),
  ).toBeVisible();
  const firstSavedRows = await prisma.permitTeamNote.findMany({
    where: { permitId: main.permit.id },
  });
  expect(firstSavedRows.map((note) => ({ teamId: note.teamId, body: note.body }))).toEqual([
    { teamId: main.team.id, body: 'Confirm the correction letter with the City counter.' },
  ]);
  const firstSavedNote = await page.request.get(notesUrl(main.permit.id));
  expect(firstSavedNote.status()).toBe(200);
  expect(await firstSavedNote.json()).toMatchObject({
    items: [{ body: 'Confirm the correction letter with the City counter.' }],
  });
  expect(await prisma.permitTeamNote.count({ where: { permitId: main.permit.id } })).toBe(1);
  await page.reload();
  await expect(page.getByText('Confirm the correction letter with the City counter.')).toBeVisible();

  await teammate.page.goto(`${origin}/dashboard/permits/${encodeURIComponent(main.permit.id)}`);
  await expect(
    teammate.page.getByText('Confirm the correction letter with the City counter.'),
  ).toBeVisible();
  await teammate.page
    .getByLabel('Write an internal note')
    .fill('The crew lead has the updated plan set.');
  await teammate.page.getByRole('button', { name: 'Add note' }).click();
  await expect(
    teammate.page
      .getByRole('listitem')
      .filter({ hasText: 'The crew lead has the updated plan set.' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('The crew lead has the updated plan set.')).toBeVisible();

  const savedNotes = await page.request.get(notesUrl(main.permit.id));
  expect(savedNotes.status()).toBe(200);
  expect(await savedNotes.json()).toMatchObject({
    items: [
      { body: 'Confirm the correction letter with the City counter.', authorName: 'QA Team Member' },
      { body: 'The crew lead has the updated plan set.', authorName: 'QA Team Member' },
    ],
  });

  const savedNoteBodies = [
    'Confirm the correction letter with the City counter.',
    'The crew lead has the updated plan set.',
  ];
  const deniedCallers = [
    { label: 'anonymous', request: anonymousPage.request, status: 401 },
    { label: 'unpaid', request: unpaid.page.request, status: 403 },
    { label: 'pending', request: pending.page.request, status: 403 },
    { label: 'verified but inactive', request: inactive.page.request, status: 403 },
    { label: 'paid nonmember', request: outsider.page.request, status: 403 },
  ];
  for (const caller of deniedCallers) {
    const deniedRead = await caller.request.get(notesUrl(main.permit.id));
    expect(deniedRead.status(), `${caller.label} read`).toBe(caller.status);
    const deniedReadBody = await deniedRead.text();
    for (const noteBody of savedNoteBodies) {
      expect(deniedReadBody, `${caller.label} received a saved note`).not.toContain(noteBody);
    }

    const deniedWrite = await caller.request.post(notesUrl(main.permit.id), {
      headers: { origin },
      data: { body: `Unauthorized attempt from ${caller.label}.` },
    });
    expect(deniedWrite.status(), `${caller.label} write`).toBe(caller.status);
  }

  const notesAfterDeniedWrites = await prisma.permitTeamNote.findMany({
    where: { permitId: main.permit.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { teamId: true, body: true },
  });
  expect(notesAfterDeniedWrites).toEqual(
    savedNoteBodies.map((body) => ({ teamId: main.team.id, body })),
  );
  const paidMemberReadAfterDeniedWrites = await page.request.get(notesUrl(main.permit.id));
  expect(paidMemberReadAfterDeniedWrites.status()).toBe(200);
  expect(await paidMemberReadAfterDeniedWrites.json()).toMatchObject({
    items: savedNoteBodies.map((body) => ({ body })),
  });

  expect(await prisma.permitTeamNote.count({ where: { permitId: main.permit.id } })).toBe(2);
  expect(await prisma.permitTeamNote.count({ where: { permitId: other.permit.id } })).toBe(0);
  expect(await emailSendCountFor(watchedRecipients)).toBe(emailBaseline);
  await expect(
    page.getByText('Shared only with members who have active paid access to this team. Notes do not send notifications.'),
  ).toBeVisible();

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole('heading', { name: 'Internal team notes' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`permit-team-notes-${viewport.name}.png`),
      fullPage: true,
    });
  }
});

test('an unpaid account with no membership can join an existing team and reach hosted checkout', async (
  { browser, page, baseURL },
  testInfo,
) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const ownerContext = await browser.newContext();
  fixtureContexts.push(ownerContext);
  const ownerPage = await ownerContext.newPage();
  const owner = await signUp(ownerPage, origin);
  const createTeam = await ownerPage.request.post(`${origin}/api/teams`, {
    headers: { origin },
    data: { action: 'create', name: 'QA Existing Remodel Team' },
  });
  expect(createTeam.status(), await createTeam.text()).toBe(201);
  const team = await prisma.teamSpace.findFirst({
    where: { createdByUserId: owner.userId, name: 'QA Existing Remodel Team' },
  });
  expect(team).not.toBeNull();
  if (!team) throw new Error('The existing team fixture was not created.');
  fixtureTeamIds.push(team.id);

  const member = await signUp(page, origin);
  expect(await prisma.teamMembership.count({ where: { userId: member.userId } })).toBe(0);
  expect(await prisma.teamSpace.count({ where: { createdByUserId: member.userId } })).toBe(0);

  await continueFromPricing(page, origin);
  await expect(page.getByLabel('Team invite code')).toBeVisible();
  await page.getByLabel('Team invite code').fill(team.joinCode);
  await page.getByRole('button', { name: 'Join team' }).click();
  await expect(page.getByText('You joined the team with purchaser access.')).toBeVisible();

  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: team.id, userId: member.userId } },
  });
  expect(membership?.role).toBe('purchaser');

  await expectHostedCheckout(page, origin, team.id);
  await captureWorkspace(page, testInfo, 'unpaid-team-joined');
});
