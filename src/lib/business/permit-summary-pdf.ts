// @polsia:user-owned — public-record fields for a saved Tampa permit snapshot.
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';
import type { BlockDocumentSpec } from '@/lib/pdf/schema';

export interface PermitSummaryPdfCheck {
  id: string;
  permitNumber: string;
  sourceUrl: string | null;
  status: string | null;
  result: string;
  checkedAt: Date;
  requestSequence: number;
  sourceFetchedAt: Date | null;
}

export interface PermitSummaryPdfRecord {
  permitNumber: string;
  address: string;
  portalUrl: string | null;
  portalStatusChecks: PermitSummaryPdfCheck[];
}

export type PermitSummaryPdfResult =
  | { available: true; spec: BlockDocumentSpec }
  | {
      available: false;
      error: 'permit_reference_required' | 'official_record_link_required';
      message: string;
    };

function latestVerifiedCheck(
  permitNumber: string,
  checks: PermitSummaryPdfCheck[],
): PermitSummaryPdfCheck | null {
  const reference = permitNumber.trim();
  return (
    checks
      .filter(
        (check) =>
          check.result === 'checked' &&
          check.permitNumber.trim() === reference &&
          Boolean(check.status?.trim()) &&
          check.sourceFetchedAt instanceof Date,
      )
      .sort((first, second) => {
        const timeOrder = second.checkedAt.getTime() - first.checkedAt.getTime();
        if (timeOrder !== 0) return timeOrder;
        const sequenceOrder = second.requestSequence - first.requestSequence;
        return sequenceOrder !== 0 ? sequenceOrder : second.id.localeCompare(first.id);
      })[0] ?? null
  );
}

function utcLabel(value: Date | null): string {
  return value ? `${value.toISOString().replace('T', ' ').replace(/Z$/, '')} UTC` : 'Not available';
}

export function buildPermitSummaryPdf(record: PermitSummaryPdfRecord): PermitSummaryPdfResult {
  const permitNumber = record.permitNumber.trim();
  if (!permitNumber) {
    return {
      available: false,
      error: 'permit_reference_required',
      message: 'Add the Tampa permit reference before downloading its summary.',
    };
  }

  const check = latestVerifiedCheck(permitNumber, record.portalStatusChecks);
  const officialUrl = check
    ? getOfficialPermitPortalUrl(check.sourceUrl ?? '')
    : getOfficialPermitPortalUrl(record.portalUrl ?? '');
  if (!officialUrl) {
    return {
      available: false,
      error: 'official_record_link_required',
      message:
        'Save a direct official City of Tampa Accela Building record URL before downloading this summary.',
    };
  }

  const spec: BlockDocumentSpec = {
    metadata: {
      title: `City of Tampa Permit Summary — ${permitNumber}`,
      subject: 'Saved Tampa permit public-record snapshot',
    },
    page: { margins: { top: 48, right: 48, bottom: 48, left: 48 } },
    defaultTextStyle: { fontSize: 10, lineHeight: 1.4, color: '#25282C' },
    styles: {
      h1: { fontSize: 22, color: '#20252B', spaceAfter: 6 },
      keyValue: { labelColor: '#5E6268', spaceAfter: 18 },
    },
    blocks: [
      { type: 'heading', level: 1, text: 'City of Tampa Permit Summary' },
      {
        type: 'text',
        text: 'Saved public-record snapshot · Not a permit filing',
        fontSize: 9,
        color: '#52606b',
        spaceAfter: 18,
      },
      {
        type: 'keyValue',
        rows: [
          { label: 'Permit reference', value: permitNumber },
          { label: 'Address', value: record.address },
          {
            label: 'Latest verified public portal result',
            value: check?.status?.trim() ?? 'No verified result available.',
          },
          { label: 'Check time (UTC)', value: utcLabel(check?.checkedAt ?? null) },
          { label: 'Official City of Tampa Accela Building record URL', value: officialUrl },
        ],
        fontSize: 10,
        spaceAfter: 18,
      },
      { type: 'rule', color: '#C8C9CB', spaceAfter: 12 },
      {
        type: 'text',
        text: 'This snapshot does not represent a permit filing or a claim of continuous checking.',
        fontSize: 9,
        color: '#52606b',
      },
    ],
  };

  return { available: true, spec };
}
