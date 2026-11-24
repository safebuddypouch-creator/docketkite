// @polsia:user-owned — store permit letter bytes in Postgres (no Polsia R2).
import 'server-only';
import { NextResponse } from 'next/server';
import {
  MAX_CORRECTION_LETTER_SIZE_BYTES,
  CorrectionLetterMimeType,
  PermitLetterUploadReceipt,
} from '@/lib/contracts/permit-letter';
import { prisma } from '@/lib/db';
import { storeUploadBytes } from '@/lib/business/stored-upload';
import { authorizeUpload, readPermitUploadScope } from '@/lib/file-upload/policy.server';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { UploadAuthorization } from '@/modules/file-upload/proxy';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
const INTENT_LIFETIME_MS = 30 * 60 * 1000;

type UploadIntent = NonNullable<Awaited<ReturnType<typeof prisma.permitUploadIntent.findUnique>>>;

async function getAuthorizedIntent(
  request: Request,
): Promise<{ user: SessionUser; intent: UploadIntent } | { response: Response }> {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return { response: response as Response };
  }

  const scope = readPermitUploadScope(request);
  if (!scope || scope.userId !== user.id) {
    return {
      response: NextResponse.json(
        { error: 'permit_upload_authorization_required' },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if ((await authorizeUpload(request)) !== UploadAuthorization.Allow) {
    return {
      response: NextResponse.json(
        { error: 'upload_not_authorized' },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }

  const intent = await prisma.permitUploadIntent.findUnique({ where: { id: scope.intentId } });
  if (
    !intent ||
    intent.userId !== user.id ||
    intent.teamId !== scope.teamId ||
    intent.permitId !== scope.permitId ||
    intent.consumedAt !== null ||
    intent.expiresAt.getTime() <= Date.now() ||
    intent.expiresAt.getTime() > Date.now() + INTENT_LIFETIME_MS
  ) {
    return {
      response: NextResponse.json(
        { error: 'permit_upload_intent_required' },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { user, intent };
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: 'forbidden_origin' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const authorized = await getAuthorizedIntent(request);
  if ('response' in authorized) return authorized.response;
  const { user, intent } = authorized;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    // Old mint/confirm clients: force the multipart path.
    return NextResponse.json(
      {
        error: {
          code: 'direct_upload_disabled',
          message: 'Upload the letter as a multipart form file.',
        },
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  if (intent.uploadIdHash !== null || intent.confirmedFileId !== null) {
    return NextResponse.json(
      { error: 'upload_intent_already_used' },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'missing_file', message: 'Choose a letter file to upload.' } },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (file.name !== intent.fileName || file.type !== intent.mimeType || file.size !== intent.size) {
      return NextResponse.json(
        { error: { code: 'upload_changed', message: 'The letter file no longer matches the approved upload.' } },
        { status: 422, headers: NO_STORE_HEADERS },
      );
    }
    const mime = CorrectionLetterMimeType.safeParse(file.type);
    if (!mime.success) {
      return NextResponse.json(
        { error: { code: 'invalid_file_type', message: 'Use a PDF, JPG, PNG, WebP, DOCX, or plain-text letter.' } },
        { status: 415, headers: NO_STORE_HEADERS },
      );
    }
    if (file.size > MAX_CORRECTION_LETTER_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: 'file_too_large',
            message: 'This letter is too large to upload.',
            max_size: MAX_CORRECTION_LETTER_SIZE_BYTES,
          },
        },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await storeUploadBytes({
      userId: user.id,
      teamId: intent.teamId,
      filename: intent.fileName,
      mimeType: intent.mimeType,
      bytes,
    });

    const saved = await prisma.permitUploadIntent.updateMany({
      where: {
        id: intent.id,
        userId: intent.userId,
        teamId: intent.teamId,
        permitId: intent.permitId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        uploadIdHash: null,
        confirmedFileId: null,
      },
      data: { confirmedFileId: stored.id },
    });
    if (saved.count !== 1) {
      return NextResponse.json(
        { error: 'permit_upload_intent_consumed' },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(PermitLetterUploadReceipt.parse({ fileId: stored.id }), {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not complete this permit letter upload' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
