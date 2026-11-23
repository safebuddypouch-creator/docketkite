// @polsia:user-owned — authenticated monthly checkout for a purchasing team.
import 'server-only';
import { NextResponse } from 'next/server';
import { TEAM_ACCESS_MONTHLY_USD, TEAM_ACCESS_PRODUCT_KEY } from '@/lib/business/team-billing';
import { TeamCheckoutRequest, TeamCheckoutResponse } from '@/lib/contracts/team';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import {
  createCheckoutSession,
  StripeBillingConfigurationError,
  StripeBillingNotEnabledError,
  StripeBillingOnboardingError,
  StripeBillingProductIdentityUnavailableError,
} from '@/lib/stripe-billing/client';
import { getTeamBillingState } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

function unavailableResponse(error: string, message: string, status = 503) {
  return NextResponse.json({ error, message }, { status });
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

  const parsed = TeamCheckoutRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: parsed.data.teamId, userId: user.id } },
  });
  if (!membership || !['owner', 'purchaser'].includes(membership.role)) {
    return NextResponse.json({ error: 'team_purchaser_required' }, { status: 403 });
  }

  const billing = await getTeamBillingState(parsed.data.teamId);
  if (billing.accessActive) {
    return NextResponse.json({ error: 'team_subscription_already_active' }, { status: 409 });
  }

  const checkout = await prisma.teamCheckout.create({
    data: { teamId: parsed.data.teamId, userId: user.id, status: 'pending' },
  });

  try {
    const origin = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
    const session = await createCheckoutSession({
      amountUsd: TEAM_ACCESS_MONTHLY_USD,
      productKey: TEAM_ACCESS_PRODUCT_KEY,
      name: 'DocketKite Team Access',
      description: 'Monthly access to a private, team-scoped DocketKite permit workspace.',
      recurring: { interval: 'month' },
      customerEmail: user.email,
      clientReferenceId: parsed.data.teamId,
      metadata: {
        teamId: parsed.data.teamId,
        userId: user.id,
        teamCheckoutId: checkout.id,
      },
      successUrl: `${origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/dashboard?checkout=cancelled`,
    });

    if (!session.checkoutId || session.productIdentity !== 'full') {
      throw new StripeBillingProductIdentityUnavailableError();
    }

    await prisma.teamCheckout.update({
      where: { id: checkout.id },
      data: {
        stripeSessionId: session.stripeSessionId,
        stripeCheckoutId: session.checkoutId,
      },
    });
    return NextResponse.json(TeamCheckoutResponse.parse({ url: session.url }));
  } catch (error) {
    await prisma.teamCheckout.update({ where: { id: checkout.id }, data: { status: 'failed' } });
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
      return unavailableResponse('stripe_product_identity_unavailable', error.message, 502);
    }
    const providerMessage = error instanceof Error ? error.message : '';
    const providerFailure = /failed:\s*(\d{3})(?:\s+([a-z][a-z0-9_-]*))?/i.exec(providerMessage);
    if (providerFailure?.[1] === '401' || providerFailure?.[1] === '403') {
      const detail = providerFailure[2] ? `: ${providerFailure[2]}` : '';
      return unavailableResponse(
        'billing_authorization_unavailable',
        `Billing authorization was rejected (HTTP ${providerFailure[1]}${detail}). No payment was started. Retry after the billing connection is restored.`,
        503,
      );
    }
    return unavailableResponse(
      'checkout_unavailable',
      'Stripe checkout could not be started. No payment was confirmed.',
      502,
    );
  }
}
