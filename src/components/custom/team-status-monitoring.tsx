// @polsia:user-owned — team-wide summary of verified public portal status changes.
'use client';

import { Activity, ArrowRight, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import {
  type PermitStatusDetection,
  PermitStatusDetectionList,
} from '@/lib/contracts/permit-status-detection';
import { TeamList, type TeamListItem } from '@/lib/contracts/team';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function responseErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.cause !== 'object' || error.cause === null) {
    return null;
  }
  if (!('error' in error.cause) || typeof error.cause.error !== 'string') return null;
  return error.cause.error;
}

export function TeamStatusMonitoring({ initialTeamId }: { initialTeamId: string }) {
  const [teams, setTeams] = useState<TeamListItem[] | null>(null);
  const [teamId, setTeamId] = useState(initialTeamId);
  const [teamsError, setTeamsError] = useState(false);
  const [detections, setDetections] = useState<PermitStatusDetection[] | null>(null);
  const [detectionsLoading, setDetectionsLoading] = useState(false);
  const [detectionsError, setDetectionsError] = useState('');
  const teamsRequestId = useRef(0);
  const detectionsRequestId = useRef(0);

  const selectedTeam = useMemo(
    () => teams?.find((team) => team.id === teamId) ?? null,
    [teamId, teams],
  );

  const loadTeams = useCallback(async () => {
    const currentRequest = ++teamsRequestId.current;
    setTeamsError(false);
    try {
      const result = await apiFetch('/api/teams', { schema: TeamList });
      if (teamsRequestId.current !== currentRequest) return;
      setTeams(result.items);
      setTeamId((current) =>
        result.items.some((team) => team.id === initialTeamId)
          ? initialTeamId
          : result.items.some((team) => team.id === current)
            ? current
            : (result.items.find((team) => team.accessActive)?.id ?? result.items[0]?.id ?? ''),
      );
    } catch {
      if (teamsRequestId.current !== currentRequest) return;
      setTeamsError(true);
      setTeams(null);
    }
  }, [initialTeamId]);

  useEffect(() => {
    void loadTeams();
    return () => {
      teamsRequestId.current += 1;
    };
  }, [loadTeams]);

  const loadDetections = useCallback(async () => {
    const currentRequest = ++detectionsRequestId.current;
    if (!selectedTeam) {
      setDetections(null);
      setDetectionsError('');
      setDetectionsLoading(false);
      return;
    }

    if (!selectedTeam.accessActive) {
      setDetections(null);
      setDetectionsError('');
      setDetectionsLoading(false);
      return;
    }

    setDetections(null);
    setDetectionsError('');
    setDetectionsLoading(true);
    void apiFetch(`/api/permit-status-detections?teamId=${encodeURIComponent(selectedTeam.id)}`, {
      schema: PermitStatusDetectionList,
    })
      .then((result) => {
        if (detectionsRequestId.current === currentRequest) setDetections(result.items);
      })
      .catch((error: unknown) => {
        if (detectionsRequestId.current !== currentRequest) return;
        const code = responseErrorCode(error);
        setDetectionsError(
          code === 'billing_status_unavailable'
            ? 'Team billing could not be confirmed. Status changes stay hidden until access can be verified.'
            : code === 'team_subscription_required'
              ? 'An active $299/month DocketKite Team Access subscription is required to view status changes.'
              : code === 'team_membership_required'
                ? 'Your team membership could not be confirmed. Status changes remain hidden.'
                : 'Recent public status changes could not be loaded. Try again.',
        );
      })
      .finally(() => {
        if (detectionsRequestId.current === currentRequest) setDetectionsLoading(false);
      });
  }, [selectedTeam]);

  useEffect(() => {
    void loadDetections();
    return () => {
      detectionsRequestId.current += 1;
    };
  }, [loadDetections]);

  return (
    <div className="grid min-w-0 gap-6">
      <header className="grid gap-4 border-b border-border pb-5 sm:flex sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            State of Florida · Team monitoring
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Public status changes
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Changes are recorded only from later, fresh, permit-identified Florida Accela Record
            Status observations. The hosted watcher is scheduled hourly. A first observation is a
            baseline; repeated, cached, stale, or out-of-order results do not create a change.
          </p>
        </div>
        {teams && teams.length > 0 ? (
          <div className="grid min-w-0 gap-1.5 sm:w-72 sm:shrink-0">
            <label htmlFor="monitoring-team" className="text-sm font-medium">
              Team
            </label>
            <select
              id="monitoring-team"
              className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selectedTeam?.id ?? ''}
              onChange={(event) => setTeamId(event.currentTarget.value)}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      {teams === null && !teamsError ? (
        <output
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-8 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <RotateCw aria-hidden="true" className="size-4 motion-reduce:animate-none" />
          Loading your teams…
        </output>
      ) : teamsError ? (
        <section className="rounded-xl border border-destructive/40 bg-card p-6" role="alert">
          <p className="font-medium">Your teams could not be loaded.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => void loadTeams()}>
            Try again
          </Button>
        </section>
      ) : teams?.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card/70 px-6 py-12 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-secondary text-primary">
            <Activity aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-foreground">No team spaces yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Create a team or join one before reviewing its public permit status changes.
          </p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/dashboard">Go to team workspace</Link>
          </Button>
        </section>
      ) : selectedTeam && !selectedTeam.accessActive ? (
        <section className="grid gap-2 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Team monitoring is locked</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {selectedTeam.paymentStatus === 'unavailable'
              ? 'The active team subscription could not be confirmed. No monitoring records are shown.'
              : 'A verified, active DocketKite Team Access subscription at $299/month is required. No monitoring records are shown.'}
          </p>
        </section>
      ) : detectionsLoading ? (
        <output
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-8 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <RotateCw aria-hidden="true" className="size-4 motion-reduce:animate-none" />
          Loading public status changes…
        </output>
      ) : detectionsError ? (
        <section className="rounded-xl border border-destructive/40 bg-card p-6" role="alert">
          <p className="font-medium">{detectionsError}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void loadDetections()}
          >
            Try again
          </Button>
        </section>
      ) : detections?.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card/70 px-6 py-12 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-secondary text-primary">
            <Activity aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            No public status changes detected
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            {selectedTeam?.name} has no detected changes between successful portal checks yet. A
            first successful check establishes a baseline and is not listed as a change.
          </p>
        </section>
      ) : detections ? (
        <section className="grid gap-3" aria-label="Recent detected public status changes">
          <p className="text-sm text-muted-foreground">
            {detections.length} recent {detections.length === 1 ? 'change' : 'changes'} across the
            team
          </p>
          <ol className="grid gap-3">
            {detections.map((detection) => (
              <li
                key={detection.id}
                data-testid={`status-change-${detection.id}`}
                className="grid min-w-0 gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-start sm:p-5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {detection.permitNumber || 'Permit number not added'} · {detection.permitType}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-foreground">
                    {detection.projectName}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{detection.address}</p>
                  <a
                    className="mt-2 block w-fit max-w-full text-xs font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={detection.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open official City record
                  </a>
                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="text-muted-foreground">{detection.previousStatus}</span>
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span className="font-semibold text-foreground">{detection.newStatus}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                  <time className="text-xs text-muted-foreground" dateTime={detection.detectedAt}>
                    DocketKite check {formatDate(detection.detectedAt)}
                  </time>
                  <time className="text-xs text-muted-foreground" dateTime={detection.observedAt}>
                    City page read {formatDate(detection.observedAt)}
                  </time>
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link
                      href={`/dashboard/permits/${encodeURIComponent(detection.permitId)}?teamId=${encodeURIComponent(selectedTeam?.id ?? '')}`}
                      aria-label={`View status history for ${detection.projectName}`}
                    >
                      View status history
                    </Link>
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                  Target:{' '}
                  {detection.targetedRole === 'project_manager' ? 'project manager' : 'unassigned'}
                  {' · '}Text: {detection.textDeliveryStatus} — {detection.textDeliveryMessage}
                  {' · '}Checklist: {detection.checklistMatchStatus} —{' '}
                  {detection.checklistMatchMessage}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
