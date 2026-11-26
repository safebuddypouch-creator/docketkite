// @polsia:user-owned
'use client';

import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  CsvDelimiter,
  CsvIssue,
  CsvMapping,
  ImportCounts,
} from '@/modules/csv-import/contracts';
import { useCsvImport } from '@/modules/csv-import/use-csv-import';

export interface CsvImporterProps {
  targetId: string;
  endpoint?: string;
  onComplete?: (counts: ImportCounts) => void;
}

function rowsLabel(count: number): string {
  return count === 1 ? 'row' : 'rows';
}

function issueMessage(issue: CsvIssue): string {
  if (issue.field === 'portal_url') {
    return 'Use a nonempty, direct Florida Accela Building record URL for this row.';
  }
  return issue.message;
}

export function CsvImporter({ targetId, endpoint, onComplete }: CsvImporterProps) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const issueRef = useRef<HTMLDivElement>(null);
  const {
    description,
    phase,
    headers,
    mapping,
    delimiter,
    mode,
    preview,
    result,
    error,
    canConfirm,
    selectFile,
    setMapping,
    setDelimiter,
    setMode,
    check,
    confirm,
    reset,
    downloadExample,
  } = useCsvImport({ targetId, endpoint, onComplete });

  const committing = phase === 'committing';
  const checking = phase === 'checking';
  const updating = mode !== 'create';
  const protectedExport = headers.some((header) => header.startsWith('__polsia_'));
  const requiredKeys = protectedExport
    ? []
    : updating
      ? (description?.updateKeyFields ?? [])
      : (description?.fields.filter((field) => field.required).map((field) => field.key) ?? []);
  const requiredFieldsMapped =
    description !== null && requiredKeys.every((key) => mapping[key] !== undefined);
  const importCount = (preview?.toCreate ?? 0) + (preview?.toUpdate ?? 0);
  const issues = error?.issues ?? preview?.issues ?? [];
  const issueCount = preview?.issueCount ?? error?.issues?.length ?? 0;

  useEffect(() => {
    if (error || issueCount > 0) issueRef.current?.focus();
  }, [error, issueCount]);

  function updateMapping(fieldKey: string, value: string) {
    const next: CsvMapping = { ...mapping };
    delete next[fieldKey];
    if (value !== '') {
      const column = Number(value);
      for (const [otherField, otherColumn] of Object.entries(next)) {
        if (otherColumn === column) delete next[otherField];
      }
      next[fieldKey] = column;
    }
    setMapping(next);
  }

  function handleDelimiter(value: string) {
    if (value === ',' || value === ';') setDelimiter(value as CsvDelimiter);
  }

  function startOver() {
    reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const status =
    phase === 'loading'
      ? 'Loading import settings…'
      : phase === 'checking'
        ? 'Checking the CSV…'
        : phase === 'committing'
          ? 'Importing rows…'
          : phase === 'done'
            ? 'Import complete.'
            : 'Ready.';

  return (
    <section className="space-y-6" aria-labelledby={`${id}-title`}>
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {description ? `Import ${description.label}` : 'CSV import'}
        </h2>
        <p className="text-sm text-muted-foreground">
          Match your CSV columns, check every row, then confirm the import.
        </p>
      </div>

      <output aria-live="polite" className="sr-only">
        {status}
      </output>

      {phase === 'loading' ? <p className="text-sm text-muted-foreground">{status}</p> : null}

      {description && phase !== 'done' ? (
        <div className="space-y-5">
          {description.modes?.some((supported) => supported !== 'create') ? (
            <div className="space-y-2">
              <Label htmlFor={`${id}-mode`}>Import mode</Label>
              <select
                id={`${id}-mode`}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={mode}
                disabled={committing}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next === 'create' || next === 'update' || next === 'upsert') setMode(next);
                }}
              >
                {description.modes.map((supported) => (
                  <option key={supported} value={supported}>
                    {supported === 'create'
                      ? 'Create new records'
                      : supported === 'update'
                        ? 'Update existing records'
                        : 'Create or update records'}
                  </option>
                ))}
              </select>
              {updating ? (
                <p className="text-sm text-muted-foreground">
                  Unmapped fields keep their current values. A mapped empty cell requests an empty
                  value, subject to validation. Review every change before importing.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor={`${id}-file`}>CSV file</Label>
              <Input
                ref={fileInputRef}
                id={`${id}-file`}
                type="file"
                accept=".csv,text/csv"
                disabled={committing}
                onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                UTF-8, up to {Math.floor(description.limits.bytes / 1_048_576)} MiB and{' '}
                {description.limits.records.toLocaleString('en-US')} records.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-delimiter`}>Separator</Label>
              <select
                id={`${id}-delimiter`}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={delimiter}
                disabled={committing}
                onChange={(event) => handleDelimiter(event.currentTarget.value)}
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
              </select>
            </div>
          </div>

          <Button type="button" variant="outline" onClick={downloadExample} disabled={committing}>
            Download example CSV
          </Button>

          {headers.length > 0 ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="font-medium">Match columns</h3>
                <p className="text-sm text-muted-foreground">
                  Choose which source column supplies each destination field.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {description.fields.map((field) => {
                  const selected = mapping[field.key];
                  const required =
                    requiredKeys.includes(field.key) ||
                    (targetId === 'tampa-city-permits' && field.key === 'portal_url');
                  const usedColumns = new Set(
                    Object.entries(mapping)
                      .filter(([key]) => key !== field.key)
                      .map(([, column]) => column),
                  );
                  return (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={`${id}-${field.key}`}>
                        {field.label} column{required ? ' (required)' : ''}
                      </Label>
                      <select
                        id={`${id}-${field.key}`}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        value={selected ?? ''}
                        disabled={committing}
                        onChange={(event) => updateMapping(field.key, event.currentTarget.value)}
                      >
                        <option value="">
                          {required
                            ? 'Choose a column'
                            : updating
                              ? 'Keep current value'
                              : 'Ignore this field'}
                        </option>
                        {headers.map((header, column) =>
                          header.startsWith('__polsia_') ? null : (
                            <option
                              key={`${column}:${header}`}
                              value={column}
                              disabled={
                                usedColumns.has(column) || (protectedExport && header !== field.key)
                              }
                            >
                              {header}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void check()}
                  disabled={!requiredFieldsMapped || checking || committing}
                >
                  {checking ? 'Checking…' : 'Check file'}
                </Button>
                <Button type="button" variant="ghost" onClick={startOver} disabled={committing}>
                  Start over
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          ref={issueRef}
          role="alert"
          tabIndex={-1}
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="font-medium text-destructive">{error.message}</p>
          {preview && preview.issueCount > 0 ? (
            <p>
              {preview.invalid} {preview.invalid === 1 ? 'row needs' : 'rows need'} attention.
            </p>
          ) : null}
          {error.uncertain ? (
            <p>Your request may have completed. Check your data before trying again.</p>
          ) : null}
          {issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {issues.map((issue) => (
                <li key={`${issue.record ?? 'file'}:${issue.field ?? 'general'}:${issue.message}`}>
                  {issue.record ? `Row ${issue.record}` : 'CSV file'}
                  {issue.field
                    ? ` · ${description?.fields.find((field) => field.key === issue.field)?.label ?? issue.field}`
                    : ''}
                  : {issueMessage(issue)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : preview && issueCount > 0 ? (
        <div
          ref={issueRef}
          role="alert"
          tabIndex={-1}
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="font-medium text-destructive">
            {preview.invalid} {preview.invalid === 1 ? 'row needs' : 'rows need'} attention.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {issues.map((issue) => (
              <li key={`${issue.record ?? 'file'}:${issue.field ?? 'general'}:${issue.message}`}>
                {issue.record ? `Row ${issue.record}` : 'CSV file'}
                {issue.field
                  ? ` · ${description?.fields.find((field) => field.key === issue.field)?.label ?? issue.field}`
                  : ''}
                : {issueMessage(issue)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <p>
              <span className="block text-muted-foreground">Total</span>
              <strong>{preview.total}</strong>
            </p>
            <p>
              <span className="block text-muted-foreground">To create</span>
              <strong>{preview.toCreate}</strong>
            </p>
            <p>
              <span className="block text-muted-foreground">
                {updating ? 'Matched records' : 'Already present'}
              </span>
              <strong>{preview.existing}</strong>
            </p>
            {updating ? (
              <p>
                <span className="block text-muted-foreground">To update</span>
                <strong>{preview.toUpdate ?? 0}</strong>
              </p>
            ) : null}
            <p>
              <span className="block text-muted-foreground">Needs attention</span>
              <strong>{preview.invalid}</strong>
            </p>
          </div>

          <p className="text-sm font-medium">
            {preview.invalid > 0
              ? 'Fix the reported rows before importing.'
              : importCount === 0
                ? updating
                  ? 'No changes to import.'
                  : 'These records are already present.'
                : [
                    ...(preview.toCreate > 0
                      ? [`${preview.toCreate} ${rowsLabel(preview.toCreate)} will be created.`]
                      : []),
                    ...((preview.toUpdate ?? 0) > 0
                      ? [`${preview.toUpdate} ${rowsLabel(preview.toUpdate ?? 0)} will be updated.`]
                      : []),
                  ].join(' ')}
          </p>

          {preview.rows.length > 0 ? (
            <>
              <div className="hidden sm:block">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Record</TableHead>
                      {description?.fields.map((field) => (
                        <TableHead key={field.key} scope="col">
                          {field.label}
                        </TableHead>
                      ))}
                      <TableHead scope="col">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.record}>
                        <TableHead scope="row">{row.record}</TableHead>
                        {description?.fields.map((field) => {
                          const change = row.changes?.find((item) => item.field === field.key);
                          return (
                            <TableCell key={field.key}>
                              {change ? (
                                <div className="space-y-1">
                                  <p className="text-muted-foreground">
                                    Before:{' '}
                                    {change.before === null
                                      ? '(not set)'
                                      : change.before === ''
                                        ? '(empty)'
                                        : change.before}
                                  </p>
                                  <p className="font-medium">
                                    After:{' '}
                                    {change.after === null
                                      ? '(not set)'
                                      : change.after === ''
                                        ? '(empty)'
                                        : change.after}
                                  </p>
                                </div>
                              ) : (
                                (row.values[field.key] ?? '')
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {updating && row.status === 'skip' ? 'No change' : row.status}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <section className="space-y-3 sm:hidden" aria-label="CSV row preview">
                {preview.rows.map((row) => (
                  <div key={row.record} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium">Record {row.record}</h3>
                      <span className="text-sm text-muted-foreground">
                        {updating && row.status === 'skip' ? 'No change' : row.status}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-y-2 text-sm">
                      {description?.fields.map((field) => (
                        <div key={field.key} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{field.label}</dt>
                          <dd className="break-words [overflow-wrap:anywhere]">
                            {row.values[field.key] || '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </section>
            </>
          ) : null}

          {importCount > 0 ? (
            <Button type="button" onClick={() => void confirm()} disabled={!canConfirm}>
              {committing ? 'Importing…' : `Import ${importCount} ${rowsLabel(importCount)}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3" aria-live="polite">
          <h3 className="font-medium">Import complete</h3>
          <p className="text-sm">
            {result.created} created,{' '}
            {result.updated !== undefined ? `${result.updated} updated, ` : ''}
            {result.skipped} skipped.
          </p>
          <Button type="button" variant="outline" onClick={startOver}>
            Import another file
          </Button>
        </div>
      ) : null}
    </section>
  );
}
