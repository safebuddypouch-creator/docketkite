// @polsia:user-owned — bind completed file-module uploads to one permit intent.
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  UploadConfirmResponse,
  type UploadRequest,
  UploadTicket,
} from '@/lib/contracts/file-upload';
import {
  PermitLetterUploadReceipt,
  RegisteredCorrectionLetterFile,
} from '@/lib/contracts/permit-letter';
import { prisma } from '@/lib/db';
import { authorizeUpload, readPermitUploadScope } from '@/lib/file-upload/policy.server';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import {
  confirmUpload,
  isMultipartUpload,
  mintUpload,
  readUploadBody,
  relayMultipart,
  UploadAuthorization,
} from '@/modules/file-upload/proxy';

export const dynamic = 'force-dynamic';

const UploadAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mint') }),
  z.object({ action: z.literal('confirm'), upload_id: z.string().min(1).max(4096) }),
]);

const NO_STORE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
const INTENT_LIFETIME_MS = 30 * 60 * 1000;

type UploadIntent = NonNullable<Awaited<ReturnType<typeof prisma.permitUploadIntent.findUnique>>>;

function hashUploadId(uploadId: string): string {
  return createHash('sha256').update(uploadId).digest('hex');
}

function matchesHash(storedHash: string | null, uploadId: string): boolean {
  if (!storedHash || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(
    Buffer.from(storedHash, 'hex'),
    Buffer.from(hashUploadId(uploadId), 'hex'),
  );
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

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
        { status: 403 },
      ),
    };
  }
  if ((await authorizeUpload(request)) !== UploadAuthorization.Allow) {
    return { response: NextResponse.json({ error: 'upload_not_authorized' }, { status: 401 }) };
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
      response: NextResponse.json({ error: 'permit_upload_intent_required' }, { status: 403 }),
    };
  }
  return { user, intent };
}

function parseConfirmedFile(payload: unknown, intent: UploadIntent) {
  const confirmed = UploadConfirmResponse.safeParse(payload);
  if (!confirmed.success) return null;
  const file = RegisteredCorrectionLetterFile.safeParse(confirmed.data.file);
  if (
    !file.success ||
    file.data.filename !== intent.fileName ||
    file.data.mime_type !== intent.mimeType ||
    file.data.size !== intent.size
  ) {
    return null;
  }
  return file.data;
}

async function saveConfirmedFile(
  intent: UploadIntent,
  fileId: number,
  uploadIdHash: string | null,
) {
  return prisma.permitUploadIntent.updateMany({
    where: {
      id: intent.id,
      userId: intent.userId,
      teamId: intent.teamId,
      permitId: intent.permitId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      uploadIdHash,
      confirmedFileId: null,
    },
    data: { confirmedFileId: fileId },
  });
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
  const { intent } = authorized;

  try {
    if (isMultipartUpload(request)) {
      if (intent.uploadIdHash !== null || intent.confirmedFileId !== null) {
        return NextResponse.json(
          { error: 'upload_intent_already_used' },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      const upstream = await relayMultipart(request);
      const payload = await responseBody(upstream);
      if (!upstream.ok) {
        return NextResponse.json(payload, { status: upstream.status, headers: NO_STORE_HEADERS });
      }
      const file = parseConfirmedFile(payload, intent);
      if (!file) {
        return NextResponse.json(
          { error: 'invalid_correction_letter' },
          { status: 422, headers: NO_STORE_HEADERS },
        );
      }
      const saved = await saveConfirmedFile(intent, file.id, null);
      if (saved.count !== 1) {
        return NextResponse.json(
          { error: 'permit_upload_intent_consumed' },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(PermitLetterUploadReceipt.parse({ fileId: file.id }), {
        headers: NO_STORE_HEADERS,
      });
    }

    const parsed = await readUploadBody(request, UploadAction);
    if (parsed instanceof Response) return parsed;

    if (parsed.action === 'mint') {
      const input: UploadRequest = {
        filename: intent.fileName,
        mime_type: intent.mimeType,
        size: intent.size,
      };
      const upstream = await mintUpload(input);
      const payload = await responseBody(upstream);
      if (!upstream.ok) {
        return NextResponse.json(payload, { status: upstream.status, headers: NO_STORE_HEADERS });
      }
      const ticket = UploadTicket.safeParse(payload);
      if (!ticket.success) {
        return NextResponse.json(
          { error: 'invalid_upload_ticket' },
          { status: 502, headers: NO_STORE_HEADERS },
        );
      }
      const uploadIdHash = hashUploadId(ticket.data.upload_id);
      const saved = await prisma.permitUploadIntent.updateMany({
        where: {
          id: intent.id,
          userId: intent.userId,
          teamId: intent.teamId,
          permitId: intent.permitId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { uploadIdHash, confirmedFileId: null },
      });
      if (saved.count !== 1) {
        return NextResponse.json(
          { error: 'permit_upload_intent_consumed' },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(ticket.data, { headers: NO_STORE_HEADERS });
    }

    if (intent.uploadIdHash === null || !matchesHash(intent.uploadIdHash, parsed.upload_id)) {
      return NextResponse.json(
        { error: 'upload_ticket_not_authorized' },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (intent.confirmedFileId !== null) {
      return NextResponse.json(
        PermitLetterUploadReceipt.parse({ fileId: intent.confirmedFileId }),
        { headers: NO_STORE_HEADERS },
      );
    }

    const upstream = await confirmUpload({ upload_id: parsed.upload_id });
    const payload = await responseBody(upstream);
    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status, headers: NO_STORE_HEADERS });
    }
    const file = parseConfirmedFile(payload, intent);
    if (!file) {
      return NextResponse.json(
        { error: 'invalid_correction_letter' },
        { status: 422, headers: NO_STORE_HEADERS },
      );
    }
    const saved = await saveConfirmedFile(intent, file.id, intent.uploadIdHash);
    if (saved.count !== 1) {
      return NextResponse.json(
        { error: 'permit_upload_intent_consumed' },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(PermitLetterUploadReceipt.parse({ fileId: file.id }), {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not complete this permit letter upload' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
