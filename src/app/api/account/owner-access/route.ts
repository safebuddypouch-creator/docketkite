// @polsia:user-owned — grant admin to the configured owner after they present the access code.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  ownerAccessCodeConfigured,
  ownerAccessEligible,
  ownerAccessMatches,
} from '@/lib/owner-access';
import { clientIp, isRateLimited } from '@/lib/public-form-rate-limit';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function GET(request: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  return NextResponse.json({
    eligible:
      Boolean(user.emailVerified) &&
      ownerAccessEligible(user.email) &&
      user.role !== 'admin',
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  // Shared Postgres counter — survives multi-instance deploys (in-memory Maps do not).
  if (
    (await isRateLimited(`owner-access:${user.id}`, MAX_ATTEMPTS, WINDOW_MS)) ||
    (await isRateLimited(`owner-access:ip:${clientIp(request)}`, MAX_ATTEMPTS * 2, WINDOW_MS))
  ) {
    return NextResponse.json({ error: 'owner_access_rate_limited' }, { status: 429 });
  }

  // Claiming the owner address is not enough — the mailbox must be verified.
  if (!user.emailVerified) {
    return NextResponse.json({ error: 'owner_access_email_unverified' }, { status: 403 });
  }

  if (!ownerAccessCodeConfigured()) {
    return NextResponse.json({ error: 'owner_access_unconfigured' }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      ? body.code
      : '';
  if (!ownerAccessMatches(user.email, code)) {
    return NextResponse.json({ error: 'owner_access_denied' }, { status: 403 });
  }

  // Re-check verification in the write so a stale session cookie cannot promote.
  const promoted = await prisma.user.updateMany({
    where: { id: user.id, email: user.email, emailVerified: true },
    data: { role: 'admin' },
  });
  if (promoted.count === 0) {
    return NextResponse.json({ error: 'owner_access_email_unverified' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, role: 'admin' });
}
