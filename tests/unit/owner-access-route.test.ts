// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sameOrigin: vi.fn(),
  configured: vi.fn(),
  matches: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/owner-access', () => ({
  ownerAccessCodeConfigured: mocks.configured,
  ownerAccessMatches: mocks.matches,
}));
vi.mock('@/lib/db', () => ({
  prisma: { user: { update: mocks.updateUser } },
}));

import { POST } from '@/app/api/account/owner-access/route';

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
    mocks.requireAuth.mockResolvedValue({ id: 'owner-user', email: 'owner@example.test' });
    mocks.configured.mockReturnValue(true);
    mocks.matches.mockReturnValue(true);
    mocks.updateUser.mockResolvedValue({ id: 'owner-user', role: 'admin' });
  });

  it('grants admin when the code matches the signed-in owner', async () => {
    const response = await post('correct-horse-battery');
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: 'owner-user' },
      data: { role: 'admin' },
    });
  });

  it('does not grant admin when the code does not match', async () => {
    mocks.matches.mockReturnValue(false);
    const response = await post('wrong-access-code');
    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
