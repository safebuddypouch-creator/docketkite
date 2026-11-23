// @polsia:user-owned — shared team access and checkout response contracts.
import { z } from 'zod';

export const OWNER_TESTING_TEAM_ID = 'owner-testing-workspace';

export const TeamListItem = z.object({
  id: z.string(),
  name: z.string(),
  joinCode: z.string().nullable(),
  role: z.string(),
  paymentStatus: z.enum(['unpaid', 'pending', 'active', 'inactive', 'unavailable']),
  accessActive: z.boolean(),
  accessMode: z.enum(['free_trial', 'paid_subscription', 'owner_testing', 'subscription_required']),
  trialStartedAt: z.string().datetime().nullable(),
  trialEndsAt: z.string().datetime().nullable(),
  trialStatus: z.enum(['not_started', 'active', 'expired']),
});

export const TeamList = z.object({ items: z.array(TeamListItem) });

export const TeamCreateOrJoin = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(2).max(80),
  }),
  z.object({
    action: z.literal('join'),
    joinCode: z.string().trim().min(6).max(32),
  }),
]);

export const TeamCheckoutRequest = z.object({ teamId: z.string().min(1) });
export const TeamCheckoutResponse = z.object({ url: z.string().url() });
export const TeamCheckoutVerificationRequest = z.union([
  z.object({ session_id: z.string().min(1) }).strict(),
  z.object({ teamId: z.string().min(1) }).strict(),
]);
export const TeamCheckoutVerification = z.object({
  verified: z.boolean(),
  reason: z.enum(['subscription_link_pending', 'subscription_inactive']).optional(),
  subscriptionStatus: z
    .enum([
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'paused',
      'not_found',
    ])
    .optional(),
});

export type TeamListItem = z.infer<typeof TeamListItem>;
export type TeamList = z.infer<typeof TeamList>;
