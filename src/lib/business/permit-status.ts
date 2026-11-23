// @polsia:user-owned — shared permit status transition rule.

export function didPermitStatusChange(previousStatus: string, savedStatus: string): boolean {
  return previousStatus !== savedStatus;
}
