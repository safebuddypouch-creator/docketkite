// @polsia:user-owned — authorized first-team hosted checkout route tests.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sameOrigin: vi.fn(),
  findMembership: vi.fn(),
  createCheckout: vi.fn(),
  updateCheckout: vi.fn(),
  getTeamBillingState: vi.fn(),
  createCheckoutSession: vi.fn(),
  StripeBillingNotEnabledError: class StripeBillingNotEnabledError extends Error {
    constructor() {
      super('Runtime payments are not enabled for this app yet.');
    }
  },
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
    teamMembership: { findUnique: mocks.findMembership },
    teamCheckout: { create: mocks.createCheckout, update: mocks.updateCheckout },
  },
}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://docketkite.example.test' } }));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/team-access', () => ({ getTeamBillingState: mocks.getTeamBillingState }));
vi.mock('@/lib/stripe-billing/client', () => ({
  createCheckoutSession: mocks.createCheckoutSession,
  StripeBillingConfigurationError: class StripeBillingConfigurationError extends Error {},
  StripeBillingNotEnabledError: mocks.StripeBillingNotEnabledError,
  StripeBillingOnboardingError: mocks.StripeBillingOnboardingError,
  StripeBillingProductIdentityUnavailableError: class StripeBillingProductIdentityUnavailableError extends Error {
    constructor() {
      super('The platform could not confirm the requested payment identity.');
    }
  },
}));

import { POST } from '@/app/api/stripe-billing/checkout/route';
import { TEAM_ACCESS_PRODUCT_KEY } from '@/lib/business/team-billing';
import {
  StripeBillingNotEnabledError,
  StripeBillingOnboardingError,
} from '@/lib/stripe-billing/client';

function post() {
  return new Request('http://localhost/api/stripe-billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: 'team-1' }),
  });
}

describe('team subscription checkout start', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.getTeamBillingState.mockResolvedValue({ paymentStatus: 'unpaid', accessActive: false });
    mocks.createCheckout.mockResolvedValue({ id: 'checkout-1' });
    mocks.updateCheckout.mockResolvedValue({});
    mocks.createCheckoutSession.mockResolvedValue({
      stripeSessionId: 'cs_test_team_1',
      checkoutId: 'stripe-checkout-1',
      productIdentity: 'full',
      url: 'https://checkout.example.test/session/team-1',
    });
  });

  it('persists team and purchaser before opening the stable $299 monthly hosted checkout', async () => {
    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://checkout.example.test/session/team-1' });
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      data: { teamId: 'team-1', userId: 'owner-1', status: 'pending' },
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 299,
        productKey: TEAM_ACCESS_PRODUCT_KEY,
        recurring: { interval: 'month' },
        customerEmail: 'owner@example.test',
        clientReferenceId: 'team-1',
        metadata: {
          teamId: 'team-1',
          userId: 'owner-1',
          teamCheckoutId: 'checkout-1',
        },
        successUrl: 'https://docketkite.example.test/dashboard?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://docketkite.example.test/dashboard?checkout=cancelled',
      }),
    );
    expect(mocks.updateCheckout).toHaveBeenCalledWith({
      where: { id: 'checkout-1' },
      data: {
        stripeSessionId: 'cs_test_team_1',
        stripeCheckoutId: 'stripe-checkout-1',
      },
    });
  });

  it('requires membership before creating a checkout record', async () => {
    mocks.findMembership.mockResolvedValue(null);

    const response = await POST(post());

    expect(response.status).toBe(403);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('allows a purchaser to start the same current $299 monthly hosted checkout', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'purchaser-1', email: 'buyer@example.test' });
    mocks.findMembership.mockResolvedValue({ role: 'purchaser' });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      data: { teamId: 'team-1', userId: 'purchaser-1', status: 'pending' },
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 299,
        productKey: TEAM_ACCESS_PRODUCT_KEY,
        recurring: { interval: 'month' },
      }),
    );
  });

  it('does not return a hosted URL when the provider cannot confirm product identity', async () => {
    mocks.createCheckoutSession.mockResolvedValue({
      stripeSessionId: 'cs_test_unlinked',
      url: 'https://checkout.example.test/session/unlinked',
      productIdentity: 'none',
    });

    const response = await POST(post());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'stripe_product_identity_unavailable',
      message: expect.stringContaining('payment identity'),
    });
    expect(mocks.updateCheckout).toHaveBeenCalledWith({
      where: { id: 'checkout-1' },
      data: { status: 'failed' },
    });
  });

  it('reports disabled Stripe payments and leaves the team available for retry', async () => {
    mocks.createCheckoutSession.mockRejectedValue(new StripeBillingNotEnabledError());

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'payments_not_enabled',
      message: expect.stringContaining('not enabled'),
    });
    expect(mocks.updateCheckout).toHaveBeenCalledWith({
      where: { id: 'checkout-1' },
      data: { status: 'failed' },
    });
  });

  it('reports a concrete billing authorization rejection during checkout creation', async () => {
    mocks.createCheckoutSession.mockRejectedValue(
      new Error('Polsia billing API request failed: 401 authorization_failed'),
    );

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'billing_authorization_unavailable',
      message: expect.stringContaining('HTTP 401: authorization_failed'),
    });
    expect(mocks.updateCheckout).toHaveBeenCalledWith({
      where: { id: 'checkout-1' },
      data: { status: 'failed' },
    });
  });

  it('reports incomplete Stripe onboarding with its concrete blocker', async () => {
    mocks.createCheckoutSession.mockRejectedValue(
      new StripeBillingOnboardingError('stripe_not_onboarded'),
    );

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'stripe_not_onboarded',
      message: expect.stringContaining('onboarding is incomplete'),
    });
  });
});
