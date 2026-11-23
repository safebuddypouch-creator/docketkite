// @polsia:user-owned — pure team trial and entitlement rules.

export const TEAM_TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type TeamTrialStatus = 'not_started' | 'active' | 'expired';
export const TEAM_TRIAL_DAY_MS = 24 * 60 * 60 * 1000;
export type TeamAccessMode =
  | 'free_trial'
  | 'paid_subscription'
  | 'owner_testing'
  | 'subscription_required';

export function createTeamTrialWindow(startedAt: Date): {
  trialStartedAt: Date;
  trialEndsAt: Date;
} {
  const trialStartedAt = new Date(startedAt.getTime());
  return {
    trialStartedAt,
    trialEndsAt: new Date(trialStartedAt.getTime() + TEAM_TRIAL_DURATION_MS),
  };
}

export function getTeamTrialStatus(
  trialStartedAt: Date | null,
  trialEndsAt: Date | null,
  now: Date,
): TeamTrialStatus {
  if (!trialStartedAt || !trialEndsAt) return 'not_started';
  if (now.getTime() < trialStartedAt.getTime()) return 'not_started';
  return now.getTime() < trialEndsAt.getTime() ? 'active' : 'expired';
}

export function getTeamTrialCountdown(
  trialStartedAt: Date | null,
  trialEndsAt: Date | null,
  now: Date,
): { status: TeamTrialStatus; remainingDays: number | null } {
  const status = getTeamTrialStatus(trialStartedAt, trialEndsAt, now);
  if (status !== 'active' || !trialEndsAt) return { status, remainingDays: null };

  return {
    status,
    remainingDays: Math.ceil((trialEndsAt.getTime() - now.getTime()) / TEAM_TRIAL_DAY_MS),
  };
}

export function resolveTeamEntitlement(input: {
  ownerTesting: boolean;
  subscriptionActive: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  now: Date;
}): { accessActive: boolean; accessMode: TeamAccessMode; trialStatus: TeamTrialStatus } {
  const trialStatus = getTeamTrialStatus(input.trialStartedAt, input.trialEndsAt, input.now);

  if (input.subscriptionActive) {
    return { accessActive: true, accessMode: 'paid_subscription', trialStatus };
  }
  if (input.ownerTesting) {
    return { accessActive: false, accessMode: 'owner_testing', trialStatus };
  }
  if (trialStatus === 'active') {
    return { accessActive: false, accessMode: 'free_trial', trialStatus };
  }
  return { accessActive: false, accessMode: 'subscription_required', trialStatus };
}
