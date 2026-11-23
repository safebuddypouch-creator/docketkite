// @polsia:user-owned — team subscription access checks.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMembership: vi.fn(),
  findCheckout: vi.fn(),
  findTeam: vi.fn(),
  findUser: vi.fn(),
  getSubscriptionStatus: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    teamMembership: { findUnique: mocks.findMembership },
    teamCheckout: { findFirst: mocks.findCheckout },
    teamSpace: { findUnique: mocks.findTeam },
    user: { findUnique: mocks.findUser },
  },
}));
vi.mock('@/lib/stripe-billing/client', () => ({
  getSubscriptionStatus: mocks.getSubscriptionStatus,
}));
vi.mock('@/lib/env', () => ({ env: { POLSIA_OWNER_EMAIL: 'owner@example.test' } }));

import { TEAM_ACCESS_PRODUCT_KEY } from '@/lib/business/team-billing';
import { OWNER_TESTING_TEAM_ID } from '@/lib/contracts/team';
import { getTeamAccessState, getTeamBillingState, requireTeamAccess } from '@/lib/team-access';

function verifiedCheckout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'verified-checkout',
    userId: 'purchaser-1',
    stripeCheckoutId: 'stripe-checkout-1',
    stripeCustomerId: 'cus_123456',
    stripeSubscriptionId: 'sub_123456',
    ...overrides,
  };
}

function activeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    status: 'active',
    plan: 'DocketKite Team Access',
    monthly_amount: 299,
    product_key: TEAM_ACCESS_PRODUCT_KEY,
    customer_email: 'OWNER@example.test',
    stripe_customer_id: 'cus_123456',
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

describe('team subscription access', () => {
  beforeEach(() => vi.resetAllMocks());

  it('requires a verified $299 checkout and an active matching subscription', async () => {
    mocks.findCheckout.mockResolvedValueOnce(verifiedCheckout()).mockResolvedValueOnce(null);
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });
    mocks.getSubscriptionStatus.mockResolvedValue(activeSubscription());

    await expect(getTeamBillingState('team-1')).resolves.toEqual({
      paymentStatus: 'active',
      accessActive: true,
    });
    expect(mocks.getSubscriptionStatus).toHaveBeenCalledWith({
      email: 'owner@example.test',
      stripeCustomerId: 'cus_123456',
      productKey: TEAM_ACCESS_PRODUCT_KEY,
    });
  });

  it('does not let a different customer subscription unlock the team', async () => {
    mocks.findCheckout.mockResolvedValueOnce(verifiedCheckout()).mockResolvedValueOnce(null);
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });
    mocks.getSubscriptionStatus.mockResolvedValue(
      activeSubscription({
        customer_email: 'other@example.test',
      }),
    );

    await expect(getTeamBillingState('team-1')).resolves.toEqual({
      paymentStatus: 'inactive',
      accessActive: false,
    });
  });

  it('fails closed when Stripe does not return the subscription customer identity', async () => {
    mocks.findCheckout.mockResolvedValueOnce(verifiedCheckout()).mockResolvedValueOnce(null);
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });
    mocks.getSubscriptionStatus.mockResolvedValue({
      active: true,
      status: 'active',
      plan: 'DocketKite Team Access',
      monthly_amount: 299,
      product_key: TEAM_ACCESS_PRODUCT_KEY,
    });

    await expect(getTeamBillingState('team-1')).resolves.toEqual({
      paymentStatus: 'inactive',
      accessActive: false,
    });
  });

  it('keeps payment verified but access pending while Stripe links the customer or subscription', async () => {
    mocks.findCheckout
      .mockResolvedValueOnce(
        verifiedCheckout({ stripeCustomerId: null, stripeSubscriptionId: null }),
      )
      .mockResolvedValueOnce(null);
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });

    await expect(getTeamBillingState('team-1')).resolves.toEqual({
      paymentStatus: 'pending',
      accessActive: false,
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps unpaid teams locked without querying subscription status', async () => {
    mocks.findCheckout.mockResolvedValue(null);

    await expect(getTeamBillingState('team-1')).resolves.toEqual({
      paymentStatus: 'unpaid',
      accessActive: false,
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps the flagged owner-testing workspace locked from unpaid permit data', async () => {
    mocks.findTeam.mockResolvedValue({ ownerTesting: true });
    mocks.findUser.mockResolvedValue({
      email: 'separate-tester@example.test',
      emailVerified: true,
      role: 'user',
    });
    mocks.findMembership.mockResolvedValue({ role: 'owner' });

    await expect(getTeamAccessState(OWNER_TESTING_TEAM_ID, 'test-user')).resolves.toEqual({
      paymentStatus: 'unpaid',
      accessActive: false,
      accessMode: 'owner_testing',
      trialStartedAt: null,
      trialEndsAt: null,
      trialStatus: 'not_started',
    });
    expect(mocks.findTeam).toHaveBeenCalledWith({
      where: { id: OWNER_TESTING_TEAM_ID },
      select: { ownerTesting: true },
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('honors a verified active subscription on the owner-testing workspace', async () => {
    mocks.findTeam.mockResolvedValue({ ownerTesting: true });
    mocks.findUser.mockResolvedValue({
      email: 'owner@example.test',
      emailVerified: true,
      role: 'user',
    });
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findCheckout
      .mockResolvedValueOnce(verifiedCheckout({ userId: 'test-user' }))
      .mockResolvedValueOnce(null);
    mocks.getSubscriptionStatus.mockResolvedValue(activeSubscription());

    await expect(getTeamAccessState(OWNER_TESTING_TEAM_ID, 'test-user')).resolves.toMatchObject({
      paymentStatus: 'active',
      accessActive: true,
      accessMode: 'paid_subscription',
    });
    expect(mocks.findCheckout).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ teamId: OWNER_TESTING_TEAM_ID }),
      }),
    );
    expect(mocks.getSubscriptionStatus).toHaveBeenCalledWith({
      email: 'owner@example.test',
      stripeCustomerId: 'cus_123456',
      productKey: TEAM_ACCESS_PRODUCT_KEY,
    });
  });

  it('scopes a verified checkout to its own team', async () => {
    mocks.findCheckout.mockResolvedValue(null);

    await expect(getTeamBillingState('different-team')).resolves.toEqual({
      paymentStatus: 'unpaid',
      accessActive: false,
    });
    expect(mocks.findCheckout).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ teamId: 'different-team' }) }),
    );
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps an unpaid unflagged team locked for a verified owner', async () => {
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findCheckout.mockResolvedValue(null);

    const result = await requireTeamAccess('customer-team', 'test-user');

    expect(result.response?.status).toBe(402);
    expect(result.response && (await result.response.json())).toMatchObject({
      error: 'team_subscription_required',
      paymentStatus: 'unpaid',
    });
    expect(mocks.findTeam).toHaveBeenCalledWith({
      where: { id: 'customer-team' },
      select: { trialStartedAt: true, trialEndsAt: true },
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('does not let a non-owner member use the flagged testing workspace', async () => {
    mocks.findTeam.mockResolvedValue({ ownerTesting: true });
    mocks.findUser.mockResolvedValue({
      email: 'separate-tester@example.test',
      emailVerified: true,
      role: 'user',
    });
    mocks.findMembership.mockResolvedValue({ role: 'project_manager' });
    mocks.findCheckout.mockResolvedValue(null);

    const result = await requireTeamAccess(OWNER_TESTING_TEAM_ID, 'test-user');

    expect(result.response?.status).toBe(402);
    expect(result.response && (await result.response.json())).toMatchObject({
      error: 'team_subscription_required',
      paymentStatus: 'unpaid',
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('does not let an unverified account use the flagged testing workspace', async () => {
    mocks.findTeam.mockResolvedValue({ ownerTesting: true });
    mocks.findUser.mockResolvedValue({
      email: 'separate-tester@example.test',
      emailVerified: false,
      role: 'user',
    });
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findCheckout.mockResolvedValue(null);

    const result = await requireTeamAccess(OWNER_TESTING_TEAM_ID, 'test-user');

    expect(result.response?.status).toBe(402);
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps a pending checkout locked while it is waiting for verification', async () => {
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findCheckout
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'pending-checkout' });

    const result = await requireTeamAccess('team-1', 'owner-1');

    expect(result.response?.status).toBe(402);
    expect(result.response && (await result.response.json())).toMatchObject({
      error: 'team_subscription_required',
      paymentStatus: 'pending',
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps a newly created team locked from permit data during its setup window', async () => {
    const trialStartedAt = new Date('2026-11-01T12:00:00.000Z');
    const trialEndsAt = new Date('2026-12-01T12:00:00.000Z');
    mocks.findTeam.mockResolvedValue({ trialStartedAt, trialEndsAt });
    mocks.findCheckout.mockResolvedValue(null);

    await expect(getTeamAccessState('team-1', 'member-1')).resolves.toMatchObject({
      paymentStatus: 'unpaid',
      accessActive: false,
      accessMode: 'free_trial',
      trialStartedAt: trialStartedAt.toISOString(),
      trialEndsAt: trialEndsAt.toISOString(),
      trialStatus: 'active',
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('denies an expired trial while checkout is pending and unverified', async () => {
    mocks.findTeam.mockResolvedValue({
      trialStartedAt: new Date('2026-10-01T12:00:00.000Z'),
      trialEndsAt: new Date('2026-10-31T12:00:00.000Z'),
    });
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findCheckout
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'pending-checkout' });

    const result = await requireTeamAccess('team-1', 'owner-1');

    expect(result.response?.status).toBe(402);
    expect(result.response && (await result.response.json())).toMatchObject({
      error: 'team_subscription_required',
      paymentStatus: 'pending',
    });
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('keeps a new paid subscription active when the team trial dates have expired', async () => {
    mocks.findTeam.mockResolvedValue({
      trialStartedAt: new Date('2026-10-01T12:00:00.000Z'),
      trialEndsAt: new Date('2026-10-31T12:00:00.000Z'),
    });
    mocks.findCheckout.mockResolvedValueOnce(verifiedCheckout()).mockResolvedValueOnce(null);
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });
    mocks.getSubscriptionStatus.mockResolvedValue(
      activeSubscription({ customer_email: 'owner@example.test' }),
    );

    await expect(getTeamAccessState('team-1', 'member-1')).resolves.toMatchObject({
      paymentStatus: 'active',
      accessActive: true,
      accessMode: 'paid_subscription',
      trialStatus: 'expired',
    });
  });

  it('looks only for a verified checkout with a confirmed $299 gross amount', async () => {
    mocks.findCheckout.mockResolvedValue(null);

    await getTeamBillingState('team-1');

    expect(mocks.findCheckout).toHaveBeenNthCalledWith(1, {
      where: {
        teamId: 'team-1',
        status: 'verified',
        grossAmountUsd: 299,
        verifiedAt: { not: null },
        stripeSessionId: { not: null },
      },
      orderBy: { verifiedAt: 'desc' },
    });
    expect(mocks.findCheckout).toHaveBeenNthCalledWith(2, {
      where: { teamId: 'team-1', status: 'pending' },
    });
  });

  it('requires membership before checking billing or returning team data', async () => {
    mocks.findMembership.mockResolvedValue(null);

    const result = await requireTeamAccess('team-1', 'member-1');

    expect(result.response?.status).toBe(403);
    expect(mocks.findCheckout).not.toHaveBeenCalled();
  });

  it.each(['owner', 'project_manager', 'purchaser'])(
    'does not let a %s membership bypass verified payment and active subscription',
    async (role) => {
      mocks.findMembership.mockResolvedValue({ role });
      mocks.findCheckout.mockResolvedValue(null);

      const result = await requireTeamAccess('unpaid-team', 'member-1');

      expect(result.response?.status).toBe(402);
      expect('accessMode' in result).toBe(false);
      expect(mocks.findUser).not.toHaveBeenCalled();
      expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
    },
  );

  it('keeps a verified checkout locked when its subscription is inactive', async () => {
    mocks.findCheckout.mockResolvedValueOnce(verifiedCheckout()).mockResolvedValueOnce(null);
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });
    mocks.getSubscriptionStatus.mockResolvedValue({
      active: false,
      status: 'canceled',
      plan: 'DocketKite Team Access',
      monthly_amount: 299,
      customer_email: 'owner@example.test',
      product_key: TEAM_ACCESS_PRODUCT_KEY,
    });

    const result = await requireTeamAccess('team-1', 'owner-1');

    expect(result.response?.status).toBe(402);
    expect(result.response && (await result.response.json())).toMatchObject({
      error: 'team_subscription_required',
      paymentStatus: 'inactive',
    });
  });

  it('fails closed when the billing service cannot confirm subscription state', async () => {
    mocks.findCheckout.mockResolvedValueOnce(verifiedCheckout()).mockResolvedValueOnce(null);
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.findUser.mockResolvedValue({ email: 'owner@example.test' });
    mocks.getSubscriptionStatus.mockRejectedValue(new Error('billing unavailable'));

    const result = await requireTeamAccess('team-1', 'owner-1');

    expect(result.response?.status).toBe(503);
    expect(result.response && (await result.response.json())).toMatchObject({
      error: 'billing_status_unavailable',
      paymentStatus: 'unavailable',
    });
  });
});
