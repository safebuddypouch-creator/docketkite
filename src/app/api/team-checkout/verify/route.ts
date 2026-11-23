// @polsia:user-owned — verify the signed-in purchaser's team subscription before access.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  isActiveTeamSubscription,
  matchesTeamCheckoutOrder,
  TEAM_ACCESS_MONTHLY_USD,
  TEAM_ACCESS_PRODUCT_KEY,
} from '@/lib/business/team-billing';
import { TeamCheckoutVerification, TeamCheckoutVerificationRequest } from '@/lib/contracts/team';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import {
  getSubscriptionStatus,
  StripeBillingConfigurationError,
  StripeBillingNotEnabledError,
  StripeBillingOnboardingError,
  StripeBillingProductIdentityUnavailableError,
  verifyCheckoutSession,
} from '@/lib/stripe-billing/client';

export const dynamic = 'force-dynamic';

function unavailableResponse(error: string, message: string, status = 503) {
  return NextResponse.json({ verified: false, error, message }, { status });
}

function verificationUnavailable(error: unknown) {
  if (error instanceof StripeBillingNotEnabledError) {
    return unavailableResponse('payments_not_enabled', error.message);
  }
  if (error instanceof StripeBillingOnboardingError) {
    return unavailableResponse(error.code, error.message);
  }
  if (error instanceof StripeBillingConfigurationError) {
    return unavailableResponse('stripe_billing_not_configured', error.message);
  }
  if (error instanceof StripeBillingProductIdentityUnavailableError) {
    return unavailableResponse('stripe_product_identity_unavailable', error.message);
  }

  const providerMessage = error instanceof Error ? error.message : '';
  const providerFailure = /failed:\s*(\d{3})(?:\s+([a-z][a-z0-9_-]*))?/i.exec(providerMessage);
  if (providerFailure?.[1] === '401' || providerFailure?.[1] === '403') {
    const detail = providerFailure[2] ? `: ${providerFailure[2]}` : '';
    return unavailableResponse(
      'billing_authorization_unavailable',
      `Billing authorization was rejected (HTTP ${providerFailure[1]}${detail}). No paid access was granted. Retry after the billing connection is restored.`,
    );
  }

  return unavailableResponse(
    'payment_verification_unavailable',
    'Stripe could not confirm the linked active subscription. No paid access was granted. Retry verification shortly.',
    502,
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const parsed = TeamCheckoutVerificationRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_session' }, { status: 400 });
  }

  let checkout: Awaited<ReturnType<typeof prisma.teamCheckout.findFirst>>;
  if ('session_id' in parsed.data) {
    checkout = await prisma.teamCheckout.findFirst({
      where: { stripeSessionId: parsed.data.session_id, userId: user.id },
    });
  } else {
    const membership = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: parsed.data.teamId, userId: user.id } },
      select: { role: true },
    });
    if (!membership || !['owner', 'purchaser'].includes(membership.role)) {
      return NextResponse.json({ error: 'team_purchaser_required' }, { status: 403 });
    }
    checkout = await prisma.teamCheckout.findFirst({
      where: {
        teamId: parsed.data.teamId,
        userId: user.id,
        status: { in: ['pending', 'verified'] },
        stripeSessionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  if (!checkout) {
    return NextResponse.json({ error: 'team_checkout_not_found' }, { status: 404 });
  }
  if (checkout.userId !== user.id) {
    return NextResponse.json({ error: 'team_purchaser_required' }, { status: 403 });
  }
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: checkout.teamId, userId: user.id } },
    select: { role: true },
  });
  if (!membership || !['owner', 'purchaser'].includes(membership.role)) {
    return NextResponse.json({ error: 'team_purchaser_required' }, { status: 403 });
  }
  const sessionId = checkout.stripeSessionId;
  if (!sessionId) {
    return NextResponse.json({ error: 'team_checkout_session_missing' }, { status: 409 });
  }
  try {
    const verification = await verifyCheckoutSession({ sessionId });
    if (!verification.verified || !verification.payment) {
      return NextResponse.json(
        {
          verified: false,
          error: 'payment_not_verified',
          message: 'Stripe has not verified this checkout payment. No paid access was granted.',
        },
        { status: 409 },
      );
    }
    const order = verification.order;
    if (
      !order ||
      !checkout.stripeCheckoutId ||
      !matchesTeamCheckoutOrder(order, {
        checkoutId: checkout.id,
        teamId: checkout.teamId,
        userId: checkout.userId,
        stripeCheckoutId: checkout.stripeCheckoutId,
      })
    ) {
      return NextResponse.json(
        {
          verified: false,
          error: 'checkout_identity_unverified',
          message:
            'Stripe could not match the payment to this team, purchaser, and saved checkout. No paid access was granted.',
        },
        { status: 409 },
      );
    }
    if (verification.payment.gross_amount_usd !== TEAM_ACCESS_MONTHLY_USD) {
      return NextResponse.json(
        {
          verified: false,
          error: 'payment_amount_unverified',
          message:
            'The verified checkout total did not match the $299 USD monthly team plan. No paid access was granted.',
        },
        { status: 409 },
      );
    }
    if (
      verification.payment.customer_email?.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      return NextResponse.json(
        {
          verified: false,
          error: 'purchaser_email_mismatch',
          message:
            'The checkout purchaser email did not match the signed-in account. No paid access was granted.',
        },
        { status: 403 },
      );
    }

    const stripeCustomerId = order.stripe_customer_id;
    const stripeSubscriptionId = order.stripe_subscription_id;
    if (!stripeCustomerId || !stripeSubscriptionId) {
      return NextResponse.json(
        TeamCheckoutVerification.parse({
          verified: false,
          reason: 'subscription_link_pending',
        }),
      );
    }
    if (
      (checkout.stripeCustomerId && checkout.stripeCustomerId !== stripeCustomerId) ||
      (checkout.stripeSubscriptionId && checkout.stripeSubscriptionId !== stripeSubscriptionId)
    ) {
      return NextResponse.json(
        {
          verified: false,
          error: 'checkout_identity_unverified',
          message:
            'Stripe returned a customer or subscription that does not match this saved checkout. No paid access was granted.',
        },
        { status: 409 },
      );
    }

    const subscription = await getSubscriptionStatus({
      email: user.email,
      stripeCustomerId,
      productKey: TEAM_ACCESS_PRODUCT_KEY,
    });
    const stripeCheckoutId = checkout.stripeCheckoutId;
    if (
      !isActiveTeamSubscription(subscription, user.email, {
        checkoutId: stripeCheckoutId,
        customerId: stripeCustomerId,
        subscriptionId: stripeSubscriptionId,
      })
    ) {
      return NextResponse.json(
        TeamCheckoutVerification.parse({
          verified: false,
          reason: 'subscription_inactive',
          ...(subscription.status ? { subscriptionStatus: subscription.status } : {}),
        }),
      );
    }

    const now = new Date();
    await prisma.teamCheckout.update({
      where: { id: checkout.id },
      data: {
        status: 'verified',
        grossAmountUsd: verification.payment.gross_amount_usd,
        verifiedAt: checkout.verifiedAt ?? now,
        stripeCheckoutId,
        checkoutItems: order.items,
        stripeCustomerId,
        stripeSubscriptionId,
      },
    });
    return NextResponse.json(TeamCheckoutVerification.parse({ verified: true }));
  } catch (error) {
    return verificationUnavailable(error);
  }
}
