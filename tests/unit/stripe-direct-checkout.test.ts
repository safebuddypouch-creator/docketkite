// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  constructEvent: vi.fn(),
  env: {
    STRIPE_SECRET_KEY: undefined as string | undefined,
    STRIPE_WEBHOOK_SECRET: undefined as string | undefined,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('stripe', () => ({
  default: class Stripe {
    static API_VERSION = '2026-09-30.endive';
    static errors = { StripeError: class StripeError extends Error {} };
    checkout = { sessions: { create: mocks.create } };
    webhooks = { constructEvent: mocks.constructEvent };
  },
}));

import { POST } from '@/app/api/stripe/webhook/route';
import {
  constructStripeEvent,
  createCheckoutSession,
  StripeBillingConfigurationError,
} from '@/lib/stripe-billing/client';

const checkoutInput = {
  amountUsd: 299,
  productKey: 'docketkite-team-access-monthly',
  name: 'DocketKite Team Access',
  successUrl: 'https://example.test/dashboard?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://example.test/dashboard?checkout=cancelled',
  recurring: { interval: 'month' as const },
  metadata: { teamId: 'team-1', userId: 'user-1', teamCheckoutId: 'checkout-1' },
};

describe('direct Stripe checkout', () => {
  beforeEach(() => {
    mocks.env.STRIPE_SECRET_KEY = undefined;
    mocks.env.STRIPE_WEBHOOK_SECRET = undefined;
    mocks.create.mockReset();
    mocks.constructEvent.mockReset();
  });

  it('reports that payments are not configured when the secret key is unset', async () => {
    await expect(createCheckoutSession(checkoutInput)).rejects.toBeInstanceOf(
      StripeBillingConfigurationError,
    );
    await expect(createCheckoutSession(checkoutInput)).rejects.toThrow(
      /Payments are not configured/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a hosted subscription session with the Stripe SDK and no Polsia call', async () => {
    mocks.env.STRIPE_SECRET_KEY = 'sk_test_example';
    mocks.create.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });

    const session = await createCheckoutSession(checkoutInput);

    expect(session.url).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
    expect(session.stripeSessionId).toBe('cs_test_123');
    expect(session.productIdentity).toBe('full');
    expect(session.platformFee).toBe(0);
    const params = mocks.create.mock.calls[0][0];
    expect(params.mode).toBe('subscription');
    expect(params.payment_method_types).toBeUndefined();
    expect(params.line_items[0].price_data.unit_amount).toBe(29900);
    expect(params.line_items[0].price_data.recurring).toEqual({ interval: 'month' });
    expect(params.line_items[0].price_data.product_data.metadata.product_key).toBe(
      'docketkite-team-access-monthly',
    );
    expect(params.metadata.teamCheckoutId).toBe('checkout-1');
    expect(params.subscription_data.metadata.checkoutId).toBe(session.checkoutId);
    expect(params.integration_identifier).toMatch(/^docketkite-team-checkout-[a-z]{8}$/);
  });

  it('rejects a webhook with no signature and does not verify a missing secret', async () => {
    const response = await POST(
      new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it('rejects a webhook when the signing secret is unset', () => {
    expect(() => constructStripeEvent('{}', 't=1,v1=abc')).toThrow(/Payments are not configured/);
  });
});
