// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
    publicFormRateLimit: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import { clientIp, isRateLimited } from '@/lib/public-form-rate-limit';

describe('public form rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        publicFormRateLimit: {
          findUnique: mocks.findUnique,
          upsert: mocks.upsert,
          update: mocks.update,
        },
      }),
    );
  });

  it('reads the first forwarded hop', () => {
    const request = new Request('http://localhost/api/contact', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('starts a new window when none exists', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({ key: 'contact:1.1.1.1', count: 1 });

    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000, 1_000_000)).resolves.toBe(false);
    expect(mocks.upsert).toHaveBeenCalled();
  });

  it('blocks once the shared counter exceeds max', async () => {
    mocks.findUnique.mockResolvedValue({
      key: 'contact:1.1.1.1',
      count: 2,
      windowStart: new Date(1_000_000),
    });

    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000, 1_000_010)).resolves.toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('fails closed when the database errors', async () => {
    mocks.transaction.mockRejectedValue(new Error('db down'));
    await expect(isRateLimited('contact:1.1.1.1', 2, 60_000)).resolves.toBe(true);
  });
});
