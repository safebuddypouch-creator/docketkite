// @polsia:user-owned — Postgres-backed throttle for public contact/waitlist POSTs.
import 'server-only';
import { prisma } from '@/lib/db';

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
 * Counters live in Postgres so every instance shares the same budget.
 * On DB failure, fail closed (treat as limited) so public forms cannot burn
 * email/API quota while the limiter is down.
 */
export async function isRateLimited(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const safeKey = key.slice(0, 190);
  const windowStart = new Date(now);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.publicFormRateLimit.findUnique({ where: { key: safeKey } });
      if (!existing || existing.windowStart.getTime() + windowMs <= now) {
        await tx.publicFormRateLimit.upsert({
          where: { key: safeKey },
          create: { key: safeKey, count: 1, windowStart },
          update: { count: 1, windowStart },
        });
        return false;
      }
      if (existing.count >= max) {
        return true;
      }
      const updated = await tx.publicFormRateLimit.update({
        where: { key: safeKey },
        data: { count: { increment: 1 } },
      });
      return updated.count > max;
    });
  } catch {
    return true;
  }
}

/** Test helper — clears all buckets when a DB is available. */
export async function resetPublicFormRateLimits() {
  try {
    await prisma.publicFormRateLimit.deleteMany();
  } catch {
    // Unit tests without a DB ignore this.
  }
}
