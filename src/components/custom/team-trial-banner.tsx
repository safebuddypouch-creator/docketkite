// @polsia:user-owned — saved trial countdown and explicit team upgrade action.
'use client';

import { Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TeamListItem } from '@/lib/contracts/team';
import { getTeamTrialCountdown, TEAM_TRIAL_DAY_MS } from '@/lib/team-entitlements';

function utcTimestamp(value: string): string {
  return `${new Date(value).toISOString().replace('T', ' ').replace('Z', '')} UTC`;
}

export function TeamTrialBanner({
  team,
  working,
  onUpgrade,
}: {
  team: TeamListItem;
  working: boolean;
  onUpgrade: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const syncNow = () => setNow(Date.now());
    const start = team.trialStartedAt ? Date.parse(team.trialStartedAt) : Number.NaN;
    const end = team.trialEndsAt ? Date.parse(team.trialEndsAt) : Number.NaN;
    const countdown = getTeamTrialCountdown(
      Number.isNaN(start) ? null : new Date(start),
      Number.isNaN(end) ? null : new Date(end),
      new Date(now),
    );

    let nextUpdateAt: number | null = null;
    if (countdown.status === 'not_started' && start > now) {
      nextUpdateAt = start;
    } else if (countdown.status === 'active' && countdown.remainingDays !== null) {
      nextUpdateAt = end - (countdown.remainingDays - 1) * TEAM_TRIAL_DAY_MS;
    }

    const timeoutId =
      nextUpdateAt === null ? null : window.setTimeout(syncNow, Math.max(1, nextUpdateAt - now));
    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', syncNow);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', syncNow);
    };
  }, [now, team.trialEndsAt, team.trialStartedAt]);

  if (
    !team.trialStartedAt ||
    !team.trialEndsAt ||
    team.paymentStatus === 'active' ||
    team.accessActive
  ) {
    return null;
  }

  const countdown = getTeamTrialCountdown(
    new Date(team.trialStartedAt),
    new Date(team.trialEndsAt),
    new Date(now),
  );
  if (countdown.status === 'not_started') return null;

  const expired = countdown.status === 'expired';
  const canUpgrade = team.role === 'owner' || team.role === 'purchaser';
  const remainingDays = countdown.remainingDays;

  return (
    <section
      aria-label="Team trial status"
      aria-live="polite"
      className={`flex min-w-0 flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${
        expired ? 'border-destructive/30 bg-destructive/5' : 'border-primary/25 bg-primary/5'
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-background text-primary">
          <Clock3 aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={expired ? 'destructive' : 'secondary'}>
              {expired ? 'Trial expired' : 'Trial active'}
            </Badge>
            <h2 className="font-semibold tracking-tight">
              {expired
                ? `Trial ended for ${team.name}`
                : `${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left in the 30-day trial for ${team.name}`}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved trial end:{' '}
            <time dateTime={team.trialEndsAt}>{utcTimestamp(team.trialEndsAt)}</time>.
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
            {expired
              ? 'No automatic charge or paid conversion occurred. Your team and records remain stored. Permit records, correction letters, checklists, and PDFs stay locked until an owner or purchaser upgrades and the matching $299/month subscription is verified active.'
              : 'No charge or paid conversion happens automatically. Permit records, correction letters, checklists, and PDFs stay locked until the matching $299/month subscription is verified active.'}
          </p>
          {!canUpgrade ? (
            <p className="mt-1 text-sm text-muted-foreground">
              A team owner or purchaser can start the hosted checkout.
            </p>
          ) : null}
        </div>
      </div>
      {canUpgrade ? (
        <Button
          type="button"
          className="w-full shrink-0 sm:w-auto"
          disabled={working}
          onClick={onUpgrade}
        >
          {working ? 'Starting checkout…' : 'Upgrade · $299/month'}
        </Button>
      ) : null}
    </section>
  );
}
