// @polsia:user-owned — paid-team protected public status change summary.
import 'server-only';
import { NextResponse } from 'next/server';
import { deriveRecentPermitStatusDetections } from '@/lib/business/permit-status-detections';
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';
import { PermitStatusDetectionList } from '@/lib/contracts/permit-status-detection';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

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

  const teamId = new URL(request.url).searchParams.get('teamId')?.trim() ?? '';
  if (!teamId) return NextResponse.json({ error: 'team_id_required' }, { status: 400 });

  try {
    const access = await requireTeamAccess(teamId, user.id);
    if (access.response) return access.response;

    const checks = await prisma.permitPortalStatusCheck.findMany({
      where: {
        teamId,
        result: 'checked',
        status: { not: null },
        permit: { is: { teamId, archivedAt: null } },
      },
      orderBy: [{ permitId: 'asc' }, { checkedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        permitId: true,
        permitNumber: true,
        status: true,
        checkedAt: true,
        sourceFetchedAt: true,
        sourceUrl: true,
        permit: {
          select: { projectName: true, address: true, permitType: true, portalUrl: true },
        },
      },
    });

    const observations = checks.flatMap((check) => {
      const status = check.status;
      const sourceUrl = check.sourceUrl;
      if (!status?.trim() || !sourceUrl || !getOfficialPermitPortalUrl(sourceUrl)) return [];
      return [{ ...check, status, sourceUrl }];
    });
    const detections = deriveRecentPermitStatusDetections(observations);
    const transitions = await prisma.permitPortalStatusTransition.findMany({
      where: { teamId, sourceCheckId: { in: detections.map((detection) => detection.id) } },
    });
    const transitionByCheck = new Map(
      transitions.map((transition) => [transition.sourceCheckId, transition]),
    );
    const items = detections.map((detection) => {
      const transition = transitionByCheck.get(detection.id);
      return {
        ...detection,
        detectedAt: detection.detectedAt.toISOString(),
        observedAt: detection.observedAt.toISOString(),
        targetedRole:
          transition?.targetedRole === 'project_manager' ? 'project_manager' : 'unassigned',
        textDeliveryStatus: transition?.textDeliveryStatus ?? 'unverified',
        textDeliveryMessage:
          transition?.textDeliveryMessage ??
          'No saved text alert outcome is recorded for this change.',
        checklistMatchStatus: transition?.checklistMatchStatus ?? 'unverified',
        checklistMatchMessage:
          transition?.checklistMatchMessage ??
          'No notice-based checklist outcome is recorded for this change.',
      };
    });

    return NextResponse.json(PermitStatusDetectionList.parse({ items }));
  } catch {
    return NextResponse.json({ error: 'Could not load public status changes' }, { status: 500 });
  }
}
