// @polsia:user-owned — verifies the installed PDF renderer accepts the permit summary blocks.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildPermitSummaryPdf } from '@/lib/business/permit-summary-pdf';
import { renderDocumentPdf } from '@/lib/pdf/client';

const recordUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

describe('installed permit summary PDF renderer', () => {
  it('returns a complete PDF document for the saved permit summary block spec', async () => {
    const summary = buildPermitSummaryPdf({
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: recordUrl,
      portalStatusChecks: [
        {
          id: 'check-1',
          permitNumber: 'BLD-27-0529173',
          sourceUrl: recordUrl,
          status: 'Corrections Requested',
          result: 'checked',
          checkedAt: new Date('2026-11-14T09:12:30.000Z'),
          requestSequence: 1,
          sourceFetchedAt: new Date('2026-11-14T09:12:28.000Z'),
        },
      ],
    });
    expect(summary.available).toBe(true);
    if (!summary.available) throw new Error('Expected a saved official record link.');

    const bytes = await renderDocumentPdf(summary.spec);

    expect(Buffer.from(bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
