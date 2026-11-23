// @polsia:user-owned — paid team-owner edits for a permit's reference and address.
import 'server-only';
import { NextResponse } from 'next/server';
import { PermitDetailsMutationResponse, PermitDetailsUpdate } from '@/lib/contracts/permit';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

async function getUser(request: Request): Promise<SessionUser | Response> {
  try {
    return await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ permitId: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const user = await getUser(request);
  if (user instanceof Response) return user;

  const parsed = PermitDetailsUpdate.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json(
      {
        errors: {
          ...(fieldErrors.permitNumber?.[0] ? { permitNumber: fieldErrors.permitNumber[0] } : {}),
          ...(fieldErrors.address?.[0] ? { address: fieldErrors.address[0] } : {}),
          ...(!fieldErrors.permitNumber?.[0] && !fieldErrors.address?.[0]
            ? { form: 'Enter a permit reference and job address.' }
            : {}),
        },
      },
      { status: 400 },
    );
  }

  const { permitId } = await context.params;
  try {
    const permit = await prisma.permit.findFirst({
      where: { id: permitId, archivedAt: null },
      select: { teamId: true },
    });
    if (!permit?.teamId || permit.teamId !== parsed.data.teamId) {
      return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
    }

    const membership = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: permit.teamId, userId: user.id } },
      select: { role: true },
    });
    if (!membership) {
      return NextResponse.json({ error: 'team_membership_required' }, { status: 403 });
    }
    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'team_owner_required' }, { status: 403 });
    }

    const access = await requireTeamAccess(permit.teamId, user.id);
    if (access.response) return access.response;
    if (access.membership.role !== 'owner') {
      return NextResponse.json({ error: 'team_owner_required' }, { status: 403 });
    }

    const updated = await prisma.permit.updateMany({
      where: { id: permitId, teamId: permit.teamId, archivedAt: null },
      data: {
        permitNumber: parsed.data.permitNumber,
        address: parsed.data.address,
      },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
    }

    const saved = await prisma.permit.findFirst({
      where: { id: permitId, teamId: permit.teamId },
      select: { id: true, permitNumber: true, address: true },
    });
    if (!saved) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    return NextResponse.json(PermitDetailsMutationResponse.parse(saved));
  } catch {
    return NextResponse.json({ error: 'Could not save these permit details' }, { status: 500 });
  }
}
