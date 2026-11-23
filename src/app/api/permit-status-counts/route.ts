// @polsia:user-owned — protected counts for a selected team's active permits.
import 'server-only';
import { NextResponse } from 'next/server';
import { buildPermitStatusCounts } from '@/lib/business/permit-status-counts';
import { PermitStatusCounts } from '@/lib/contracts/permit-status-counts';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const teamId = new URL(request.url).searchParams.get('teamId')?.trim() ?? '';
  if (!teamId) return NextResponse.json({ error: 'team_id_required' }, { status: 400 });

  const access = await requireTeamAccess(teamId, user.id);
  if (access.response) return access.response;

  try {
    const groups = await prisma.permit.groupBy({
      by: ['status'],
      where: { teamId, archivedAt: null },
      _count: { _all: true },
    });
    return NextResponse.json(
      PermitStatusCounts.parse({
        teamId,
        items: buildPermitStatusCounts(
          groups.map((group) => ({ status: group.status, count: group._count._all })),
        ),
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not load permit status counts' }, { status: 500 });
  }
}
