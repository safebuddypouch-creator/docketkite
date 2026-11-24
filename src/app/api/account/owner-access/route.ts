// @polsia:user-owned — grant admin to the configured owner after they present the access code.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  ownerAccessCodeConfigured,
  ownerAccessEligible,
  ownerAccessMatches,
} from '@/lib/owner-access';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';

export const dynamic = 'force-dynamic';

const attempts = new Map<string, { count: number; resetAt: number }>();
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
    eligible: ownerAccessEligible(user.email) && user.role !== 'admin',
  });
}

function limited(userId: string): boolean {
  const now = Date.now();
  const current = attempts.get(userId);
  if (!current || current.resetAt <= now) {
    attempts.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
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

  if (limited(user.id)) {
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
  if (!ownerAccessMatches(user.email, code)) {
    return NextResponse.json({ error: 'owner_access_denied' }, { status: 403 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
  return NextResponse.json({ ok: true, role: 'admin' });
}
