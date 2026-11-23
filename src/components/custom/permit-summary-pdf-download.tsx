// @polsia:user-owned — visible download control for a server-generated permit snapshot.
'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface ErrorPayload {
  message?: unknown;
}

function responseMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as ErrorPayload).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Could not generate the permit summary. No PDF was downloaded.';
}

export function PermitSummaryPdfDownload({ permitId }: { permitId: string }) {
  const [downloading, setDownloading] = useState(false);

  async function downloadSummary() {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/permits/${encodeURIComponent(permitId)}/summary-pdf`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(responseMessage(error));
      }

      if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/pdf') {
        throw new Error('The server did not return a PDF. No file was downloaded.');
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('The permit summary was empty. No file was downloaded.');

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition');
      const fileName = disposition?.match(/filename="([^"]+)"/)?.[1];
      link.href = url;
      if (fileName) link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Permit summary downloaded.');
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Could not generate the permit summary. No PDF was downloaded.',
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void downloadSummary()}
      disabled={downloading}
    >
      {downloading ? (
        <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
      ) : (
        <Download aria-hidden="true" className="mr-2 size-4" />
      )}
      {downloading ? 'Generating PDF…' : 'Download permit summary'}
    </Button>
  );
}
