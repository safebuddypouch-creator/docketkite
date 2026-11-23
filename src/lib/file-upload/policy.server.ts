// @polsia:user-owned

import 'server-only';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { UploadRequest } from '@/lib/contracts/file-upload';
import { prisma } from '@/lib/db';
import { getTeamAccessState } from '@/lib/team-access';
import { UploadAuthorization } from '@/modules/file-upload/proxy';

const PERMIT_UPLOAD_SCOPE_COOKIE = 'docketkite_permit_upload_scope';
const PERMIT_UPLOAD_SCOPE_LIFETIME_SECONDS = 1800;
const PermitUploadScope = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1),
  permitId: z.string().min(1),
  intentId: z.string().min(1),
  expiresAt: z.number().int(),
});

type PermitUploadScope = z.infer<typeof PermitUploadScope>;

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  const entry = cookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));
  return entry?.slice(name.length + 1) ?? null;
}

export function readPermitUploadScope(request: Request): PermitUploadScope | null {
  const value = readCookie(request, PERMIT_UPLOAD_SCOPE_COOKIE);
  if (!value) return null;

  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const parsed = PermitUploadScope.safeParse(payload);
    if (!parsed.success || parsed.data.expiresAt <= Date.now()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function permitUploadScopeCookie(
  _request: Request,
  scope: Omit<PermitUploadScope, 'expiresAt'>,
): string {
  const value = Buffer.from(
    JSON.stringify({
      ...scope,
      expiresAt: Date.now() + PERMIT_UPLOAD_SCOPE_LIFETIME_SECONDS * 1000,
    }),
  ).toString('base64url');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PERMIT_UPLOAD_SCOPE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PERMIT_UPLOAD_SCOPE_LIFETIME_SECONDS}${secure}`;
}

export function clearPermitUploadScopeCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PERMIT_UPLOAD_SCOPE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/**
 * The module's upload requests carry no permit id, so the permit API sets a
 * short-lived scope cookie after checking the requested permit. Revalidate the
 * session, membership, permit/team link, one-use upload intent and paid access
 * for every mint and confirm request; a scope cookie alone never grants access.
 */
export async function authorizeUpload(request: Request): Promise<UploadAuthorization> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return UploadAuthorization.Deny;

  const scope = readPermitUploadScope(request);
  if (!scope || scope.userId !== session.user.id) return UploadAuthorization.Deny;

  try {
    const [membership, permit, intent] = await Promise.all([
      prisma.teamMembership.findUnique({
        where: { teamId_userId: { teamId: scope.teamId, userId: session.user.id } },
        select: { id: true, role: true },
      }),
      prisma.permit.findFirst({
        where: { id: scope.permitId, teamId: scope.teamId },
        select: { id: true },
      }),
      prisma.permitUploadIntent.findUnique({ where: { id: scope.intentId } }),
    ]);
    if (
      !membership ||
      !permit ||
      !intent ||
      intent.userId !== session.user.id ||
      intent.teamId !== scope.teamId ||
      intent.permitId !== permit.id ||
      intent.consumedAt !== null ||
      intent.expiresAt.getTime() <= Date.now()
    ) {
      return UploadAuthorization.Deny;
    }

    const path = new URL(request.url).pathname;
    const contentType = request.headers.get('content-type') ?? '';
    if (path.endsWith('/api/upload') && !contentType.startsWith('multipart/form-data')) {
      const uploadRequest = UploadRequest.safeParse(await request.clone().json());
      if (
        !uploadRequest.success ||
        uploadRequest.data.mime_type !== intent.mimeType ||
        uploadRequest.data.size !== intent.size
      ) {
        return UploadAuthorization.Deny;
      }
    }

    const access = await getTeamAccessState(scope.teamId, session.user.id);
    return access.accessActive ? UploadAuthorization.Allow : UploadAuthorization.Deny;
  } catch {
    return UploadAuthorization.Deny;
  }
}
