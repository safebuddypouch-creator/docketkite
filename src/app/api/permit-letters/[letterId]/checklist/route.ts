// @polsia:user-owned — member-scoped, paid-team checklist creation from confirmed letter reviews.
import 'server-only';
import { NextResponse } from 'next/server';
import { checklistItemsFromConfirmedReview } from '@/lib/business/permit-checklist';
import {
  PermitCorrectionChecklistItemUpdateRequest,
  PermitCorrectionChecklistItemUpdateResponse,
  PermitCorrectionChecklistRequest,
  PermitCorrectionChecklistResponse,
} from '@/lib/contracts/permit-letter';
import { prisma } from '@/lib/db';
import { deliverEmail } from '@/lib/email/deliver';
import { permitCorrectionChecklistCreatedEmail } from '@/lib/email/templates';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { siteUrl } from '@/lib/site';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

async function getUser(request: Request): Promise<SessionUser | Response> {
  try {
    return await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function serializeChecklist(
  checklist: {
    id: string;
    teamId: string;
    permitId: string;
    permitLetterId: string;
    createdAt: Date;
    items: {
      id: string;
      sourceLetterId: string;
      sourceItemId: string;
      action: string;
      location: string | null;
      planReference: string | null;
      completed: boolean;
    }[];
  },
  sourceFileName: string,
) {
  return PermitCorrectionChecklistResponse.parse({
    checklist: {
      id: checklist.id,
      teamId: checklist.teamId,
      permitId: checklist.permitId,
      sourceLetterId: checklist.permitLetterId,
      sourceFileName,
      createdAt: checklist.createdAt.toISOString(),
      items: checklist.items,
    },
  });
}

async function existingChecklist(permitLetterId: string) {
  return prisma.permitCorrectionChecklist.findUnique({
    where: { permitLetterId },
    include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } },
  });
}

async function notifyAssignedProjectManager(checklist: {
  teamId: string;
  permitId: string;
  permitLetterId: string;
}) {
  try {
    const permit = await prisma.permit.findFirst({
      where: { id: checklist.permitId, teamId: checklist.teamId },
      select: {
        assignedProjectManagerUserId: true,
        projectName: true,
        permitNumber: true,
      },
    });
    const managerId = permit?.assignedProjectManagerUserId;
    if (!permit || !managerId) return;

    const membership = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: checklist.teamId, userId: managerId } },
      select: { role: true },
    });
    if (membership?.role !== 'project_manager') return;

    const manager = await prisma.user.findUnique({
      where: { id: managerId },
      select: { email: true },
    });
    if (!manager?.email.trim()) return;

    const permitNumber = permit.permitNumber.trim();
    const permitReference = permitNumber || permit.projectName;
    const checklistPath = `/dashboard/permits/${encodeURIComponent(checklist.permitId)}/letters/${encodeURIComponent(checklist.permitLetterId)}/checklist`;
    const checklistUrl = new URL(checklistPath, siteUrl).toString();

    await deliverEmail({
      to: manager.email,
      ...permitCorrectionChecklistCreatedEmail({
        permitReference,
        projectName: permit.projectName,
        permitNumber,
        checklistUrl,
      }),
    });
  } catch {
    // The checklist is already saved; notification lookups and delivery cannot undo creation.
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ letterId: string }> }) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { letterId } = await params;
  const permitId = new URL(request.url).searchParams.get('permitId') ?? '';
  if (!permitId) return NextResponse.json({ error: 'permit_id_required' }, { status: 400 });

  const letter = await prisma.permitLetter.findFirst({
    where: { id: letterId, permitId },
    select: { id: true, teamId: true, fileName: true },
  });
  if (!letter) return NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 });

  const access = await requireTeamAccess(letter.teamId, user.id);
  if (access.response) return access.response;

  const checklist = await existingChecklist(letter.id);
  if (!checklist) {
    return NextResponse.json({ error: 'correction_checklist_not_found' }, { status: 404 });
  }

  return NextResponse.json(serializeChecklist(checklist, letter.fileName));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ letterId: string }> },
) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { letterId } = await params;
  const parsed = PermitCorrectionChecklistItemUpdateRequest.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_checklist_item_update' }, { status: 400 });
  }

  const letter = await prisma.permitLetter.findUnique({
    where: { id: letterId },
    select: { id: true, teamId: true },
  });
  if (!letter) return NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 });

  const access = await requireTeamAccess(letter.teamId, user.id);
  if (access.response) return access.response;

  const checklist = await prisma.permitCorrectionChecklist.findUnique({
    where: { permitLetterId: letter.id },
    select: { id: true },
  });
  if (!checklist) {
    return NextResponse.json({ error: 'correction_checklist_not_found' }, { status: 404 });
  }

  const updated = await prisma.permitCorrectionChecklistItem.updateMany({
    where: { id: parsed.data.itemId, checklistId: checklist.id },
    data: { completed: parsed.data.completed },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: 'correction_checklist_item_not_found' }, { status: 404 });
  }

  const item = await prisma.permitCorrectionChecklistItem.findFirst({
    where: { id: parsed.data.itemId, checklistId: checklist.id },
  });
  if (!item) {
    return NextResponse.json({ error: 'correction_checklist_item_not_found' }, { status: 404 });
  }

  return NextResponse.json(PermitCorrectionChecklistItemUpdateResponse.parse({ item }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ letterId: string }> },
) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { letterId } = await params;
  const parsed = PermitCorrectionChecklistRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_checklist_request' }, { status: 400 });
  }

  const access = await requireTeamAccess(parsed.data.teamId, user.id);
  if (access.response) return access.response;

  const letter = await prisma.permitLetter.findFirst({
    where: {
      id: letterId,
      permitId: parsed.data.permitId,
      teamId: parsed.data.teamId,
    },
    select: { id: true, teamId: true, permitId: true, fileName: true },
  });
  if (!letter) return NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 });

  const draft = await prisma.permitCorrectionDraft.findUnique({
    where: { permitLetterId: letter.id },
    select: { status: true, confirmedAt: true, reviewedItems: true },
  });
  if (!draft || draft.status !== 'confirmed' || !draft.confirmedAt) {
    return NextResponse.json({ error: 'correction_review_not_confirmed' }, { status: 409 });
  }

  const items = checklistItemsFromConfirmedReview(draft, letter.id);
  if (!items) {
    return NextResponse.json({ error: 'confirmed_correction_items_unavailable' }, { status: 409 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: 'confirmed_correction_items_required' }, { status: 409 });
  }

  const previous = await existingChecklist(letter.id);
  if (previous) return NextResponse.json(serializeChecklist(previous, letter.fileName));

  try {
    const created = await prisma.permitCorrectionChecklist.create({
      data: {
        permitLetterId: letter.id,
        permitId: letter.permitId,
        teamId: letter.teamId,
        createdByUserId: user.id,
        items: { create: items.map((item, position) => ({ ...item, position })) },
      },
      include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (access.membership.role === 'owner') {
      await notifyAssignedProjectManager(created);
    }
    return NextResponse.json(serializeChecklist(created, letter.fileName), { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const createdByAnotherRequest = await existingChecklist(letter.id);
      if (createdByAnotherRequest) {
        return NextResponse.json(serializeChecklist(createdByAnotherRequest, letter.fileName));
      }
    }
    return NextResponse.json({ error: 'correction_checklist_creation_failed' }, { status: 500 });
  }
}
