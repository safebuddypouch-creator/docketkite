// @polsia:user-owned — owner-scoped permit list and mutations.
import 'server-only';
import { NextResponse } from 'next/server';
import { getPermitAssignmentDenial } from '@/lib/business/permit-assignment';
import { buildPermitListOrderBy, buildPermitListWhere } from '@/lib/business/permit-list';
import { getLatestPermitMonitoringOutcomes } from '@/lib/business/permit-monitoring-outcome';
import { updatePermitWithStatusNotifications } from '@/lib/business/permit-updates';
import {
  PermitBulkArchiveResponse,
  PermitCreate,
  PermitItem,
  PermitList,
  PermitListSort,
  PermitMonitoringOutcome,
  PermitMutation,
  PermitStatus,
} from '@/lib/contracts/permit';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

type PermitRecord = NonNullable<Awaited<ReturnType<typeof prisma.permit.findFirst>>>;
type PermitStatusEventRecord = {
  id: string;
  status: string;
  falseAlarmReason: string | null;
  createdAt: Date;
};
type PermitWithStatusEvents = PermitRecord & { statusEvents?: PermitStatusEventRecord[] };

class BulkArchiveConflictError extends Error {}

function serializePermit(
  permit: PermitWithStatusEvents,
  assignedProjectManager: { id: string; name: string } | null,
) {
  return PermitItem.parse({
    ...permit,
    portalUrl: permit.portalUrl ?? '',
    portalStatusObservedAt: permit.portalStatusObservedAt?.toISOString() ?? null,
    archivedAt: permit.archivedAt?.toISOString() ?? null,
    createdAt: permit.createdAt.toISOString(),
    updatedAt: permit.updatedAt.toISOString(),
    assignedProjectManager,
    statusEvents: (permit.statusEvents ?? []).map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}

async function serializePermitForResponse(permit: PermitWithStatusEvents) {
  const userId = permit.assignedProjectManagerUserId;
  if (!userId || !permit.teamId) return serializePermit(permit, null);

  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: permit.teamId, userId } },
    select: { role: true },
  });
  if (membership?.role !== 'project_manager') return serializePermit(permit, null);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  return serializePermit(
    permit,
    user ? { id: user.id, name: user.name.trim() || 'Project manager' } : null,
  );
}

async function getUser(request: Request): Promise<SessionUser | Response> {
  try {
    return await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
}

export async function GET(request: Request) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const view = new URL(request.url).searchParams.get('view') ?? 'active';
  const searchParams = new URL(request.url).searchParams;
  const teamId = searchParams.get('teamId') ?? '';
  const sort = PermitListSort.safeParse(searchParams.get('sort') ?? 'activity');
  const statusParam = searchParams.get('status');
  const status = statusParam === null ? null : PermitStatus.safeParse(statusParam);
  const monitoringOutcomeParam = searchParams.get('monitoringOutcome');
  const monitoringOutcome =
    monitoringOutcomeParam === null
      ? null
      : PermitMonitoringOutcome.safeParse(monitoringOutcomeParam);
  const assignedToMe = searchParams.get('assignedToMe') === 'true';
  const interruptedMonitoring = searchParams.get('interruptedMonitoring') === 'true';
  if (view !== 'active' && view !== 'archived') {
    return NextResponse.json({ error: 'Invalid list view' }, { status: 400 });
  }
  if (!sort.success) {
    return NextResponse.json({ error: 'Invalid permit sort' }, { status: 400 });
  }
  if (status !== null && !status.success) {
    return NextResponse.json({ error: 'Invalid permit status' }, { status: 400 });
  }
  if (monitoringOutcome !== null && !monitoringOutcome.success) {
    return NextResponse.json({ error: 'Invalid monitoring outcome' }, { status: 400 });
  }
  if (!teamId) return NextResponse.json({ error: 'team_id_required' }, { status: 400 });

  const access = await requireTeamAccess(teamId, user.id);
  if (access.response) return access.response;

  const searchTerm = searchParams.get('search')?.trim() ?? '';
  if (searchTerm.length > 200) {
    return NextResponse.json({ error: 'Search must be 200 characters or fewer.' }, { status: 400 });
  }

  const assignedToMeUserId =
    assignedToMe && access.membership.role === 'project_manager' ? user.id : null;

  try {
    const candidates = await prisma.permit.findMany({
      where: buildPermitListWhere({
        teamId,
        view,
        assignedToMeUserId,
        interruptedMonitoring,
        status: status?.data ?? null,
        searchTerm,
      }),
      orderBy: buildPermitListOrderBy(sort.data),
      include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    let permits = candidates;
    if (monitoringOutcome?.success && candidates.length > 0) {
      const latestChecks = await prisma.permitPortalStatusCheck.findMany({
        where: {
          teamId,
          permitId: { in: candidates.map((permit) => permit.id) },
        },
        orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
        select: { id: true, permitId: true, result: true, checkedAt: true, requestSequence: true },
      });
      const outcomes = getLatestPermitMonitoringOutcomes(latestChecks);
      permits = candidates.filter(
        (permit) => (outcomes.get(permit.id) ?? 'not_checked') === monitoringOutcome.data,
      );
    }
    const projectManagerMemberships = await prisma.teamMembership.findMany({
      where: { teamId, role: 'project_manager' },
      select: { userId: true },
    });
    const managerIds = [
      ...new Set([
        ...projectManagerMemberships.map((membership) => membership.userId),
        ...permits.flatMap((permit) =>
          permit.assignedProjectManagerUserId ? [permit.assignedProjectManagerUserId] : [],
        ),
      ]),
    ];
    const managers = await prisma.user.findMany({
      where: { id: { in: managerIds } },
      select: { id: true, name: true },
    });
    const managersById = new Map(
      managers.map((manager) => [
        manager.id,
        { id: manager.id, name: manager.name.trim() || 'Project manager' },
      ]),
    );
    const eligibleIds = new Set(projectManagerMemberships.map((membership) => membership.userId));
    const items = permits.map((permit) =>
      serializePermit(
        permit,
        permit.assignedProjectManagerUserId && eligibleIds.has(permit.assignedProjectManagerUserId)
          ? (managersById.get(permit.assignedProjectManagerUserId) ?? null)
          : null,
      ),
    );
    const projectManagers =
      access.membership.role === 'owner'
        ? projectManagerMemberships
            .flatMap((membership) => {
              const manager = managersById.get(membership.userId);
              return manager ? [manager] : [];
            })
            .sort((first, second) => first.name.localeCompare(second.name))
        : [];
    return NextResponse.json(PermitList.parse({ items, projectManagers }));
  } catch {
    return NextResponse.json({ error: 'Could not load permits' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  const user = await getUser(request);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: { form: 'Enter valid permit details.' } }, { status: 400 });
  }
  const parsed = PermitCreate.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
      const message = messages?.[0];
      if (message) errors[field] = message;
    }
    return NextResponse.json({ errors }, { status: 400 });
  }

  const access = await requireTeamAccess(parsed.data.teamId, user.id);
  if (access.response) return access.response;

  try {
    const { teamId, portalUrl, ...fields } = parsed.data;
    const permit = await prisma.permit.create({
      data: { ...fields, portalUrl: portalUrl || null, teamId, userId: user.id },
      include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    return NextResponse.json(serializePermit(permit, null), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Could not create this permit' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  const user = await getUser(request);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: { form: 'Enter valid permit details.' } }, { status: 400 });
  }
  const parsed = PermitMutation.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
      const message = messages?.[0];
      if (message) errors[field] = message;
    }
    return NextResponse.json({ errors }, { status: 400 });
  }

  const access = await requireTeamAccess(parsed.data.teamId, user.id);
  if (access.response) return access.response;

  if (parsed.data.action === 'archiveBulk') {
    if (access.membership.role !== 'owner') {
      return NextResponse.json({ error: 'team_owner_required' }, { status: 403 });
    }

    const { permitIds, teamId } = parsed.data;
    try {
      const archivedCount = permitIds.length;
      const archivedAt = new Date();
      await prisma.$transaction(async (transaction) => {
        const activePermits = await transaction.permit.findMany({
          where: {
            id: { in: permitIds },
            teamId,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (activePermits.length !== archivedCount) throw new BulkArchiveConflictError();

        const updated = await transaction.permit.updateMany({
          where: {
            id: { in: permitIds },
            teamId,
            archivedAt: null,
          },
          data: { archivedAt },
        });
        if (updated.count !== archivedCount) throw new BulkArchiveConflictError();
      });

      return NextResponse.json(PermitBulkArchiveResponse.parse({ archivedCount }));
    } catch (error) {
      if (error instanceof BulkArchiveConflictError) {
        return NextResponse.json({ error: 'selected_permits_changed' }, { status: 409 });
      }
      return NextResponse.json(
        { error: 'Could not archive the selected permits' },
        { status: 500 },
      );
    }
  }

  if (parsed.data.action === 'assign') {
    const assignment = parsed.data;
    const ownerPermission = getPermitAssignmentDenial({
      teamId: assignment.teamId,
      requesterRole: access.membership.role,
      projectManagerUserId: null,
      projectManagerMembership: null,
    });
    if (ownerPermission) {
      return NextResponse.json({ error: ownerPermission }, { status: 403 });
    }

    try {
      const result = await prisma.$transaction(async (transaction) => {
        const ownerMembership = await transaction.teamMembership.findUnique({
          where: { teamId_userId: { teamId: assignment.teamId, userId: user.id } },
          select: { teamId: true, userId: true, role: true },
        });
        const transactionOwnerPermission = getPermitAssignmentDenial({
          teamId: assignment.teamId,
          requesterRole: ownerMembership?.role ?? '',
          projectManagerUserId: null,
          projectManagerMembership: null,
        });
        if (transactionOwnerPermission) return { kind: 'forbidden' as const };

        const permit = await transaction.permit.findFirst({
          where: { id: assignment.id, teamId: assignment.teamId, archivedAt: null },
          select: { id: true },
        });
        if (!permit) return { kind: 'not_found' as const };

        let projectManagerMembership: {
          teamId: string;
          userId: string;
          role: string;
        } | null = null;
        if (assignment.projectManagerUserId) {
          projectManagerMembership = await transaction.teamMembership.findUnique({
            where: {
              teamId_userId: {
                teamId: assignment.teamId,
                userId: assignment.projectManagerUserId,
              },
            },
            select: { teamId: true, userId: true, role: true },
          });
        }

        const assignmentPermission = getPermitAssignmentDenial({
          teamId: assignment.teamId,
          requesterRole: ownerMembership?.role ?? '',
          projectManagerUserId: assignment.projectManagerUserId,
          projectManagerMembership,
        });
        if (assignmentPermission) {
          return assignmentPermission === 'team_owner_required'
            ? { kind: 'forbidden' as const }
            : { kind: 'ineligible' as const };
        }

        const updated = await transaction.permit.updateMany({
          where: { id: permit.id, teamId: assignment.teamId, archivedAt: null },
          data: { assignedProjectManagerUserId: assignment.projectManagerUserId },
        });
        if (updated.count !== 1) return { kind: 'not_found' as const };

        const saved = await transaction.permit.findFirst({
          where: { id: permit.id, teamId: assignment.teamId },
          include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
        });
        return saved ? { kind: 'saved' as const, permit: saved } : { kind: 'not_found' as const };
      });

      if (result.kind === 'not_found') {
        return NextResponse.json({ error: 'Permit not found' }, { status: 404 });
      }
      if (result.kind === 'forbidden') {
        return NextResponse.json({ error: 'team_owner_required' }, { status: 403 });
      }
      if (result.kind === 'ineligible') {
        return NextResponse.json(
          { error: 'project_manager_not_accepted_team_member' },
          { status: 422 },
        );
      }
      return NextResponse.json(await serializePermitForResponse(result.permit));
    } catch {
      return NextResponse.json({ error: 'Could not save this permit assignment' }, { status: 500 });
    }
  }

  try {
    const where = { id: parsed.data.id, teamId: parsed.data.teamId, archivedAt: null };
    let permit: PermitRecord | null;
    if (parsed.data.action === 'archive') {
      const archived = await prisma.permit.updateMany({
        where,
        data: { archivedAt: new Date() },
      });
      if (archived.count !== 1) {
        return NextResponse.json({ error: 'Permit not found' }, { status: 404 });
      }
      permit = await prisma.permit.findFirst({
        where: { id: parsed.data.id, teamId: parsed.data.teamId },
        include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
    } else {
      const updated = await updatePermitWithStatusNotifications({
        id: parsed.data.id,
        teamId: parsed.data.teamId,
        data: parsed.data.data,
        falseAlarmReason: parsed.data.falseAlarmReason,
      });
      if (updated.kind === 'not_found') {
        return NextResponse.json({ error: 'Permit not found' }, { status: 404 });
      }
      if (updated.kind === 'conflict') {
        return NextResponse.json(
          { error: 'Permit changed while saving. Please try again.' },
          { status: 409 },
        );
      }
      permit = updated.permit;
    }
    if (!permit) return NextResponse.json({ error: 'Permit not found' }, { status: 404 });
    return NextResponse.json(await serializePermitForResponse(permit));
  } catch {
    return NextResponse.json({ error: 'Could not save this permit' }, { status: 500 });
  }
}
