// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}));

import { clientIp, isRateLimited, nextRateLimitBucket } from '@/lib/public-form-rate-limit';

describe('public form rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the first forwarded hop', () => {
    const request = new Request('http://localhost/api/contact', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('opens a window on the first hit and blocks after max', () => {
    const now = 1_000_000;
    const first = nextRateLimitBucket(null, now, 60_000);
    expect(first).toEqual({ count: 1, resetAt: now + 60_000 });
    const second = nextRateLimitBucket(first, now + 1, 60_000);
    expect(second.count).toBe(2);
    const third = nextRateLimitBucket(second, now + 2, 60_000);
    expect(third.count).toBe(3);
    expect(third.count > 2).toBe(true);
    expect(second.count > 2).toBe(false);
  });

  it('resets after the window', () => {
    const now = 1_000_000;
    const first = nextRateLimitBucket(null, now, 1_000);
    expect(nextRateLimitBucket(first, now + 10, 1_000).count).toBe(2);
    expect(nextRateLimitBucket(first, now + 1_001, 1_000)).toEqual({
      count: 1,
      resetAt: now + 1_001 + 1_000,
    });
  });

  it('allows up to max hits then blocks inside the window', async () => {
    const buckets = new Map<string, { count: number; resetAt: number }>();
    mocks.queryRaw.mockImplementation(async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      const key = String(values[0]);
      const resetAt = values[1] as Date;
      const now = values[2] as Date;
      const next = nextRateLimitBucket(
        buckets.get(key) ?? null,
        now.getTime(),
        resetAt.getTime() - now.getTime(),
      );
      buckets.set(key, next);
      return [{ count: next.count }];
    });

    const now = 1_000_000;
    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now)).resolves.toBe(false);
    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now + 1)).resolves.toBe(false);
    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now + 2)).resolves.toBe(true);
    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now + 60_001)).resolves.toBe(false);
  });

  it('upserts with ON CONFLICT', async () => {
    mocks.queryRaw.mockResolvedValue([{ count: 1 }]);
    await expect(isRateLimited('waitlist:2.2.2.2', 1, 1_000, 1_000_000)).resolves.toBe(false);
    const sql = (mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('INSERT INTO "rate_limit_bucket"');
    expect(sql).toContain('ON CONFLICT ("key") DO UPDATE');
  });

  it('fails closed when the write throws or returns no count', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('db down'));
    await expect(isRateLimited('contact:1.1.1.1', 5, 60_000)).resolves.toBe(true);

    mocks.queryRaw.mockResolvedValue([]);
    await expect(isRateLimited('contact:1.1.1.1', 5, 60_000)).resolves.toBe(true);
  });
});
