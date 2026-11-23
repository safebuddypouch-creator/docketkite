// @polsia:user-owned — classify a permit from its newest saved portal check.
import type { PermitMonitoringOutcome } from '@/lib/contracts/permit';

export interface PermitMonitoringCheckSnapshot {
  id: string;
  permitId: string;
  result: string;
  checkedAt: Date;
  requestSequence: number;
}

function newestCheckFirst(
  first: PermitMonitoringCheckSnapshot,
  second: PermitMonitoringCheckSnapshot,
): number {
  const checkedAtOrder = second.checkedAt.getTime() - first.checkedAt.getTime();
  if (checkedAtOrder !== 0) return checkedAtOrder;

  const sequenceOrder = second.requestSequence - first.requestSequence;
  if (sequenceOrder !== 0) return sequenceOrder;

  if (first.id === second.id) return 0;
  return first.id < second.id ? 1 : -1;
}

export function classifyPermitMonitoringOutcome(
  result: string | undefined,
): PermitMonitoringOutcome {
  if (result === undefined) return 'not_checked';
  return result === 'checked' ? 'successful' : 'failed';
}

export function getLatestPermitMonitoringOutcomes(
  checks: PermitMonitoringCheckSnapshot[],
): Map<string, PermitMonitoringOutcome> {
  const latest = new Map<string, PermitMonitoringOutcome>();
  for (const check of [...checks].sort(newestCheckFirst)) {
    if (!latest.has(check.permitId)) {
      latest.set(check.permitId, classifyPermitMonitoringOutcome(check.result));
    }
  }
  return latest;
}
