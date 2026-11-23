// @polsia:user-owned
'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CsvDelimiter } from '@/modules/csv-export/contracts';
import { exportErrorSchema } from '@/modules/csv-export/contracts';
import { requestCsvExport, saveCsvFile } from '@/modules/csv-export/download';

export interface CsvExporterProps {
  sourceId: string;
  filters: unknown;
  columns?: string[];
  delimiter?: CsvDelimiter;
  label?: string;
}

function exportErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const parsed = exportErrorSchema.safeParse(error.cause);
    if (parsed.success) {
      switch (parsed.data.error.code) {
        case 'UNAUTHENTICATED':
          return 'Sign in to export permits.';
        case 'FORBIDDEN':
          return 'An active paid team membership is required to export permits.';
        case 'NO_RESULTS':
          return 'There are no permits to export with these filters.';
        case 'ROW_LIMIT':
          return 'This export exceeds 10,000 records. Refine the filters and try again.';
        case 'BYTE_LIMIT':
          return 'This export exceeds 10 MiB. Refine the filters and try again.';
        case 'CELL_LIMIT':
          return 'A permit field is too long to export.';
        case 'TIMEOUT':
          return 'The export took too long. Refine the filters and try again.';
        default:
          return parsed.data.error.message;
      }
    }
  }
  return 'The export could not be downloaded. Please try again.';
}

export function CsvExporter({
  sourceId,
  filters,
  columns,
  delimiter = ',',
  label = 'Export CSV',
}: CsvExporterProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify({ sourceId, filters, columns, delimiter });

  useEffect(() => {
    // Changing active filters/source invalidates an outstanding export.
    if (requestKey) {
      setStatus('idle');
      setMessage('');
    }
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [requestKey]);

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus('loading');
    setMessage('');
    try {
      const result = await requestCsvExport(
        { sourceId, filters, columns, delimiter },
        controller.signal,
      );
      if (controller.signal.aborted || active.current !== controller) return;
      saveCsvFile(result.data.csv, result.data.filename);
      setMessage(`${result.data.records.toLocaleString('en-US')} records exported.`);
      setStatus('success');
    } catch (error) {
      if (controller.signal.aborted || active.current !== controller) return;
      setMessage(exportErrorMessage(error));
      setStatus('error');
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={status === 'loading'}
        onClick={download}
        aria-busy={status === 'loading'}
      >
        {status === 'loading' ? 'Exporting…' : label}
      </Button>
      {message && (
        <p className="text-sm" role={status === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
    </div>
  );
}
