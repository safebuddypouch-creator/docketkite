// @polsia:user-owned — stable identity and verification rules for the team plan.
import type { CheckoutOrder, SubscriptionStatusResult } from '@/lib/stripe-billing/schema';

export const TEAM_ACCESS_PRODUCT_KEY = 'docketkite-team-access-monthly';
export const TEAM_ACCESS_MONTHLY_USD = 299;

export function matchesTeamCheckoutOrder(
  order: CheckoutOrder | null | undefined,
  expected: {
    checkoutId: string;
    teamId: string;
    userId: string;
    stripeCheckoutId?: string | null;
  },
): boolean {
  if (
    !order ||
    order.mode !== 'subscription' ||
    (expected.stripeCheckoutId !== undefined &&
      expected.stripeCheckoutId !== null &&
      order.checkout_id !== expected.stripeCheckoutId) ||
    order.client_reference_id !== expected.teamId ||
    order.metadata.teamId !== expected.teamId ||
    order.metadata.userId !== expected.userId ||
    order.metadata.teamCheckoutId !== expected.checkoutId ||
    order.items.length !== 1
  ) {
    return false;
  }

  const item = order.items[0];
  return Boolean(
    item &&
      item.product_key === TEAM_ACCESS_PRODUCT_KEY &&
      item.quantity === 1 &&
      item.unit_amount_minor === TEAM_ACCESS_MONTHLY_USD * 100 &&
      item.currency.toLowerCase() === 'usd' &&
      item.interval === 'month',
  );
}

export function isActiveTeamSubscription(
  subscription: SubscriptionStatusResult,
  purchaserEmail: string,
  expected: { checkoutId: string; customerId: string; subscriptionId: string },
): boolean {
  return (
    subscription.active &&
    subscription.status === 'active' &&
    subscription.monthly_amount === TEAM_ACCESS_MONTHLY_USD &&
    subscription.product_key === TEAM_ACCESS_PRODUCT_KEY &&
    (subscription.stripe_customer_id === null ||
      subscription.stripe_customer_id === undefined ||
      subscription.stripe_customer_id === expected.customerId) &&
    subscription.customer_email?.trim().toLowerCase() === purchaserEmail.trim().toLowerCase() &&
    Boolean(
      subscription.subscriptions?.some(
        (item) =>
          item.active &&
          item.status === 'active' &&
          item.monthly_amount === TEAM_ACCESS_MONTHLY_USD &&
          item.product_key === TEAM_ACCESS_PRODUCT_KEY &&
          item.checkout_id === expected.checkoutId &&
          item.stripe_customer_id === expected.customerId &&
          item.stripe_subscription_id === expected.subscriptionId,
      ),
    )
  );
}
