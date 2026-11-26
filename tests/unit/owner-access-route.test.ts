// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sameOrigin: vi.fn(),
  configured: vi.fn(),
  eligible: vi.fn(),
  matches: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  isRateLimited: vi.fn(),
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
}));
vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));

import { GET, POST } from '@/app/api/account/owner-access/route';

const storedOwner = {
  id: 'owner-user',
  email: 'owner@example.test',
  emailVerified: true,
  role: 'user',
};

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
      email: 'session-can-be-stale@example.test',
      role: 'admin',
      emailVerified: false,
    });
    mocks.configured.mockReturnValue(true);
    mocks.eligible.mockImplementation((email: string) => email === 'owner@example.test');
    mocks.matches.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue(storedOwner);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.isRateLimited.mockResolvedValue(false);
  });

  it('tells only a verified non-admin owner that the form applies', async () => {
    const response = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eligible: true,
      needsVerification: false,
    });

    mocks.findUnique.mockResolvedValue({ ...storedOwner, role: 'admin' });
    const alreadyAdmin = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    await expect(alreadyAdmin.json()).resolves.toEqual({
      eligible: false,
      needsVerification: false,
    });

    mocks.findUnique.mockResolvedValue({ ...storedOwner, email: 'teammate@example.test' });
    const invited = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    const body = await invited.json();
    expect(body).toEqual({ eligible: false, needsVerification: false });
    expect(body).not.toHaveProperty('email');
  });

  it('asks the unverified owner to verify and hides the code form', async () => {
    mocks.findUnique.mockResolvedValue({ ...storedOwner, emailVerified: false });
    const response = await GET(
      new Request('https://docketkite.apps.grok.bot/api/account/owner-access'),
    );
    await expect(response.json()).resolves.toEqual({
      eligible: false,
      needsVerification: true,
    });
  });

  it('grants admin only when the stored mailbox is verified', async () => {
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'owner-user', email: 'owner@example.test', emailVerified: true },
      data: { role: 'admin' },
    });
    expect(mocks.isRateLimited).toHaveBeenCalledWith('owner-access:owner-user', 5, 15 * 60 * 1000);
  });

  it('refuses an unverified stored user even when the session says otherwise', async () => {
    mocks.requireAuth.mockResolvedValue({
      id: 'owner-user',
      email: 'owner@example.test',
      role: 'user',
      emailVerified: true,
    });
    mocks.findUnique.mockResolvedValue({ ...storedOwner, emailVerified: false });
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'owner_access_email_unverified' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.matches).not.toHaveBeenCalled();
  });

  it('does not promote when the verified write matches no row', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'owner_access_email_unverified' });
  });

  it('does not grant admin when the code does not match', async () => {
    mocks.matches.mockReturnValue(false);
    const response = await post('wrong-access-code');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'owner_access_denied' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rate limits before reading the account', async () => {
    mocks.isRateLimited.mockResolvedValue(true);
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(429);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
