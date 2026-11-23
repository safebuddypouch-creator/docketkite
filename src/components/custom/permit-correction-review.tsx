// @polsia:user-owned — editable review of a saved letter-derived correction draft.
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  PermitCorrectionChecklistResponse,
  type PermitCorrectionDraftItem,
  PermitCorrectionReviewDetails,
  type PermitCorrectionReviewDetailsData,
  PermitCorrectionReviewResponse,
  type PermitLetterItem,
} from '@/lib/contracts/permit-letter';

function apiErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const body = error.cause;
  if (typeof body !== 'object' || body === null || !('error' in body)) return '';
  return typeof body.error === 'string' ? body.error : '';
}

function loadErrorMessage(error: unknown): string {
  const code = apiErrorCode(error);
  if (code === 'team_subscription_required' || code === 'billing_status_unavailable') {
    return 'A verified paid team subscription is required to review this permit letter.';
  }
  if (code === 'team_membership_required') {
    return 'You need an active membership in this permit’s team to review its letter.';
  }
  if (code === 'unauthorized') return 'Sign in to review this permit letter.';
  if (code === 'correction_draft_not_found') {
    return 'This permit letter does not have a saved correction draft to review.';
  }
  return 'The correction draft could not be loaded. Return to the workspace and try again.';
}

function endpoint(permitId: string, letterId: string): string {
  const query = new URLSearchParams({ permitId });
  return `/api/permit-letters/${encodeURIComponent(letterId)}/review?${query.toString()}`;
}

function sourceHref(letter: PermitLetterItem): string {
  const query = new URLSearchParams({ teamId: letter.teamId, permitId: letter.permitId });
  return `/api/permit-letters/${encodeURIComponent(letter.id)}/source?${query.toString()}`;
}

function checklistPath(permitId: string, letterId: string): string {
  return `/dashboard/permits/${encodeURIComponent(permitId)}/letters/${encodeURIComponent(letterId)}/checklist`;
}

function checklistEndpoint(letterId: string): string {
  return `/api/permit-letters/${encodeURIComponent(letterId)}/checklist`;
}

export function PermitCorrectionReview({
  permitId,
  letterId,
}: {
  permitId: string;
  letterId: string;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const [details, setDetails] = useState<PermitCorrectionReviewDetailsData | null>(null);
  const [items, setItems] = useState<PermitCorrectionDraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [checklistPending, setChecklistPending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await apiFetch(endpoint(permitId, letterId), {
        schema: PermitCorrectionReviewDetails,
      });
      setDetails(result);
      setItems(result.letter.correctionDraft?.items ?? []);
    } catch (error) {
      setLoadError(loadErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [letterId, permitId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateItem(
    itemId: string,
    field: 'action' | 'location' | 'planReference',
    value: string,
  ) {
    const optionalValue = value.trim() ? value : null;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        if (field === 'action') return { ...item, action: value };
        if (field === 'location') return { ...item, location: optionalValue };
        return { ...item, planReference: optionalValue };
      }),
    );
    setFormError('');
  }

  async function submitReview(action: 'save' | 'confirm') {
    if (!details || pending) return;
    if (items.some((item) => !item.action.trim())) {
      setFormError('Enter a correction request for every item, or remove that item.');
      return;
    }

    setPending(true);
    setFormError('');
    try {
      const result = await apiFetch(endpoint(permitId, letterId), {
        method: 'PATCH',
        body: JSON.stringify({ action, items }),
        schema: PermitCorrectionReviewResponse,
      });
      setItems(result.draft.items);
      setDetails((current) =>
        current
          ? {
              ...current,
              letter: { ...current.letter, correctionDraft: result.draft },
            }
          : current,
      );
      toast.success(
        action === 'confirm' ? 'Correction review confirmed.' : 'Review changes saved.',
      );
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === 'correction_review_already_confirmed') {
        setFormError(
          'This review was already confirmed. Reload the page to see the saved version.',
        );
      } else {
        setFormError('The review could not be saved. Check your access and try again.');
      }
    } finally {
      setPending(false);
    }
  }

  async function createChecklist() {
    if (!details || details.letter.correctionDraft?.status !== 'confirmed' || checklistPending)
      return;
    setChecklistPending(true);
    setFormError('');
    try {
      await apiFetch(checklistEndpoint(letterId), {
        method: 'POST',
        body: JSON.stringify({ teamId: details.letter.teamId, permitId }),
        schema: PermitCorrectionChecklistResponse,
      });
      router.push(checklistPath(permitId, letterId));
    } catch (error) {
      const code = apiErrorCode(error);
      setFormError(
        code === 'correction_review_not_confirmed'
          ? 'Confirm the reviewed items before creating a checklist.'
          : code === 'confirmed_correction_items_required'
            ? 'There are no confirmed correction items to add to a checklist.'
            : 'The checklist could not be created. Check your team access and try again.',
      );
    } finally {
      setChecklistPending(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Loading correction review…
      </p>
    );
  }

  if (loadError || !details) {
    return (
      <section className="mx-auto grid w-full max-w-3xl gap-5 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Permit letter review
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
            Review unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {loadError || 'This letter has no saved correction draft to review.'}
          </p>
        </div>
        <Button asChild type="button" variant="outline" className="w-fit">
          <Link href="/dashboard">Back to team workspace</Link>
        </Button>
      </section>
    );
  }

  const { letter, permit } = details;
  const draft = letter.correctionDraft;
  if (!draft) {
    return (
      <section className="mx-auto grid w-full max-w-3xl gap-5 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Permit letter review
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground">
            Review unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This letter does not have a saved correction draft to review.
          </p>
        </div>
        <Button asChild type="button" variant="outline" className="w-fit">
          <Link href={`/dashboard?teamId=${encodeURIComponent(letter.teamId)}`}>
            Back to team workspace
          </Link>
        </Button>
      </section>
    );
  }
  const confirmed = draft.status === 'confirmed';

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild type="button" variant="ghost" size="sm" className="-ml-3">
          <Link href={`/dashboard?teamId=${encodeURIComponent(letter.teamId)}`}>
            Back to permit workspace
          </Link>
        </Button>
        <Badge variant={confirmed ? 'secondary' : 'outline'}>
          {confirmed ? 'Review confirmed' : 'Needs review'}
        </Badge>
      </div>

      <header className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {permit.permitNumber ? `Permit ${permit.permitNumber}` : 'Permit review'}
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            Review correction items
          </h1>
          <p className="mt-2 text-lg font-medium text-foreground">{permit.projectName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{permit.address}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Source letter
            </p>
            <p className="mt-1 break-all text-sm font-medium text-foreground">{letter.fileName}</p>
          </div>
          <Button asChild type="button" size="sm" variant="outline">
            <Link href={sourceHref(letter)} target="_blank" rel="noreferrer">
              Open source letter
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-5 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="grid gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Proposed work from the letter
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Check each extracted item against the source letter. You can correct the wording or
            remove an item before confirming the review.
          </p>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            This review does not monitor permit portals or change the permit’s manually maintained
            status.
          </p>
        </div>

        {confirmed ? (
          <div className="grid gap-3 rounded-lg border border-primary/20 bg-secondary/60 p-4">
            <p className="text-sm font-semibold text-foreground">This review is confirmed.</p>
            <p className="text-sm leading-6 text-muted-foreground">
              No checklist was created yet. The checklist will use only these confirmed items and
              will keep each one linked to {letter.fileName}.
            </p>
            {details.checklistId ? (
              <Button asChild type="button" className="w-fit">
                <Link href={checklistPath(permitId, letterId)}>Open correction checklist</Link>
              </Button>
            ) : items.length > 0 ? (
              <Button
                type="button"
                className="w-fit"
                onClick={() => void createChecklist()}
                disabled={checklistPending}
              >
                {checklistPending ? 'Creating checklist…' : 'Create correction checklist'}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                There are no confirmed correction items to add to a checklist.
              </p>
            )}
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <ol className="grid gap-4">
            {items.map((item, index) => {
              const actionId = `${idPrefix}-action-${index}`;
              const locationId = `${idPrefix}-location-${index}`;
              const referenceId = `${idPrefix}-reference-${index}`;
              return (
                <li key={item.id}>
                  <section
                    aria-label={`Correction item ${index + 1}`}
                    className="grid gap-4 rounded-lg border border-border bg-background p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        Proposed item {index + 1}
                      </h3>
                      {!confirmed ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setItems((current) => current.filter((entry) => entry.id !== item.id));
                            setFormError('');
                          }}
                          aria-label={`Remove correction item ${index + 1}`}
                          disabled={pending}
                        >
                          Remove item
                        </Button>
                      ) : null}
                    </div>
                    <label className="grid gap-2 text-sm font-medium" htmlFor={actionId}>
                      Correction request
                      <Textarea
                        id={actionId}
                        value={item.action}
                        rows={3}
                        readOnly={confirmed || pending}
                        onChange={(event) =>
                          updateItem(item.id, 'action', event.currentTarget.value)
                        }
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium" htmlFor={locationId}>
                        Location <span className="font-normal text-muted-foreground">Optional</span>
                        <Input
                          id={locationId}
                          value={item.location ?? ''}
                          readOnly={confirmed || pending}
                          onChange={(event) =>
                            updateItem(item.id, 'location', event.currentTarget.value)
                          }
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium" htmlFor={referenceId}>
                        Plan reference{' '}
                        <span className="font-normal text-muted-foreground">Optional</span>
                        <Input
                          id={referenceId}
                          value={item.planReference ?? ''}
                          readOnly={confirmed || pending}
                          onChange={(event) =>
                            updateItem(item.id, 'planReference', event.currentTarget.value)
                          }
                        />
                      </label>
                    </div>
                  </section>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-background px-4 py-5 text-sm leading-6 text-muted-foreground">
            No proposed items remain. You can confirm that this letter has no checklist items to
            carry forward.
          </p>
        )}

        {!confirmed ? (
          <div className="grid gap-4 border-t border-border pt-4">
            <p className="text-xs leading-5 text-muted-foreground">
              Confirm the reviewed items to make checklist creation available. The checklist uses
              only this uploaded letter and does not add portal monitoring or alerts.
            </p>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void submitReview('save')}
                disabled={pending}
              >
                {pending ? 'Saving…' : 'Save review'}
              </Button>
              <Button type="button" onClick={() => void submitReview('confirm')} disabled={pending}>
                {pending ? 'Saving…' : 'Confirm reviewed items'}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
