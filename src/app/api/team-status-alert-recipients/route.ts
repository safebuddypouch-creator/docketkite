// @polsia:user-owned — team owners manage verified status alert recipients.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  TeamStatusAlertRecipientsResponse,
  TeamStatusAlertRecipientsUpdate,
} from '@/lib/contracts/team-status-alert-recipients';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { getTeamAccessState } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

async function authorizeOwner(request: Request, teamId: string) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return { response: response as Response };
  }

  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
    select: { role: true },
  });
  if (membership?.role !== 'owner') {
    return { response: NextResponse.json({ error: 'team_owner_required' }, { status: 403 }) };
  }

  const team = await prisma.teamSpace.findUnique({ where: { id: teamId } });
  if (!team) {
    return { response: NextResponse.json({ error: 'team_not_found' }, { status: 404 }) };
  }

  const access = await getTeamAccessState(teamId, user.id);
  if (!access.accessActive) {
    const unavailable = access.paymentStatus === 'unavailable';
    return {
      response: NextResponse.json(
        {
          error: unavailable ? 'billing_status_unavailable' : 'team_subscription_required',
          paymentStatus: access.paymentStatus,
        },
        { status: unavailable ? 503 : 402 },
      ),
    };
  }

  return { response: null };
}

async function readRecipients(teamId: string) {
  const [preference, memberships] = await Promise.all([
    prisma.teamStatusAlertPreference.findUnique({ where: { teamId } }),
    prisma.teamMembership.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true },
    }),
  ]);
  const memberIds = memberships.map((membership) => membership.userId);
  const [users, configuredRecipients] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, email: true },
    }),
    preference
      ? prisma.teamStatusAlertRecipient.findMany({
          where: { teamId },
          select: { userId: true },
        })
      : Promise.resolve([]),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const members = memberships.flatMap((membership) => {
    const user = usersById.get(membership.userId);
    return user
      ? [{ userId: user.id, name: user.name, email: user.email, role: membership.role }]
      : [];
  });
  const currentMemberIds = new Set(memberIds);

  return TeamStatusAlertRecipientsResponse.parse({
    teamId,
    members,
    recipientUserIds: preference
      ? configuredRecipients
          .map((recipient) => recipient.userId)
          .filter((userId) => currentMemberIds.has(userId))
      : [],
    usesAssignedProjectManagerDefault: !preference,
  });
}

export async function GET(request: Request) {
  const teamId = new URL(request.url).searchParams.get('teamId')?.trim() ?? '';
  if (!teamId) return NextResponse.json({ error: 'team_id_required' }, { status: 400 });

  try {
    const authorization = await authorizeOwner(request, teamId);
    if (authorization.response) return authorization.response;
    return NextResponse.json(await readRecipients(teamId));
  } catch {
    return NextResponse.json({ error: 'Could not load status alert recipients' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const parsed = TeamStatusAlertRecipientsUpdate.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_recipient_selection' }, { status: 400 });
  }

  try {
    const authorization = await authorizeOwner(request, parsed.data.teamId);
    if (authorization.response) return authorization.response;

    if (parsed.data.action === 'use_assigned_project_manager') {
      await prisma.$transaction(async (transaction) => {
        await transaction.teamStatusAlertRecipient.deleteMany({
          where: { teamId: parsed.data.teamId },
        });
        await transaction.teamStatusAlertPreference.deleteMany({
          where: { teamId: parsed.data.teamId },
        });
      });
    } else {
      const requestedIds = parsed.data.recipientUserIds;
      const saved = await prisma.$transaction(async (transaction) => {
        const memberships = await transaction.teamMembership.findMany({
          where: { teamId: parsed.data.teamId, userId: { in: requestedIds } },
          select: { userId: true },
        });
        const users = await transaction.user.findMany({
          where: { id: { in: requestedIds } },
          select: { id: true },
        });
        if (memberships.length !== requestedIds.length || users.length !== requestedIds.length) {
          return false;
        }

        await transaction.teamStatusAlertPreference.upsert({
          where: { teamId: parsed.data.teamId },
          create: { teamId: parsed.data.teamId },
          update: {},
        });
        await transaction.teamStatusAlertRecipient.deleteMany({
          where: { teamId: parsed.data.teamId },
        });
        await transaction.teamStatusAlertRecipient.createMany({
          data: requestedIds.map((recipientUserId) => ({
            teamId: parsed.data.teamId,
            userId: recipientUserId,
          })),
        });
        return true;
      });
      if (!saved) {
        return NextResponse.json(
          { error: 'recipient_must_be_current_team_member' },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(await readRecipients(parsed.data.teamId));
  } catch {
    return NextResponse.json({ error: 'Could not save status alert recipients' }, { status: 500 });
  }
}
