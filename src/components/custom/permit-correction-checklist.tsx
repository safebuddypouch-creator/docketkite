// @polsia:user-owned — source-linked list of corrections confirmed from one uploaded permit letter.
'use client';

import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CompletionProgress } from '@/components/custom/completion-progress';
import { PermitChecklistPdfDownload } from '@/components/custom/permit-checklist-pdf-download';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { apiFetch } from '@/lib/api-client';
import {
  type PermitCorrectionChecklistData,
  PermitCorrectionChecklistItemUpdateRequest,
  PermitCorrectionChecklistItemUpdateResponse,
  PermitCorrectionChecklistResponse,
} from '@/lib/contracts/permit-letter';

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const body = error.cause;
  if (typeof body !== 'object' || body === null || !('error' in body)) return '';
  return typeof body.error === 'string' ? body.error : '';
}

function requestPath(permitId: string, letterId: string): string {
  const query = new URLSearchParams({ permitId });
  return `/api/permit-letters/${encodeURIComponent(letterId)}/checklist?${query.toString()}`;
}

function sourceHref(checklist: PermitCorrectionChecklistData): string {
  const query = new URLSearchParams({
    teamId: checklist.teamId,
    permitId: checklist.permitId,
  });
  return `/api/permit-letters/${encodeURIComponent(checklist.sourceLetterId)}/source?${query.toString()}`;
}

export function PermitCorrectionChecklistView({
  permitId,
  letterId,
}: {
  permitId: string;
  letterId: string;
}) {
  const [checklist, setChecklist] = useState<PermitCorrectionChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch(requestPath(permitId, letterId), {
        schema: PermitCorrectionChecklistResponse,
      });
      setChecklist(result.checklist);
    } catch (loadError) {
      const code = errorCode(loadError);
      setError(
        code === 'team_subscription_required' || code === 'billing_status_unavailable'
          ? 'A verified paid team subscription is required to view this checklist.'
          : code === 'team_membership_required'
            ? 'You need an active membership in this permit’s team to view the checklist.'
            : 'The correction checklist could not be loaded. Return to the permit review and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [letterId, permitId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateCompletion(itemId: string, completed: boolean) {
    if (!checklist || saving) return;
    setSaving(true);
    try {
      const request = PermitCorrectionChecklistItemUpdateRequest.parse({ itemId, completed });
      const result = await apiFetch(
        `/api/permit-letters/${encodeURIComponent(letterId)}/checklist`,
        {
          method: 'PATCH',
          body: JSON.stringify(request),
          schema: PermitCorrectionChecklistItemUpdateResponse,
        },
      );
      setChecklist((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === result.item.id ? result.item : item)),
            }
          : current,
      );
    } catch {
      toast.error('Could not save the team task update. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Loading correction checklist…
      </p>
    );
  }

  if (error || !checklist) {
    return (
      <section className="mx-auto grid w-full max-w-3xl gap-5 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Permit letter checklist
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
            Checklist unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {error || 'This letter has no correction checklist.'}
          </p>
        </div>
        <Button asChild type="button" variant="outline" className="w-fit">
          <Link
            href={`/dashboard/permits/${encodeURIComponent(permitId)}/letters/${encodeURIComponent(letterId)}/review`}
          >
            Return to letter review
          </Link>
        </Button>
      </section>
    );
  }

  const source = sourceHref(checklist);
  const review = `/dashboard/permits/${encodeURIComponent(permitId)}/letters/${encodeURIComponent(letterId)}/review`;
  const completedCount = checklist.items.filter((item) => item.completed).length;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild type="button" variant="ghost" size="sm" className="-ml-3">
          <Link href={review}>
            <ArrowLeft aria-hidden="true" className="mr-1.5 size-4" />
            Back to letter review
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={completedCount === checklist.items.length ? 'default' : 'secondary'}>
            {completedCount === checklist.items.length && checklist.items.length > 0
              ? 'All team tasks are done'
              : `${completedCount} of ${checklist.items.length} team tasks complete`}
          </Badge>
          <PermitChecklistPdfDownload permitId={permitId} letterId={letterId} />
        </div>
      </div>

      <header className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            User-provided permit letter
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            Correction checklist
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Each item comes from the confirmed review of this uploaded letter. This checklist does
            not monitor permit portals or send alerts.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Checking an item saves a team task update only. It never changes the permit’s manually
            maintained status.
          </p>
          <CompletionProgress completed={completedCount} total={checklist.items.length} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <FileText aria-hidden="true" className="size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Source letter
              </p>
              <p className="mt-1 break-all text-sm font-medium text-foreground">
                {checklist.sourceFileName}
              </p>
            </div>
          </div>
          <Button asChild type="button" size="sm" variant="outline">
            <Link href={source} target="_blank" rel="noreferrer">
              Open source letter
            </Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="checklist-items-heading" className="grid gap-4">
        <div>
          <h2
            id="checklist-items-heading"
            className="text-xl font-semibold tracking-tight text-foreground"
          >
            Confirmed corrections
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The reviewed wording and its source reference are kept together for each item.
          </p>
        </div>
        <ol className="grid gap-3">
          {checklist.items.map((item, index) => (
            <li key={item.id}>
              <article className="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4 sm:p-6">
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full border border-primary/30 text-sm font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`checklist-item-${item.id}`}
                        aria-label={`Completion status for ${item.action}`}
                        checked={item.completed}
                        disabled={saving}
                        onCheckedChange={(checked) =>
                          void updateCompletion(item.id, checked === true)
                        }
                      />
                      <label
                        htmlFor={`checklist-item-${item.id}`}
                        className="cursor-pointer text-sm font-medium text-foreground"
                      >
                        {item.completed ? 'Completed · select to reopen' : 'Mark task complete'}
                      </label>
                    </div>
                    <Badge variant={item.completed ? 'default' : 'outline'}>
                      {item.completed ? 'Done by team' : 'Open team task'}
                    </Badge>
                  </div>
                  <p
                    className={`text-base font-medium leading-7 ${item.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {item.action}
                  </p>
                  {item.location || item.planReference ? (
                    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                      {item.location ? (
                        <div>
                          <dt className="inline text-muted-foreground">Location: </dt>
                          <dd className="inline font-medium text-foreground">{item.location}</dd>
                        </div>
                      ) : null}
                      {item.planReference ? (
                        <div>
                          <dt className="inline text-muted-foreground">Plan reference: </dt>
                          <dd className="inline font-medium text-foreground">
                            {item.planReference}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  <Link
                    href={source}
                    target="_blank"
                    rel="noreferrer"
                    className="w-fit text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Source: {checklist.sourceFileName}
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
