// @polsia:user-owned — only a verified hosted checkout may mark team payment verified.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sameOrigin: vi.fn(),
  findCheckout: vi.fn(),
  findMembership: vi.fn(),
  updateCheckout: vi.fn(),
  verifyCheckoutSession: vi.fn(),
  getSubscriptionStatus: vi.fn(),
  StripeBillingOnboardingError: class StripeBillingOnboardingError extends Error {
    readonly code: 'stripe_not_configured' | 'stripe_not_onboarded';

    constructor(code: 'stripe_not_configured' | 'stripe_not_onboarded') {
      super(
        code === 'stripe_not_onboarded'
          ? 'Stripe onboarding is incomplete for this business.'
          : 'Stripe is not configured for this business.',
      );
      this.code = code;
    }
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    teamCheckout: {
      findFirst: mocks.findCheckout,
      update: mocks.updateCheckout,
    },
    teamMembership: { findUnique: mocks.findMembership },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/stripe-billing/client', () => ({
  verifyCheckoutSession: mocks.verifyCheckoutSession,
  getSubscriptionStatus: mocks.getSubscriptionStatus,
  StripeBillingConfigurationError: class StripeBillingConfigurationError extends Error {},
  StripeBillingNotEnabledError: class StripeBillingNotEnabledError extends Error {},
  StripeBillingOnboardingError: mocks.StripeBillingOnboardingError,
  StripeBillingProductIdentityUnavailableError: class StripeBillingProductIdentityUnavailableError extends Error {},
}));

import { POST } from '@/app/api/team-checkout/verify/route';
import { TEAM_ACCESS_PRODUCT_KEY } from '@/lib/business/team-billing';
import { StripeBillingOnboardingError } from '@/lib/stripe-billing/client';

function verifiedOrder(
  overrides: {
    checkout_id?: string;
    metadata?: Record<string, string>;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
  } = {},
) {
  return {
    checkout_id: overrides.checkout_id ?? 'stripe-checkout-1',
    mode: 'subscription',
    client_reference_id: 'team-1',
    metadata: {
      teamId: 'team-1',
      userId: 'purchaser-1',
      teamCheckoutId: 'checkout-1',
      ...overrides.metadata,
    },
    stripe_customer_id:
      overrides.stripe_customer_id === undefined ? 'cus_123456' : overrides.stripe_customer_id,
    stripe_subscription_id:
      overrides.stripe_subscription_id === undefined
        ? 'sub_123456'
        : overrides.stripe_subscription_id,
    items: [
      {
        position: 0,
        product_key: TEAM_ACCESS_PRODUCT_KEY,
        name: 'DocketKite Team Access',
        quantity: 1,
        unit_amount_minor: 29_900,
        currency: 'usd',
        interval: 'month',
      },
    ],
  };
}

function post(sessionId = 'session-1') {
  return new Request('http://localhost/api/team-checkout/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

function postWithoutSession() {
  return new Request('http://localhost/api/team-checkout/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

function retryByTeam() {
  return new Request('http://localhost/api/team-checkout/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: 'team-1' }),
  });
}

describe('team hosted checkout verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'purchaser-1', email: 'buyer@example.test' });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.findCheckout.mockResolvedValue({
      id: 'checkout-1',
      teamId: 'team-1',
      userId: 'purchaser-1',
      stripeSessionId: 'session-1',
      stripeCheckoutId: 'stripe-checkout-1',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: 'pending',
      verifiedAt: null,
    });
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.updateCheckout.mockResolvedValue({
      id: 'checkout-1',
      teamId: 'team-1',
      userId: 'purchaser-1',
      stripeSessionId: 'session-1',
      stripeCheckoutId: 'stripe-checkout-1',
      stripeCustomerId: 'cus_123456',
      stripeSubscriptionId: 'sub_123456',
      status: 'verified',
      verifiedAt: new Date('2026-11-16T12:00:00.000Z'),
    });
    mocks.getSubscriptionStatus.mockResolvedValue({
      active: true,
      status: 'active',
      monthly_amount: 299,
      customer_email: 'buyer@example.test',
      stripe_customer_id: 'cus_123456',
      product_key: TEAM_ACCESS_PRODUCT_KEY,
      subscriptions: [
        {
          stripe_subscription_id: 'sub_123456',
          status: 'active',
          active: true,
          plan: 'DocketKite Team Access',
          monthly_amount: 299,
          current_period_end: null,
          created_at: '2026-11-16T12:00:00.000Z',
          product_key: TEAM_ACCESS_PRODUCT_KEY,
          checkout_id: 'stripe-checkout-1',
          stripe_customer_id: 'cus_123456',
        },
      ],
    });
  });

  it('leaves pending checkout unverified when the hosted session is incomplete', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({ verified: false, payment: null });

    const response = await POST(post());

    expect(response.status).toBe(409);
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('requires a session id and resolves it only against the signed-in purchaser', async () => {
    expect((await POST(postWithoutSession())).status).toBe(400);
    expect(mocks.findCheckout).not.toHaveBeenCalled();

    mocks.findCheckout.mockResolvedValueOnce(null);
    const missing = await POST(post('missing-session'));

    expect(missing.status).toBe(404);
    expect(mocks.findCheckout).toHaveBeenCalledWith({
      where: { stripeSessionId: 'missing-session', userId: 'purchaser-1' },
    });
    expect(mocks.verifyCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('rejects a saved checkout whose purchaser differs from the signed-in account', async () => {
    mocks.findCheckout.mockResolvedValueOnce({
      id: 'checkout-1',
      teamId: 'team-1',
      userId: 'another-purchaser',
      stripeSessionId: 'session-1',
      stripeCheckoutId: 'stripe-checkout-1',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: 'pending',
      verifiedAt: null,
    });

    const response = await POST(post());

    expect(response.status).toBe(403);
    expect(mocks.verifyCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('leaves pending checkout unverified when the amount or customer identity does not match', async () => {
    mocks.verifyCheckoutSession
      .mockResolvedValueOnce({
        verified: true,
        payment: { gross_amount_usd: 149, customer_email: 'buyer@example.test' },
        order: verifiedOrder(),
      })
      .mockResolvedValueOnce({
        verified: true,
        payment: { gross_amount_usd: 299, customer_email: 'other@example.test' },
        order: verifiedOrder(),
      });

    expect((await POST(post())).status).toBe(409);
    expect((await POST(post())).status).toBe(403);
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('marks the checkout verified only after a matching $299 session is verified', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: {
        amount_usd: 282,
        gross_amount_usd: 299,
        customer_email: 'BUYER@example.test',
      },
      order: verifiedOrder(),
    });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true });
    expect(mocks.updateCheckout).toHaveBeenCalledWith({
      where: { id: 'checkout-1' },
      data: {
        status: 'verified',
        grossAmountUsd: 299,
        verifiedAt: expect.any(Date),
        stripeCheckoutId: 'stripe-checkout-1',
        checkoutItems: verifiedOrder().items,
        stripeCustomerId: 'cus_123456',
        stripeSubscriptionId: 'sub_123456',
      },
    });
    expect(mocks.getSubscriptionStatus).toHaveBeenCalledWith({
      email: 'buyer@example.test',
      stripeCustomerId: 'cus_123456',
      productKey: TEAM_ACCESS_PRODUCT_KEY,
    });
    expect(mocks.findCheckout).toHaveBeenCalledWith({
      where: { stripeSessionId: 'session-1', userId: 'purchaser-1' },
    });
  });

  it('lets the signed-in owner retry the latest saved checkout without exposing its session id', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder(),
    });

    const response = await POST(retryByTeam());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true });
    expect(mocks.findCheckout).toHaveBeenCalledWith({
      where: {
        teamId: 'team-1',
        userId: 'purchaser-1',
        status: { in: ['pending', 'verified'] },
        stripeSessionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(mocks.verifyCheckoutSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('keeps payment-only results pending until Stripe links its subscription, then allows a retry', async () => {
    mocks.verifyCheckoutSession
      .mockResolvedValueOnce({
        verified: true,
        payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
        order: verifiedOrder({ stripe_customer_id: null, stripe_subscription_id: null }),
      })
      .mockResolvedValueOnce({
        verified: true,
        payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
        order: verifiedOrder(),
      });

    const first = await POST(post());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ verified: false, reason: 'subscription_link_pending' });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();

    const retry = await POST(post());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ verified: true });
    expect(mocks.verifyCheckoutSession).toHaveBeenCalledTimes(2);
  });

  it('does not mark a payment verified while its linked subscription is inactive', async () => {
    mocks.getSubscriptionStatus.mockResolvedValue({
      active: false,
      status: 'incomplete',
      subscriptions: [],
    });
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder(),
    });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verified: false,
      reason: 'subscription_inactive',
      subscriptionStatus: 'incomplete',
    });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('keeps the checkout unverified when subscription status verification is unavailable', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder(),
    });
    mocks.getSubscriptionStatus.mockRejectedValue(
      new Error('Polsia billing API request failed: 401 authorization_failed'),
    );

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      verified: false,
      error: 'billing_authorization_unavailable',
      message: expect.stringContaining('HTTP 401: authorization_failed'),
    });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('surfaces incomplete Stripe onboarding as the verification blocker', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder(),
    });
    mocks.getSubscriptionStatus.mockRejectedValue(
      new StripeBillingOnboardingError('stripe_not_onboarded'),
    );

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      verified: false,
      error: 'stripe_not_onboarded',
      message: expect.stringContaining('onboarding'),
    });
  });

  it('does not verify a payment whose stable product or team metadata does not match', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { amount_usd: 282, gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder({ metadata: { teamId: 'another-team' } }),
    });

    const response = await POST(post());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'checkout_identity_unverified' });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('does not attach a different provider checkout to the saved team session', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder({ checkout_id: 'another-stripe-checkout' }),
    });

    const response = await POST(post());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'checkout_identity_unverified' });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('does not verify a checkout with a different product or saved customer identity', async () => {
    mocks.verifyCheckoutSession.mockResolvedValueOnce({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: {
        ...verifiedOrder(),
        items: verifiedOrder().items.map((item) => ({ ...item, product_key: 'another-product' })),
      },
    });

    const wrongProduct = await POST(post());
    expect(wrongProduct.status).toBe(409);
    expect(await wrongProduct.json()).toMatchObject({ error: 'checkout_identity_unverified' });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();

    mocks.findCheckout.mockResolvedValueOnce({
      id: 'checkout-1',
      teamId: 'team-1',
      userId: 'purchaser-1',
      stripeSessionId: 'session-1',
      stripeCheckoutId: 'stripe-checkout-1',
      stripeCustomerId: 'cus_saved',
      stripeSubscriptionId: null,
      status: 'pending',
      verifiedAt: null,
    });
    mocks.verifyCheckoutSession.mockResolvedValueOnce({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder(),
    });

    const wrongCustomer = await POST(post());
    expect(wrongCustomer.status).toBe(409);
    expect(await wrongCustomer.json()).toMatchObject({ error: 'checkout_identity_unverified' });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });

  it('does not verify a subscription linked to a different subscription id', async () => {
    mocks.verifyCheckoutSession.mockResolvedValue({
      verified: true,
      payment: { gross_amount_usd: 299, customer_email: 'buyer@example.test' },
      order: verifiedOrder(),
    });
    mocks.getSubscriptionStatus.mockResolvedValue({
      active: true,
      status: 'active',
      monthly_amount: 299,
      customer_email: 'buyer@example.test',
      stripe_customer_id: 'cus_123456',
      product_key: TEAM_ACCESS_PRODUCT_KEY,
      subscriptions: [
        {
          stripe_subscription_id: 'sub_other',
          status: 'active',
          active: true,
          plan: 'DocketKite Team Access',
          monthly_amount: 299,
          current_period_end: null,
          created_at: '2026-11-16T12:00:00.000Z',
          product_key: TEAM_ACCESS_PRODUCT_KEY,
          checkout_id: 'stripe-checkout-1',
          stripe_customer_id: 'cus_123456',
        },
      ],
    });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      verified: false,
      reason: 'subscription_inactive',
    });
    expect(mocks.updateCheckout).not.toHaveBeenCalled();
  });
});
