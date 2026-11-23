// @polsia:user-owned — team-scoped correction letter authorization and records.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  PermitLetterAuthorization,
  PermitLetterItem,
  PermitLetterList,
  PermitLetterRequest,
  RegisteredCorrectionLetterFile,
} from '@/lib/contracts/permit-letter';
import { prisma } from '@/lib/db';
import {
  clearPermitUploadScopeCookie,
  permitUploadScopeCookie,
  readPermitUploadScope,
} from '@/lib/file-upload/policy.server';
import { findRegisteredUpload } from '@/lib/file-upload/registered-file.server';
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

function serializeLetter(letter: {
  id: string;
  permitId: string;
  teamId: string;
  uploadId: number;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  correctionDraft?: {
    status: string;
    items: unknown;
    reviewedItems: unknown;
    fieldErrors: unknown;
    extractedAt: Date;
    reviewedAt: Date | null;
    confirmedAt: Date | null;
  } | null;
  correctionChecklist?: {
    id: string;
    permitLetterId: string;
    items: { completed: boolean }[];
  } | null;
}) {
  const { correctionDraft, correctionChecklist, ...details } = letter;
  return PermitLetterItem.parse({
    ...details,
    createdAt: letter.createdAt.toISOString(),
    correctionDraft: correctionDraft
      ? {
          status: correctionDraft.status === 'confirmed' ? 'confirmed' : 'draft',
          items: correctionDraft.reviewedItems ?? correctionDraft.items,
          fieldErrors: correctionDraft.fieldErrors ?? [],
          extractedAt: correctionDraft.extractedAt.toISOString(),
          reviewedAt: correctionDraft.reviewedAt?.toISOString() ?? null,
          confirmedAt: correctionDraft.confirmedAt?.toISOString() ?? null,
        }
      : null,
    correctionChecklist: correctionChecklist
      ? {
          id: correctionChecklist.id,
          sourceLetterId: correctionChecklist.permitLetterId,
          completedCount: correctionChecklist.items.filter((item) => item.completed).length,
          totalCount: correctionChecklist.items.length,
        }
      : null,
  });
}

export async function GET(request: Request) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const teamId = new URL(request.url).searchParams.get('teamId') ?? '';
  if (!teamId) return NextResponse.json({ error: 'team_id_required' }, { status: 400 });

  const access = await requireTeamAccess(teamId, user.id);
  if (access.response) return access.response;

  try {
    const letters = await prisma.permitLetter.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      include: {
        correctionDraft: true,
        correctionChecklist: {
          select: {
            id: true,
            permitLetterId: true,
            items: { select: { completed: true } },
          },
        },
      },
    });
    return NextResponse.json(PermitLetterList.parse({ items: letters.map(serializeLetter) }));
  } catch {
    return NextResponse.json({ error: 'Could not load permit letters' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const user = await getUser(request);
  if (user instanceof Response) return user;

  const body = await request.json().catch(() => null);
  const parsed = PermitLetterRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_permit_letter_request' }, { status: 400 });
  }

  const access = await requireTeamAccess(parsed.data.teamId, user.id);
  if (access.response) return access.response;

  try {
    const permit = await prisma.permit.findFirst({
      where: { id: parsed.data.permitId, teamId: parsed.data.teamId },
      select: { id: true },
    });
    if (!permit) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    if (parsed.data.action === 'authorize') {
      const uploadDetails = parsed.data.file;
      if (!uploadDetails) {
        return NextResponse.json({ error: 'upload_details_required' }, { status: 400 });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
      await prisma.permitUploadIntent.deleteMany({
        where: { userId: user.id, expiresAt: { lte: now } },
      });
      const intent = await prisma.permitUploadIntent.create({
        data: {
          userId: user.id,
          teamId: parsed.data.teamId,
          permitId: permit.id,
          fileName: uploadDetails.filename,
          mimeType: uploadDetails.mime_type,
          size: uploadDetails.size,
          expiresAt,
        },
      });

      return NextResponse.json(PermitLetterAuthorization.parse({ authorized: true }), {
        headers: {
          'set-cookie': permitUploadScopeCookie(request, {
            userId: user.id,
            teamId: parsed.data.teamId,
            permitId: permit.id,
            intentId: intent.id,
          }),
        },
      });
    }

    const scope = readPermitUploadScope(request);
    if (
      !scope ||
      scope.userId !== user.id ||
      scope.teamId !== parsed.data.teamId ||
      scope.permitId !== permit.id
    ) {
      return NextResponse.json({ error: 'permit_upload_authorization_required' }, { status: 403 });
    }

    const intent = await prisma.permitUploadIntent.findUnique({ where: { id: scope.intentId } });
    if (
      !intent ||
      intent.userId !== user.id ||
      intent.teamId !== parsed.data.teamId ||
      intent.permitId !== permit.id ||
      intent.consumedAt !== null ||
      intent.expiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: 'permit_upload_intent_required' }, { status: 403 });
    }
    if (intent.confirmedFileId !== parsed.data.uploadId) {
      return NextResponse.json({ error: 'upload_not_confirmed_for_intent' }, { status: 422 });
    }

    const registered = await findRegisteredUpload(parsed.data.uploadId);
    if (registered.status === 'unavailable') {
      return NextResponse.json({ error: 'upload_verification_unavailable' }, { status: 503 });
    }
    if (registered.status === 'not_registered') {
      return NextResponse.json({ error: 'upload_not_registered' }, { status: 422 });
    }
    const file = registered.file;
    const validLetter = RegisteredCorrectionLetterFile.safeParse(file);
    if (
      !validLetter.success ||
      validLetter.data.id !== parsed.data.uploadId ||
      validLetter.data.filename !== intent.fileName ||
      validLetter.data.mime_type !== intent.mimeType ||
      validLetter.data.size !== intent.size
    ) {
      return NextResponse.json({ error: 'invalid_correction_letter' }, { status: 422 });
    }

    const letter = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.permitUploadIntent.updateMany({
        where: {
          id: intent.id,
          userId: user.id,
          teamId: parsed.data.teamId,
          permitId: permit.id,
          confirmedFileId: file.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) return null;

      return transaction.permitLetter.create({
        data: {
          permitId: permit.id,
          teamId: parsed.data.teamId,
          uploadedByUserId: user.id,
          uploadId: file.id,
          fileKey: file.key,
          fileUrl: validLetter.data.url,
          fileName: file.filename,
          mimeType: validLetter.data.mime_type,
          size: file.size,
        },
      });
    });
    if (!letter) {
      return NextResponse.json({ error: 'permit_upload_intent_consumed' }, { status: 409 });
    }
    return NextResponse.json(serializeLetter(letter), {
      status: 201,
      headers: { 'set-cookie': clearPermitUploadScopeCookie() },
    });
  } catch {
    return NextResponse.json({ error: 'Could not save this permit letter' }, { status: 500 });
  }
}
