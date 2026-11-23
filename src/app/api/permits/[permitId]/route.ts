// @polsia:user-owned — paid-team protected read for one permit deep link.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  PermitDetailsPage,
  PermitPortalUrlMutationResponse,
  PermitPortalUrlUpdate,
} from '@/lib/contracts/permit';
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

export async function GET(request: Request, context: { params: Promise<{ permitId: string }> }) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { permitId } = await context.params;
  try {
    const accessTarget = await prisma.permit.findUnique({
      where: { id: permitId },
      select: { teamId: true },
    });
    if (!accessTarget?.teamId) {
      return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
    }

    const access = await requireTeamAccess(accessTarget.teamId, user.id);
    if (access.response) return access.response;

    const permit = await prisma.permit.findFirst({
      where: { id: permitId, teamId: accessTarget.teamId },
      include: { statusEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!permit) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    let assignedProjectManager: { id: string; name: string } | null = null;
    if (permit.assignedProjectManagerUserId) {
      const membership = await prisma.teamMembership.findUnique({
        where: {
          teamId_userId: {
            teamId: accessTarget.teamId,
            userId: permit.assignedProjectManagerUserId,
          },
        },
        select: { role: true },
      });
      if (membership?.role === 'project_manager') {
        const manager = await prisma.user.findUnique({
          where: { id: permit.assignedProjectManagerUserId },
          select: { id: true, name: true },
        });
        if (manager) {
          assignedProjectManager = {
            id: manager.id,
            name: manager.name.trim() || 'Project manager',
          };
        }
      }
    }

    let projectManagers: { id: string; name: string }[] = [];
    if (access.membership.role === 'owner') {
      const memberships = await prisma.teamMembership.findMany({
        where: { teamId: accessTarget.teamId, role: 'project_manager' },
        select: { userId: true },
      });
      const users = await prisma.user.findMany({
        where: { id: { in: memberships.map((membership) => membership.userId) } },
        select: { id: true, name: true },
      });
      projectManagers = users
        .map((manager) => ({ id: manager.id, name: manager.name.trim() || 'Project manager' }))
        .sort((first, second) => first.name.localeCompare(second.name));
    }

    return NextResponse.json(
      PermitDetailsPage.parse({
        ...permit,
        portalUrl: permit.portalUrl ?? '',
        portalStatusObservedAt: permit.portalStatusObservedAt?.toISOString() ?? null,
        archivedAt: permit.archivedAt?.toISOString() ?? null,
        createdAt: permit.createdAt.toISOString(),
        updatedAt: permit.updatedAt.toISOString(),
        assignedProjectManager,
        canEditDetails: access.membership.role === 'owner',
        projectManagers,
        statusEvents: permit.statusEvents.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not load permit' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ permitId: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  const user = await getUser(request);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: { portalUrl: 'Enter a direct public City record URL.' } },
      { status: 400 },
    );
  }
  const parsed = PermitPortalUrlUpdate.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.flatten().fieldErrors.portalUrl?.[0];
    return NextResponse.json(
      { errors: { portalUrl: message ?? 'Enter a direct public City record URL.' } },
      { status: 400 },
    );
  }

  const { permitId } = await context.params;
  try {
    const permitScope = await prisma.permit.findFirst({
      where: { id: permitId, archivedAt: null },
      select: { teamId: true },
    });
    if (!permitScope?.teamId) {
      return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
    }

    const access = await requireTeamAccess(permitScope.teamId, user.id);
    if (access.response) return access.response;

    const updated = await prisma.permit.updateMany({
      where: { id: permitId, teamId: permitScope.teamId, archivedAt: null },
      data: { portalUrl: parsed.data.portalUrl },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
    }

    const saved = await prisma.permit.findFirst({
      where: { id: permitId, teamId: permitScope.teamId },
      select: { id: true, portalUrl: true },
    });
    if (!saved) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    return NextResponse.json(
      PermitPortalUrlMutationResponse.parse({ id: saved.id, portalUrl: saved.portalUrl ?? '' }),
    );
  } catch {
    return NextResponse.json({ error: 'Could not save this permit portal URL' }, { status: 500 });
  }
}
