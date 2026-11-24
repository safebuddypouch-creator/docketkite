// @polsia:user-owned — paid-team access to the original permit letter.
import 'server-only';
import { NextResponse } from 'next/server';
import { readStoredUploadBytes } from '@/lib/business/stored-upload';
import {
  MAX_CORRECTION_LETTER_SIZE_BYTES,
  PermitLetterSourceRequest,
} from '@/lib/contracts/permit-letter';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { requireTeamAccess } from '@/lib/team-access';

async function getUser(request: Request): Promise<SessionUser | Response> {
  try {
    return await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
}

function unavailable(): Response {
  return NextResponse.json(
    { error: 'letter_source_unavailable', message: 'The original letter could not be opened.' },
    { status: 502 },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ letterId: string }> }) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const input = PermitLetterSourceRequest.safeParse(query);
  if (!input.success) {
    return NextResponse.json({ error: 'invalid_source_request' }, { status: 400 });
  }

  const access = await requireTeamAccess(input.data.teamId, user.id);
  if (access.response) return access.response;

  const { letterId } = await params;
  const letter = await prisma.permitLetter.findFirst({
    where: {
      id: letterId,
      teamId: input.data.teamId,
      permitId: input.data.permitId,
    },
    select: { uploadId: true, fileUrl: true, fileName: true, mimeType: true, size: true },
  });
  if (!letter) return NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 });
  if (letter.size > MAX_CORRECTION_LETTER_SIZE_BYTES) {
    return NextResponse.json({ error: 'letter_source_too_large' }, { status: 413 });
  }

  const stored = await readStoredUploadBytes(letter.uploadId);
  if (stored) {
    const headers = new Headers({
      'cache-control': 'private, no-store',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(stored.fileName)}`,
      'content-type': stored.mimeType,
      'content-length': String(stored.size),
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    });
    return new Response(new Uint8Array(stored.bytes), { headers });
  }

  // Legacy letters uploaded through Polsia R2 before local storage.
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(letter.fileUrl);
  } catch {
    return unavailable();
  }
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) {
    return unavailable();
  }
  if (sourceUrl.hostname === 'files.docketkitepermits.com') {
    return unavailable();
  }

  let source: Response;
  try {
    source = await fetch(sourceUrl, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return unavailable();
  }
  if (!source.ok || !source.body) return unavailable();

  const headers = new Headers({
    'cache-control': 'private, no-store',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(letter.fileName)}`,
    'content-type': letter.mimeType,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
  });
  return new Response(source.body, { headers });
}
