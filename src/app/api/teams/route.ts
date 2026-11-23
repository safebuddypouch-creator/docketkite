// @polsia:user-owned — create or join a team before checkout; list own memberships.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { TeamCreateOrJoin, TeamList, TeamListItem } from '@/lib/contracts/team';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { getTeamAccessState } from '@/lib/team-access';
import { createTeamTrialWindow } from '@/lib/team-entitlements';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  try {
    const memberships = await prisma.teamMembership.findMany({ where: { userId: user.id } });
    if (memberships.length === 0) return NextResponse.json(TeamList.parse({ items: [] }));

    const spaces = await prisma.teamSpace.findMany({
      where: { id: { in: memberships.map((membership) => membership.teamId) } },
    });
    const byId = new Map(spaces.map((space) => [space.id, space]));
    const items = await Promise.all(
      memberships.map(async (membership) => {
        const team = byId.get(membership.teamId);
        if (!team) return null;
        const access = await getTeamAccessState(team.id, user.id);
        return TeamListItem.parse({
          id: team.id,
          name: team.name,
          joinCode: membership.role === 'project_manager' ? null : team.joinCode,
          role: membership.role,
          ...access,
        });
      }),
    );
    return NextResponse.json(TeamList.parse({ items: items.filter((item) => item !== null) }));
  } catch {
    return NextResponse.json({ error: 'Could not load teams' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const body = await request.json().catch(() => null);
  const parsed = TeamCreateOrJoin.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_team_request' }, { status: 400 });
  }

  try {
    let teamId: string;
    if (parsed.data.action === 'create') {
      const name = parsed.data.name;
      const createdAt = new Date();
      const trialWindow = createTeamTrialWindow(createdAt);
      const team = await prisma.$transaction(async (transaction) => {
        const created = await transaction.teamSpace.create({
          data: {
            name,
            joinCode: randomBytes(5).toString('hex').toUpperCase(),
            createdByUserId: user.id,
            ownerTesting: false,
            createdAt,
            ...trialWindow,
          },
        });
        await transaction.teamMembership.create({
          data: { teamId: created.id, userId: user.id, role: 'owner' },
        });
        await transaction.permit.updateMany({
          where: { userId: user.id, teamId: null },
          data: { teamId: created.id },
        });
        return created;
      });
      teamId = team.id;
    } else {
      const team = await prisma.teamSpace.findUnique({
        where: { joinCode: parsed.data.joinCode.toUpperCase() },
        select: { id: true },
      });
      if (!team) return NextResponse.json({ error: 'team_invite_not_found' }, { status: 404 });

      await prisma.$transaction(async (transaction) => {
        await transaction.teamMembership.upsert({
          where: { teamId_userId: { teamId: team.id, userId: user.id } },
          create: { teamId: team.id, userId: user.id, role: 'purchaser' },
          update: {},
        });
      });
      teamId = team.id;
    }

    const [membership, team] = await Promise.all([
      prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: user.id } } }),
      prisma.teamSpace.findUnique({ where: { id: teamId } }),
    ]);
    if (!membership || !team) {
      return NextResponse.json({ error: 'Could not load the selected team' }, { status: 500 });
    }
    const access = await getTeamAccessState(teamId, user.id);
    return NextResponse.json(
      TeamListItem.parse({
        id: team.id,
        name: team.name,
        joinCode: membership.role === 'project_manager' ? null : team.joinCode,
        role: membership.role,
        ...access,
      }),
      { status: parsed.data.action === 'create' ? 201 : 200 },
    );
  } catch {
    return NextResponse.json({ error: 'Could not save team membership' }, { status: 500 });
  }
}
