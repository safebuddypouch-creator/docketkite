// @polsia:user-owned — review UI for correction-item drafts extracted from letters.
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import {
  PermitCorrectionDraftResponse,
  type PermitLetterItem,
} from '@/lib/contracts/permit-letter';

const MAX_PARSE_BYTES = 20 * 1024 * 1024;
const PARSEABLE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function errorMessage(error: unknown): string {
  if (!(error instanceof Error))
    return 'Could not extract correction items. Try again or review the letter manually.';
  const body = error.cause;
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message;
  }
  return 'Could not extract correction items. Try again or review the letter manually.';
}

export function PermitLetterDraft({
  letter,
  teamId,
  onSaved,
}: {
  letter: PermitLetterItem;
  teamId: string;
  onSaved: (draft: PermitLetterItem['correctionDraft']) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const canParse = PARSEABLE_TYPES.has(letter.mimeType) && letter.size <= MAX_PARSE_BYTES;

  async function extract() {
    if (pending || !canParse) return;
    setPending(true);
    setError('');
    try {
      const result = await apiFetch(
        `/api/permit-letters/${encodeURIComponent(letter.id)}/extract`,
        {
          method: 'POST',
          body: JSON.stringify({ teamId, permitId: letter.permitId }),
          schema: PermitCorrectionDraftResponse,
        },
      );
      onSaved(result.draft);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-background/70 p-3">
      {letter.correctionDraft ? (
        <section
          aria-label={`Correction item draft from ${letter.fileName}`}
          className="grid gap-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">Correction items</h4>
            <Badge variant="outline">
              {letter.correctionDraft.status === 'confirmed'
                ? 'Review confirmed'
                : 'Draft · review needed'}
            </Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Extracted from this letter as a proposal. It does not monitor permit portals or update
            permit status.
          </p>
          {letter.correctionDraft.items.length > 0 ? (
            <ol className="grid gap-2">
              {letter.correctionDraft.items.map((item) => (
                <li key={item.id} className="rounded-md border border-border bg-card px-3 py-2.5">
                  <p className="text-sm leading-5 text-foreground">{item.action}</p>
                  {item.location || item.planReference ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {[item.location, item.planReference].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              No correction items were found. Review the letter manually.
            </p>
          )}
          {letter.correctionDraft.fieldErrors.length > 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Some details could not be read. Check those parts of the source letter during review.
            </p>
          ) : null}
          {letter.correctionDraft.status === 'confirmed' && !letter.correctionChecklist ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Review the confirmed items to create a saved team checklist.
            </p>
          ) : null}
          <Button asChild type="button" size="sm" variant="outline" className="w-fit">
            <Link
              href={`/dashboard/permits/${encodeURIComponent(letter.permitId)}/letters/${encodeURIComponent(letter.id)}/review`}
            >
              {letter.correctionDraft.status === 'confirmed'
                ? 'View reviewed items'
                : 'Review draft'}
            </Link>
          </Button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-muted-foreground">
              Extraction supports PDF, JPG, PNG, or WebP up to 20 MB and 10 pages.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void extract()}
              disabled={pending || !canParse}
            >
              {pending ? 'Reading letter…' : 'Extract correction items'}
            </Button>
          </div>
          {!canParse ? (
            <p className="text-xs text-muted-foreground">
              This attached file is available for manual review, but does not meet the extraction
              format or size limits.
            </p>
          ) : null}
          {pending ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Reading the letter and preparing an unconfirmed draft…
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
