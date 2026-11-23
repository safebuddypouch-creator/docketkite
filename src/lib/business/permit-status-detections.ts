// @polsia:user-owned — derive public status changes from successful portal observations.

export interface PermitPortalStatusObservation {
  id: string;
  permitId: string;
  permitNumber: string;
  status: string;
  checkedAt: Date;
  sourceFetchedAt: Date | null;
  sourceUrl: string;
  permit: {
    projectName: string;
    address: string;
    permitType: string;
  };
}

export interface PermitStatusDetectionRecord {
  id: string;
  permitId: string;
  permitNumber: string;
  projectName: string;
  address: string;
  permitType: string;
  previousStatus: string;
  newStatus: string;
  detectedAt: Date;
  observedAt: Date;
  sourceUrl: string;
}

function comparableStatus(status: string): string {
  return status.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/** True when two portal labels differ only by case or whitespace. */
export function portalStatusesEquivalent(left: string, right: string): boolean {
  return comparableStatus(left) === comparableStatus(right);
}

function compareObservations(
  left: PermitPortalStatusObservation,
  right: PermitPortalStatusObservation,
): number {
  const permitOrder = left.permitId.localeCompare(right.permitId);
  if (permitOrder !== 0) return permitOrder;
  const timeOrder = left.checkedAt.getTime() - right.checkedAt.getTime();
  return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id);
}

/**
 * A change needs two successful observations for the same permit. The first is
 * a baseline; repeated values (ignoring case and whitespace) are not changes.
 */
export function deriveRecentPermitStatusDetections(
  observations: readonly PermitPortalStatusObservation[],
  limit = 50,
): PermitStatusDetectionRecord[] {
  const previousByPermit = new Map<string, PermitPortalStatusObservation>();
  const detections: PermitStatusDetectionRecord[] = [];

  for (const observation of [...observations].sort(compareObservations)) {
    // Older imported observations without the source's fetch timestamp cannot
    // establish a public transition. Keep them out of the alert summary.
    if (!observation.status.trim() || !observation.sourceFetchedAt) continue;

    const previous = previousByPermit.get(observation.permitId);
    if (
      observation.sourceFetchedAt &&
      previous?.sourceFetchedAt &&
      observation.sourceFetchedAt.getTime() <= previous.sourceFetchedAt.getTime()
    ) {
      continue;
    }
    previousByPermit.set(observation.permitId, observation);
    if (!previous || portalStatusesEquivalent(previous.status, observation.status)) {
      continue;
    }

    detections.push({
      id: observation.id,
      permitId: observation.permitId,
      permitNumber: observation.permitNumber,
      projectName: observation.permit.projectName,
      address: observation.permit.address,
      permitType: observation.permit.permitType,
      previousStatus: previous.status,
      newStatus: observation.status,
      detectedAt: observation.checkedAt,
      observedAt: observation.sourceFetchedAt,
      sourceUrl: observation.sourceUrl,
    });
  }

  return detections
    .sort((left, right) => {
      const timeOrder = right.detectedAt.getTime() - left.detectedAt.getTime();
      return timeOrder !== 0 ? timeOrder : right.id.localeCompare(left.id);
    })
    .slice(0, Math.max(0, limit));
}
