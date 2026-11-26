// @polsia:user-owned — private manual permit management for the owner workspace.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ClipboardList, ListFilter, MapPin, Plus, RotateCw, Search } from 'lucide-react';
import Link from 'next/link';
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { completionPercent } from '@/components/custom/completion-progress';
import { CsvExporter } from '@/components/custom/csv-exporter';
import { CsvImporter } from '@/components/custom/csv-importer';
import { PermitLetterDraft } from '@/components/custom/permit-letter-draft';
import { PermitPortalMonitor } from '@/components/custom/permit-portal-monitor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  getOfficialPermitPortalUrl,
  PermitBulkArchiveResponse as PermitBulkArchiveResponseSchema,
  type PermitCreateFieldsInput,
  PermitCreateFields as PermitCreateFieldsSchema,
  type PermitFields,
  type PermitFieldsInput,
  PermitFields as PermitFieldsSchema,
  type PermitItem,
  PermitItem as PermitItemSchema,
  PermitList,
  PermitListSort,
  type PermitMonitoringOutcome,
  PermitMonitoringOutcome as PermitMonitoringOutcomeSchema,
  type PermitProjectManager,
  type PermitStatus,
  PermitStatus as PermitStatusSchema,
} from '@/lib/contracts/permit';
import {
  CorrectionLetterMimeType,
  MAX_CORRECTION_LETTER_SIZE_BYTES,
  PermitLetterAuthorization,
  type PermitLetterItem,
  PermitLetterItem as PermitLetterItemSchema,
  PermitLetterList,
} from '@/lib/contracts/permit-letter';
import {
  type PermitStatusCount,
  PermitStatusCounts as PermitStatusCountsSchema,
} from '@/lib/contracts/permit-status-counts';
import { uploadPermitLetter } from '@/lib/file-upload/permit-letter-upload.client';
import { applyServerErrors } from '@/lib/forms';
import { FileUploadError } from '@/modules/file-upload/client';

type ListView = 'active' | 'archived';

const permitTypes = ['Building', 'Electrical', 'Plumbing', 'Mechanical', 'Other'] as const;
const permitStatuses = [
  'Planning',
  'Ready to submit',
  'Submitted',
  'Under review',
  'Corrections requested',
  'Issued',
] as const;

const emptyPermit: PermitFields = {
  projectName: '',
  address: '',
  permitNumber: '',
  permitType: 'Building',
  status: 'Planning',
  notes: '',
  portalUrl: '',
};

function PermitEditor({
  initialValues,
  editing,
  onCancel,
  onSave,
}: {
  initialValues: PermitFields;
  editing: boolean;
  onCancel: () => void;
  onSave: (values: PermitFields, falseAlarmReason?: string) => Promise<PermitItem>;
}) {
  const [pending, setPending] = useState(false);
  const portalUrlId = useId();
  const portalUrlHelpId = useId();
  const falseAlarmReasonId = useId();
  const [falseAlarmReason, setFalseAlarmReason] = useState('');
  const form = useForm<PermitFieldsInput | PermitCreateFieldsInput, unknown, PermitFields>({
    resolver: zodResolver(editing ? PermitFieldsSchema : PermitCreateFieldsSchema),
    defaultValues: initialValues,
  });
  const selectedStatus = form.watch('status');
  const officialPortalUrl = getOfficialPermitPortalUrl(initialValues.portalUrl);

  const submit = form.handleSubmit(async (values) => {
    setPending(true);
    try {
      await onSave(values, falseAlarmReason.trim() || undefined);
      toast.success(editing ? 'Permit details saved.' : 'Permit added to your list.');
      onCancel();
    } catch (error) {
      const applied = error instanceof Error && applyServerErrors(error.cause, form.setError);
      if (!applied) toast.error(permitSaveErrorMessage(error));
    } finally {
      setPending(false);
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="permit-number">
          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span>Permit reference / number</span>
            <span className="font-normal text-muted-foreground">
              {editing ? 'Optional for older records' : 'Required'}
            </span>
          </span>
          <Input
            id="permit-number"
            autoComplete="off"
            autoFocus={!editing}
            required={!editing}
            placeholder={editing ? 'Permit number' : 'Enter the permit number from the City record'}
            aria-invalid={Boolean(form.formState.errors.permitNumber)}
            {...form.register('permitNumber')}
          />
          <FieldError message={form.formState.errors.permitNumber?.message} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor={portalUrlId}>
          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span>Official City of Tampa Accela Building record URL</span>
            <span className="font-normal text-muted-foreground">
              {editing ? 'Optional for older records' : 'Required'}
            </span>
          </span>
          <Input
            id={portalUrlId}
            type="url"
            autoComplete="url"
            required={!editing}
            placeholder="Paste a direct City record URL from Accela"
            aria-describedby={portalUrlHelpId}
            aria-invalid={Boolean(form.formState.errors.portalUrl)}
            {...form.register('portalUrl')}
          />
          <FieldError message={form.formState.errors.portalUrl?.message} />
          <span id={portalUrlHelpId} className="text-xs font-normal text-muted-foreground">
            Use the direct Building detail page with the record IDs in its URL. A Tampa mailing
            address alone does not establish City jurisdiction. Checks are on demand, confirm the
            permit number, and do not access applicant-only details.
          </span>
          {officialPortalUrl ? (
            <a
              className="w-fit text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={officialPortalUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open saved City portal link
            </a>
          ) : null}
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="permit-project-name">
          <span className="flex items-baseline justify-between gap-2">
            <span>Project name</span>
            <span className="font-normal text-muted-foreground">Required</span>
          </span>
          <Input
            id="permit-project-name"
            autoComplete="off"
            required
            placeholder="Example: Willow Street kitchen remodel"
            aria-invalid={Boolean(form.formState.errors.projectName)}
            {...form.register('projectName')}
          />
          <FieldError message={form.formState.errors.projectName?.message} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="permit-address">
          <span className="flex items-baseline justify-between gap-2">
            <span>Job address</span>
            <span className="font-normal text-muted-foreground">Required</span>
          </span>
          <Input
            id="permit-address"
            autoComplete="street-address"
            required
            placeholder="Street address in the City of Tampa"
            aria-invalid={Boolean(form.formState.errors.address)}
            {...form.register('address')}
          />
          <FieldError message={form.formState.errors.address?.message} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="permit-type">
          Permit type
          <select
            id="permit-type"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...form.register('permitType')}
          >
            {permitTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="permit-status">
          Current status
          <select
            id="permit-status"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...form.register('status')}
          >
            {permitStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-muted-foreground">
            Updated manually by your team
          </span>
        </label>
        {editing && selectedStatus !== initialValues.status ? (
          <label className="grid gap-1.5 text-sm font-medium" htmlFor={falseAlarmReasonId}>
            False-alarm reason <span className="font-normal text-muted-foreground">Optional</span>
            <Textarea
              id={falseAlarmReasonId}
              rows={2}
              maxLength={500}
              placeholder="Add context if this status change was a false alarm"
              value={falseAlarmReason}
              onChange={(event) => setFalseAlarmReason(event.currentTarget.value)}
            />
          </label>
        ) : null}
      </div>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="permit-notes">
        Notes <span className="font-normal text-muted-foreground">Optional</span>
        <Textarea
          id="permit-notes"
          rows={3}
          placeholder="Add a handoff note for your team"
          aria-invalid={Boolean(form.formState.errors.notes)}
          {...form.register('notes')}
        />
        <FieldError message={form.formState.errors.notes?.message} />
      </label>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Add permit'}
        </Button>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <span className="text-xs font-normal text-destructive" role="alert">
      {message}
    </span>
  ) : null;
}

function permitSaveErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not save this permit. Please try again.';
  const body = error.cause;
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return 'Could not save this permit. Please try again.';
  }
  const code = body.error;
  if (code === 'team_membership_required') {
    return 'You no longer have access to this team. Select a team you belong to and try again.';
  }
  if (code === 'team_subscription_required') {
    return 'This team does not have active permit access. Ask the team owner to restore access.';
  }
  if (code === 'billing_status_unavailable') {
    return 'This team’s access could not be confirmed. Please try again shortly.';
  }
  if (code === 'forbidden_origin') {
    return 'This request could not be verified. Refresh the page and try again.';
  }
  return 'Could not save this permit. Please try again.';
}

function CorrectionLetterUpload({
  teamId,
  permitId,
  onUploaded,
}: {
  teamId: string;
  permitId: string;
  onUploaded: (letter: PermitLetterItem) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File | undefined) {
    if (!file || progress !== null) return;

    if (!CorrectionLetterMimeType.safeParse(file.type).success) {
      toast.error('Choose a PDF, DOCX, or plain text letter.');
      return;
    }
    if (file.size > MAX_CORRECTION_LETTER_SIZE_BYTES) {
      toast.error('Correction letters must be 50 MB or smaller.');
      return;
    }

    setProgress(0);
    try {
      await apiFetch('/api/permit-letters', {
        method: 'POST',
        body: JSON.stringify({
          action: 'authorize',
          permitId,
          teamId,
          file: { filename: file.name, mime_type: file.type, size: file.size },
        }),
        schema: PermitLetterAuthorization,
      });

      const uploadId = await uploadPermitLetter(file, setProgress);
      const letter = await apiFetch('/api/permit-letters', {
        method: 'POST',
        body: JSON.stringify({
          action: 'attach',
          permitId,
          teamId,
          uploadId,
        }),
        schema: PermitLetterItemSchema,
      });
      onUploaded(letter);
      toast.success('Correction letter attached to this permit.');
    } catch (error) {
      toast.error(
        error instanceof FileUploadError
          ? error.message
          : 'Could not attach this letter. Confirm team access and try again.',
      );
    } finally {
      setProgress(null);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    void upload(file);
  }

  return (
    <div className="grid gap-2 sm:max-w-md">
      <label htmlFor={inputId} className="text-sm font-medium">
        Add a correction letter
      </label>
      <Input
        id={inputId}
        type="file"
        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        aria-describedby={hintId}
        disabled={progress !== null}
        onChange={handleChange}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        Attach a copy your team can access · PDF, DOCX, plain text, or image up to 50 MB. Public
        City attachments were not verified; secure files may require an authorized contact.
        Extraction supports PDF, JPG, PNG, or WebP up to 20 MB and 10 pages.
      </p>
      {progress !== null ? (
        <Progress value={progress} aria-label={`Uploading correction letter: ${progress}%`} />
      ) : null}
    </div>
  );
}

function PermitCard({
  permit,
  teamId,
  canBulkArchive,
  bulkSelected,
  onBulkSelectionChange,
  letters,
  editing,
  onEdit,
  onArchive,
  onSave,
  onLetterAttached,
  onLetterUpdated,
  onAssign,
  projectManagers,
  canAssign,
  archiving,
  bulkArchivePending,
  assigning,
}: {
  permit: PermitItem;
  teamId: string;
  canBulkArchive: boolean;
  bulkSelected: boolean;
  onBulkSelectionChange: (selected: boolean) => void;
  letters: PermitLetterItem[];
  editing: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onSave: (values: PermitFields, falseAlarmReason?: string) => Promise<PermitItem>;
  onLetterAttached: (letter: PermitLetterItem) => void;
  onLetterUpdated: (letter: PermitLetterItem) => void;
  onAssign: (projectManagerUserId: string | null) => Promise<void>;
  projectManagers: PermitProjectManager[];
  canAssign: boolean;
  archiving: boolean;
  bulkArchivePending: boolean;
  assigning: boolean;
}) {
  const [selectedManagerId, setSelectedManagerId] = useState(
    permit.assignedProjectManager?.id ?? '',
  );

  useEffect(() => {
    setSelectedManagerId(permit.assignedProjectManager?.id ?? '');
  }, [permit.assignedProjectManager?.id]);

  const officialPortalUrl = getOfficialPermitPortalUrl(permit.portalUrl);

  function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onAssign(selectedManagerId || null);
  }

  if (editing) {
    return (
      <article className="rounded-xl border border-primary/30 bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {canBulkArchive ? (
              <PermitSelectionControl
                permitName={permit.projectName}
                selected={bulkSelected}
                onChange={onBulkSelectionChange}
                disabled={archiving || bulkArchivePending}
              />
            ) : null}
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Edit permit
            </p>
            <h2 className="mt-1 text-lg font-semibold">{permit.projectName}</h2>
          </div>
          <Badge variant="outline">{officialPortalUrl ? 'City of Tampa' : 'Not monitored'}</Badge>
        </div>
        <PermitEditor
          initialValues={{
            projectName: permit.projectName,
            address: permit.address,
            permitNumber: permit.permitNumber,
            permitType: permit.permitType,
            status: permit.status,
            notes: permit.notes,
            portalUrl: permit.portalUrl,
          }}
          editing
          onCancel={onEdit}
          onSave={onSave}
        />
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {canBulkArchive ? (
            <PermitSelectionControl
              permitName={permit.projectName}
              selected={bulkSelected}
              onChange={onBulkSelectionChange}
              disabled={archiving || bulkArchivePending}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-lg font-semibold tracking-tight text-foreground">
              {permit.projectName}
            </h2>
            <Badge variant="outline">{officialPortalUrl ? 'City of Tampa' : 'Not monitored'}</Badge>
            <Badge variant={permit.status === 'Issued' ? 'default' : 'secondary'}>
              {permit.status}
            </Badge>
          </div>
          <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{permit.address}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{permit.permitType}</span>
            {permit.permitNumber ? (
              <span>Permit {permit.permitNumber}</span>
            ) : (
              <span>No permit number yet</span>
            )}
          </div>
          {officialPortalUrl ? (
            <div className="mt-4 grid justify-items-start gap-1">
              <a
                className="text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={officialPortalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Official City of Tampa Accela record
              </a>
              <p className="text-xs text-muted-foreground">
                Tampa public record link. Applicant-only information is not accessed.
              </p>
            </div>
          ) : null}
          <PermitPortalMonitor
            permitId={permit.id}
            permitNumber={permit.permitNumber}
            portalUrl={permit.portalUrl}
            teamId={teamId}
            archived={Boolean(permit.archivedAt)}
          />
          {permit.notes ? (
            <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/80">{permit.notes}</p>
          ) : null}
          <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:max-w-xl">
            <p className="text-sm">
              <span className="font-medium">Project manager: </span>
              <span className="text-muted-foreground">
                {permit.assignedProjectManager?.name ?? 'Unassigned'}
              </span>
            </p>
            {canAssign && !permit.archivedAt ? (
              <form className="grid gap-2" onSubmit={saveAssignment}>
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`project-manager-${permit.id}`}
                >
                  Change assignment
                </label>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <select
                    id={`project-manager-${permit.id}`}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={selectedManagerId}
                    onChange={(event) => setSelectedManagerId(event.currentTarget.value)}
                    disabled={assigning}
                  >
                    <option value="">Unassigned</option>
                    {projectManagers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={
                      assigning || selectedManagerId === (permit.assignedProjectManager?.id ?? '')
                    }
                  >
                    {assigning ? 'Saving…' : 'Save assignment'}
                  </Button>
                </div>
                {projectManagers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    An accepted project manager invitation is required before assignment.
                  </p>
                ) : null}
              </form>
            ) : null}
          </div>
        </div>
        {permit.archivedAt ? (
          <Badge variant="outline" className="w-fit shrink-0">
            Archived
          </Badge>
        ) : (
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onArchive}
              disabled={archiving || bulkArchivePending}
            >
              <Archive aria-hidden="true" className="mr-1.5 size-4" />
              {archiving ? 'Archiving…' : 'Archive'}
            </Button>
          </div>
        )}
      </div>
      <section
        className="mt-5 grid gap-3 border-t border-border pt-5"
        aria-label={`Status history for ${permit.projectName}`}
      >
        <div>
          <h3 className="text-sm font-semibold">Status history</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved status changes for this permit, oldest first.
          </p>
        </div>
        {permit.statusEvents.length > 0 ? (
          <ol className="grid gap-2">
            {permit.statusEvents.map((event) => (
              <li
                key={event.id}
                className="grid gap-1 rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant={event.status === 'Issued' ? 'default' : 'secondary'}>
                    {event.status}
                  </Badge>
                  <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </div>
                {event.falseAlarmReason ? (
                  <p className="text-sm text-foreground/80">
                    <span className="font-medium">False-alarm reason: </span>
                    {event.falseAlarmReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            No status changes have been recorded yet.
          </p>
        )}
      </section>
      {permit.archivedAt ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          Archived {new Date(permit.archivedAt).toLocaleDateString()}
        </p>
      ) : null}
      <section
        className="mt-5 grid gap-4 border-t border-border pt-5"
        aria-label={`Correction letters for ${permit.projectName}`}
      >
        <div>
          <h3 className="text-sm font-semibold">Correction letters</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Letters uploaded by your team for this permit.
          </p>
        </div>
        {letters.length > 0 ? (
          <ul className="grid gap-2">
            {letters.map((letter) => (
              <li
                key={letter.id}
                className="grid gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    className="w-fit break-all text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/api/permit-letters/${encodeURIComponent(letter.id)}/source?${new URLSearchParams({ teamId, permitId: permit.id }).toString()}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {letter.fileName}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(letter.size / (1024 * 1024)).toFixed(1)} MB ·{' '}
                    {new Date(letter.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {letter.correctionChecklist ? (
                  <Link
                    aria-label={`Open saved correction checklist for ${letter.fileName}: ${letter.correctionChecklist.completedCount} of ${letter.correctionChecklist.totalCount} items complete`}
                    className="grid w-full max-w-sm gap-1.5 rounded-md text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`correction-checklist-summary-${letter.id}`}
                    href={`/dashboard/permits/${encodeURIComponent(letter.permitId)}/letters/${encodeURIComponent(letter.correctionChecklist.sourceLetterId)}/checklist`}
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 underline underline-offset-4 hover:no-underline">
                      <span className="font-medium">Correction checklist</span>
                      <span className="text-muted-foreground">
                        {letter.correctionChecklist.completedCount} of{' '}
                        {letter.correctionChecklist.totalCount} complete
                        {letter.correctionChecklist.totalCount > 0 &&
                        letter.correctionChecklist.completedCount ===
                          letter.correctionChecklist.totalCount
                          ? ' · All tasks done'
                          : ''}
                      </span>
                    </span>
                    <Progress
                      value={completionPercent(
                        letter.correctionChecklist.completedCount,
                        letter.correctionChecklist.totalCount,
                      )}
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid={`correction-checklist-none-${letter.id}`}
                  >
                    No saved checklist
                  </p>
                )}
                <PermitLetterDraft
                  letter={letter}
                  teamId={teamId}
                  onSaved={(draft) => onLetterUpdated({ ...letter, correctionDraft: draft })}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            No letters attached yet. No saved correction checklist.
          </p>
        )}
        <CorrectionLetterUpload
          teamId={teamId}
          permitId={permit.id}
          onUploaded={onLetterAttached}
        />
      </section>
    </article>
  );
}

function PermitSelectionControl({
  permitName,
  selected,
  onChange,
  disabled,
}: {
  permitName: string;
  selected: boolean;
  onChange: (selected: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="mb-3 inline-flex min-h-9 w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground"
    >
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Select ${permitName} for bulk archive`}
        checked={selected}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>Select permit</span>
    </label>
  );
}

export function PermitWorkspace({
  teamId,
  role,
  initialStatus,
}: {
  teamId: string;
  role: string;
  initialStatus: PermitStatus | null;
}) {
  const [view, setView] = useState<ListView>('active');
  const [statusFilter, setStatusFilter] = useState<PermitStatus | null>(initialStatus);
  const [monitoringOutcomeFilter, setMonitoringOutcomeFilter] =
    useState<PermitMonitoringOutcome | null>(null);
  const [sort, setSort] = useState<PermitListSort>('activity');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [interruptedMonitoring, setInterruptedMonitoring] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [statusCounts, setStatusCounts] = useState<PermitStatusCount[] | null>(null);
  const [projectManagers, setProjectManagers] = useState<PermitProjectManager[]>([]);
  const [letters, setLetters] = useState<PermitLetterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [selectedPermitIds, setSelectedPermitIds] = useState<string[]>([]);
  const [showBulkArchiveConfirmation, setShowBulkArchiveConfirmation] = useState(false);
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const requestId = useRef(0);
  const assignedFilterActive = role === 'project_manager' && assignedToMe;
  const monitoringOutcomeLabel = monitoringOutcomeFilter
    ? {
        successful: 'Successful',
        failed: 'Failed',
        not_checked: 'Not yet checked',
      }[monitoringOutcomeFilter]
    : null;
  const filterNames = [
    ...(monitoringOutcomeLabel ? [`Latest monitoring outcome: ${monitoringOutcomeLabel}`] : []),
    ...(interruptedMonitoring ? ['Interrupted monitoring'] : []),
    ...(assignedFilterActive ? ['Assigned to me'] : []),
  ];
  const assignedOnly = assignedFilterActive && !interruptedMonitoring;
  const viewLabel = view === 'active' ? 'Active' : 'Archived';

  useEffect(() => {
    setStatusFilter(initialStatus);
  }, [initialStatus]);

  const loadPermits = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    setStatusCounts(null);
    try {
      const query = new URLSearchParams({ view, teamId, sort });
      if (statusFilter) query.set('status', statusFilter);
      if (monitoringOutcomeFilter) query.set('monitoringOutcome', monitoringOutcomeFilter);
      if (assignedToMe && role === 'project_manager') query.set('assignedToMe', 'true');
      if (interruptedMonitoring) query.set('interruptedMonitoring', 'true');
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      const letterQuery = new URLSearchParams({ teamId });
      const countsQuery = new URLSearchParams({ teamId });
      const [data, letterData, countData] = await Promise.all([
        apiFetch(`/api/permits?${query.toString()}`, { schema: PermitList }),
        apiFetch(`/api/permit-letters?${letterQuery.toString()}`, { schema: PermitLetterList }),
        apiFetch(`/api/permit-status-counts?${countsQuery.toString()}`, {
          schema: PermitStatusCountsSchema,
        }),
      ]);
      if (requestId.current === currentRequest) {
        setPermits(data.items);
        setProjectManagers(data.projectManagers);
        setLetters(letterData.items);
        setStatusCounts(countData.items);
      }
    } catch {
      if (requestId.current === currentRequest) {
        setLoadError(true);
        setStatusCounts(null);
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [
    assignedToMe,
    interruptedMonitoring,
    monitoringOutcomeFilter,
    role,
    searchTerm,
    sort,
    statusFilter,
    teamId,
    view,
  ]);

  useEffect(() => {
    void loadPermits();
    return () => {
      requestId.current += 1;
    };
  }, [loadPermits]);

  async function saveNew(values: PermitFields) {
    return apiFetch('/api/permits', {
      method: 'POST',
      body: JSON.stringify({ ...values, teamId }),
      schema: PermitItemSchema,
    });
  }

  async function createPermit(values: PermitFields) {
    const permit = await saveNew(values);
    await loadPermits();
    setShowCreate(false);
    return permit;
  }

  async function updatePermit(id: string, values: PermitFields, falseAlarmReason?: string) {
    const permit = await apiFetch('/api/permits', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'update', id, teamId, data: values, falseAlarmReason }),
      schema: PermitItemSchema,
    });
    await loadPermits();
    setEditingId(null);
    return permit;
  }

  async function assignPermit(id: string, projectManagerUserId: string | null) {
    setAssigningId(id);
    try {
      const permit = await apiFetch('/api/permits', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'assign', id, teamId, projectManagerUserId }),
        schema: PermitItemSchema,
      });
      setPermits((items) => items.map((item) => (item.id === permit.id ? permit : item)));
      toast.success('Project manager assignment saved.');
    } catch {
      toast.error(
        'Could not save this assignment. Confirm the manager is an accepted team member.',
      );
    } finally {
      setAssigningId(null);
    }
  }

  async function archivePermit(permit: PermitItem) {
    setArchivingId(permit.id);
    try {
      await apiFetch('/api/permits', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'archive', id: permit.id, teamId }),
        schema: PermitItemSchema,
      });
      await loadPermits();
      setSelectedPermitIds((items) => items.filter((id) => id !== permit.id));
      toast.success('Permit moved to archived.');
    } catch {
      toast.error('Could not archive this permit. Please try again.');
    } finally {
      setArchivingId(null);
    }
  }

  function selectPermit(permitId: string, selected: boolean) {
    setSelectedPermitIds((current) =>
      selected
        ? current.includes(permitId)
          ? current
          : [...current, permitId]
        : current.filter((id) => id !== permitId),
    );
  }

  function clearListFiltersForStatus() {
    setView('active');
    setAssignedToMe(false);
    setInterruptedMonitoring(false);
    setMonitoringOutcomeFilter(null);
    setSearchTerm('');
  }

  async function archiveSelectedPermits() {
    if (selectedPermitIds.length === 0) return;
    const permitIds = [...selectedPermitIds];
    setBulkArchiving(true);
    try {
      const result = await apiFetch('/api/permits', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'archiveBulk', teamId, permitIds }),
        schema: PermitBulkArchiveResponseSchema,
      });
      await loadPermits();
      setSelectedPermitIds([]);
      setShowBulkArchiveConfirmation(false);
      const noun = result.archivedCount === 1 ? 'permit' : 'permits';
      toast.success(`${result.archivedCount} ${noun} moved to Archived.`);
    } catch {
      toast.error(
        'Could not archive the selected permits. No permits were changed. Please try again.',
      );
    } finally {
      setBulkArchiving(false);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <section className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            City of Tampa · Permit desk
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Your permits
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Keep each job, permit number, and team note together in one private list.
          </p>
        </div>
        {view === 'active' ? (
          <Button type="button" onClick={() => setShowCreate((open) => !open)}>
            <Plus aria-hidden="true" className="mr-2 size-4" />
            {showCreate ? 'Close form' : 'Add permit'}
          </Button>
        ) : null}
      </section>

      <section
        className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4 sm:p-5"
        aria-labelledby="team-permit-status-title"
        aria-busy={statusCounts === null && !loadError}
      >
        <div>
          <h3 id="team-permit-status-title" className="font-semibold text-foreground">
            Active permits by saved status
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Counts include active permits in this team. Select a status to see its permits.
          </p>
        </div>
        {statusCounts === null ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {loadError ? 'Status counts could not be loaded.' : 'Loading status counts…'}
          </p>
        ) : (
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {PermitStatusSchema.options.map((status) => {
              const count = statusCounts.find((item) => item.status === status)?.count ?? 0;
              const query = new URLSearchParams({ teamId, status });
              return (
                <Link
                  key={status}
                  href={`/dashboard?${query.toString()}`}
                  onClick={clearListFiltersForStatus}
                  aria-label={`View ${count} ${status} permit${count === 1 ? '' : 's'}`}
                  aria-current={statusFilter === status ? 'page' : undefined}
                  className={`grid min-w-0 gap-2 rounded-lg border px-3 py-3 transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${statusFilter === status ? 'border-primary bg-primary/5' : 'border-border bg-background'}`}
                >
                  <span className="text-left text-xs leading-4 text-muted-foreground sm:text-sm">
                    {status}
                  </span>
                  <strong className="text-left text-2xl font-semibold tabular-nums text-foreground">
                    {count}
                  </strong>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {statusFilter ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-sm text-foreground">
            Showing {viewLabel.toLowerCase()} permits with saved status{' '}
            <strong>{statusFilter}</strong>.
          </p>
          <Link
            href={`/dashboard?teamId=${encodeURIComponent(teamId)}`}
            className="text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear status filter
          </Link>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-3">
        <p className="text-sm text-muted-foreground">
          Manual permit management · status is maintained by your team
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label
            htmlFor="permit-search"
            className="grid w-full gap-1.5 text-sm font-medium sm:max-w-xs"
          >
            Search permits
            <span className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="permit-search"
                type="search"
                autoComplete="off"
                maxLength={200}
                placeholder="Permit reference or property address"
                value={searchTerm}
                onChange={(event) => {
                  setSelectedPermitIds([]);
                  setShowBulkArchiveConfirmation(false);
                  setSearchTerm(event.currentTarget.value);
                }}
                className="pl-9"
              />
            </span>
          </label>
          <label htmlFor="permit-sort" className="grid w-full gap-1.5 text-sm font-medium sm:w-52">
            Sort permits
            <select
              id="permit-sort"
              value={sort}
              onChange={(event) => setSort(PermitListSort.parse(event.currentTarget.value))}
              className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="reference">Permit reference</option>
              <option value="address">Address</option>
              <option value="activity">Most recent activity</option>
            </select>
          </label>
          <label
            htmlFor="permit-monitoring-outcome"
            className="grid w-full gap-1.5 text-sm font-medium sm:w-52"
          >
            Latest monitoring outcome
            <select
              id="permit-monitoring-outcome"
              value={monitoringOutcomeFilter ?? ''}
              onChange={(event) => {
                setSelectedPermitIds([]);
                setShowBulkArchiveConfirmation(false);
                setMonitoringOutcomeFilter(
                  event.currentTarget.value
                    ? PermitMonitoringOutcomeSchema.parse(event.currentTarget.value)
                    : null,
                );
              }}
              className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">All outcomes</option>
              <option value="successful">Successful</option>
              <option value="failed">Failed</option>
              <option value="not_checked">Not yet checked</option>
            </select>
          </label>
          <fieldset className="flex w-full rounded-lg border border-border bg-muted/60 p-1 sm:w-auto">
            <legend className="sr-only">Permit list view</legend>
            <Button
              type="button"
              size="sm"
              variant={view === 'active' ? 'secondary' : 'ghost'}
              className="flex-1 sm:flex-none"
              aria-pressed={view === 'active'}
              onClick={() => {
                setSelectedPermitIds([]);
                setShowBulkArchiveConfirmation(false);
                setView('active');
              }}
            >
              Active
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === 'archived' ? 'secondary' : 'ghost'}
              className="flex-1 sm:flex-none"
              aria-pressed={view === 'archived'}
              onClick={() => {
                setEditingId(null);
                setSelectedPermitIds([]);
                setShowBulkArchiveConfirmation(false);
                setView('archived');
              }}
            >
              Archived
            </Button>
          </fieldset>
          {role === 'project_manager' ? (
            <Button
              type="button"
              size="sm"
              variant={assignedToMe ? 'secondary' : 'outline'}
              className="w-full sm:w-auto"
              aria-pressed={assignedToMe}
              onClick={() => {
                setSelectedPermitIds([]);
                setShowBulkArchiveConfirmation(false);
                setAssignedToMe((current) => !current);
              }}
            >
              <ListFilter aria-hidden="true" className="mr-2 size-4" />
              Assigned to me
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={interruptedMonitoring ? 'secondary' : 'outline'}
            className="w-full sm:w-auto"
            aria-pressed={interruptedMonitoring}
            onClick={() => {
              setSelectedPermitIds([]);
              setShowBulkArchiveConfirmation(false);
              setInterruptedMonitoring((current) => !current);
            }}
          >
            <ListFilter aria-hidden="true" className="mr-2 size-4" />
            Interrupted monitoring
          </Button>
          <CsvExporter
            sourceId="permits"
            filters={{
              teamId,
              view,
              sort,
              status: statusFilter,
              assignedToMe: role === 'project_manager' && assignedToMe,
              interruptedMonitoring,
              searchTerm,
            }}
            label="Export CSV"
          />
        </div>
      </div>

      {role === 'owner' && view === 'active' && permits.length > 0 ? (
        <section className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Select active permits to archive them together. Archived permits stay available in the
            Archived view.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={selectedPermitIds.length === 0 || bulkArchiving}
            onClick={() => setShowBulkArchiveConfirmation(true)}
          >
            <Archive aria-hidden="true" className="size-4" />
            Archive selected ({selectedPermitIds.length})
          </Button>
        </section>
      ) : null}

      {showBulkArchiveConfirmation && selectedPermitIds.length > 0 ? (
        <section
          className="grid gap-3 rounded-xl border border-destructive/40 bg-card p-4 sm:flex sm:items-center sm:justify-between"
          aria-labelledby="bulk-archive-confirmation-title"
        >
          <div>
            <h3 id="bulk-archive-confirmation-title" className="font-semibold text-foreground">
              Archive {selectedPermitIds.length} selected{' '}
              {selectedPermitIds.length === 1 ? 'permit' : 'permits'}?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The records will move to Archived and remain available there.
            </p>
            {bulkArchiving ? (
              <output className="mt-2 text-sm font-medium text-primary" aria-live="polite">
                Archiving {selectedPermitIds.length}{' '}
                {selectedPermitIds.length === 1 ? 'permit' : 'permits'}…
              </output>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={bulkArchiving}
              onClick={() => setShowBulkArchiveConfirmation(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={bulkArchiving}
              onClick={() => void archiveSelectedPermits()}
            >
              {bulkArchiving
                ? 'Archiving…'
                : `Confirm archive ${selectedPermitIds.length} ${selectedPermitIds.length === 1 ? 'permit' : 'permits'}`}
            </Button>
          </div>
        </section>
      ) : null}

      {role === 'owner' ? (
        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-5 py-4 font-semibold text-foreground marker:text-primary">
            Import permits from CSV
          </summary>
          <div className="border-t border-border px-5 py-5 sm:px-6">
            <p className="mb-5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Add City of Tampa permit records to this team. Every row needs a direct City of Tampa
              Accela Building record URL with its record IDs; portal home, search, and non-Building
              links are rejected. Existing records are skipped, and no rows are saved if any row has
              an issue.
            </p>
            <CsvImporter
              targetId="tampa-city-permits"
              endpoint={`/api/csv-import?teamId=${encodeURIComponent(teamId)}`}
              onComplete={() => void loadPermits()}
            />
          </div>
        </details>
      ) : null}

      {showCreate && view === 'active' ? (
        <section
          className="rounded-xl border border-primary/30 bg-card p-5 shadow-sm sm:p-6"
          aria-labelledby="new-permit-title"
        >
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Manual entry
            </p>
            <h2 id="new-permit-title" className="mt-1 text-xl font-semibold">
              Add a monitored Tampa permit
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This records a job for on-demand status checks. Redline does not file the permit with
              the City.
            </p>
          </div>
          <PermitEditor
            initialValues={emptyPermit}
            editing={false}
            onCancel={() => setShowCreate(false)}
            onSave={createPermit}
          />
        </section>
      ) : null}

      {loading ? (
        <output
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-8 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <RotateCw aria-hidden="true" className="size-4 motion-reduce:animate-none" />
          Loading permits…
        </output>
      ) : loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-6" role="alert">
          <p className="font-medium">Your permits could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void loadPermits()}
          >
            Try again
          </Button>
        </div>
      ) : permits.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card/70 px-6 py-12 text-center sm:py-16">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-secondary text-primary">
            {view === 'active' ? (
              <ClipboardList aria-hidden="true" className="size-5" />
            ) : (
              <Archive aria-hidden="true" className="size-5" />
            )}
          </span>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {searchTerm.trim()
              ? `No permits match “${searchTerm.trim()}” in your ${viewLabel} list${assignedFilterActive ? ' for Assigned to me' : ''}.`
              : statusFilter
                ? `No ${viewLabel.toLowerCase()} permits have saved status “${statusFilter}”.`
                : monitoringOutcomeLabel
                  ? `No ${monitoringOutcomeLabel.toLowerCase()} permits in your ${viewLabel.toLowerCase()} list.`
                  : interruptedMonitoring
                    ? `No permits match these filters in ${viewLabel}.`
                    : assignedOnly
                      ? `No permits are assigned to you in ${viewLabel}.`
                      : view === 'active'
                        ? 'No active permits yet.'
                        : 'Nothing archived yet.'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {searchTerm.trim()
              ? "Search checks this team's selected list by permit reference or property address. Try another term or clear the search."
              : statusFilter
                ? 'Choose another saved status above or clear the status filter to return to the full active list.'
                : monitoringOutcomeLabel
                  ? 'Choose another latest monitoring outcome or select All outcomes to return to the full list.'
                  : interruptedMonitoring
                    ? `Filters: ${filterNames.join(' and ')}.`
                    : assignedOnly
                      ? 'Turn off Assigned to me to return to the full team list.'
                      : view === 'active'
                        ? 'Add your team’s first City of Tampa permit with its reference and official Building record URL. This saves it for on-demand checks; it does not file with the City.'
                        : 'Permits you archive will appear here and stay out of the active list.'}
          </p>
          {searchTerm.trim() || assignedOnly || interruptedMonitoring || monitoringOutcomeFilter ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {searchTerm.trim() ? (
                <Button type="button" variant="outline" onClick={() => setSearchTerm('')}>
                  Clear search
                </Button>
              ) : null}
              {assignedOnly ? (
                <Button type="button" variant="outline" onClick={() => setAssignedToMe(false)}>
                  Show full team list
                </Button>
              ) : null}
              {monitoringOutcomeFilter ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMonitoringOutcomeFilter(null)}
                >
                  Clear monitoring outcome
                </Button>
              ) : null}
              {interruptedMonitoring ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setInterruptedMonitoring(false);
                    setMonitoringOutcomeFilter(null);
                    if (assignedFilterActive) setAssignedToMe(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : null}
          {view === 'active' &&
          filterNames.length === 0 &&
          !statusFilter &&
          !searchTerm.trim() &&
          !showCreate ? (
            <Button type="button" className="mt-5" onClick={() => setShowCreate(true)}>
              <Plus aria-hidden="true" className="mr-2 size-4" />
              Add your first permit
            </Button>
          ) : null}
        </section>
      ) : (
        <section
          className="grid gap-3"
          aria-label={view === 'active' ? 'Active permits' : 'Archived permits'}
        >
          {permits.map((permit) => (
            <PermitCard
              key={permit.id}
              permit={permit}
              teamId={teamId}
              canBulkArchive={role === 'owner' && view === 'active'}
              bulkSelected={selectedPermitIds.includes(permit.id)}
              onBulkSelectionChange={(selected) => selectPermit(permit.id, selected)}
              letters={letters.filter((letter) => letter.permitId === permit.id)}
              editing={editingId === permit.id}
              onEdit={() => setEditingId(editingId === permit.id ? null : permit.id)}
              onArchive={() => void archivePermit(permit)}
              onSave={(values, falseAlarmReason) =>
                updatePermit(permit.id, values, falseAlarmReason)
              }
              onLetterAttached={(letter) => setLetters((items) => [letter, ...items])}
              onLetterUpdated={(letter) =>
                setLetters((items) => items.map((item) => (item.id === letter.id ? letter : item)))
              }
              onAssign={(projectManagerUserId) => assignPermit(permit.id, projectManagerUserId)}
              projectManagers={projectManagers}
              canAssign={role === 'owner'}
              archiving={archivingId === permit.id}
              bulkArchivePending={bulkArchiving}
              assigning={assigningId === permit.id}
            />
          ))}
        </section>
      )}
    </div>
  );
}
