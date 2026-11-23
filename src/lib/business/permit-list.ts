// @polsia:user-owned — scoped permit list query conditions.
import type { Prisma } from '@prisma/client';
import type { PermitListSort, PermitStatus } from '@/lib/contracts/permit';

export type PermitListView = 'active' | 'archived';

export function buildPermitListOrderBy(
  sort: PermitListSort,
): Prisma.PermitOrderByWithRelationInput[] {
  switch (sort) {
    case 'reference':
      return [{ permitNumber: 'asc' }, { id: 'asc' }];
    case 'address':
      return [{ address: 'asc' }, { id: 'asc' }];
    case 'activity':
      return [{ updatedAt: 'desc' }, { id: 'asc' }];
  }
}

export function buildPermitListWhere(input: {
  teamId: string;
  view: PermitListView;
  assignedToMeUserId: string | null;
  interruptedMonitoring?: boolean;
  status?: PermitStatus | null;
  searchTerm?: string;
}): Prisma.PermitWhereInput {
  const searchTerm = input.searchTerm?.trim();
  return {
    teamId: input.teamId,
    archivedAt: input.view === 'archived' ? { not: null } : null,
    ...(input.assignedToMeUserId ? { assignedProjectManagerUserId: input.assignedToMeUserId } : {}),
    ...(input.interruptedMonitoring ? { portalMonitoringInterruptedAt: { not: null } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(searchTerm
      ? {
          OR: [
            { permitNumber: { contains: searchTerm, mode: 'insensitive' } },
            { address: { contains: searchTerm, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}
