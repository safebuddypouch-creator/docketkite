// @polsia:user-owned — permit upload authorization requires active paid team access.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findMembership: vi.fn(),
  findTeam: vi.fn(),
  findUser: vi.fn(),
  findCheckout: vi.fn(),
  findPermit: vi.fn(),
  findIntent: vi.fn(),
  getSubscriptionStatus: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/lib/db', () => ({
  prisma: {
    teamMembership: { findUnique: mocks.findMembership },
    teamSpace: { findUnique: mocks.findTeam },
    user: { findUnique: mocks.findUser },
    teamCheckout: { findFirst: mocks.findCheckout },
    permit: { findFirst: mocks.findPermit },
    permitUploadIntent: { findUnique: mocks.findIntent },
  },
}));
vi.mock('@/lib/stripe-billing/client', () => ({
  getSubscriptionStatus: mocks.getSubscriptionStatus,
}));
vi.mock('@/modules/file-upload/proxy', () => ({
  UploadAuthorization: { Allow: 'allow', Deny: 'deny' },
}));

import { authorizeUpload, permitUploadScopeCookie } from '@/lib/file-upload/policy.server';

function configuredOwnerEmail() {
  const email = process.env.POLSIA_OWNER_EMAIL?.trim();
  if (!email) throw new Error('POLSIA_OWNER_EMAIL must be set for upload access tests.');
  return email;
}

function uploadRequest(userId: string) {
  const scopeCookie = permitUploadScopeCookie(new Request('https://app.example.test'), {
    userId,
    teamId: 'owner-test-team',
    permitId: 'permit-1',
    intentId: 'intent-1',
  });
  const cookie = scopeCookie.split(';')[0];
  if (!cookie) throw new Error('The upload scope cookie was not created.');
  return new Request('https://app.example.test/api/upload', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ filename: 'sample-letter.pdf', mime_type: 'application/pdf', size: 1024 }),
  });
}

function configureDatabase(userId: string, email: string, creatorId: string) {
  mocks.getSession.mockResolvedValue({ user: { id: userId } });
  mocks.findMembership.mockResolvedValue({ id: 'membership-1', role: 'owner' });
  mocks.findPermit.mockResolvedValue({ id: 'permit-1' });
  mocks.findIntent.mockResolvedValue({
    id: 'intent-1',
    userId,
    teamId: 'owner-test-team',
    permitId: 'permit-1',
    mimeType: 'application/pdf',
    size: 1024,
    fileName: 'sample-letter.pdf',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  });
  mocks.findCheckout.mockResolvedValue(null);
  mocks.findUser.mockResolvedValue({ email });
  mocks.findTeam.mockResolvedValue({ createdByUserId: creatorId });
}

describe('permit upload access policy', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('denies the configured app owner on an unpaid team', async () => {
    const ownerEmail = configuredOwnerEmail();
    vi.stubEnv('POLSIA_OWNER_EMAIL', ownerEmail);
    configureDatabase('owner-user', ` ${ownerEmail.toUpperCase()} `, 'owner-user');

    await expect(authorizeUpload(uploadRequest('owner-user'))).resolves.toBe('deny');
    expect(mocks.getSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('denies another signed-in team owner on the same test team', async () => {
    vi.stubEnv('POLSIA_OWNER_EMAIL', configuredOwnerEmail());
    configureDatabase('other-user', 'customer@example.test', 'owner-user');

    await expect(authorizeUpload(uploadRequest('other-user'))).resolves.toBe('deny');
  });
});
