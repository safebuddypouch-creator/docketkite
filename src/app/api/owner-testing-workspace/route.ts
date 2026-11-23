// @polsia:user-owned — configure the single owner-testing workspace.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { OWNER_TESTING_TEAM_ID, TeamListItem } from '@/lib/contracts/team';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { getTeamAccessState } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

function isConfiguredOwner(user: SessionUser): boolean {
  const configuredEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(
    configuredEmail &&
      user.emailVerified &&
      user.role === 'admin' &&
      user.email.trim().toLowerCase() === configuredEmail,
  );
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

  if (!isConfiguredOwner(user)) {
    return NextResponse.json({ error: 'owner_admin_required' }, { status: 403 });
  }

  try {
    const team = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.teamSpace.findUnique({
        where: { id: OWNER_TESTING_TEAM_ID },
      });
      if (existing && existing.createdByUserId !== user.id) return null;

      await transaction.teamSpace.updateMany({
        where: { ownerTesting: true, id: { not: OWNER_TESTING_TEAM_ID } },
        data: { ownerTesting: false },
      });

      const testingTeam = existing
        ? await transaction.teamSpace.update({
            where: { id: OWNER_TESTING_TEAM_ID },
            data: { ownerTesting: true },
          })
        : await transaction.teamSpace.create({
            data: {
              id: OWNER_TESTING_TEAM_ID,
              name: 'Owner testing workspace',
              joinCode: randomBytes(5).toString('hex').toUpperCase(),
              createdByUserId: user.id,
              ownerTesting: true,
            },
          });

      await transaction.teamMembership.upsert({
        where: { teamId_userId: { teamId: testingTeam.id, userId: user.id } },
        create: { teamId: testingTeam.id, userId: user.id, role: 'owner' },
        update: { role: 'owner' },
      });
      return testingTeam;
    });

    if (!team) {
      return NextResponse.json({ error: 'owner_testing_workspace_unavailable' }, { status: 409 });
    }

    const membership = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Could not load the test workspace' }, { status: 500 });
    }

    const access = await getTeamAccessState(team.id, user.id);
    return NextResponse.json(
      TeamListItem.parse({
        id: team.id,
        name: team.name,
        joinCode: team.joinCode,
        role: membership.role,
        ...access,
      }),
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: 'Could not configure the owner testing workspace' },
      { status: 500 },
    );
  }
}
