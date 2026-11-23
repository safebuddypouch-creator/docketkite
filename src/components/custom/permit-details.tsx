// @polsia:user-owned — direct view for a permit reached from a status email.
'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PermitPortalMonitor } from '@/components/custom/permit-portal-monitor';
import { PermitSummaryPdfDownload } from '@/components/custom/permit-summary-pdf-download';
import { PermitTeamNotes } from '@/components/custom/permit-team-notes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import {
  getOfficialPermitPortalUrl,
  isHistoricalSanJosePortalUrl,
  PermitDetailsMutationResponse,
  type PermitDetailsPage,
  PermitDetailsPage as PermitDetailsPageSchema,
  PermitDetailsUpdate,
  type PermitItem,
  PermitItem as PermitItemSchema,
  PermitMutation,
  PermitPortalUrlMutationResponse,
  PermitPortalUrlUpdate,
} from '@/lib/contracts/permit';

function portalUrlErrorFrom(error: unknown): string | null {
  if (!(error instanceof Error) || !error.cause || typeof error.cause !== 'object') return null;
  if (!('errors' in error.cause) || !error.cause.errors || typeof error.cause.errors !== 'object') {
    return null;
  }
  const errors = error.cause.errors;
  if (!('portalUrl' in errors) || typeof errors.portalUrl !== 'string') return null;
  return errors.portalUrl;
}

export function PermitDetails({ permitId }: { permitId: string }) {
  const [permit, setPermit] = useState<PermitDetailsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({ permitNumber: '', address: '' });
  const [detailsErrors, setDetailsErrors] = useState<{
    permitNumber?: string;
    address?: string;
    form?: string;
  }>({});
  const [savingDetails, setSavingDetails] = useState(false);
  const [editingPortalUrl, setEditingPortalUrl] = useState(false);
  const [portalUrlDraft, setPortalUrlDraft] = useState('');
  const [portalUrlError, setPortalUrlError] = useState<string | null>(null);
  const [savingPortalUrl, setSavingPortalUrl] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void apiFetch(`/api/permits/${encodeURIComponent(permitId)}`, {
      schema: PermitDetailsPageSchema,
    })
      .then((result) => {
        if (mounted) {
          setPermit(result);
          setAssignmentDraft(result.assignedProjectManager?.id ?? '');
        }
      })
      .catch(() => {
        if (mounted) setPermit(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [permitId]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Loading permit…
      </p>
    );
  }

  if (!permit) {
    return (
      <section className="mx-auto grid w-full max-w-3xl gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Private permit record
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
            Permit unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This permit could not be loaded. Check your team access and try again.
          </p>
        </div>
        <Button asChild type="button" variant="outline" className="w-fit">
          <Link href="/dashboard">Back to team workspace</Link>
        </Button>
      </section>
    );
  }

  const officialPortalUrl = getOfficialPermitPortalUrl(permit.portalUrl);

  function startEditingDetails(currentPermit: PermitDetailsPage) {
    setDetailsDraft({
      permitNumber: currentPermit.permitNumber,
      address: currentPermit.address,
    });
    setDetailsErrors({});
    setEditingDetails(true);
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>, currentPermit: PermitDetailsPage) {
    event.preventDefault();
    const parsed = PermitDetailsUpdate.safeParse({
      teamId: currentPermit.teamId,
      ...detailsDraft,
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setDetailsErrors({
        ...(fieldErrors.permitNumber?.[0] ? { permitNumber: fieldErrors.permitNumber[0] } : {}),
        ...(fieldErrors.address?.[0] ? { address: fieldErrors.address[0] } : {}),
      });
      return;
    }

    setSavingDetails(true);
    setDetailsErrors({});
    try {
      const saved = await apiFetch(`/api/permits/${encodeURIComponent(currentPermit.id)}/details`, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
        schema: PermitDetailsMutationResponse,
      });
      setPermit((current) =>
        current
          ? { ...current, permitNumber: saved.permitNumber, address: saved.address }
          : current,
      );
      setEditingDetails(false);
      toast.success('Permit reference and address saved.');
    } catch (error) {
      const cause = error instanceof Error ? error.cause : null;
      if (typeof cause === 'object' && cause !== null && 'errors' in cause) {
        const fields = cause.errors;
        if (typeof fields === 'object' && fields !== null) {
          const errors: { permitNumber?: string; address?: string; form?: string } = {};
          if ('permitNumber' in fields && typeof fields.permitNumber === 'string') {
            errors.permitNumber = fields.permitNumber;
          }
          if ('address' in fields && typeof fields.address === 'string') {
            errors.address = fields.address;
          }
          if ('form' in fields && typeof fields.form === 'string') errors.form = fields.form;
          if (Object.keys(errors).length > 0) {
            setDetailsErrors(errors);
            return;
          }
        }
      }
      toast.error('Could not save permit details. Check your team access and try again.');
    } finally {
      setSavingDetails(false);
    }
  }

  function startEditingPortalUrl(currentPermit: PermitItem) {
    setPortalUrlDraft(currentPermit.portalUrl);
    setPortalUrlError(null);
    setEditingPortalUrl(true);
  }

  async function savePortalUrl(event: FormEvent<HTMLFormElement>, currentPermit: PermitItem) {
    event.preventDefault();
    const parsed = PermitPortalUrlUpdate.safeParse({ portalUrl: portalUrlDraft });
    if (!parsed.success) {
      setPortalUrlError(
        parsed.error.flatten().fieldErrors.portalUrl?.[0] ??
          'Enter a direct public City record URL.',
      );
      return;
    }

    setSavingPortalUrl(true);
    setPortalUrlError(null);
    try {
      const saved = await apiFetch(`/api/permits/${encodeURIComponent(currentPermit.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
        schema: PermitPortalUrlMutationResponse,
      });
      setPermit((current) => (current ? { ...current, portalUrl: saved.portalUrl } : current));
      setEditingPortalUrl(false);
      toast.success('Permit portal URL saved.');
    } catch (error) {
      const fieldError = portalUrlErrorFrom(error);
      if (fieldError) {
        setPortalUrlError(fieldError);
      } else {
        toast.error('Could not save the portal URL. Check your team access and try again.');
      }
    } finally {
      setSavingPortalUrl(false);
    }
  }

  async function saveAssignment(
    event: FormEvent<HTMLFormElement>,
    currentPermit: PermitDetailsPage,
  ) {
    event.preventDefault();
    const parsed = PermitMutation.safeParse({
      action: 'assign',
      id: currentPermit.id,
      teamId: currentPermit.teamId,
      projectManagerUserId: assignmentDraft || null,
    });
    if (!parsed.success) {
      toast.error('Choose an eligible project manager and try again.');
      return;
    }

    setSavingAssignment(true);
    try {
      const saved = await apiFetch('/api/permits', {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
        schema: PermitItemSchema,
      });
      setPermit((current) =>
        current ? { ...current, assignedProjectManager: saved.assignedProjectManager } : current,
      );
      setAssignmentDraft(saved.assignedProjectManager?.id ?? '');
      toast.success('Project manager assignment saved.');
    } catch (error) {
      const cause = error instanceof Error ? error.cause : null;
      const details =
        typeof cause === 'object' && cause !== null && 'error' in cause ? cause.error : undefined;
      toast.error(
        details === 'project_manager_not_accepted_team_member'
          ? 'That project manager is no longer eligible. Reload the permit and try again.'
          : 'Could not save this assignment. Check team access and try again.',
      );
    } finally {
      setSavingAssignment(false);
    }
  }

  return (
    <article className="mx-auto grid w-full max-w-4xl gap-6 pb-10">
      <Button asChild type="button" variant="ghost" size="sm" className="-ml-3 w-fit">
        <Link href="/dashboard">
          <ArrowLeft aria-hidden="true" className="mr-2 size-4" />
          Back to permits
        </Link>
      </Button>

      <header className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {permit.permitNumber ? `Permit ${permit.permitNumber}` : permit.permitType}
          </p>
          <Badge variant="secondary">{permit.status}</Badge>
        </div>
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {permit.projectName}
          </h1>
          <p className="mt-2 text-base text-muted-foreground">{permit.address}</p>
        </div>
        <section className="grid gap-3 rounded-lg border border-border bg-background/70 p-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Project manager</h2>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {permit.assignedProjectManager
                ? `Currently assigned to ${permit.assignedProjectManager.name}.`
                : 'No project manager is assigned.'}
            </p>
          </div>
          {permit.canEditDetails ? (
            permit.projectManagers.length > 0 ? (
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(event) => void saveAssignment(event, permit)}
                aria-label="Assign a project manager"
              >
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <label htmlFor="permit-project-manager" className="text-sm font-medium">
                    Assign to
                  </label>
                  <select
                    id="permit-project-manager"
                    value={assignmentDraft}
                    onChange={(event) => setAssignmentDraft(event.target.value)}
                    disabled={savingAssignment || Boolean(permit.archivedAt)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Unassigned</option>
                    {permit.projectManagers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    savingAssignment ||
                    Boolean(permit.archivedAt) ||
                    assignmentDraft === (permit.assignedProjectManager?.id ?? '')
                  }
                >
                  {savingAssignment ? 'Saving…' : 'Save assignment'}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                No eligible project managers yet. Invite a manager and wait for them to accept
                before assigning this permit.
              </p>
            )
          ) : null}
        </section>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {officialPortalUrl ? (
            <a
              href={officialPortalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open City permit record
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              {permit.portalUrl
                ? isHistoricalSanJosePortalUrl(permit.portalUrl)
                  ? 'This historical San José link is retained, but San José is no longer active coverage. Save a City of Tampa Accela Building record URL to enable checks.'
                  : 'The saved portal URL is unsupported. Update it to a direct City of Tampa Accela Building record URL.'
                : 'Add a direct public City record URL to enable public-record checks.'}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(permit.archivedAt)}
            onClick={() => startEditingPortalUrl(permit)}
          >
            {officialPortalUrl ? 'Edit portal URL' : 'Add portal URL'}
          </Button>
          <PermitSummaryPdfDownload permitId={permit.id} />
          {permit.archivedAt ? (
            <span className="text-xs text-muted-foreground">Archived permits are read-only.</span>
          ) : null}
        </div>
        {editingPortalUrl ? (
          <form
            className="grid gap-3 rounded-lg border border-border bg-background/70 p-4"
            onSubmit={(event) => void savePortalUrl(event, permit)}
            aria-label="Edit official City portal URL"
          >
            <div className="grid gap-1.5">
              <label htmlFor="permit-portal-url" className="text-sm font-medium text-foreground">
                Official City of Tampa Accela Building record URL
              </label>
              <Input
                id="permit-portal-url"
                name="portalUrl"
                type="text"
                inputMode="url"
                autoComplete="url"
                value={portalUrlDraft}
                onChange={(event) => {
                  setPortalUrlDraft(event.target.value);
                  setPortalUrlError(null);
                }}
                aria-invalid={Boolean(portalUrlError)}
                aria-describedby={
                  portalUrlError
                    ? 'permit-portal-url-help permit-portal-url-error'
                    : 'permit-portal-url-help'
                }
                required
              />
              <p id="permit-portal-url-help" className="text-xs leading-5 text-muted-foreground">
                Use a direct HTTPS record detail URL from the official City of Tampa Accela Building
                portal. A mailing address alone does not establish City jurisdiction.
              </p>
              {portalUrlError ? (
                <p id="permit-portal-url-error" className="text-sm text-destructive" role="alert">
                  {portalUrlError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={savingPortalUrl}>
                {savingPortalUrl ? 'Saving…' : 'Save portal URL'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={savingPortalUrl}
                onClick={() => {
                  setPortalUrlDraft(permit.portalUrl);
                  setPortalUrlError(null);
                  setEditingPortalUrl(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </header>

      <PermitPortalMonitor
        permitId={permit.id}
        permitNumber={permit.permitNumber}
        portalUrl={permit.portalUrl}
        teamId={permit.teamId}
        archived={Boolean(permit.archivedAt)}
        retryOnly
      />

      <section className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Job details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Permit information maintained by your team.
            </p>
          </div>
          {permit.canEditDetails ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(permit.archivedAt) || editingDetails}
              onClick={() => startEditingDetails(permit)}
            >
              Edit permit details
            </Button>
          ) : null}
        </div>
        {editingDetails ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => void saveDetails(event, permit)}
            aria-label="Edit permit details"
          >
            <div className="grid gap-1.5">
              <label htmlFor="permit-reference" className="text-sm font-medium text-foreground">
                Permit reference
              </label>
              <Input
                id="permit-reference"
                name="permitNumber"
                type="text"
                maxLength={80}
                value={detailsDraft.permitNumber}
                onChange={(event) => {
                  setDetailsDraft((current) => ({ ...current, permitNumber: event.target.value }));
                  setDetailsErrors((current) => ({ ...current, permitNumber: undefined }));
                }}
                aria-invalid={Boolean(detailsErrors.permitNumber)}
                aria-describedby={detailsErrors.permitNumber ? 'permit-reference-error' : undefined}
              />
              {detailsErrors.permitNumber ? (
                <p id="permit-reference-error" className="text-sm text-destructive" role="alert">
                  {detailsErrors.permitNumber}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="permit-address" className="text-sm font-medium text-foreground">
                Job address
              </label>
              <Input
                id="permit-address"
                name="address"
                type="text"
                maxLength={200}
                value={detailsDraft.address}
                onChange={(event) => {
                  setDetailsDraft((current) => ({ ...current, address: event.target.value }));
                  setDetailsErrors((current) => ({ ...current, address: undefined }));
                }}
                aria-invalid={Boolean(detailsErrors.address)}
                aria-describedby={detailsErrors.address ? 'permit-address-error' : undefined}
                required
              />
              {detailsErrors.address ? (
                <p id="permit-address-error" className="text-sm text-destructive" role="alert">
                  {detailsErrors.address}
                </p>
              ) : null}
            </div>
            {detailsErrors.form ? (
              <p className="text-sm text-destructive" role="alert">
                {detailsErrors.form}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={savingDetails}>
                {savingDetails ? 'Saving…' : 'Save details'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={savingDetails}
                onClick={() => {
                  setDetailsDraft({
                    permitNumber: permit.permitNumber,
                    address: permit.address,
                  });
                  setDetailsErrors({});
                  setEditingDetails(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Project
              </dt>
              <dd className="mt-1 break-words text-sm text-foreground">{permit.projectName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Job address
              </dt>
              <dd className="mt-1 break-words text-sm text-foreground">{permit.address}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Permit type
              </dt>
              <dd className="mt-1 text-sm text-foreground">{permit.permitType}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Permit reference
              </dt>
              <dd className="mt-1 break-words text-sm text-foreground">
                {permit.permitNumber || 'Not added'}
              </dd>
            </div>
          </dl>
        )}
        {permit.notes ? (
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Team notes</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
              {permit.notes}
            </p>
          </div>
        ) : null}
      </section>

      <PermitTeamNotes permitId={permit.id} archived={Boolean(permit.archivedAt)} />

      <section
        className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
        aria-labelledby="permit-status-history-title"
      >
        <div>
          <h2 id="permit-status-history-title" className="text-lg font-semibold">
            Status history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved permit status changes, shown from oldest to newest.
          </p>
        </div>
        {permit.statusEvents.length > 0 ? (
          <ol className="ml-2 grid border-l border-border">
            {permit.statusEvents.map((event) => (
              <li key={event.id} className="relative pb-5 pl-6 last:pb-0">
                <span
                  aria-hidden="true"
                  className="absolute -left-[0.4375rem] top-4 size-3 rounded-full border-2 border-primary bg-card"
                />
                <div className="rounded-lg border border-border bg-background/70 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="font-medium text-foreground">{event.status}</p>
                    <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>
                      {new Intl.DateTimeFormat('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(event.createdAt))}
                    </time>
                  </div>
                  {event.falseAlarmReason ? (
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {event.falseAlarmReason}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No status changes have been recorded yet.</p>
        )}
      </section>
    </article>
  );
}
