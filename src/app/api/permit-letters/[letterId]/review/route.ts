// @polsia:user-owned — paid-team review and confirmation of letter-derived drafts.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  PermitCorrectionDraftResponse,
  PermitCorrectionReviewDetails,
  PermitCorrectionReviewRequest,
  PermitCorrectionReviewResponse,
  PermitLetterItem,
} from '@/lib/contracts/permit-letter';
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

function serializeDraft(draft: {
  status: string;
  items: unknown;
  reviewedItems: unknown;
  fieldErrors: unknown;
  extractedAt: Date;
  reviewedAt: Date | null;
  confirmedAt: Date | null;
}) {
  return PermitCorrectionDraftResponse.parse({
    draft: {
      status: draft.status === 'confirmed' ? 'confirmed' : 'draft',
      items: draft.reviewedItems ?? draft.items,
      fieldErrors: draft.fieldErrors ?? [],
      extractedAt: draft.extractedAt.toISOString(),
      reviewedAt: draft.reviewedAt?.toISOString() ?? null,
      confirmedAt: draft.confirmedAt?.toISOString() ?? null,
    },
  }).draft;
}

async function getAuthorizedLetter(request: Request, letterId: string, userId: string) {
  const permitId = new URL(request.url).searchParams.get('permitId') ?? '';
  if (!permitId) {
    return { response: NextResponse.json({ error: 'permit_id_required' }, { status: 400 }) };
  }

  const scope = await prisma.permitLetter.findFirst({
    where: { id: letterId, permitId },
    select: { teamId: true },
  });
  if (!scope) {
    return { response: NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 }) };
  }

  const access = await requireTeamAccess(scope.teamId, userId);
  if (access.response) return { response: access.response };
  return { permitId, teamId: scope.teamId, response: null };
}

export async function GET(request: Request, { params }: { params: Promise<{ letterId: string }> }) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { letterId } = await params;
  const authorized = await getAuthorizedLetter(request, letterId, user.id);
  if (authorized.response) return authorized.response;

  const letter = await prisma.permitLetter.findFirst({
    where: { id: letterId, permitId: authorized.permitId, teamId: authorized.teamId },
    select: {
      id: true,
      permitId: true,
      teamId: true,
      uploadId: true,
      fileName: true,
      mimeType: true,
      size: true,
      createdAt: true,
      correctionDraft: true,
      correctionChecklist: {
        select: {
          id: true,
          permitLetterId: true,
          items: { select: { completed: true } },
        },
      },
      permit: {
        select: { id: true, projectName: true, address: true, permitNumber: true },
      },
    },
  });
  if (!letter?.correctionDraft) {
    return NextResponse.json({ error: 'correction_draft_not_found' }, { status: 404 });
  }

  return NextResponse.json(
    PermitCorrectionReviewDetails.parse({
      letter: PermitLetterItem.parse({
        id: letter.id,
        permitId: letter.permitId,
        teamId: letter.teamId,
        uploadId: letter.uploadId,
        fileName: letter.fileName,
        mimeType: letter.mimeType,
        size: letter.size,
        createdAt: letter.createdAt.toISOString(),
        correctionDraft: serializeDraft(letter.correctionDraft),
        correctionChecklist: letter.correctionChecklist
          ? {
              id: letter.correctionChecklist.id,
              sourceLetterId: letter.correctionChecklist.permitLetterId,
              completedCount: letter.correctionChecklist.items.filter((item) => item.completed)
                .length,
              totalCount: letter.correctionChecklist.items.length,
            }
          : null,
      }),
      checklistId: letter.correctionChecklist?.id ?? null,
      permit: letter.permit,
    }),
  );
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
  const authorized = await getAuthorizedLetter(request, letterId, user.id);
  if (authorized.response) return authorized.response;

  const parsed = PermitCorrectionReviewRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_correction_review' }, { status: 400 });
  }

  const draft = await prisma.permitCorrectionDraft.findUnique({
    where: { permitLetterId: letterId },
  });
  if (!draft) {
    return NextResponse.json({ error: 'correction_draft_not_found' }, { status: 404 });
  }
  if (draft.status === 'confirmed') {
    return NextResponse.json({ error: 'correction_review_already_confirmed' }, { status: 409 });
  }

  const reviewedAt = new Date();
  const updated = await prisma.permitCorrectionDraft.update({
    where: { id: draft.id },
    data: {
      status: parsed.data.action === 'confirm' ? 'confirmed' : 'draft',
      reviewedItems: parsed.data.items,
      reviewedByUserId: user.id,
      reviewedAt,
      confirmedAt: parsed.data.action === 'confirm' ? reviewedAt : null,
    },
  });

  return NextResponse.json(
    PermitCorrectionReviewResponse.parse({ draft: serializeDraft(updated) }),
  );
}
