// @polsia:user-owned — aggregate only the app's saved permit status values.
import { PermitStatus } from '@/lib/contracts/permit';

export function buildPermitStatusCounts(groups: readonly { status: string; count: number }[]) {
  const counts = new Map(PermitStatus.options.map((status) => [status, 0 as number] as const));

  for (const group of groups) {
    const parsedStatus = PermitStatus.safeParse(group.status);
    if (parsedStatus.success) counts.set(parsedStatus.data, group.count);
  }

  return PermitStatus.options.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}
