// @polsia:user-owned — exact public Florida Accela permit status extraction.
import { portalStatusesEquivalent } from '@/lib/business/permit-status-detections';

export type PermitPortalExtraction =
  | { result: 'checked'; status: string; message: null }
  | { result: 'unverified'; status: null; message: string };

export interface PermitPortalMonitoringRecord {
  lastSuccessfulPortalCheckAt: Date | null;
  portalMonitoringInterruptedAt: Date | null;
  portalMonitoringReason: string | null;
}

export interface PermitPortalObservationOrder {
  checkedAt: Date;
  requestSequence: number;
}

/** A repeated or older cached page cannot establish a new public status transition. */
export function isNewerPortalPageRead(
  candidateFetchedAt: Date,
  previousFetchedAt: Date | null,
): boolean {
  return previousFetchedAt === null || candidateFetchedAt.getTime() > previousFetchedAt.getTime();
}

export interface PermitPortalMonitoringOutcome extends PermitPortalObservationOrder {
  result: 'checked' | 'unverified' | 'unavailable';
  message: string | null;
}

/** Compare saved checks in request order, using the sequence to break timestamp ties. */
export function isPortalObservationLater(
  candidate: PermitPortalObservationOrder,
  previous: PermitPortalObservationOrder | null,
): boolean {
  if (!previous) return true;
  const timeOrder = candidate.checkedAt.getTime() - previous.checkedAt.getTime();
  return timeOrder > 0 || (timeOrder === 0 && candidate.requestSequence > previous.requestSequence);
}

/** Notify only when a newer failed observation changes the current interruption. */
export function isNewPortalMonitoringInterruption(
  attempt: PermitPortalMonitoringOutcome,
  previous: (PermitPortalObservationOrder & { result: string; message: string | null }) | null,
): boolean {
  if (attempt.result === 'checked' || !isPortalObservationLater(attempt, previous)) return false;
  if (!previous || previous.result === 'checked') return true;
  return previous.result !== attempt.result || previous.message !== attempt.message;
}

/** Failed, stale, or unchanged reads never create a public status transition. */
export function shouldRecordPortalStatusTransition(input: {
  result: 'checked' | 'unverified' | 'unavailable';
  isCurrentSourceObservation: boolean;
  previousStatus: string | null;
  status: string | null;
}): boolean {
  if (
    input.result !== 'checked' ||
    !input.isCurrentSourceObservation ||
    !input.previousStatus?.trim() ||
    !input.status?.trim()
  ) {
    return false;
  }

  return !portalStatusesEquivalent(input.previousStatus, input.status);
}

export function applyPortalMonitoringOutcome(
  current: PermitPortalMonitoringRecord,
  attempt: {
    result: 'checked' | 'unverified' | 'unavailable';
    checkedAt: Date;
    requestSequence: number;
    message: string | null;
  },
  latestOutcome: PermitPortalObservationOrder | null,
): PermitPortalMonitoringRecord {
  const isLater = isPortalObservationLater(attempt, latestOutcome);
  const lastSuccessfulPortalCheckAt =
    attempt.result === 'checked' &&
    (!current.lastSuccessfulPortalCheckAt ||
      attempt.checkedAt.getTime() > current.lastSuccessfulPortalCheckAt.getTime())
      ? attempt.checkedAt
      : current.lastSuccessfulPortalCheckAt;
  if (isLater && attempt.result === 'checked') {
    return {
      lastSuccessfulPortalCheckAt,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    };
  }

  if (!isLater) {
    return { ...current, lastSuccessfulPortalCheckAt };
  }

  return {
    lastSuccessfulPortalCheckAt,
    portalMonitoringInterruptedAt: attempt.checkedAt,
    portalMonitoringReason:
      attempt.message ?? 'The public City permit status could not be verified.',
  };
}

export function portalMonitoringFromHistory(
  latestSuccessfulCheck: { checkedAt: Date } | null,
  latestCheck: {
    checkedAt: Date;
    result: string;
    message: string | null;
  } | null,
): PermitPortalMonitoringRecord {
  const interrupted = latestCheck && latestCheck.result !== 'checked' ? latestCheck : null;
  return {
    lastSuccessfulPortalCheckAt: latestSuccessfulCheck?.checkedAt ?? null,
    portalMonitoringInterruptedAt: interrupted?.checkedAt ?? null,
    portalMonitoringReason: interrupted
      ? (interrupted.message ?? 'The public City permit status could not be verified.')
      : null,
  };
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pageConfirmsIdentifier(markdown: string, identifier: string): boolean {
  const pattern = [...identifier].join('[^a-z0-9]*');
  const exactIdentifier = new RegExp(`(?:^|[^a-z0-9/-])${pattern}(?:$|[^a-z0-9/-])`, 'i');
  return exactIdentifier.test(markdown);
}

function cleanValue(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/^\s*(?:#{1,6}\s*|>+\s*)+/, '')
    .replace(/^\s*[-*#>]+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function statusFromMarkdown(markdown: string): string | null {
  const lines = markdown
    .replace(
      /<\/?(?:article|blockquote|br|dd|div|dl|dt|fieldset|footer|form|h[1-6]|header|hr|li|main|ol|p|section|table|td|th|tr|ul)\b[^>]*>/gi,
      '\n',
    )
    .split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;

    const cells = line
      .split('|')
      .map(cleanValue)
      .filter((cell) => cell.length > 0);
    const firstCell = cells[0]?.toLowerCase();
    const secondCell = cells[1];
    if (firstCell === 'record status' && secondCell && !/^[-:]+$/.test(secondCell)) {
      return secondCell;
    }

    const normalizedLine = cleanValue(line);
    const labeled = normalizedLine.match(/^record\s+status\s*:\s*(.+?)\s*$/i);
    const labeledStatus = labeled?.[1] ? cleanValue(labeled[1]) : null;
    if (labeledStatus) return labeledStatus;

    const standaloneLabel = cleanValue(line).toLowerCase().replace(/:$/, '');
    if (standaloneLabel === 'record status') {
      for (const followingLine of lines.slice(index + 1)) {
        const candidate = cleanValue(followingLine);
        if (!candidate || /^\|?\s*:?-{2,}/.test(candidate)) continue;
        const candidateLabel = candidate.toLowerCase();
        if (candidateLabel === 'application status' || candidateLabel === 'record status') {
          break;
        }
        return candidate.replace(/^\|+|\|+$/g, '').trim() || null;
      }
    }
  }
  return null;
}

/**
 * Accept a portal status only when the public page visibly identifies the
 * requested permit and exposes its public `Record Status` field. Applicant-only
 * `Application Status` and unlabelled guesses are deliberately ignored.
 */
export function extractPermitPortalStatus(
  markdown: string,
  permitNumber: string,
): PermitPortalExtraction {
  const identifier = normalizeIdentifier(permitNumber);
  if (!identifier || !pageConfirmsIdentifier(markdown, identifier)) {
    return {
      result: 'unverified',
      status: null,
      message: 'The public page did not confirm this permit number.',
    };
  }

  const status = statusFromMarkdown(markdown);
  if (!status || status.length > 160) {
    return {
      result: 'unverified',
      status: null,
      message: 'The public page did not show a readable public Record Status field.',
    };
  }

  return { result: 'checked', status, message: null };
}
