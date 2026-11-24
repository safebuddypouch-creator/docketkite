// @polsia:user-owned — scheduled hourly checks of saved City of Tampa Building records.
import 'server-only';
import { readPermitPortalPage } from '@/lib/business/permit-portal-retrieval';
import {
  applyPortalMonitoringOutcome,
  extractPermitPortalStatus,
  isNewerPortalPageRead,
  isPortalObservationLater,
  portalMonitoringFromHistory,
  shouldRecordPortalStatusTransition,
} from '@/lib/business/permit-portal-status';
import { recordPermitPortalStatusTransition } from '@/lib/business/permit-status-transition.server';
import { resolveTeamStatusAlertRecipients } from '@/lib/business/team-status-alert-recipients';
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';
import { prisma } from '@/lib/db';
import { deliverEmail } from '@/lib/email/deliver';
import { permitPortalStatusDetectedEmail } from '@/lib/email/templates';
import { getTeamAccessState } from '@/lib/team-access';
import { fetchPermitPortalPage } from '@/lib/business/permit-portal-page-fetch';

const MAX_CHECKS_PER_RUN = 20;

async function main(): Promise<void> {
  const permits = await prisma.permit.findMany({
    where: {
      teamId: { not: null },
      archivedAt: null,
      permitNumber: { not: '' },
      portalUrl: { not: null },
    },
    include: {
      portalCheckCounter: { select: { attemptedAt: true } },
    },
  });

  const candidates = permits
    .flatMap((permit) => {
      const sourceUrl = getOfficialPermitPortalUrl(permit.portalUrl ?? '');
      if (!permit.teamId || !sourceUrl || !permit.permitNumber.trim()) return [];
      return [{ ...permit, teamId: permit.teamId, sourceUrl }];
    })
    .sort((left, right) => {
      const leftAttempt = left.portalCheckCounter?.attemptedAt?.getTime() ?? 0;
      const rightAttempt = right.portalCheckCounter?.attemptedAt?.getTime() ?? 0;
      return leftAttempt - rightAttempt || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_CHECKS_PER_RUN);

  const accessByTeam = new Map<string, Promise<boolean>>();
  for (const permit of candidates) {
    const attemptTime = new Date();
    await prisma.permitPortalCheckCounter.upsert({
      where: { permitId: permit.id },
      create: {
        permitId: permit.id,
        sequence: 0,
        checkedAt: attemptTime,
        attemptedAt: attemptTime,
      },
      update: { attemptedAt: attemptTime },
    });
    let teamAccess = accessByTeam.get(permit.teamId);
    if (!teamAccess) {
      teamAccess = (async () => {
        const team = await prisma.teamSpace.findUnique({
          where: { id: permit.teamId },
          select: { createdByUserId: true },
        });
        if (!team) return false;
        const state = await getTeamAccessState(permit.teamId, team.createdByUserId);
        return state.accessActive;
      })();
      accessByTeam.set(permit.teamId, teamAccess);
    }
    if (!(await teamAccess)) continue;

      const now = new Date();
      const reservation = await prisma.permitPortalCheckCounter.upsert({
        where: { permitId: permit.id },
        create: { permitId: permit.id, sequence: 1, checkedAt: now, attemptedAt: now },
        update: { sequence: { increment: 1 }, checkedAt: now, attemptedAt: now },
        select: { sequence: true, checkedAt: true },
      });
      const read = await readPermitPortalPage(
        permit.sourceUrl,
        permit.permitNumber,
        fetchPermitPortalPage,
      );
      let result: 'checked' | 'unverified' | 'unavailable' = 'unavailable';
      let status: string | null = null;
      let message: string | null = 'The public City record could not be checked.';
      let sourceFetchedAt: Date | null = null;

      if (read.kind === 'fetched') {
        sourceFetchedAt = new Date(read.page.fetchedAt);
        const extraction = extractPermitPortalStatus(read.page.markdown, permit.permitNumber);
        result = extraction.result;
        status = extraction.status;
        message = extraction.message;
      } else if (read.kind === 'missing_permit_number') {
        message = 'A permit number is required before the public City record can be checked.';
      } else if (read.kind === 'invalid_url') {
        message = 'The saved link is outside active City of Tampa coverage.';
      } else if (read.kind === 'failed') {
        message = 'The public City record could not be retrieved during the scheduled check.';
      }

      const saved = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${permit.id}, 0))::text AS locked
        `;
        const [latestSuccessfulCheck, latestPageRead, latestCheck] = await Promise.all([
          transaction.permitPortalStatusCheck.findFirst({
            where: {
              permitId: permit.id,
              teamId: permit.teamId,
              result: 'checked',
              status: { not: null },
            },
            orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
            select: { checkedAt: true, requestSequence: true, status: true },
          }),
          transaction.permitPortalStatusCheck.findFirst({
            where: {
              permitId: permit.id,
              teamId: permit.teamId,
              result: 'checked',
              status: { not: null },
              sourceFetchedAt: { not: null },
            },
            orderBy: [
              { sourceFetchedAt: 'desc' },
              { checkedAt: 'desc' },
              { requestSequence: 'desc' },
            ],
            select: { status: true, sourceFetchedAt: true },
          }),
          transaction.permitPortalStatusCheck.findFirst({
            where: { permitId: permit.id, teamId: permit.teamId },
            orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
            select: { checkedAt: true, requestSequence: true, result: true, message: true },
          }),
        ]);
        const previousStatus = latestPageRead?.status ?? latestSuccessfulCheck?.status ?? null;
        const isCurrentSourceObservation =
          result === 'checked' &&
          sourceFetchedAt !== null &&
          status !== null &&
          status.trim().length > 0 &&
          isPortalObservationLater(
            { checkedAt: reservation.checkedAt, requestSequence: reservation.sequence },
            latestSuccessfulCheck
              ? {
                  checkedAt: latestSuccessfulCheck.checkedAt,
                  requestSequence: latestSuccessfulCheck.requestSequence,
                }
              : null,
          ) &&
          isNewerPortalPageRead(sourceFetchedAt, latestPageRead?.sourceFetchedAt ?? null);
        const statusChanged = shouldRecordPortalStatusTransition({
          result,
          isCurrentSourceObservation,
          previousStatus,
          status,
        });
        const check = await transaction.permitPortalStatusCheck.create({
          data: {
            permitId: permit.id,
            teamId: permit.teamId,
            permitNumber: permit.permitNumber,
            sourceUrl: read.kind === 'invalid_url' ? null : permit.sourceUrl,
            status,
            result,
            message,
            checkedAt: reservation.checkedAt,
            requestSequence: reservation.sequence,
            sourceFetchedAt,
            redlineResult: 'not_connected',
            redlineMessage: 'No Redline source is connected to this workspace for comparison.',
          },
        });
        await transaction.permit.update({
          where: { id: permit.id },
          data: {
            ...applyPortalMonitoringOutcome(
              portalMonitoringFromHistory(latestSuccessfulCheck, latestCheck),
              {
                result,
                checkedAt: reservation.checkedAt,
                requestSequence: reservation.sequence,
                message,
              },
              latestCheck
                ? { checkedAt: latestCheck.checkedAt, requestSequence: latestCheck.requestSequence }
                : null,
            ),
            ...(isCurrentSourceObservation
              ? { portalCurrentStatus: status, portalStatusObservedAt: sourceFetchedAt }
              : {}),
          },
        });
        let notification: {
          recipients: string[];
          projectName: string;
          permitNumber: string;
          previousStatus: string;
          status: string;
          checkedAt: Date;
          sourceUrl: string;
          correctionChecklist: string[];
        } | null = null;

        if (statusChanged && previousStatus && status && sourceFetchedAt) {
          const currentPermit = await transaction.permit.findUniqueOrThrow({
            where: { id: permit.id },
            select: {
              id: true,
              teamId: true,
              permitNumber: true,
              assignedProjectManagerUserId: true,
            },
          });
          const preference = await transaction.teamStatusAlertPreference.findUnique({
            where: { teamId: permit.teamId },
            select: { id: true },
          });
          let currentTeamMembers: { userId: string; role: string; email: string | null }[] = [];
          let selectedUserIds: string[] = [];

          if (preference) {
            const memberships = await transaction.teamMembership.findMany({
              where: { teamId: permit.teamId },
              select: { userId: true, role: true },
            });
            const users = await transaction.user.findMany({
              where: { id: { in: memberships.map((membership) => membership.userId) } },
              select: { id: true, email: true },
            });
            const emailsByUserId = new Map(users.map((member) => [member.id, member.email]));
            currentTeamMembers = memberships.map((membership) => ({
              ...membership,
              email: emailsByUserId.get(membership.userId) ?? null,
            }));
            const selectedRecipients = await transaction.teamStatusAlertRecipient.findMany({
              where: { teamId: permit.teamId },
              select: { userId: true },
            });
            selectedUserIds = selectedRecipients.map((recipient) => recipient.userId);
          } else if (currentPermit.assignedProjectManagerUserId) {
            const assignedUserId = currentPermit.assignedProjectManagerUserId;
            const membership = await transaction.teamMembership.findUnique({
              where: {
                teamId_userId: { teamId: permit.teamId, userId: assignedUserId },
              },
              select: { role: true },
            });
            if (membership) {
              const assignedUser = await transaction.user.findUnique({
                where: { id: assignedUserId },
                select: { email: true },
              });
              currentTeamMembers = [
                {
                  userId: assignedUserId,
                  role: membership.role,
                  email: assignedUser?.email ?? null,
                },
              ];
            }
          }

          const recipients = resolveTeamStatusAlertRecipients({
            hasCustomSelection: Boolean(preference),
            selectedUserIds,
            currentTeamMembers,
            assignedProjectManagerUserId: currentPermit.assignedProjectManagerUserId,
          });

          if (recipients.length > 0) {
            const confirmedChecklist = await transaction.permitCorrectionChecklist.findFirst({
              where: {
                permitId: permit.id,
                teamId: permit.teamId,
                permitLetter: {
                  is: {
                    correctionDraft: {
                      is: { status: 'confirmed', confirmedAt: { not: null } },
                    },
                  },
                },
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: {
                items: {
                  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                  take: 5,
                  select: { action: true, location: true, planReference: true },
                },
              },
            });
            const correctionChecklist = (confirmedChecklist?.items ?? []).map((item) => {
              const context = [
                item.location,
                item.planReference ? `Plan ${item.planReference}` : null,
              ].filter((value): value is string => Boolean(value?.trim()));
              return context.length > 0 ? `${item.action} (${context.join('; ')})` : item.action;
            });
            notification = {
              recipients,
              projectName: permit.projectName,
              permitNumber: permit.permitNumber,
              previousStatus,
              status,
              checkedAt: reservation.checkedAt,
              sourceUrl: permit.sourceUrl,
              correctionChecklist,
            };
          }

          await recordPermitPortalStatusTransition(transaction, {
            permit: { ...currentPermit, teamId: permit.teamId },
            check: {
              id: check.id,
              checkedAt: check.checkedAt,
              sourceFetchedAt,
              sourceUrl: permit.sourceUrl,
            },
            previousStatus,
            newStatus: status,
          });
        }

        return notification;
      });

      if (saved) {
        await Promise.allSettled(
          saved.recipients.map((to) =>
            deliverEmail({ to, ...permitPortalStatusDetectedEmail(saved) }),
          ),
        );
      }

    if (read.kind === 'failed') throw read.error;
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`Tampa permit monitor job failed: ${reason.slice(0, 400)}\n`);
  process.exitCode = 1;
});
