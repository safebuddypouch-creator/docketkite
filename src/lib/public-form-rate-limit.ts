// @polsia:user-owned — Postgres throttle shared by every instance.
import 'server-only';
import { prisma } from '@/lib/db';

export type RateLimitBucketState = { count: number; resetAt: number };

/**
 * Fixed window starting on the first hit. A later hit increments until `resetAt`.
 * The SQL upsert in `isRateLimited` implements this same transition atomically.
 */
export function nextRateLimitBucket(
  current: RateLimitBucketState | null,
  now: number,
  windowMs: number,
): RateLimitBucketState {
  if (!current || current.resetAt <= now) {
    return { count: 1, resetAt: now + windowMs };
  }
  return { count: current.count + 1, resetAt: current.resetAt };
}

/**
 * Client IP for rate limiting. Prefers the first X-Forwarded-For hop (platform
 * proxy), then X-Real-IP, then a shared unknown bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 128);
  return 'unknown';
}

/**
 * Returns true when this key has already used `max` hits inside `windowMs`.
 * The current call counts toward the window. Counters live in Postgres.
 * A failed write fails closed so a down database cannot open the forms.
 */
export async function isRateLimited(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const safeKey = key.slice(0, 200);
  const nowDate = new Date(now);
  const resetAt = new Date(now + windowMs);

  try {
    // Parameter order is part of the unit-test fake: key, resetAt, now, now, resetAt.
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "rate_limit_bucket" ("key", "count", "resetAt")
      VALUES (${safeKey}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "rate_limit_bucket"."resetAt" <= ${nowDate} THEN 1
          ELSE "rate_limit_bucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "rate_limit_bucket"."resetAt" <= ${nowDate} THEN ${resetAt}
          ELSE "rate_limit_bucket"."resetAt"
        END
      RETURNING "count"
    `;
    const count = Number(rows[0]?.count);
    if (!Number.isFinite(count) || count < 1) return true;
    return count > max;
  } catch {
    return true;
  }
}

/** Clears buckets when a database is available. */
export async function resetPublicFormRateLimits() {
  try {
    await prisma.$executeRaw`DELETE FROM "rate_limit_bucket"`;
  } catch {
    // Unit tests without a database ignore this.
  }
}
