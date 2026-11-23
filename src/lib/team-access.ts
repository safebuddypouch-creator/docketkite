// @polsia:user-owned — server-side team membership and subscription gate.
import 'server-only';
import {
  isActiveTeamSubscription,
  TEAM_ACCESS_MONTHLY_USD,
  TEAM_ACCESS_PRODUCT_KEY,
} from '@/lib/business/team-billing';
import { OWNER_TESTING_TEAM_ID } from '@/lib/contracts/team';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getSubscriptionStatus } from '@/lib/stripe-billing/client';
import { resolveTeamEntitlement } from '@/lib/team-entitlements';

export type TeamPaymentStatus = 'unpaid' | 'pending' | 'active' | 'inactive' | 'unavailable';

export async function getTeamBillingState(teamId: string): Promise<{
  paymentStatus: TeamPaymentStatus;
  accessActive: boolean;
}> {
  const [verifiedCheckout, pendingCheckout] = await Promise.all([
    prisma.teamCheckout.findFirst({
      where: {
        teamId,
        status: 'verified',
        grossAmountUsd: TEAM_ACCESS_MONTHLY_USD,
        verifiedAt: { not: null },
        stripeSessionId: { not: null },
      },
      orderBy: { verifiedAt: 'desc' },
    }),
    prisma.teamCheckout.findFirst({ where: { teamId, status: 'pending' } }),
  ]);

  if (!verifiedCheckout) {
    return {
      paymentStatus: pendingCheckout ? 'pending' : 'unpaid',
      accessActive: false,
    };
  }

  const purchaser = await prisma.user.findUnique({
    where: { id: verifiedCheckout.userId },
    select: { email: true },
  });
  if (!purchaser?.email) return { paymentStatus: 'unavailable', accessActive: false };
  if (
    !verifiedCheckout.stripeCheckoutId ||
    !verifiedCheckout.stripeCustomerId ||
    !verifiedCheckout.stripeSubscriptionId
  ) {
    return { paymentStatus: 'pending', accessActive: false };
  }

  try {
    const subscription = await getSubscriptionStatus({
      email: purchaser.email,
      stripeCustomerId: verifiedCheckout.stripeCustomerId,
      productKey: TEAM_ACCESS_PRODUCT_KEY,
    });
    return isActiveTeamSubscription(subscription, purchaser.email, {
      checkoutId: verifiedCheckout.stripeCheckoutId,
      customerId: verifiedCheckout.stripeCustomerId,
      subscriptionId: verifiedCheckout.stripeSubscriptionId,
    })
      ? { paymentStatus: 'active', accessActive: true }
      : { paymentStatus: 'inactive', accessActive: false };
  } catch {
    return { paymentStatus: 'unavailable', accessActive: false };
  }
}

async function canUseOwnerTestingAccess(teamId: string, userId: string): Promise<boolean> {
  if (teamId !== OWNER_TESTING_TEAM_ID) return false;

  const [user, membership, team] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true, role: true },
    }),
    prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { role: true },
    }),
    prisma.teamSpace.findUnique({
      where: { id: OWNER_TESTING_TEAM_ID },
      select: { ownerTesting: true },
    }),
  ]);
  const configuredOwnerEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  const configuredOwnerAdmin = Boolean(
    configuredOwnerEmail && user?.email.trim().toLowerCase() === configuredOwnerEmail,
  );
  return Boolean(
    team?.ownerTesting &&
      user?.emailVerified &&
      membership?.role === 'owner' &&
      (user.role !== 'admin' || configuredOwnerAdmin),
  );
}

export async function getTeamAccessState(teamId: string, userId?: string) {
  const [ownerTesting, team] = await Promise.all([
    userId ? canUseOwnerTestingAccess(teamId, userId) : Promise.resolve(false),
    prisma.teamSpace.findUnique({
      where: { id: teamId },
      select: { trialStartedAt: true, trialEndsAt: true },
    }),
  ]);
  const trialStartedAt = team?.trialStartedAt ?? null;
  const trialEndsAt = team?.trialEndsAt ?? null;
  const billing = await getTeamBillingState(teamId);
  const entitlement = resolveTeamEntitlement({
    ownerTesting,
    subscriptionActive: billing.accessActive,
    trialStartedAt,
    trialEndsAt,
    now: new Date(),
  });

  return {
    ...billing,
    ...entitlement,
    // A setup trial or owner-testing flag is not paid access to permit data.
    accessActive: billing.accessActive,
    trialStartedAt: trialStartedAt?.toISOString() ?? null,
    trialEndsAt: trialEndsAt?.toISOString() ?? null,
  };
}

export async function requireTeamAccess(teamId: string, userId: string) {
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    return { response: Response.json({ error: 'team_membership_required' }, { status: 403 }) };
  }

  const access = await getTeamAccessState(teamId, userId);
  if (access.paymentStatus !== 'active' || !access.accessActive) {
    const unavailable = access.paymentStatus === 'unavailable';
    return {
      response: Response.json(
        {
          error: unavailable ? 'billing_status_unavailable' : 'team_subscription_required',
          paymentStatus: access.paymentStatus,
        },
        { status: unavailable ? 503 : 402 },
      ),
    };
  }

  return { membership, response: null, ...access };
}
