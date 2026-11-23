// @polsia:user-owned — one-time, email-matched project-manager invitation acceptance.
import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { OWNER_TESTING_TEAM_ID } from '@/lib/contracts/team';
import {
  TeamInvitationAcceptRequest,
  TeamInvitationAcceptResponse,
} from '@/lib/contracts/team-invitation';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';

export const dynamic = 'force-dynamic';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type AcceptanceResult =
  | { status: 'accepted'; teamId: string; teamName: string; role: 'project_manager' | 'owner' }
  | 'not_found'
  | 'already_used'
  | 'expired'
  | 'email_mismatch'
  | 'already_member'
  | 'team_not_found';

function failure(result: Exclude<AcceptanceResult, { status: 'accepted' }>) {
  switch (result) {
    case 'not_found':
      return NextResponse.json(
        {
          error: 'invitation_not_found',
          message: 'This invitation link is invalid. Ask the team owner to send a new one.',
        },
        { status: 404 },
      );
    case 'already_used':
      return NextResponse.json(
        { error: 'invitation_already_used', message: 'This invitation has already been used.' },
        { status: 409 },
      );
    case 'expired':
      return NextResponse.json(
        {
          error: 'invitation_expired',
          message: 'This invitation has expired. Ask the team owner to send a new one.',
        },
        { status: 410 },
      );
    case 'email_mismatch':
      return NextResponse.json(
        {
          error: 'invitation_email_mismatch',
          message:
            'This invitation was sent to a different email address. Sign in with the invited address.',
        },
        { status: 403 },
      );
    case 'already_member':
      return NextResponse.json(
        {
          error: 'already_team_member',
          message: 'You already have a different role in this team. Ask the owner for help.',
        },
        { status: 409 },
      );
    case 'team_not_found':
      return NextResponse.json(
        { error: 'invited_team_not_found', message: 'The invited team is no longer available.' },
        { status: 404 },
      );
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

  if (!user.emailVerified) {
    return NextResponse.json(
      {
        error: 'email_verification_required',
        message: 'Verify the invited email address before accepting this invitation.',
      },
      { status: 403 },
    );
  }

  const parsed = TeamInvitationAcceptRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_invitation_link',
        message: 'This invitation link is invalid. Ask the team owner to send a new one.',
      },
      { status: 400 },
    );
  }

  try {
    const now = new Date();
    const result: AcceptanceResult = await prisma.$transaction(async (transaction) => {
      const invitation = await transaction.teamInvitation.findUnique({
        where: { tokenHash: hashToken(parsed.data.token) },
      });
      if (!invitation) return 'not_found';
      if (invitation.status === 'expired' || invitation.expiresAt <= now) {
        await transaction.teamInvitation.updateMany({
          where: { id: invitation.id, status: 'pending' },
          data: { status: 'expired' },
        });
        return 'expired';
      }
      if (invitation.status !== 'pending') return 'already_used';
      if (invitation.invitedEmail.toLowerCase() !== user.email.trim().toLowerCase()) {
        return 'email_mismatch';
      }

      const team = await transaction.teamSpace.findUnique({ where: { id: invitation.teamId } });
      if (!team) return 'team_not_found';
      const role =
        invitation.role === 'project_manager'
          ? 'project_manager'
          : invitation.role === 'owner' && team.id === OWNER_TESTING_TEAM_ID && team.ownerTesting
            ? 'owner'
            : null;
      if (!role) return 'not_found';

      const existingMembership = await transaction.teamMembership.findUnique({
        where: { teamId_userId: { teamId: invitation.teamId, userId: user.id } },
      });
      if (existingMembership) return 'already_member';

      const claimed = await transaction.teamInvitation.updateMany({
        where: { id: invitation.id, status: 'pending', expiresAt: { gt: now } },
        data: { status: 'accepted', acceptedAt: now, acceptedByUserId: user.id },
      });
      if (claimed.count !== 1) return 'already_used';

      await transaction.teamMembership.create({
        data: { teamId: invitation.teamId, userId: user.id, role },
      });
      return { status: 'accepted', teamId: team.id, teamName: team.name, role };
    });

    if (typeof result === 'string') return failure(result);
    return NextResponse.json(
      TeamInvitationAcceptResponse.parse({
        teamId: result.teamId,
        teamName: result.teamName,
        role: result.role,
      }),
    );
  } catch {
    return NextResponse.json(
      {
        error: 'invitation_acceptance_failed',
        message: 'The invitation could not be accepted right now. Try again shortly.',
      },
      { status: 500 },
    );
  }
}
