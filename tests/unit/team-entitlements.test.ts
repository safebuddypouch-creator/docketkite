// @polsia:user-owned — team trial cutoff, renewal, and access decisions.
import { describe, expect, it } from 'vitest';
import {
  createTeamTrialWindow,
  getTeamTrialCountdown,
  getTeamTrialStatus,
  resolveTeamEntitlement,
  TEAM_TRIAL_DAY_MS,
  TEAM_TRIAL_DURATION_MS,
} from '@/lib/team-entitlements';

const teamCreatedAt = new Date('2026-01-10T12:34:56.789Z');
const trial = createTeamTrialWindow(teamCreatedAt);

describe('team trial window', () => {
  it('persists a start at team creation and an end exactly 30 elapsed days later', () => {
    expect(trial.trialStartedAt.toISOString()).toBe(teamCreatedAt.toISOString());
    expect(trial.trialEndsAt.getTime() - trial.trialStartedAt.getTime()).toBe(
      TEAM_TRIAL_DURATION_MS,
    );
    expect(trial.trialEndsAt.toISOString()).toBe('2026-02-09T12:34:56.789Z');
  });

  it('grants trial access immediately before the stored end and expires at the exact end instant', () => {
    const justBeforeEnd = new Date(trial.trialEndsAt.getTime() - 1);
    const exactlyAtEnd = new Date(trial.trialEndsAt.getTime());
    const justAfterEnd = new Date(trial.trialEndsAt.getTime() + 1);

    expect(getTeamTrialStatus(trial.trialStartedAt, trial.trialEndsAt, justBeforeEnd)).toBe(
      'active',
    );
    expect(getTeamTrialStatus(trial.trialStartedAt, trial.trialEndsAt, exactlyAtEnd)).toBe(
      'expired',
    );
    expect(getTeamTrialStatus(trial.trialStartedAt, trial.trialEndsAt, justAfterEnd)).toBe(
      'expired',
    );
  });

  it('rounds a partial day up and counts whole remaining days from the saved UTC end', () => {
    const savedEnd = new Date('2026-02-09T12:34:56.789Z');

    expect(
      getTeamTrialCountdown(trial.trialStartedAt, savedEnd, new Date(savedEnd.getTime() - 1)),
    ).toEqual({ status: 'active', remainingDays: 1 });
    expect(
      getTeamTrialCountdown(
        trial.trialStartedAt,
        savedEnd,
        new Date(savedEnd.getTime() - TEAM_TRIAL_DAY_MS - 1),
      ),
    ).toEqual({ status: 'active', remainingDays: 2 });
  });

  it('switches to expired at the saved end, with no remaining-day value before or after it', () => {
    const justBeforeEnd = new Date(trial.trialEndsAt.getTime() - 1);

    expect(getTeamTrialCountdown(trial.trialStartedAt, trial.trialEndsAt, justBeforeEnd)).toEqual({
      status: 'active',
      remainingDays: 1,
    });
    expect(
      getTeamTrialCountdown(trial.trialStartedAt, trial.trialEndsAt, trial.trialEndsAt),
    ).toEqual({
      status: 'expired',
      remainingDays: null,
    });
    expect(
      getTeamTrialCountdown(
        trial.trialStartedAt,
        trial.trialEndsAt,
        new Date(trial.trialEndsAt.getTime() + 1),
      ),
    ).toEqual({ status: 'expired', remainingDays: null });
  });

  it('uses the same stored window for later members and reloads without moving its dates', () => {
    const storedStart = trial.trialStartedAt.toISOString();
    const storedEnd = trial.trialEndsAt.toISOString();
    const laterMemberJoinsAt = new Date(trial.trialStartedAt.getTime() + 20 * 24 * 60 * 60 * 1000);
    const reloadsAt = new Date(trial.trialEndsAt.getTime() + 10_000);

    expect(getTeamTrialStatus(trial.trialStartedAt, trial.trialEndsAt, laterMemberJoinsAt)).toBe(
      'active',
    );
    expect(getTeamTrialStatus(trial.trialStartedAt, trial.trialEndsAt, reloadsAt)).toBe('expired');
    expect(trial.trialStartedAt.toISOString()).toBe(storedStart);
    expect(trial.trialEndsAt.toISOString()).toBe(storedEnd);
  });

  it('does not create trial eligibility for existing teams without stored dates', () => {
    expect(getTeamTrialStatus(null, null, teamCreatedAt)).toBe('not_started');
    expect(
      resolveTeamEntitlement({
        ownerTesting: false,
        subscriptionActive: false,
        trialStartedAt: null,
        trialEndsAt: null,
        now: teamCreatedAt,
      }),
    ).toEqual({
      accessActive: false,
      accessMode: 'subscription_required',
      trialStatus: 'not_started',
    });
  });
});

describe('team entitlement decisions', () => {
  it('keeps permit access locked during the setup window and after expiry without a verified plan', () => {
    expect(
      resolveTeamEntitlement({
        ownerTesting: false,
        subscriptionActive: false,
        ...trial,
        now: new Date(trial.trialEndsAt.getTime() - 1),
      }),
    ).toMatchObject({ accessActive: false, accessMode: 'free_trial', trialStatus: 'active' });
    expect(
      resolveTeamEntitlement({
        ownerTesting: false,
        subscriptionActive: false,
        ...trial,
        now: trial.trialEndsAt,
      }),
    ).toMatchObject({
      accessActive: false,
      accessMode: 'subscription_required',
      trialStatus: 'expired',
    });
  });

  it('preserves verified paid access after the setup window without granting owner-testing access', () => {
    expect(
      resolveTeamEntitlement({
        ownerTesting: false,
        subscriptionActive: true,
        ...trial,
        now: trial.trialEndsAt,
      }),
    ).toMatchObject({
      accessActive: true,
      accessMode: 'paid_subscription',
      trialStatus: 'expired',
    });
    expect(
      resolveTeamEntitlement({
        ownerTesting: true,
        subscriptionActive: false,
        trialStartedAt: null,
        trialEndsAt: null,
        now: trial.trialEndsAt,
      }),
    ).toMatchObject({ accessActive: false, accessMode: 'owner_testing' });
  });

  it('lets an active subscription unlock the dedicated testing workspace', () => {
    expect(
      resolveTeamEntitlement({
        ownerTesting: true,
        subscriptionActive: true,
        ...trial,
        now: trial.trialStartedAt,
      }),
    ).toMatchObject({ accessActive: true, accessMode: 'paid_subscription', trialStatus: 'active' });
  });
});
