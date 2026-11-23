// @polsia:user-owned — downloads a checklist from its protected PDF endpoint.
'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

function pdfPath(permitId: string, letterId: string): string {
  const query = new URLSearchParams({ permitId });
  return `/api/permit-letters/${encodeURIComponent(letterId)}/checklist-pdf?${query.toString()}`;
}

function downloadFileName(response: Response): string {
  const header = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? 'correction-checklist.pdf';
}

export function PermitChecklistPdfDownload({
  permitId,
  letterId,
}: {
  permitId: string;
  letterId: string;
}) {
  const [loading, setLoading] = useState(false);

  async function downloadPdf() {
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch(pdfPath(permitId, letterId), { cache: 'no-store' });
      if (!response.ok) {
        toast.error(
          response.status === 402 || response.status === 403
            ? 'An active paid team membership is required to download this checklist.'
            : 'The checklist PDF could not be generated. Try again.',
        );
        return;
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadFileName(response);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.requestAnimationFrame(() => URL.revokeObjectURL(objectUrl));
      toast.success('Checklist PDF download started.');
    } catch {
      toast.error('The checklist PDF could not be generated. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={downloadPdf} disabled={loading}>
      {loading ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <Download aria-hidden="true" className="size-4" />
      )}
      <span>{loading ? 'Preparing PDF…' : 'Download PDF'}</span>
    </Button>
  );
}
