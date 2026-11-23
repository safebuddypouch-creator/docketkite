// @polsia:user-owned — save one auditable outcome for each fresh public status transition.
import 'server-only';
import type { Prisma } from '@prisma/client';

export async function recordPermitPortalStatusTransition(
  transaction: Prisma.TransactionClient,
  input: {
    permit: {
      id: string;
      teamId: string;
      permitNumber: string;
      assignedProjectManagerUserId: string | null;
    };
    check: {
      id: string;
      checkedAt: Date;
      sourceFetchedAt: Date;
      sourceUrl: string;
    };
    previousStatus: string;
    newStatus: string;
  },
) {
  const existing = await transaction.permitPortalStatusTransition.findUnique({
    where: { sourceCheckId: input.check.id },
  });
  if (existing) return existing;

  const assignedUserId = input.permit.assignedProjectManagerUserId;
  const membership = assignedUserId
    ? await transaction.teamMembership.findUnique({
        where: {
          teamId_userId: { teamId: input.permit.teamId, userId: assignedUserId },
        },
        select: { role: true },
      })
    : null;
  const isAcceptedProjectManager = membership?.role === 'project_manager';

  return transaction.permitPortalStatusTransition.create({
    data: {
      permitId: input.permit.id,
      teamId: input.permit.teamId,
      sourceCheckId: input.check.id,
      permitNumber: input.permit.permitNumber,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      sourceUrl: input.check.sourceUrl,
      checkedAt: input.check.checkedAt,
      sourceFetchedAt: input.check.sourceFetchedAt,
      targetedProjectManagerId: isAcceptedProjectManager ? assignedUserId : null,
      targetedRole: isAcceptedProjectManager ? 'project_manager' : 'unassigned',
      textDeliveryStatus: 'unverified',
      textDeliveryMessage:
        'No SMS provider is installed or configured, so delivery to the project manager is unverified.',
      checklistMatchStatus: 'unverified',
      checklistMatchMessage:
        'This status observation did not include a City notice; a notice-based checklist match is unverified.',
    },
  });
}
