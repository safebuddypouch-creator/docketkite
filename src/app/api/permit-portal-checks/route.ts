// @polsia:user-owned — authenticated team checks and history for public City permit status.
import 'server-only';
import { NextResponse } from 'next/server';
import { readPermitPortalPage } from '@/lib/business/permit-portal-retrieval';
import {
  applyPortalMonitoringOutcome,
  extractPermitPortalStatus,
  isNewerPortalPageRead,
  isNewPortalMonitoringInterruption,
  isPortalObservationLater,
  portalMonitoringFromHistory,
  shouldRecordPortalStatusTransition,
} from '@/lib/business/permit-portal-status';
import { recordPermitPortalStatusTransition } from '@/lib/business/permit-status-transition.server';
import { resolveTeamStatusAlertRecipients } from '@/lib/business/team-status-alert-recipients';
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';
import {
  INVALID_PERMIT_PORTAL_URL_MESSAGE,
  PermitPortalCheckItem,
  PermitPortalCheckList,
  PermitPortalCheckMutation,
  PermitPortalCheckRequest,
  PermitPortalMonitoringState,
} from '@/lib/contracts/permit-portal-check';
import { prisma } from '@/lib/db';
import { deliverEmail } from '@/lib/email/deliver';
import {
  permitMonitoringInterruptedEmail,
  permitPortalStatusDetectedEmail,
} from '@/lib/email/templates';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { siteUrl } from '@/lib/site';
import { requireTeamAccess } from '@/lib/team-access';
import {
  fetchPermitPortalPage,
  PermitPortalInvalidUrlError,
  PermitPortalPageUnavailableError,
} from '@/lib/business/permit-portal-page-fetch';

export const dynamic = 'force-dynamic';

async function getUser(request: Request): Promise<SessionUser | Response> {
  try {
    return await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
}

function serializeCheck(check: {
  id: string;
  permitId: string;
  permitNumber: string;
  sourceUrl: string | null;
  status: string | null;
  result: string;
  message: string | null;
  checkedAt: Date;
  sourceFetchedAt: Date | null;
  redlineStatus: string | null;
  redlineResult: string;
  redlineMessage: string | null;
}) {
  return PermitPortalCheckItem.parse({
    ...check,
    checkedAt: check.checkedAt.toISOString(),
    sourceFetchedAt: check.sourceFetchedAt?.toISOString() ?? null,
    monitoringStatus: check.result === 'checked' ? check.status : null,
    monitoringAgreement: check.result === 'checked' ? 'matches_portal' : 'not_verified',
  });
}

function serializeMonitoring(state: ReturnType<typeof portalMonitoringFromHistory>) {
  return PermitPortalMonitoringState.parse({
    lastSuccessfulPortalCheckAt: state.lastSuccessfulPortalCheckAt?.toISOString() ?? null,
    interruptedAt: state.portalMonitoringInterruptedAt?.toISOString() ?? null,
    reason: state.portalMonitoringReason,
  });
}

function retrievalFailure(error: unknown): { result: 'unavailable'; message: string } {
  if (error instanceof PermitPortalInvalidUrlError) {
    return {
      result: 'unavailable',
      message: 'Enter a direct City of Tampa Building record URL from the official Accela portal.',
    };
  }
  if (error instanceof PermitPortalPageUnavailableError) {
    return {
      result: 'unavailable',
      message: 'The public City record page could not be read.',
    };
  }
  return { result: 'unavailable', message: 'The public City record could not be checked.' };
}

export async function GET(request: Request) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  const permitId = url.searchParams.get('permitId') ?? '';
  const teamId = url.searchParams.get('teamId') ?? '';
  if (!permitId || !teamId) {
    return NextResponse.json({ error: 'permit_id_and_team_id_required' }, { status: 400 });
  }

  const access = await requireTeamAccess(teamId, user.id);
  if (access.response) return access.response;

  try {
    const permit = await prisma.permit.findFirst({
      where: { id: permitId, teamId },
      select: {
        id: true,
        teamId: true,
        permitNumber: true,
        assignedProjectManagerUserId: true,
      },
    });
    if (!permit) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    const [checks, successfulChecks, latestCheck] = await Promise.all([
      prisma.permitPortalStatusCheck.findMany({
        where: { permitId, teamId },
        orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      prisma.permitPortalStatusCheck.findMany({
        where: {
          permitId,
          teamId,
          permitNumber: permit.permitNumber,
          result: 'checked',
          status: { not: null },
          sourceUrl: { not: null },
          sourceFetchedAt: { not: null },
        },
        orderBy: [
          { sourceFetchedAt: 'desc' },
          { checkedAt: 'desc' },
          { requestSequence: 'desc' },
          { id: 'desc' },
        ],
        select: {
          permitNumber: true,
          status: true,
          sourceUrl: true,
          checkedAt: true,
          sourceFetchedAt: true,
        },
      }),
      prisma.permitPortalStatusCheck.findFirst({
        where: { permitId, teamId },
        orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
        select: { checkedAt: true, result: true, message: true },
      }),
    ]);
    const latestVerifiedCheck = successfulChecks.find(
      (check) =>
        Boolean(check.status?.trim()) &&
        check.sourceUrl !== null &&
        check.sourceFetchedAt !== null &&
        getOfficialPermitPortalUrl(check.sourceUrl) === check.sourceUrl,
    );
    const latestVerified =
      latestVerifiedCheck?.status &&
      latestVerifiedCheck.sourceUrl &&
      latestVerifiedCheck.sourceFetchedAt
        ? {
            permitNumber: latestVerifiedCheck.permitNumber,
            status: latestVerifiedCheck.status,
            sourceUrl: latestVerifiedCheck.sourceUrl,
            checkedAt: latestVerifiedCheck.checkedAt.toISOString(),
            sourceFetchedAt: latestVerifiedCheck.sourceFetchedAt.toISOString(),
          }
        : null;
    const monitoring = serializeMonitoring(
      portalMonitoringFromHistory(
        latestVerifiedCheck ? { checkedAt: latestVerifiedCheck.checkedAt } : null,
        latestCheck,
      ),
    );
    return NextResponse.json(
      PermitPortalCheckList.parse({
        items: checks.map(serializeCheck),
        monitoring,
        latestVerified,
        canRetry: access.membership.role === 'owner',
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not load portal check history' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const body = await request.json().catch(() => null);
  const parsed = PermitPortalCheckRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_portal_check_request' }, { status: 400 });
  }

  const access = await requireTeamAccess(parsed.data.teamId, user.id);
  if (access.response) return access.response;

  const permit = await prisma.permit.findFirst({
    where: {
      id: new URL(request.url).searchParams.get('permitId') ?? '',
      teamId: parsed.data.teamId,
      archivedAt: null,
    },
  });
  if (!permit) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

  if (access.membership.role !== 'owner') {
    const latestCheck = await prisma.permitPortalStatusCheck.findFirst({
      where: { permitId: permit.id, teamId: parsed.data.teamId },
      orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
      select: { result: true },
    });
    if (latestCheck && latestCheck.result !== 'checked') {
      return NextResponse.json(
        {
          error: 'team_owner_required',
          message: 'Only this team’s owner can retry a failed City record check.',
        },
        { status: 403 },
      );
    }
  }

  const [reservation] = await prisma.$queryRaw<Array<{ requestSequence: number; checkedAt: Date }>>`
    INSERT INTO public."PermitPortalCheckCounter" ("permitId", "sequence", "checkedAt", "attemptedAt")
    VALUES (${permit.id}, 1, clock_timestamp(), clock_timestamp())
    ON CONFLICT ("permitId")
    DO UPDATE SET
      "sequence" = "PermitPortalCheckCounter"."sequence" + 1,
      "checkedAt" = clock_timestamp(),
      "attemptedAt" = clock_timestamp()
    RETURNING "sequence" AS "requestSequence", "checkedAt"
  `;
  if (!reservation) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
  const { checkedAt, requestSequence } = reservation;
  const portalPageRead = await readPermitPortalPage(
    permit.portalUrl,
    permit.permitNumber,
    fetchPermitPortalPage,
  );
  if (portalPageRead.kind === 'invalid_url') {
    return NextResponse.json(
      { error: 'invalid_portal_url', message: INVALID_PERMIT_PORTAL_URL_MESSAGE },
      { status: 422 },
    );
  }

  const sourceUrl = portalPageRead.sourceUrl;
  let result: 'checked' | 'unverified' | 'unavailable';
  let status: string | null = null;
  let message: string | null = null;
  let sourceFetchedAt: Date | null = null;

  if (portalPageRead.kind === 'missing_permit_number') {
    result = 'unavailable';
    message = 'A permit number is required before the public City record can be checked.';
  } else if (portalPageRead.kind === 'failed') {
    const failure = retrievalFailure(portalPageRead.error);
    result = failure.result;
    message = failure.message;
  } else {
    try {
      const page = portalPageRead.page;
      sourceFetchedAt = new Date(page.fetchedAt);
      const extracted = extractPermitPortalStatus(page.markdown, permit.permitNumber);
      result = extracted.result;
      status = extracted.status;
      message = extracted.message;
    } catch (error) {
      const failure = retrievalFailure(error);
      result = failure.result;
      message = failure.message;
    }
  }

  try {
    const saved = await prisma.$transaction(async (transaction) => {
      // Advisory transaction locks are reliable with the pooled PostgreSQL
      // connections used by the app. Acquire before reading the summary so a
      // concurrent check always applies its result to the latest saved state.
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${permit.id}, 0))::text AS locked
      `;
      const [latestSuccessfulCheck, latestPortalPageRead, latestCheck] = await Promise.all([
        transaction.permitPortalStatusCheck.findFirst({
          where: {
            permitId: permit.id,
            teamId: parsed.data.teamId,
            result: 'checked',
            status: { not: null },
          },
          orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
          select: { checkedAt: true, requestSequence: true, status: true },
        }),
        transaction.permitPortalStatusCheck.findFirst({
          where: {
            permitId: permit.id,
            teamId: parsed.data.teamId,
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
          where: { permitId: permit.id, teamId: parsed.data.teamId },
          orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
          select: { checkedAt: true, requestSequence: true, result: true, message: true },
        }),
      ]);
      const currentMonitoring = portalMonitoringFromHistory(latestSuccessfulCheck, latestCheck);
      const previousPublicStatus =
        latestPortalPageRead?.status ?? latestSuccessfulCheck?.status ?? null;
      // A slow retrieval from an earlier request is historical once a newer
      // successful observation has been saved, even though it commits later.
      const isCurrentSourceObservation =
        isPortalObservationLater(
          { checkedAt, requestSequence },
          latestSuccessfulCheck
            ? {
                checkedAt: latestSuccessfulCheck.checkedAt,
                requestSequence: latestSuccessfulCheck.requestSequence,
              }
            : null,
        ) &&
        result === 'checked' &&
        sourceFetchedAt !== null &&
        isNewerPortalPageRead(sourceFetchedAt, latestPortalPageRead?.sourceFetchedAt ?? null) &&
        status !== null &&
        status.trim().length > 0;
      const statusChanged = shouldRecordPortalStatusTransition({
        result,
        isCurrentSourceObservation,
        previousStatus: previousPublicStatus,
        status,
      });
      const check = await transaction.permitPortalStatusCheck.create({
        data: {
          permitId: permit.id,
          teamId: parsed.data.teamId,
          permitNumber: permit.permitNumber,
          sourceUrl,
          status,
          result,
          message,
          checkedAt,
          requestSequence,
          sourceFetchedAt,
          redlineStatus: null,
          redlineResult: 'not_connected',
          redlineMessage: 'No Redline source is connected to this workspace for comparison.',
        },
      });
      if (statusChanged && previousPublicStatus && status && sourceUrl && sourceFetchedAt) {
        await recordPermitPortalStatusTransition(transaction, {
          permit: {
            id: permit.id,
            teamId: parsed.data.teamId,
            permitNumber: permit.permitNumber,
            assignedProjectManagerUserId: permit.assignedProjectManagerUserId,
          },
          check: {
            id: check.id,
            checkedAt: check.checkedAt,
            sourceFetchedAt,
            sourceUrl,
          },
          previousStatus: previousPublicStatus,
          newStatus: status,
        });
      }
      const monitoring = await transaction.permit.update({
        where: { id: permit.id },
        data: {
          ...applyPortalMonitoringOutcome(
            currentMonitoring,
            { result, checkedAt, requestSequence, message },
            latestCheck
              ? { checkedAt: latestCheck.checkedAt, requestSequence: latestCheck.requestSequence }
              : null,
          ),
          ...(isCurrentSourceObservation
            ? { portalCurrentStatus: status, portalStatusObservedAt: sourceFetchedAt }
            : {}),
        },
        select: {
          lastSuccessfulPortalCheckAt: true,
          portalMonitoringInterruptedAt: true,
          portalMonitoringReason: true,
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
      let interruptionNotification: {
        teamId: string;
        projectName: string;
        permitNumber: string;
        result: 'unavailable' | 'unverified';
        reason: string;
        checkedAt: Date;
        permitUrl: string;
      } | null = null;

      if (
        result !== 'checked' &&
        isNewPortalMonitoringInterruption(
          { result, checkedAt, requestSequence, message },
          latestCheck,
        )
      ) {
        interruptionNotification = {
          teamId: parsed.data.teamId,
          projectName: permit.projectName,
          permitNumber: permit.permitNumber,
          result,
          reason: message ?? 'The public City permit status could not be verified.',
          checkedAt: check.checkedAt,
          permitUrl: new URL(
            `/dashboard/permits/${encodeURIComponent(permit.id)}`,
            siteUrl,
          ).toString(),
        };
      }

      if (statusChanged && status && previousPublicStatus && sourceUrl) {
        const preference = await transaction.teamStatusAlertPreference.findUnique({
          where: { teamId: parsed.data.teamId },
          select: { id: true },
        });
        let currentTeamMembers: { userId: string; role: string; email: string | null }[] = [];
        let selectedUserIds: string[] = [];

        if (preference) {
          const memberships = await transaction.teamMembership.findMany({
            where: { teamId: parsed.data.teamId },
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
            where: { teamId: parsed.data.teamId },
            select: { userId: true },
          });
          selectedUserIds = selectedRecipients.map((recipient) => recipient.userId);
        } else if (permit.assignedProjectManagerUserId) {
          const assignedUserId = permit.assignedProjectManagerUserId;
          const membership = await transaction.teamMembership.findUnique({
            where: {
              teamId_userId: { teamId: parsed.data.teamId, userId: assignedUserId },
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
          assignedProjectManagerUserId: permit.assignedProjectManagerUserId,
        });

        if (recipients.length > 0) {
          const confirmedChecklist = await transaction.permitCorrectionChecklist.findFirst({
            where: {
              permitId: permit.id,
              teamId: parsed.data.teamId,
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
            previousStatus: previousPublicStatus,
            status,
            checkedAt: check.checkedAt,
            sourceUrl,
            correctionChecklist,
          };
        }
      }

      return { check, monitoring, notification, interruptionNotification };
    });

    const statusNotification = saved.notification;
    if (statusNotification) {
      try {
        await Promise.allSettled(
          statusNotification.recipients.map((to) =>
            deliverEmail({ to, ...permitPortalStatusDetectedEmail(statusNotification) }),
          ),
        );
      } catch {
        // The saved portal observation is authoritative; email delivery is best-effort.
      }
    }

    const interruptionNotification = saved.interruptionNotification;
    if (interruptionNotification) {
      try {
        const owners = await prisma.teamMembership.findMany({
          where: { teamId: interruptionNotification.teamId, role: 'owner' },
          select: { userId: true },
        });
        const recipients = owners.length
          ? await prisma.user.findMany({
              where: { id: { in: owners.map((owner) => owner.userId) } },
              select: { email: true },
            })
          : [];
        await Promise.allSettled(
          recipients.map((recipient) =>
            deliverEmail({
              to: recipient.email,
              ...permitMonitoringInterruptedEmail(interruptionNotification),
            }),
          ),
        );
      } catch {
        // The saved observation is authoritative; owner email is best-effort.
      }
    }

    return NextResponse.json(
      PermitPortalCheckMutation.parse({
        check: serializeCheck(saved.check),
        monitoring: serializeMonitoring(saved.monitoring),
      }),
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Could not save this portal check' }, { status: 500 });
  }
}
