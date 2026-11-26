// @polsia:user-owned — grant admin to the configured owner after they present the access code.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  ownerAccessCodeConfigured,
  ownerAccessEligible,
  ownerAccessMatches,
} from '@/lib/owner-access';
import { isRateLimited } from '@/lib/public-form-rate-limit';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const denied = () => NextResponse.json({ error: 'owner_access_denied' }, { status: 403 });
const unverified = () =>
  NextResponse.json({ error: 'owner_access_email_unverified' }, { status: 403 });

async function storedUser(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, emailVerified: true, role: true },
  });
}

export async function GET(request: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const stored = await storedUser(user.id);
  const emailMatches = stored ? ownerAccessEligible(stored.email) : false;
  const verified = Boolean(stored?.emailVerified);
  return NextResponse.json({
    eligible: emailMatches && verified && stored?.role !== 'admin',
    needsVerification: emailMatches && !verified,
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

  if (await isRateLimited(`owner-access:${user.id}`, MAX_ATTEMPTS, WINDOW_MS)) {
    return NextResponse.json({ error: 'owner_access_rate_limited' }, { status: 429 });
  }

  if (!ownerAccessCodeConfigured()) {
    return NextResponse.json({ error: 'owner_access_unconfigured' }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      ? body.code
      : '';

  const stored = await storedUser(user.id);
  if (!stored || !ownerAccessEligible(stored.email)) return denied();
  // The session flag is not proof. Only a persisted verified mailbox can be promoted.
  if (!stored.emailVerified) return unverified();
  if (!ownerAccessMatches(stored.email, code)) return denied();

  const promoted = await prisma.user.updateMany({
    where: { id: stored.id, email: stored.email, emailVerified: true },
    data: { role: 'admin' },
  });
  if (promoted.count !== 1) return unverified();
  return NextResponse.json({ ok: true, role: 'admin' });
}
