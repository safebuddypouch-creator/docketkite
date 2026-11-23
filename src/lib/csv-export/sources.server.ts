// @polsia:user-owned

import 'server-only';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { buildPermitListOrderBy, buildPermitListWhere } from '@/lib/business/permit-list';
import { PermitExportFilters } from '@/lib/contracts/permit-export';
import { prisma } from '@/lib/db';
import {
  CsvAccessError,
  type CsvServerSource,
  defineCsvSource,
  type ExportContext,
} from '@/modules/csv-export/server';

type PermitExportRow = {
  id: string;
  updatedAt: Date;
  projectName: string;
  address: string;
  permitNumber: string;
  permitType: string;
  status: string;
  portalUrl: string | null;
  assignedProjectManagerName: string | null;
};

const permitCsvSource = defineCsvSource<PermitExportRow, PermitExportFilters>({
  id: 'permits',
  label: 'Team permits',
  schemaVersion: '1',
  columns: [
    {
      key: 'permit_id',
      label: 'Permit ID',
      kind: 'identifier',
      access: 'readonly',
      nullable: false,
      serialize: (row) => row.id,
    },
    {
      key: 'project_name',
      label: 'Project name',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.projectName,
    },
    {
      key: 'address',
      label: 'Job address',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.address,
    },
    {
      key: 'permit_number',
      label: 'Permit number',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.permitNumber,
    },
    {
      key: 'permit_type',
      label: 'Permit type',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.permitType,
    },
    {
      key: 'status',
      label: 'Saved status',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.status,
    },
    {
      key: 'project_manager',
      label: 'Assigned project manager',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.assignedProjectManagerName ?? '',
    },
    {
      key: 'portal_url',
      label: 'Permit portal URL (only City of Tampa Accela links are actively checked)',
      kind: 'text',
      access: 'editable',
      nullable: false,
      serialize: (row) => row.portalUrl ?? '',
    },
  ],
  parseFilters(raw) {
    const parsed = PermitExportFilters.safeParse(raw);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
  },
  async authorizeColumns() {
    return [
      'permit_id',
      'project_name',
      'address',
      'permit_number',
      'permit_type',
      'status',
      'project_manager',
      'portal_url',
    ];
  },
  keyOf: (row) => row.id,
  versionOf: (row) => row.updatedAt.toISOString(),
  async readRows({ context, filters, limit, signal }) {
    if (signal.aborted || filters.teamId !== context.scopeId)
      throw new Error('Invalid export scope');

    return prisma.$transaction(
      async (transaction) => {
        if (signal.aborted) throw new Error('Export cancelled');
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
        await transaction.$executeRaw`SET LOCAL statement_timeout = '25000ms'`;

        const membership = await transaction.teamMembership.findUnique({
          where: { teamId_userId: { teamId: context.scopeId, userId: context.actorId } },
          select: { role: true },
        });
        if (!membership) throw new Error('Team membership is no longer active');

        const where: Prisma.PermitWhereInput = buildPermitListWhere({
          teamId: context.scopeId,
          view: filters.view,
          assignedToMeUserId:
            filters.assignedToMe && membership.role === 'project_manager' ? context.actorId : null,
          interruptedMonitoring: filters.interruptedMonitoring,
          status: filters.status,
          searchTerm: filters.searchTerm,
        });
        const permits = await transaction.permit.findMany({
          where,
          orderBy: buildPermitListOrderBy(filters.sort),
          take: limit,
          select: {
            id: true,
            updatedAt: true,
            projectName: true,
            address: true,
            permitNumber: true,
            permitType: true,
            status: true,
            portalUrl: true,
            assignedProjectManagerUserId: true,
          },
        });
        if (signal.aborted) throw new Error('Export cancelled');

        const assignedUserIds = [
          ...new Set(
            permits.flatMap((permit) =>
              permit.assignedProjectManagerUserId ? [permit.assignedProjectManagerUserId] : [],
            ),
          ),
        ];
        const [projectManagerMemberships, managers] = await Promise.all([
          assignedUserIds.length > 0
            ? transaction.teamMembership.findMany({
                where: {
                  teamId: context.scopeId,
                  role: 'project_manager',
                  userId: { in: assignedUserIds },
                },
                select: { userId: true },
              })
            : Promise.resolve([]),
          assignedUserIds.length > 0
            ? transaction.user.findMany({
                where: { id: { in: assignedUserIds } },
                select: { id: true, name: true },
              })
            : Promise.resolve([]),
        ]);
        if (signal.aborted) throw new Error('Export cancelled');

        const eligibleManagerIds = new Set(
          projectManagerMemberships.map((membershipItem) => membershipItem.userId),
        );
        const namesById = new Map(
          managers.map((manager) => [manager.id, manager.name.trim() || 'Project manager']),
        );

        return permits.map((permit) => {
          const managerId = permit.assignedProjectManagerUserId;
          return {
            id: permit.id,
            updatedAt: permit.updatedAt,
            projectName: permit.projectName,
            address: permit.address,
            permitNumber: permit.permitNumber,
            permitType: permit.permitType,
            status: permit.status,
            portalUrl: permit.portalUrl,
            assignedProjectManagerName:
              managerId && eligibleManagerIds.has(managerId)
                ? (namesById.get(managerId) ?? null)
                : null,
          };
        });
      },
      { isolationLevel: 'RepeatableRead', maxWait: 2_000, timeout: 27_000 },
    );
  },
});

export const csvExportSources: CsvServerSource[] = [permitCsvSource];

export async function authorizeCsvExport(
  request: Request,
  sourceId: string,
): Promise<ExportContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new CsvAccessError(401);
  if (sourceId !== 'permits') throw new CsvAccessError(403);

  if (request.method === 'GET') {
    return { actorId: session.user.id, scopeId: session.user.id };
  }

  const actorId = request.headers.get('x-polsia-csv-actor-id');
  const teamId = request.headers.get('x-polsia-csv-team-id');
  if (!teamId || actorId !== session.user.id) throw new CsvAccessError(403);
  return { actorId: session.user.id, scopeId: teamId };
}
