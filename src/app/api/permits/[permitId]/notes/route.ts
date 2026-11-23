// @polsia:user-owned — paid team members only; notes never trigger notifications.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  PermitTeamNoteCreate,
  PermitTeamNoteItem,
  PermitTeamNoteList,
} from '@/lib/contracts/permit-team-note';
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

async function getPermitTeam(permitId: string, includeArchived = false) {
  return prisma.permit.findFirst({
    where: { id: permitId, ...(includeArchived ? {} : { archivedAt: null }) },
    select: { id: true, teamId: true },
  });
}

export async function GET(request: Request, context: { params: Promise<{ permitId: string }> }) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { permitId } = await context.params;
  try {
    const permit = await getPermitTeam(permitId, true);
    if (!permit?.teamId) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    const access = await requireTeamAccess(permit.teamId, user.id);
    if (access.response) return access.response;

    const notes = await prisma.permitTeamNote.findMany({
      where: { permitId: permit.id, teamId: permit.teamId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const authors = await prisma.user.findMany({
      where: { id: { in: notes.map((note) => note.authorUserId) } },
      select: { id: true, name: true },
    });
    const authorNames = new Map(authors.map((author) => [author.id, author.name]));

    return NextResponse.json(
      PermitTeamNoteList.parse({
        items: notes.map((note) =>
          PermitTeamNoteItem.parse({
            id: note.id,
            body: note.body,
            authorName: authorNames.get(note.authorUserId)?.trim() || 'Team member',
            createdAt: note.createdAt.toISOString(),
          }),
        ),
      }),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'Could not load internal permit notes' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ permitId: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { permitId } = await context.params;
  try {
    const permit = await getPermitTeam(permitId);
    if (!permit?.teamId) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });
    const teamId = permit.teamId;

    const access = await requireTeamAccess(teamId, user.id);
    if (access.response) return access.response;

    const parsed = PermitTeamNoteCreate.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { errors: { body: parsed.error.flatten().fieldErrors.body?.[0] ?? 'Enter a note.' } },
        { status: 400 },
      );
    }

    const note = await prisma.$transaction(async (transaction) => {
      const currentPermit = await transaction.permit.findFirst({
        where: { id: permit.id, teamId, archivedAt: null },
        select: { id: true },
      });
      if (!currentPermit) return null;

      return transaction.permitTeamNote.create({
        data: {
          permitId: currentPermit.id,
          teamId,
          authorUserId: user.id,
          body: parsed.data.body,
        },
      });
    });
    if (!note) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    return NextResponse.json(
      PermitTeamNoteItem.parse({
        id: note.id,
        body: note.body,
        authorName: user.name.trim() || 'Team member',
        createdAt: note.createdAt.toISOString(),
      }),
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Could not save this internal permit note' },
      { status: 500 },
    );
  }
}
