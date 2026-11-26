// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({ email: 'owner@example.test' as string | undefined }));
const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  deleteSessions: vi.fn(),
  deleteAccounts: vi.fn(),
  deleteVerifications: vi.fn(),
  deleteUser: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    get POLSIA_OWNER_EMAIL() {
      return envState.email;
    },
  },
}));
vi.mock('@/lib/db', () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { releaseUnverifiedOwnerMailbox } from '@/lib/owner-mailbox-release';

const tx = {
  $queryRaw: mocks.queryRaw,
  user: { findUnique: mocks.findUnique, delete: mocks.deleteUser },
  session: { deleteMany: mocks.deleteSessions },
  account: { deleteMany: mocks.deleteAccounts },
  verification: { deleteMany: mocks.deleteVerifications },
};

describe('unverified owner mailbox release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.email = 'owner@example.test';
    mocks.transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
    mocks.queryRaw.mockResolvedValue([{ id: 'squatter', email: 'owner@example.test' }]);
    mocks.findUnique.mockResolvedValue({
      id: 'squatter',
      email: 'owner@example.test',
      emailVerified: false,
    });
    mocks.deleteSessions.mockResolvedValue({ count: 1 });
    mocks.deleteAccounts.mockResolvedValue({ count: 1 });
    mocks.deleteVerifications.mockResolvedValue({ count: 1 });
    mocks.deleteUser.mockResolvedValue({ id: 'squatter' });
  });

  it('ignores every address except the configured owner', async () => {
    await releaseUnverifiedOwnerMailbox('other@example.test');
    envState.email = undefined;
    await releaseUnverifiedOwnerMailbox('owner@example.test');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('deletes only an unverified owner, plus sessions, accounts, and verification rows', async () => {
    await releaseUnverifiedOwnerMailbox(' OWNER@example.test ');

    const sql = (mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('"emailVerified" = false');
    expect(sql).toContain('FOR UPDATE');
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { userId: 'squatter' } });
    expect(mocks.deleteAccounts).toHaveBeenCalledWith({ where: { userId: 'squatter' } });
    expect(mocks.deleteVerifications).toHaveBeenCalledWith({
      where: {
        OR: [
          { identifier: { equals: 'owner@example.test', mode: 'insensitive' } },
          { identifier: { endsWith: ':owner@example.test', mode: 'insensitive' } },
          { identifier: { endsWith: '-owner@example.test', mode: 'insensitive' } },
          { value: 'squatter' },
        ],
      },
    });
    expect(mocks.deleteUser).toHaveBeenCalledWith({ where: { id: 'squatter' } });
  });

  it('never deletes a verified owner', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'owner',
      email: 'owner@example.test',
      emailVerified: true,
    });
    await releaseUnverifiedOwnerMailbox('owner@example.test');
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.deleteSessions).not.toHaveBeenCalled();
    expect(mocks.deleteVerifications).not.toHaveBeenCalled();
  });

  it('ignores a second concurrent delete', async () => {
    mocks.deleteUser.mockRejectedValue({ code: 'P2025' });
    await expect(releaseUnverifiedOwnerMailbox('owner@example.test')).resolves.toBeUndefined();
  });

  it('surfaces other database failures', async () => {
    mocks.deleteUser.mockRejectedValue(new Error('db down'));
    await expect(releaseUnverifiedOwnerMailbox('owner@example.test')).rejects.toThrow('db down');
  });
});
