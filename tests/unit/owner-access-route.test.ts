// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sameOrigin: vi.fn(),
  configured: vi.fn(),
  eligible: vi.fn(),
  matches: vi.fn(),
  updateMany: vi.fn(),
  isRateLimited: vi.fn(),
  clientIp: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/owner-access', () => ({
  ownerAccessCodeConfigured: mocks.configured,
  ownerAccessEligible: mocks.eligible,
  ownerAccessMatches: mocks.matches,
}));
vi.mock('@/lib/public-form-rate-limit', () => ({
  isRateLimited: mocks.isRateLimited,
  clientIp: mocks.clientIp,
}));
vi.mock('@/lib/db', () => ({
  prisma: { user: { updateMany: mocks.updateMany } },
}));

import { GET, POST } from '@/app/api/account/owner-access/route';

function post(code: string) {
  return POST(
    new Request('https://docketkite.apps.grok.bot/api/account/owner-access', {
      method: 'POST',
      headers: { origin: 'https://docketkite.apps.grok.bot', 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  );
}

describe('owner access route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sameOrigin.mockReturnValue(true);
    mocks.requireAuth.mockResolvedValue({
      id: 'owner-user',
      email: 'owner@example.test',
      role: 'user',
      emailVerified: true,
    });
    mocks.configured.mockReturnValue(true);
    mocks.eligible.mockReturnValue(true);
    mocks.matches.mockReturnValue(true);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.clientIp.mockReturnValue('203.0.113.10');
  });

  it('tells only the verified configured owner that the form applies', async () => {
    const response = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ eligible: true });

    mocks.requireAuth.mockResolvedValue({
      id: 'owner-user',
      email: 'owner@example.test',
      role: 'user',
      emailVerified: false,
    });
    const unverified = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    await expect(unverified.json()).resolves.toEqual({ eligible: false });

    mocks.requireAuth.mockResolvedValue({
      id: 'owner-user',
      email: 'owner@example.test',
      role: 'user',
      emailVerified: true,
    });
    mocks.eligible.mockReturnValue(false);
    const invited = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    await expect(invited.json()).resolves.toEqual({ eligible: false });
  });

  it('grants admin when the verified owner presents the matching code', async () => {
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'owner-user', email: 'owner@example.test', emailVerified: true },
      data: { role: 'admin' },
    });
    expect(mocks.isRateLimited).toHaveBeenCalledWith('owner-access:owner-user', 5, 15 * 60 * 1000);
  });

  it('does not grant admin when the email is not verified', async () => {
    mocks.requireAuth.mockResolvedValue({
      id: 'owner-user',
      email: 'owner@example.test',
      role: 'user',
      emailVerified: false,
    });
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'owner_access_email_unverified' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('does not grant admin when the code does not match', async () => {
    mocks.matches.mockReturnValue(false);
    const response = await post('wrong-access-code');
    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects when the shared rate limit is exhausted', async () => {
    mocks.isRateLimited.mockResolvedValueOnce(true);
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'owner_access_rate_limited' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
