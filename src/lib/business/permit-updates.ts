// @polsia:user-owned — the shared permit update boundary and status notifications.
import 'server-only';
import { didPermitStatusChange } from '@/lib/business/permit-status';
import type { PermitFields } from '@/lib/contracts/permit';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { permitStatusChangedEmail } from '@/lib/email/templates';
import { siteUrl } from '@/lib/site';

type PermitRecord = NonNullable<Awaited<ReturnType<typeof prisma.permit.findFirst>>>;
type PermitStatusEventRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.permitStatusEvent.findFirst>>
>;
type PermitWithStatusEvents = PermitRecord & { statusEvents: PermitStatusEventRecord[] };

/**
 * Save an active team permit update and notify its project managers after commit
 * only when its persisted status changed. Future permit update routes should use
 * this boundary too, so they retain the same transition behavior.
 */
export async function updatePermitWithStatusNotifications(input: {
  id: string;
  teamId: string;
  data: PermitFields;
  falseAlarmReason?: string;
}): Promise<
  { kind: 'updated'; permit: PermitWithStatusEvents } | { kind: 'not_found' } | { kind: 'conflict' }
> {
  const result = await prisma.$transaction(async (transaction) => {
    const current = await transaction.permit.findFirst({
      where: { id: input.id, teamId: input.teamId, archivedAt: null },
      select: { status: true },
    });
    if (!current) return { kind: 'not_found' as const };

    const statusChanged = didPermitStatusChange(current.status, input.data.status);
    const saved = await transaction.permit.updateMany({
      where: {
        id: input.id,
        teamId: input.teamId,
        archivedAt: null,
        status: current.status,
      },
      data: { ...input.data, portalUrl: input.data.portalUrl || null },
    });
    if (saved.count !== 1) return { kind: 'conflict' as const };

    if (statusChanged) {
      await transaction.permitStatusEvent.create({
        data: {
          permitId: input.id,
          status: input.data.status,
          falseAlarmReason: input.falseAlarmReason?.trim() || null,
        },
      });
    }

    const permit = await transaction.permit.findFirst({
      where: { id: input.id, teamId: input.teamId },
      include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!permit) return { kind: 'not_found' as const };

    return {
      kind: 'updated' as const,
      permit,
      statusChanged,
      previousStatus: current.status,
    };
  });

  if (result.kind !== 'updated') return result;
  if (result.statusChanged && result.permit.teamId) {
    try {
      await notifyProjectManagers({
        teamId: result.permit.teamId,
        teamName: await getTeamName(result.permit.teamId),
        permit: result.permit,
        previousStatus: result.previousStatus,
      });
    } catch {
      // The permit is already saved; a notification failure must not report the update as failed.
    }
  }

  return { kind: 'updated', permit: result.permit };
}

async function getTeamName(teamId: string): Promise<string | null> {
  const team = await prisma.teamSpace.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  return team?.name ?? null;
}

async function notifyProjectManagers(input: {
  teamId: string;
  teamName: string | null;
  permit: PermitRecord;
  previousStatus: string;
}): Promise<void> {
  if (!input.teamName) return;

  const memberships = await prisma.teamMembership.findMany({
    where: { teamId: input.teamId, role: 'project_manager' },
    select: { userId: true },
  });
  if (memberships.length === 0) return;

  const managers = await prisma.user.findMany({
    where: { id: { in: memberships.map((membership) => membership.userId) } },
    select: { email: true },
  });
  const message = permitStatusChangedEmail({
    teamName: input.teamName,
    projectName: input.permit.projectName,
    address: input.permit.address,
    previousStatus: input.previousStatus,
    status: input.permit.status,
    permitUrl: new URL(
      `/dashboard/permits/${encodeURIComponent(input.permit.id)}`,
      siteUrl,
    ).toString(),
  });

  await Promise.allSettled(managers.map((manager) => sendEmail({ to: manager.email, ...message })));
}
