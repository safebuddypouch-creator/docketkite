// Fulfill team checkout from verified Stripe webhook events.
// Access is recorded only after a paid subscription checkout matches the saved team row.

import 'server-only';
import type Stripe from 'stripe';
import { TEAM_ACCESS_MONTHLY_USD, TEAM_ACCESS_PRODUCT_KEY } from '@/lib/business/team-billing';
import { prisma } from '@/lib/db';
import { stripeClient } from '@/lib/stripe-billing/client';

const MONTHLY_CENTS = TEAM_ACCESS_MONTHLY_USD * 100;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function subscriptionPriceMatches(subscription: Stripe.Subscription): boolean {
  const item = subscription.items.data[0];
  return (
    subscription.metadata.productKey === TEAM_ACCESS_PRODUCT_KEY &&
    item?.price.unit_amount === MONTHLY_CENTS &&
    item.price.currency === 'usd' &&
    item.price.recurring?.interval === 'month'
  );
}

async function recordPaidCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status === 'unpaid' || session.mode !== 'subscription') return;
  if (session.amount_total !== MONTHLY_CENTS || session.currency !== 'usd') return;

  const metadata = session.metadata ?? {};
  const checkoutId = metadata.checkoutId;
  const teamCheckoutId = metadata.teamCheckoutId;
  const teamId = metadata.teamId;
  const userId = metadata.userId;
  if (!checkoutId || !teamCheckoutId || !teamId || !userId) return;
  if (metadata.productKey !== TEAM_ACCESS_PRODUCT_KEY) return;

  const row = await prisma.teamCheckout.findFirst({
    where: { OR: [{ stripeSessionId: session.id }, { id: teamCheckoutId }] },
  });
  if (!row || row.id !== teamCheckoutId || row.teamId !== teamId || row.userId !== userId) return;

  const subscriptionId = idOf(session.subscription);
  const customerId = idOf(session.customer);
  if (!subscriptionId || !customerId) return;

  const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
  if (subscription.status !== 'active' || !subscriptionPriceMatches(subscription)) return;
  if (subscription.metadata.checkoutId !== checkoutId) return;
  if (idOf(subscription.customer) !== customerId) return;

  await prisma.teamCheckout.update({
    where: { id: row.id },
    data: {
      status: 'verified',
      grossAmountUsd: TEAM_ACCESS_MONTHLY_USD,
      verifiedAt: row.verifiedAt ?? new Date(),
      stripeSessionId: session.id,
      stripeCheckoutId: checkoutId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    },
  });
}

async function markCheckoutFailed(session: Stripe.Checkout.Session): Promise<void> {
  await prisma.teamCheckout.updateMany({
    where: { stripeSessionId: session.id, status: 'pending' },
    data: { status: 'failed' },
  });
}

async function subscriptionFromInvoice(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return;
  const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
  if (invoice.status !== 'paid' || subscription.status !== 'active') return;
  if (!subscriptionPriceMatches(subscription)) return;

  const teamCheckoutId = subscription.metadata.teamCheckoutId;
  const checkoutId = subscription.metadata.checkoutId;
  if (!teamCheckoutId || !checkoutId) return;

  const row = await prisma.teamCheckout.findUnique({ where: { id: teamCheckoutId } });
  if (
    !row ||
    row.teamId !== subscription.metadata.teamId ||
    row.userId !== subscription.metadata.userId
  ) {
    return;
  }

  await prisma.teamCheckout.update({
    where: { id: row.id },
    data: {
      status: 'verified',
      grossAmountUsd: TEAM_ACCESS_MONTHLY_USD,
      verifiedAt: row.verifiedAt ?? new Date(),
      stripeCheckoutId: checkoutId,
      stripeCustomerId: idOf(subscription.customer),
      stripeSubscriptionId: subscription.id,
    },
  });
}

async function noteCustomerSubscriptions(customerId: string | null): Promise<void> {
  if (!customerId) return;
  await stripeClient().subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await recordPaidCheckout(event.data.object);
      return;
    case 'checkout.session.async_payment_failed':
      await markCheckoutFailed(event.data.object);
      return;
    case 'invoice.paid':
      await subscriptionFromInvoice(event.data.object);
      return;
    case 'invoice.payment_failed':
      await subscriptionFromInvoice(event.data.object);
      return;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await stripeClient().subscriptions.retrieve(event.data.object.id);
      return;
    case 'charge.refunded':
      await noteCustomerSubscriptions(idOf(event.data.object.customer));
      return;
    case 'charge.dispute.created': {
      const chargeId = idOf(event.data.object.charge);
      if (!chargeId) return;
      const charge = await stripeClient().charges.retrieve(chargeId);
      await noteCustomerSubscriptions(idOf(charge.customer));
      return;
    }
    case 'radar.early_fraud_warning.created': {
      const chargeId = idOf(event.data.object.charge);
      if (!chargeId) return;
      const charge = await stripeClient().charges.retrieve(chargeId);
      await noteCustomerSubscriptions(idOf(charge.customer));
      return;
    }
    default:
      return;
  }
}
