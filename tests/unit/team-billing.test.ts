// @polsia:user-owned — stable product, team, purchaser, and subscription verification tests.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isActiveTeamSubscription,
  matchesTeamCheckoutOrder,
  TEAM_ACCESS_PRODUCT_KEY,
} from '@/lib/business/team-billing';
import type {
  CheckoutOrder,
  SubscriptionStatusResult,
} from '@/lib/stripe-billing/schema';

const checkoutItem: CheckoutOrder['items'][number] = {
  position: 0,
  product_key: TEAM_ACCESS_PRODUCT_KEY,
  name: 'DocketKite Team Access',
  quantity: 1,
  unit_amount_minor: 29_900,
  currency: 'usd',
  interval: 'month',
};

function order(overrides: Partial<CheckoutOrder> = {}): CheckoutOrder {
  return {
    checkout_id: 'stripe-checkout-1',
    mode: 'subscription',
    client_reference_id: 'team-1',
    metadata: { teamId: 'team-1', userId: 'buyer-1', teamCheckoutId: 'checkout-1' },
    stripe_customer_id: 'cus_123456',
    stripe_subscription_id: 'sub_123456',
    items: [checkoutItem],
    ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionStatusResult> = {}): SubscriptionStatusResult {
  return {
    active: true,
    status: 'active',
    plan: 'DocketKite Team Access',
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
        created_at: '2026-11-01T00:00:00.000Z',
        product_key: TEAM_ACCESS_PRODUCT_KEY,
        checkout_id: 'stripe-checkout-1',
        stripe_customer_id: 'cus_123456',
      },
    ],
    ...overrides,
  };
}

const checkoutMismatches: Array<[string, Partial<CheckoutOrder>]> = [
  ['another provider checkout', { checkout_id: 'stripe-checkout-2' }],
  ['another team', { client_reference_id: 'team-2' }],
  ['another purchaser', {
    metadata: { teamId: 'team-1', userId: 'buyer-2', teamCheckoutId: 'checkout-1' },
  }],
  ['another checkout', {
    metadata: { teamId: 'team-1', userId: 'buyer-1', teamCheckoutId: 'checkout-2' },
  }],
  ['a different product', { items: [{ ...checkoutItem, product_key: 'other-product' }] }],
  ['a different amount', { items: [{ ...checkoutItem, unit_amount_minor: 14_900 }] }],
  ['a different interval', { items: [{ ...checkoutItem, interval: 'year' }] }],
];

const subscriptionMismatches: Array<[string, Partial<SubscriptionStatusResult>]> = [
  ['canceled', { active: false, status: 'canceled' }],
  ['trialing', { active: true, status: 'trialing' }],
  ['incomplete', { active: false, status: 'incomplete' }],
  ['wrong amount', { monthly_amount: 149 }],
  ['wrong product', { product_key: 'other-product' }],
  ['wrong purchaser', { customer_email: 'other@example.test' }],
  ['another customer at the status level', { stripe_customer_id: 'cus_654321' }],
  [
    'another linked customer',
    {
      subscriptions: [
        {
          ...subscription().subscriptions![0]!,
          stripe_customer_id: 'cus_654321',
        },
      ],
    },
  ],
  [
    'another linked subscription',
    {
      subscriptions: [
        {
          ...subscription().subscriptions![0]!,
          stripe_subscription_id: 'sub_654321',
        },
      ],
    },
  ],
];

describe('team checkout identity', () => {
  it('accepts only the expected $299 monthly product bound to this team, purchaser, and checkout', () => {
    expect(
      matchesTeamCheckoutOrder(order(), {
        checkoutId: 'checkout-1',
        teamId: 'team-1',
        userId: 'buyer-1',
      stripeCheckoutId: 'stripe-checkout-1',
      }),
    ).toBe(true);
  });

  it.each(checkoutMismatches)('rejects checkout identity for %s', (_reason, changes) => {
    expect(
      matchesTeamCheckoutOrder(order(changes), {
        checkoutId: 'checkout-1',
        teamId: 'team-1',
        userId: 'buyer-1',
        stripeCheckoutId: 'stripe-checkout-1',
      }),
    ).toBe(false);
  });
});

describe('active paid team subscription', () => {
  it('requires a current active $299 subscription, matching product, and matching purchaser email', () => {
    expect(
      isActiveTeamSubscription(subscription(), 'BUYER@example.test', {
        checkoutId: 'stripe-checkout-1',
        customerId: 'cus_123456',
        subscriptionId: 'sub_123456',
      }),
    ).toBe(true);
  });

  it.each(subscriptionMismatches)('keeps access locked for a %s subscription result', (_reason, changes) => {
    expect(
      isActiveTeamSubscription(subscription(changes), 'buyer@example.test', {
        checkoutId: 'stripe-checkout-1',
        customerId: 'cus_123456',
        subscriptionId: 'sub_123456',
      }),
    ).toBe(false);
  });

  it('requires the active subscription to be linked to this exact checkout and subscription id', () => {
    expect(
      isActiveTeamSubscription(
        subscription({
          subscriptions: [
            {
              ...subscription().subscriptions![0]!,
              checkout_id: 'another-checkout',
            },
          ],
        }),
        'buyer@example.test',
        {
          checkoutId: 'stripe-checkout-1',
          customerId: 'cus_123456',
          subscriptionId: 'sub_123456',
        },
      ),
    ).toBe(false);
  });
});
