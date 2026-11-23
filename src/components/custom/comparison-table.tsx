// @polsia:user-owned — comparison display. Restyle or replace it freely, while
// preserving accessible column/row relationships and a text label for the
// featured option. Edit claims in src/lib/comparison/content.ts.
import { Check, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ComparisonSource } from '@/lib/comparison/content';
import { cn } from '@/lib/utils';
import type {
  ComparisonColumn,
  ComparisonContent,
  ComparisonValue,
} from '@/modules/comparison-page/types';

function displayValue(value: ComparisonValue | undefined) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-2 font-medium text-foreground">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        Yes
      </span>
    );
  }
  if (value === false || value === undefined) {
    return (
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted">
          <Minus className="size-3.5" aria-hidden="true" />
        </span>
        No
      </span>
    );
  }
  return <span className="font-medium text-foreground">{value}</span>;
}

function columnClassName(column: ComparisonColumn): string | undefined {
  return column.featured ? 'bg-primary/[0.045]' : undefined;
}

export function ComparisonTable({
  content,
  sources,
  citations,
}: {
  content: ComparisonContent;
  sources: readonly ComparisonSource[];
  citations: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return (
    <section className="flex flex-col gap-6" aria-labelledby="comparison-heading">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {content.columns.map((column, index) => (
          <div
            key={column.id}
            className={cn(
              'relative flex min-h-36 flex-col justify-between gap-6 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm sm:min-h-48 sm:gap-8 sm:p-6',
              column.featured && 'border-primary/40 bg-primary/[0.045] shadow-primary/5',
            )}
          >
            {column.featured ? (
              <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              {column.badge ? (
                <Badge className="rounded-full px-3 py-1">{column.badge}</Badge>
              ) : null}
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold tracking-tight">{column.name}</h3>
              {column.description ? (
                <p className="text-sm leading-6 text-muted-foreground">{column.description}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Evidence-linked comparison
            </p>
            <h2 id="comparison-heading" className="mt-1 text-xl font-semibold tracking-tight">
              Compare what each tool documents
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Scroll the table horizontally on smaller screens
          </p>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[1120px]">
            <TableCaption className="sr-only">{content.tableCaption}</TableCaption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-14 w-[16%] px-5 sm:px-6">Capability</TableHead>
                {content.columns.map((column) => (
                  <TableHead
                    key={column.id}
                    scope="col"
                    className={cn(
                      'h-14 min-w-48 px-4 text-sm text-foreground',
                      columnClassName(column),
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span>{column.name}</span>
                      {column.featured ? (
                        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                      ) : null}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {content.groups.flatMap((group) => [
                <TableRow key={`${group.label}-heading`} className="bg-muted/40 hover:bg-muted/40">
                  <TableHead
                    colSpan={content.columns.length + 1}
                    scope="colgroup"
                    className="h-11 px-5 text-xs font-semibold uppercase tracking-[0.16em] text-foreground sm:px-6"
                  >
                    {group.label}
                  </TableHead>
                </TableRow>,
                ...group.rows.map((row) => (
                  <TableRow key={`${group.label}-${row.label}`} className="hover:bg-muted/25">
                    <TableHead
                      scope="row"
                      className="h-auto whitespace-normal px-5 py-5 align-middle text-foreground sm:px-6"
                    >
                      <span>{row.label}</span>
                      {row.description ? (
                        <span className="mt-1 block max-w-xs text-xs font-normal leading-5 text-muted-foreground">
                          {row.description}
                        </span>
                      ) : null}
                    </TableHead>
                    {content.columns.map((column) => {
                      const citedSources = (citations[row.label]?.[column.id] ?? [])
                        .map((sourceId) => sourceById.get(sourceId))
                        .filter((source): source is ComparisonSource => Boolean(source));

                      return (
                        <TableCell
                          key={column.id}
                          className={cn('px-4 py-5 align-middle', columnClassName(column))}
                        >
                          <div className="grid gap-2">
                            {displayValue(row.values[column.id])}
                            {citedSources.length > 0 ? (
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                {citedSources.map((source) => (
                                  <a
                                    key={source.id}
                                    href={source.href}
                                    target={source.href.startsWith('/') ? undefined : '_blank'}
                                    rel={source.href.startsWith('/') ? undefined : 'noreferrer'}
                                    className="text-xs font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                                  >
                                    {source.label}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
