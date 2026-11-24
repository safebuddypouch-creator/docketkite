// @polsia:user-owned — owner-only project-manager invitations for private teams.
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { OWNER_TESTING_TEAM_ID } from '@/lib/contracts/team';
import {
  TeamInvitationCreateRequest,
  TeamInvitationCreateResponse,
} from '@/lib/contracts/team-invitation';
import { prisma } from '@/lib/db';
import { deliverEmail } from '@/lib/email/deliver';
import { teamManagerInvitationEmail, teamTestingOwnerInvitationEmail } from '@/lib/email/templates';
import { env } from '@/lib/env';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { invitationAppUrl, teamInvitationPageUrl } from '@/lib/team-invite-url';

export const dynamic = 'force-dynamic';
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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

  const parsed = TeamInvitationCreateRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_invitation_request' }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: parsed.data.teamId, userId: user.id } },
  });
  if (membership?.role !== 'owner') {
    return NextResponse.json(
      {
        error: 'team_owner_required',
        message: 'Only this team’s owner can invite project managers.',
      },
      { status: 403 },
    );
  }

  const team = await prisma.teamSpace.findUnique({ where: { id: parsed.data.teamId } });
  if (!team) {
    return NextResponse.json({ error: 'team_not_found' }, { status: 404 });
  }

  const isTestingWorkspace = team.id === OWNER_TESTING_TEAM_ID && team.ownerTesting;
  const configuredOwnerEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  const isConfiguredOwnerAdmin = Boolean(
    configuredOwnerEmail &&
      user.emailVerified &&
      user.role === 'admin' &&
      user.email.trim().toLowerCase() === configuredOwnerEmail,
  );
  if (isTestingWorkspace && !isConfiguredOwnerAdmin) {
    return NextResponse.json(
      {
        error: 'owner_admin_required',
        message: 'Only the verified app owner can invite the separate test owner.',
      },
      { status: 403 },
    );
  }
  const invitationRole = isTestingWorkspace ? 'owner' : 'project_manager';
  const now = new Date();

  if (isTestingWorkspace) {
    const [currentTestOwner, pendingTestOwner] = await Promise.all([
      prisma.teamMembership.findFirst({
        where: { teamId: team.id, userId: { not: user.id }, role: 'owner' },
        select: { userId: true },
      }),
      prisma.teamInvitation.findFirst({
        where: { teamId: team.id, role: 'owner', status: 'pending', expiresAt: { gt: now } },
        select: { id: true },
      }),
    ]);
    if (currentTestOwner || pendingTestOwner) {
      return NextResponse.json(
        {
          error: 'test_owner_already_assigned',
          message: 'The testing workspace already has a separate test owner or pending invitation.',
        },
        { status: 409 },
      );
    }
  }

  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existingUser) {
    const existingMembership = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: existingUser.id } },
    });
    if (existingMembership) {
      return NextResponse.json(
        { error: 'already_team_member', message: 'That person is already a member of this team.' },
        { status: 409 },
      );
    }
  }

  const pendingInvitation = await prisma.teamInvitation.findFirst({
    where: { teamId: team.id, invitedEmail: email, status: 'pending', expiresAt: { gt: now } },
    select: { id: true },
  });
  if (pendingInvitation) {
    return NextResponse.json(
      {
        error: 'invitation_already_pending',
        message: 'An active invitation is already pending for that email.',
      },
      { status: 409 },
    );
  }

  const token = randomBytes(32).toString('base64url');
  let inviteUrl: string;
  try {
    // Do not let the env schema's localhost fallback escape in a production email.
    inviteUrl = teamInvitationPageUrl(token, invitationAppUrl(request));
  } catch {
    return NextResponse.json(
      {
        error: 'invitation_origin_not_configured',
        message: 'Invitation links are unavailable until the app origin is configured.',
      },
      { status: 503 },
    );
  }

  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
  const invitation = await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      invitedByUserId: user.id,
      invitedEmail: email,
      tokenHash: hashToken(token),
      role: invitationRole,
      expiresAt,
    },
  });

  const message = isTestingWorkspace
    ? teamTestingOwnerInvitationEmail({
        teamName: team.name,
        inviterName: user.name,
        inviteUrl,
      })
    : teamManagerInvitationEmail({
        teamName: team.name,
        inviterName: user.name,
        inviteUrl,
      });

  try {
    const delivery = await deliverEmail({ to: email, ...message });
    if (!delivery.id) throw new Error('The invitation recipient is suppressed.');
  } catch {
    await prisma.teamInvitation
      .deleteMany({ where: { id: invitation.id, status: 'pending' } })
      .catch(() => undefined);
    return NextResponse.json(
      {
        error: 'invitation_email_failed',
        message: 'The invitation email could not be delivered. Please try again.',
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    TeamInvitationCreateResponse.parse({ email, expiresAt: expiresAt.toISOString() }),
    { status: 201 },
  );
}
