// @polsia:user-owned — team creation and joining preserve the persisted trial window.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sameOrigin: vi.fn(),
  getTeamAccessState: vi.fn(),
  transaction: vi.fn(),
  createTeam: vi.fn(),
  findTeam: vi.fn(),
  createMembership: vi.fn(),
  upsertMembership: vi.fn(),
  findMembership: vi.fn(),
  updatePermits: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
    teamSpace: { create: mocks.createTeam, findUnique: mocks.findTeam },
    teamMembership: {
      create: mocks.createMembership,
      upsert: mocks.upsertMembership,
      findUnique: mocks.findMembership,
    },
    permit: { updateMany: mocks.updatePermits },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/team-access', () => ({ getTeamAccessState: mocks.getTeamAccessState }));

import { POST } from '@/app/api/teams/route';

type TeamTransaction = {
  teamSpace: { create: typeof mocks.createTeam };
  teamMembership: { create: typeof mocks.createMembership; upsert: typeof mocks.upsertMembership };
  permit: { updateMany: typeof mocks.updatePermits };
};

const transaction: TeamTransaction = {
  teamSpace: { create: mocks.createTeam },
  teamMembership: { create: mocks.createMembership, upsert: mocks.upsertMembership },
  permit: { updateMany: mocks.updatePermits },
};

function post(body: unknown) {
  return new Request('http://localhost/api/teams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('team trial persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.transaction.mockImplementation(
      async (callback: (tx: TeamTransaction) => Promise<unknown>) => callback(transaction),
    );
    mocks.createTeam.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'team-new',
      ...data,
    }));
    mocks.findTeam.mockImplementation(async () => {
      const call = mocks.createTeam.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      return call?.data
        ? { id: 'team-new', name: 'Sample Remodelers', joinCode: 'ABCDEF1234', ...call.data }
        : null;
    });
    mocks.createMembership.mockResolvedValue({});
    mocks.upsertMembership.mockResolvedValue({});
    mocks.findMembership.mockResolvedValue({ role: 'owner' });
    mocks.updatePermits.mockResolvedValue({ count: 0 });
    mocks.getTeamAccessState.mockImplementation(
      async (teamId: string, _userId: string) => ({
        paymentStatus: 'unpaid',
        accessActive: false,
        accessMode: 'free_trial',
        trialStartedAt: mocks.createTeam.mock.calls[0]?.[0]?.data?.trialStartedAt?.toISOString() ?? null,
        trialEndsAt: mocks.createTeam.mock.calls[0]?.[0]?.data?.trialEndsAt?.toISOString() ?? null,
        trialStatus: 'active',
        teamId,
      }),
    );
  });

  it('creates the team and one 30-day window together without starting checkout', async () => {
    const response = await POST(post({ action: 'create', name: 'Sample Remodelers' }));
    const result = (await response.json()) as {
      accessMode: string;
      trialStartedAt: string;
      trialEndsAt: string;
    };
    const createCall = mocks.createTeam.mock.calls[0]?.[0] as {
      data: {
        createdAt: Date;
        trialStartedAt: Date;
        trialEndsAt: Date;
      };
    };

    expect(response.status).toBe(201);
    expect(result.accessMode).toBe('free_trial');
    expect(createCall.data.trialStartedAt.toISOString()).toBe(createCall.data.createdAt.toISOString());
    expect(createCall.data.trialEndsAt.getTime() - createCall.data.trialStartedAt.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(result.trialStartedAt).toBe(createCall.data.trialStartedAt.toISOString());
    expect(result.trialEndsAt).toBe(createCall.data.trialEndsAt.toISOString());
    expect(mocks.createTeam).toHaveBeenCalledTimes(1);
    expect(mocks.createMembership).toHaveBeenCalledTimes(1);
  });

  it('joins with the team’s original dates and leaves the persisted trial window untouched', async () => {
    const savedStart = new Date('2026-05-01T12:00:00.000Z');
    const savedEnd = new Date('2026-05-31T12:00:00.000Z');
    mocks.findTeam
      .mockResolvedValueOnce({ id: 'existing-team' })
      .mockResolvedValueOnce({
        id: 'existing-team',
        name: 'Existing Team',
        joinCode: 'ABCDEF1234',
        trialStartedAt: savedStart,
        trialEndsAt: savedEnd,
      });
    mocks.findMembership.mockResolvedValue({ role: 'purchaser' });
    mocks.getTeamAccessState.mockResolvedValue({
      paymentStatus: 'unpaid',
      accessActive: false,
      accessMode: 'free_trial',
      trialStartedAt: savedStart.toISOString(),
      trialEndsAt: savedEnd.toISOString(),
      trialStatus: 'active',
    });

    const response = await POST(post({ action: 'join', joinCode: 'ABCDEF1234' }));
    const result = (await response.json()) as { trialStartedAt: string; trialEndsAt: string };

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      trialStartedAt: savedStart.toISOString(),
      trialEndsAt: savedEnd.toISOString(),
    });
    expect(mocks.upsertMembership).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 'existing-team', userId: 'owner-1' } },
      create: { teamId: 'existing-team', userId: 'owner-1', role: 'purchaser' },
      update: {},
    });
    expect(mocks.createTeam).not.toHaveBeenCalled();
  });
});
