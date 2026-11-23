// @polsia:user-owned — on-demand public City of Tampa status checks and history.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { getOfficialPermitPortalUrl, isHistoricalSanJosePortalUrl } from '@/lib/contracts/permit';
import {
  type PermitPortalCheckItem,
  PermitPortalCheckList,
  PermitPortalCheckMutation,
  PermitPortalCheckUrlError,
  type PermitPortalMonitoringState,
  type PermitPortalVerifiedResult,
} from '@/lib/contracts/permit-portal-check';

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function resultLabel(result: PermitPortalCheckItem['result']): string {
  if (result === 'checked') return 'Checked';
  if (result === 'unverified') return 'Unverified';
  return 'Unavailable';
}

const missingRecordStatusReason =
  'The public page did not show a readable public Record Status field.';

function latestAttemptExplanation(check: PermitPortalCheckItem): string {
  if (check.result === 'unavailable') {
    return 'This public check did not complete, so it could not determine a current public status.';
  }
  if (check.result === 'unverified' && check.message === missingRecordStatusReason) {
    return 'The public City page was reached, but it did not provide a readable Record Status. This attempt did not verify a current status.';
  }
  return check.message ?? 'The public City status was not verified.';
}

export function PermitPortalMonitor({
  permitId,
  permitNumber,
  portalUrl,
  teamId,
  archived,
  retryOnly = false,
}: {
  permitId: string;
  permitNumber: string;
  portalUrl: string;
  teamId: string;
  archived: boolean;
  retryOnly?: boolean;
}) {
  const [checks, setChecks] = useState<PermitPortalCheckItem[] | null>(null);
  const [monitoring, setMonitoring] = useState<PermitPortalMonitoringState | null>(null);
  const [latestVerified, setLatestVerified] = useState<PermitPortalVerifiedResult | null>(null);
  const [canRetryAsOwner, setCanRetryAsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [actionError, setActionError] = useState('');
  const tampaPortalUrl = getOfficialPermitPortalUrl(portalUrl);
  const ready = Boolean(permitNumber.trim() && tampaPortalUrl);
  const historicalSanJose = isHistoricalSanJosePortalUrl(portalUrl);
  const query = new URLSearchParams({ permitId, teamId }).toString();
  const latestCheck = checks?.[0] ?? null;
  const retryingFailure = latestCheck !== null && latestCheck.result !== 'checked';
  const canRetry =
    !loading &&
    !historyError &&
    (retryOnly
      ? canRetryAsOwner && latestCheck !== null && latestCheck.result !== 'checked'
      : latestCheck === null || latestCheck.result === 'checked' || canRetryAsOwner);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setHistoryError(false);
    setChecks(null);
    setMonitoring(null);
    setLatestVerified(null);
    try {
      const data = await apiFetch(`/api/permit-portal-checks?${query}`, {
        schema: PermitPortalCheckList,
      });
      setChecks(data.items);
      setMonitoring(data.monitoring);
      setLatestVerified(data.latestVerified);
      setCanRetryAsOwner(data.canRetry);
    } catch {
      setHistoryError(true);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function checkNow() {
    if (!ready || archived || working) return;
    setWorking(true);
    setActionError('');
    try {
      await apiFetch(`/api/permit-portal-checks?permitId=${encodeURIComponent(permitId)}`, {
        method: 'POST',
        body: JSON.stringify({ teamId }),
        schema: PermitPortalCheckMutation,
      });
      await loadHistory();
    } catch (error) {
      const validationError = PermitPortalCheckUrlError.safeParse(
        error instanceof Error ? error.cause : null,
      );
      setActionError(
        validationError.success
          ? validationError.data.message
          : 'The check could not be saved. Confirm team access and try again.',
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="mt-5 grid gap-4 rounded-xl border border-primary/20 bg-primary/[0.035] p-4 sm:p-5"
      aria-label={`Public City status for permit ${permitNumber || 'without a number'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {tampaPortalUrl
              ? 'City of Tampa · public record'
              : historicalSanJose
                ? 'Historical San José record · monitoring retired'
                : portalUrl
                  ? 'Unsupported portal link · not monitored'
                  : 'No public record link'}
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">Watcher health</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Checks read only the public City of Tampa page; they do not access secure or
            applicant-only records. The hosted watcher is scheduled hourly while DocketKite&apos;s
            platform subscription is active, and team owners can run a one-off public check. The
            exact Record Status is stored separately from your team&apos;s status, notes, and
            correction tasks. The source read time may predate a check when the retrieval service
            serves a cached page.
          </p>
        </div>
        {canRetry ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void checkNow()}
            disabled={!ready || archived || working}
          >
            {working
              ? retryingFailure
                ? 'Retrying…'
                : 'Checking…'
              : retryOnly
                ? 'Retry check'
                : 'Run public check'}
          </Button>
        ) : null}
        {working ? (
          <output className="text-sm text-muted-foreground" aria-live="polite">
            {retryingFailure
              ? 'Retrying the public City of Tampa record check…'
              : 'Checking the public City of Tampa record…'}
          </output>
        ) : null}
      </div>

      <div className="grid gap-3 border-y border-border/80 py-3 sm:grid-cols-2">
        {loading ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Loading saved watcher health…
          </p>
        ) : historyError || !monitoring ? (
          <output className="text-sm font-medium text-destructive">
            Watcher health unavailable. Saved outcomes could not be loaded.
          </output>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Last successful City of Tampa portal check
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {monitoring.lastSuccessfulPortalCheckAt ? (
                  <time dateTime={monitoring.lastSuccessfulPortalCheckAt}>
                    {formatDate(monitoring.lastSuccessfulPortalCheckAt)}
                  </time>
                ) : (
                  'No successful checks yet'
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Monitoring health</p>
              <output
                className={`mt-1 text-sm font-semibold ${monitoring.interruptedAt ? 'text-destructive' : 'text-foreground'}`}
              >
                {monitoring.interruptedAt
                  ? `Interrupted · ${formatDate(monitoring.interruptedAt)}`
                  : monitoring.lastSuccessfulPortalCheckAt
                    ? 'No interruption recorded'
                    : 'No saved outcomes yet'}
              </output>
              {monitoring.reason ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{monitoring.reason}</p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <section
        aria-label="Last verified City of Tampa portal result"
        className="grid gap-2 rounded-lg border border-border bg-background/80 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-4"
      >
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {latestCheck?.result === 'checked'
              ? 'Verified public City of Tampa result · Record Status'
              : 'Last successful public City of Tampa result · Record Status'}
          </p>
          <p className="mt-1 break-words text-base font-semibold text-foreground">
            {loading
              ? 'Loading saved portal result…'
              : historyError
                ? 'The saved City of Tampa result could not be loaded.'
                : (latestVerified?.status ??
                  'No successful City of Tampa result has been verified yet.')}
          </p>
          {latestVerified ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Permit {latestVerified.permitNumber} · DocketKite check{' '}
              <time dateTime={latestVerified.checkedAt}>
                {formatDate(latestVerified.checkedAt)}
              </time>
              {' · '}City page read{' '}
              <time dateTime={latestVerified.sourceFetchedAt}>
                {formatDate(latestVerified.sourceFetchedAt)}
              </time>
            </p>
          ) : null}
          {latestVerified && latestCheck && latestCheck.result !== 'checked' ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              The latest attempt did not verify a current public status. This value is the last
              successful public reading.
            </p>
          ) : null}
        </div>
        {latestVerified ? (
          <a
            className="w-fit max-w-full break-words text-xs font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={latestVerified.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open official City record used for this check
          </a>
        ) : null}
      </section>

      {latestCheck && latestCheck.result !== 'checked' ? (
        <section
          aria-label="Latest City of Tampa monitoring attempt"
          className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.035] p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-destructive/40 px-2.5 py-1 text-xs font-semibold text-destructive">
              {resultLabel(latestCheck.result)}
            </span>
            <p className="text-xs text-muted-foreground">
              Latest attempt ·{' '}
              <time dateTime={latestCheck.checkedAt}>{formatDate(latestCheck.checkedAt)}</time>
            </p>
          </div>
          <p className="text-sm leading-5 text-foreground">
            {latestAttemptExplanation(latestCheck)}
          </p>
          {latestCheck.result === 'unavailable' && latestCheck.message ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Check detail: {latestCheck.message}
            </p>
          ) : null}
          {latestCheck.sourceFetchedAt ? (
            <p className="text-xs text-muted-foreground">
              Public page read{' '}
              <time dateTime={latestCheck.sourceFetchedAt}>
                {formatDate(latestCheck.sourceFetchedAt)}
              </time>
            </p>
          ) : null}
          {latestCheck.sourceUrl && getOfficialPermitPortalUrl(latestCheck.sourceUrl) ? (
            <a
              className="w-fit max-w-full break-all text-xs font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={latestCheck.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open City record from this attempt
            </a>
          ) : null}
        </section>
      ) : null}

      {!ready ? (
        <p className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
          {historicalSanJose
            ? 'This San José record and its check history are retained for reference. San José is no longer supported for active checks; save a City of Tampa Accela record link to use public checks.'
            : 'Add the permit number and its direct City of Tampa Building Accela record URL under Edit to enable an on-demand public check.'}
        </p>
      ) : null}
      {archived ? (
        <p className="text-xs text-muted-foreground">Archived permits are read-only.</p>
      ) : null}
      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Loading portal history…
        </p>
      ) : historyError ? (
        <div className="grid gap-2 text-sm" role="alert">
          <p className="text-destructive">Saved portal checks could not be loaded.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void loadHistory()}
          >
            Retry history
          </Button>
        </div>
      ) : checks?.length ? (
        <ol className="grid gap-3">
          {checks.map((check) => (
            <li
              key={check.id}
              className="grid gap-3 rounded-lg border border-border bg-background/80 p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground">
                  {resultLabel(check.result)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Checked {formatDate(check.checkedAt)} · Permit {check.permitNumber}
                </span>
                {check.result === 'checked' ? (
                  <span className="text-xs font-medium text-foreground">
                    Verified public City result
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Public Record Status</p>
                  <p className="mt-1 break-words text-sm font-semibold text-foreground">
                    {check.status ?? 'No status verified'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">DocketKite monitoring</p>
                  <p className="mt-1 break-words text-sm font-semibold text-foreground">
                    {check.monitoringStatus ?? 'No status retrieved'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {check.monitoringAgreement === 'matches_portal'
                      ? 'Stored public field matches the value read from this page.'
                      : 'Agreement could not be verified.'}
                  </p>
                </div>
              </div>
              <div className="grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
                <p>
                  Redline: {check.redlineStatus ?? 'no status available'} ·{' '}
                  {check.redlineResult === 'not_connected'
                    ? 'not connected; comparison unavailable'
                    : check.redlineResult}
                </p>
                <p>
                  {check.sourceFetchedAt
                    ? `Portal page read ${formatDate(check.sourceFetchedAt)}`
                    : 'Portal page read time unavailable'}
                </p>
              </div>
              {check.message || check.redlineMessage ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {[check.message, check.redlineMessage].filter(Boolean).join(' ')}
                </p>
              ) : null}
              {check.sourceUrl &&
              (getOfficialPermitPortalUrl(check.sourceUrl) ||
                isHistoricalSanJosePortalUrl(check.sourceUrl)) ? (
                <a
                  className="w-fit max-w-full break-all text-xs font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={check.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {isHistoricalSanJosePortalUrl(check.sourceUrl)
                    ? 'Open historical San José source'
                    : 'Open City of Tampa source'}
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
          No saved portal checks yet. Each attempt will appear here with its source and check time.
        </p>
      )}
    </section>
  );
}
