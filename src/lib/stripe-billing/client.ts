// Server-only billing against the account's own Stripe API.
// Checkout, verification, and the customer portal use the official Stripe SDK.
// Secrets are read from the environment and are never logged.

import 'server-only';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { env } from '@/lib/env';
import {
  type CheckoutSessionResult,
  type CheckoutVerificationResult,
  type CreateCheckoutSessionInput,
  type CreateCustomerPortalSessionInput,
  type CustomerPortalSessionResult,
  checkoutSessionResultSchema,
  checkoutVerificationResultSchema,
  createCheckoutSessionInputSchema,
  createCustomerPortalSessionInputSchema,
  customerPortalSessionResultSchema,
  type PaymentEventsResult,
  type PaymentEventType,
  type SubscriptionStatusResult,
  subscriptionStatusResultSchema,
} from '@/lib/stripe-billing/schema';

const PAYMENTS_NOT_CONFIGURED = 'Payments are not configured.';

export class StripeBillingConfigurationError extends Error {
  constructor(message = PAYMENTS_NOT_CONFIGURED) {
    super(message);
    this.name = 'StripeBillingConfigurationError';
  }
}

export class StripeBillingNotEnabledError extends Error {
  constructor(message = 'Payments are not configured.') {
    super(message);
    this.name = 'StripeBillingNotEnabledError';
  }
}

export class StripeBillingOnboardingError extends Error {
  readonly code: 'stripe_not_configured' | 'stripe_not_onboarded';

  constructor(code: 'stripe_not_configured' | 'stripe_not_onboarded') {
    super(
      code === 'stripe_not_configured'
        ? 'Payments are not configured.'
        : 'Stripe onboarding is incomplete for this business. Finish Stripe account setup before payments can be accepted.',
    );
    this.name = 'StripeBillingOnboardingError';
    this.code = code;
  }
}

export class StripeBillingProductIdentityUnavailableError extends Error {
  constructor() {
    super(
      'Stripe could not confirm the requested payment identity. Do not broaden the request or redirect to checkout.',
    );
    this.name = 'StripeBillingProductIdentityUnavailableError';
  }
}

export class StripeWebhookSignatureError extends Error {
  constructor() {
    super('Invalid Stripe webhook signature');
    this.name = 'StripeWebhookSignatureError';
  }
}

export interface VerifyCheckoutSessionInput {
  sessionId: string;
}

export interface GetSubscriptionStatusInput {
  email?: string;
  stripeCustomerId?: string;
  productKey?: string;
}

export interface ListPaymentEventsInput {
  sinceCursor?: number;
  limit?: number;
  types?: readonly PaymentEventType[];
}

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function stripeClient(): Stripe {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeBillingConfigurationError(PAYMENTS_NOT_CONFIGURED);
  }
  return new Stripe(key, { apiVersion: Stripe.API_VERSION });
}

function rethrowStripe(error: unknown): never {
  if (error instanceof StripeBillingConfigurationError) throw error;
  if (error instanceof Stripe.errors.StripeError) {
    const status = error.statusCode ?? 502;
    const code = error.code ? ` ${error.code}` : '';
    throw new Error(`Stripe request failed: ${status}${code}`);
  }
  throw error instanceof Error ? error : new Error('Stripe request failed');
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function integrationIdentifier(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(8);
  let suffix = '';
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `docketkite-team-checkout-${suffix}`;
}

function checkoutReference(): string {
  return `chk_${randomBytes(16).toString('hex')}`;
}

export function constructStripeEvent(payload: string, signature: string): Stripe.Event {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new StripeBillingConfigurationError(PAYMENTS_NOT_CONFIGURED);
  }
  try {
    return stripeClient().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    if (error instanceof StripeBillingConfigurationError) throw error;
    throw new StripeWebhookSignatureError();
  }
}

export async function verifyCheckoutSession(
  input: VerifyCheckoutSessionInput,
): Promise<CheckoutVerificationResult> {
  const stripe = stripeClient();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(input.sessionId, {
      expand: ['line_items.data.price.product', 'subscription', 'customer'],
    });
  } catch (error) {
    rethrowStripe(error);
  }

  const paid = session.status === 'complete' && session.payment_status !== 'unpaid';
  if (!paid) {
    return checkoutVerificationResultSchema.parse({ verified: false });
  }

  const lineItems = session.line_items?.data ?? [];
  const customer = session.customer;
  const customerEmail =
    session.customer_details?.email ??
    session.customer_email ??
    (customer && typeof customer !== 'string' && !customer.deleted ? customer.email : null);
  const amount = session.amount_total == null ? null : session.amount_total / 100;
  const metadata = session.metadata ?? {};

  return checkoutVerificationResultSchema.parse({
    verified: true,
    payment: {
      amount_usd: amount ?? 0,
      gross_amount_usd: amount,
      customer_email: customerEmail,
      product_name: lineItems[0]?.description ?? null,
      paid_at: new Date((session.created ?? 0) * 1000).toISOString(),
    },
    order: {
      checkout_id: metadata.checkoutId ?? '',
      mode: session.mode ?? 'payment',
      client_reference_id: session.client_reference_id,
      metadata,
      stripe_customer_id: idOf(session.customer),
      stripe_subscription_id: idOf(session.subscription),
      items: lineItems.map((item, index) => lineItemRecord(item, index, metadata.productKey)),
    },
  });
}

function lineItemRecord(
  item: Stripe.LineItem,
  index: number,
  fallbackProductKey: string | undefined,
) {
  const price = item.price;
  const product = price && typeof price.product !== 'string' ? price.product : null;
  const productKey =
    product && !('deleted' in product && product.deleted)
      ? (product.metadata?.product_key ?? fallbackProductKey ?? null)
      : (fallbackProductKey ?? null);
  return {
    position: index,
    product_key: productKey,
    name: item.description ?? 'Checkout item',
    quantity: item.quantity ?? 1,
    unit_amount_minor: price?.unit_amount ?? 0,
    currency: price?.currency ?? item.currency,
    interval: price?.recurring?.interval ?? null,
  };
}

export async function getSubscriptionStatus(
  input: GetSubscriptionStatusInput,
): Promise<SubscriptionStatusResult> {
  const { email, stripeCustomerId, productKey } = input;
  if ((stripeCustomerId != null || productKey != null) && !stripeCustomerId) {
    throw new StripeBillingProductIdentityUnavailableError();
  }
  if (!stripeCustomerId) {
    return subscriptionStatusResultSchema.parse({ active: false, status: 'not_found' });
  }

  const stripe = stripeClient();
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted) {
      throw new StripeBillingProductIdentityUnavailableError();
    }
    const listed = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 20,
    });
    const customerEmail = customer.email ?? undefined;
    const entries = listed.data
      .filter((subscription) => !productKey || subscription.metadata.productKey === productKey)
      .map((subscription) => subscriptionEntry(subscription, customerEmail));
    const current = entries.find((entry) => entry.active) ?? entries[0];
    return subscriptionStatusResultSchema.parse({
      active: Boolean(current?.active),
      ...(current ? { status: current.status } : { status: 'not_found' }),
      ...(current
        ? {
            plan: current.plan,
            monthly_amount: current.monthly_amount,
            current_period_end: current.current_period_end,
            customer_email: email ?? customerEmail,
            stripe_customer_id: stripeCustomerId,
            product_key: current.product_key ?? productKey,
          }
        : { product_key: productKey, stripe_customer_id: stripeCustomerId }),
      subscriptions: entries,
    });
  } catch (error) {
    if (error instanceof StripeBillingProductIdentityUnavailableError) throw error;
    rethrowStripe(error);
  }
}

function subscriptionEntry(subscription: Stripe.Subscription, customerEmail: string | undefined) {
  const item = subscription.items.data[0];
  const amount = item?.price.unit_amount ?? 0;
  const periodEnd = item?.current_period_end;
  const active = ACTIVE_STATUSES.has(subscription.status);
  return {
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    active,
    plan: item?.price.nickname ?? subscription.metadata.productKey ?? 'subscription',
    monthly_amount: amount / 100,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    created_at: new Date(subscription.created * 1000).toISOString(),
    product_key: subscription.metadata.productKey ?? null,
    checkout_id: subscription.metadata.checkoutId ?? null,
    stripe_customer_id: idOf(subscription.customer),
    customer_email: customerEmail,
  };
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const parsed = createCheckoutSessionInputSchema.parse(input);
  const stripe = stripeClient();
  const checkoutId = checkoutReference();
  const metadata = {
    ...(parsed.metadata ?? {}),
    checkoutId,
    ...(parsed.productKey ? { productKey: parsed.productKey } : {}),
  };
  const recurring = parsed.recurring;
  const lineItems = checkoutLineItems(parsed, recurring?.interval);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: recurring ? 'subscription' : 'payment',
      line_items: lineItems,
      success_url: parsed.successUrl,
      cancel_url: parsed.cancelUrl,
      client_reference_id: parsed.clientReferenceId,
      customer_email: parsed.customerEmail,
      metadata,
      integration_identifier: integrationIdentifier(),
      ...(parsed.allowPromotionCodes !== undefined
        ? { allow_promotion_codes: parsed.allowPromotionCodes }
        : {}),
      ...(parsed.billingAddressCollection
        ? { billing_address_collection: parsed.billingAddressCollection }
        : {}),
      ...(parsed.locale
        ? { locale: parsed.locale as Stripe.Checkout.SessionCreateParams.Locale }
        : {}),
      ...(recurring
        ? {
            subscription_data: {
              metadata,
              ...(parsed.trialPeriodDays ? { trial_period_days: parsed.trialPeriodDays } : {}),
            },
          }
        : {}),
    });
  } catch (error) {
    rethrowStripe(error);
  }

  if (!session.url) {
    throw new StripeBillingProductIdentityUnavailableError();
  }

  const hasProductKeys =
    parsed.productKey !== undefined ||
    parsed.lineItems?.some((item) => item.productKey !== undefined);
  const expectedCoverage = parsed.lineItems?.some((item) => item.productKey === undefined)
    ? 'partial'
    : 'full';
  const productIdentity = hasProductKeys ? expectedCoverage : undefined;
  if (hasProductKeys && productIdentity !== expectedCoverage) {
    throw new StripeBillingProductIdentityUnavailableError();
  }

  return checkoutSessionResultSchema.parse({
    id: 0,
    stripeSessionId: session.id,
    url: session.url,
    totalAmountUsd: parsed.amountUsd ?? sumLineItems(parsed),
    companyReceives: parsed.amountUsd ?? sumLineItems(parsed),
    platformFee: 0,
    ...(recurring ? { billingInterval: recurring.interval, recurring: true } : {}),
    checkoutId,
    ...(productIdentity ? { productIdentity } : {}),
  });
}

function sumLineItems(parsed: CreateCheckoutSessionInput): number {
  return (parsed.lineItems ?? []).reduce(
    (total, item) => total + item.amountUsd * (item.quantity ?? 1),
    0,
  );
}

function checkoutLineItems(
  parsed: CreateCheckoutSessionInput,
  interval: 'month' | 'year' | undefined,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (parsed.lineItems?.length) {
    return parsed.lineItems.map((item) => ({
      quantity: item.quantity ?? 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(item.amountUsd * 100),
        product_data: {
          name: item.name,
          ...(item.productKey ? { metadata: { product_key: item.productKey } } : {}),
        },
        ...(interval ? { recurring: { interval } } : {}),
      },
    }));
  }

  return [
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round((parsed.amountUsd ?? 0) * 100),
        product_data: {
          name: parsed.name ?? 'Checkout',
          ...(parsed.description ? { description: parsed.description } : {}),
          ...(parsed.productKey ? { metadata: { product_key: parsed.productKey } } : {}),
        },
        ...(interval ? { recurring: { interval } } : {}),
      },
    },
  ];
}

export async function createCustomerPortalSession(
  input: CreateCustomerPortalSessionInput,
): Promise<CustomerPortalSessionResult> {
  const parsed = createCustomerPortalSessionInputSchema.parse(input);
  const stripe = stripeClient();
  try {
    const customerId =
      parsed.stripeCustomerId ?? (await customerIdForEmail(stripe, parsed.customerEmail ?? ''));
    if (!customerId) {
      throw new StripeBillingProductIdentityUnavailableError();
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: parsed.returnUrl,
    });
    return customerPortalSessionResultSchema.parse({ url: session.url });
  } catch (error) {
    if (error instanceof StripeBillingProductIdentityUnavailableError) throw error;
    rethrowStripe(error);
  }
}

async function customerIdForEmail(stripe: Stripe, email: string): Promise<string | null> {
  const customers = await stripe.customers.list({ email, limit: 1 });
  return customers.data[0]?.id ?? null;
}

/**
 * Stripe delivers payment events to the webhook. This feed no longer calls Polsia.
 * Callers that still poll receive an empty page so they do not contact another service.
 */
export async function listPaymentEvents(
  input: ListPaymentEventsInput = {},
): Promise<PaymentEventsResult> {
  return {
    events: [],
    nextCursor: input.sinceCursor ?? 0,
  };
}
