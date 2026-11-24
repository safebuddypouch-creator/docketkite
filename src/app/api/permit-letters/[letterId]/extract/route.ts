// @polsia:user-owned — paid-team extraction of correction-item drafts.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  extractCorrectionItems,
  LetterExtractFailedError,
  LetterExtractNotConfiguredError,
} from '@/lib/business/letter-extract';
import { readStoredUploadBytes } from '@/lib/business/stored-upload';
import {
  PermitCorrectionDraftResponse,
  PermitLetterExtractRequest,
} from '@/lib/contracts/permit-letter';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { requireTeamAccess } from '@/lib/team-access';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PARSEABLE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

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
  });
}

function parseError(error: unknown): Response {
  if (error instanceof LetterExtractNotConfiguredError) {
    return NextResponse.json(
      {
        error: 'parsing_unavailable',
        message: 'Document parsing is not configured for this app yet.',
      },
      { status: 503 },
    );
  }
  if (error instanceof LetterExtractFailedError) {
    return NextResponse.json(
      {
        error: 'document_parse_failed',
        message: error.message,
      },
      { status: 422 },
    );
  }
  return NextResponse.json(
    {
      error: 'document_parse_failed',
      message: 'Could not extract correction items. Try again or review the letter manually.',
    },
    { status: 502 },
  );
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

  const body = await request.json().catch(() => null);
  const input = PermitLetterExtractRequest.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: 'invalid_extraction_request' }, { status: 400 });
  }

  const access = await requireTeamAccess(input.data.teamId, user.id);
  if (access.response) return access.response;

  const { letterId } = await params;
  const letter = await prisma.permitLetter.findFirst({
    where: { id: letterId, permitId: input.data.permitId, teamId: input.data.teamId },
    include: { correctionDraft: true },
  });
  if (!letter) return NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 });

  if (letter.correctionDraft) {
    return NextResponse.json(serializeDraft(letter.correctionDraft));
  }
  if (!PARSEABLE_MIME_TYPES.has(letter.mimeType)) {
    return NextResponse.json(
      {
        error: 'unsupported_document',
        message:
          'Extraction supports PDF, JPG, PNG, or WebP letters. This file is still attached for manual review.',
      },
      { status: 415 },
    );
  }
  if (letter.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: 'unsupported_document', message: 'Extraction supports letters up to 20 MB.' },
      { status: 413 },
    );
  }

  const stored = await readStoredUploadBytes(letter.uploadId);
  if (!stored) {
    return NextResponse.json(
      {
        error: 'document_parse_failed',
        message: 'The original letter file is no longer available for extraction.',
      },
      { status: 422 },
    );
  }

  try {
    const result = await extractCorrectionItems({
      bytes: stored.bytes,
      mimeType: letter.mimeType,
      fileName: letter.fileName,
    });
    const extractedItems = result.fields.items;
    const items = extractedItems.flatMap((item) => {
      const action = item.action?.trim();
      if (!action) return [];
      return [
        {
          id: randomUUID(),
          action,
          location: item.location?.trim() || null,
          planReference: item.planReference?.trim() || null,
        },
      ];
    });
    if (extractedItems.length > 0 && items.length === 0) {
      return NextResponse.json(
        {
          error: 'correction_items_unavailable',
          message:
            'No usable correction items could be read. Review the letter manually or try another copy.',
        },
        { status: 422 },
      );
    }
    if (items.length === 0 && result.fieldErrors.length === 0) {
      return NextResponse.json(
        {
          error: 'correction_items_unavailable',
          message:
            'No usable correction items could be read. Review the letter manually or try another copy.',
        },
        { status: 422 },
      );
    }

    const fieldErrors = [
      ...result.fieldErrors,
      ...extractedItems.flatMap((item, index) =>
        item.action?.trim()
          ? []
          : [
              {
                path: `items.${index}.action`,
                message: 'Correction request text could not be read.',
              },
            ],
      ),
    ];

    let draft: {
      status: string;
      items: unknown;
      reviewedItems: unknown;
      fieldErrors: unknown;
      extractedAt: Date;
      reviewedAt: Date | null;
      confirmedAt: Date | null;
    };
    try {
      draft = await prisma.permitCorrectionDraft.create({
        data: {
          permitLetterId: letter.id,
          createdByUserId: user.id,
          items,
          fieldErrors,
        },
        select: {
          status: true,
          items: true,
          reviewedItems: true,
          fieldErrors: true,
          extractedAt: true,
          reviewedAt: true,
          confirmedAt: true,
        },
      });
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002')
        throw error;
      const existing = await prisma.permitCorrectionDraft.findUnique({
        where: { permitLetterId: letter.id },
        select: {
          status: true,
          items: true,
          reviewedItems: true,
          fieldErrors: true,
          extractedAt: true,
          reviewedAt: true,
          confirmedAt: true,
        },
      });
      if (!existing) throw error;
      draft = existing;
    }

    return NextResponse.json(serializeDraft(draft));
  } catch (error) {
    return parseError(error);
  }
}
