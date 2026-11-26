// @polsia:user-owned — in-process IP throttle for public contact/waitlist POSTs.
import 'server-only';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Drop stale buckets occasionally so the map cannot grow without bound. */
function prune(now: number) {
  if (buckets.size < 2_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
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
 * The current call counts toward the window.
 */
export function isRateLimited(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  prune(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > max;
}

/** Test helper — clears all buckets. */
export function resetPublicFormRateLimits() {
  buckets.clear();
}
