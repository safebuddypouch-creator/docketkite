// @polsia:user-owned — internal notes shared with paid members of this permit's team.
'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  PermitTeamNoteCreate,
  PermitTeamNoteItem,
  type PermitTeamNoteItem as PermitTeamNoteItemType,
  PermitTeamNoteList,
} from '@/lib/contracts/permit-team-note';

export function PermitTeamNotes({ permitId, archived }: { permitId: string; archived: boolean }) {
  const [items, setItems] = useState<PermitTeamNoteItemType[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void apiFetch(`/api/permits/${encodeURIComponent(permitId)}/notes`, {
      schema: PermitTeamNoteList,
    })
      .then((result) => {
        if (mounted) {
          setItems(result.items);
          setError('');
        }
      })
      .catch(() => {
        if (mounted)
          setError('Internal notes could not be loaded. Check paid team access and try again.');
      });
    return () => {
      mounted = false;
    };
  }, [permitId]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = PermitTeamNoteCreate.safeParse({ body: draft });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.body?.[0] ?? 'Enter a note.');
      return;
    }

    setSaving(true);
    setError('');
    setFieldError('');
    try {
      const item = await apiFetch(`/api/permits/${encodeURIComponent(permitId)}/notes`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        schema: PermitTeamNoteItem,
      });
      setItems((current) => [...(current ?? []), item]);
      setDraft('');
      toast.success('Internal note saved.');
    } catch {
      setError('Internal note could not be saved. Check paid team access and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
      aria-labelledby="permit-team-notes-title"
    >
      <div>
        <h2 id="permit-team-notes-title" className="text-lg font-semibold">
          Internal team notes
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Shared only with members who have active paid access to this team. Notes do not send
          notifications.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Loading internal notes…
        </p>
      ) : items.length > 0 ? (
        <ol className="grid gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid gap-2 rounded-lg border border-border bg-background p-4"
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                {item.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.authorName} ·{' '}
                <time dateTime={item.createdAt}>
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(item.createdAt))}
                </time>
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No internal notes yet.
        </p>
      )}

      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={(event) => void addNote(event)}
      >
        <div className="grid gap-1.5">
          <label htmlFor="permit-internal-note" className="text-sm font-medium">
            Write an internal note
          </label>
          <Textarea
            id="permit-internal-note"
            name="body"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setFieldError('');
            }}
            maxLength={2000}
            rows={4}
            disabled={archived || saving}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'permit-internal-note-error' : undefined}
            placeholder="Add a detail for your team…"
          />
          {fieldError ? (
            <p id="permit-internal-note-error" className="text-sm text-destructive" role="alert">
              {fieldError}
            </p>
          ) : null}
        </div>
        {archived ? (
          <p className="text-sm text-muted-foreground">Archived permits are read-only.</p>
        ) : null}
        <Button type="submit" className="w-fit" disabled={archived || saving || items === null}>
          {saving ? 'Saving note…' : 'Add note'}
        </Button>
      </form>
    </section>
  );
}
