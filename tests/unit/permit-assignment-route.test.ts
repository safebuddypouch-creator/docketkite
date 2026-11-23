// @polsia:user-owned — owner-only permit assignment route checks.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  sameOrigin: vi.fn(),
  transaction: vi.fn(),
  transactionMembershipFind: vi.fn(),
  transactionPermitFind: vi.fn(),
  transactionPermitUpdate: vi.fn(),
  responseMembershipFind: vi.fn(),
  responseUserFind: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
    teamMembership: { findUnique: mocks.responseMembershipFind },
    user: { findUnique: mocks.responseUserFind },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));
vi.mock('@/lib/business/permit-updates', () => ({
  updatePermitWithStatusNotifications: vi.fn(),
}));

import { PATCH } from '@/app/api/permits/route';

const permitRow = {
  id: 'permit-1',
  teamId: 'team-1',
  userId: 'owner-1',
  assignedProjectManagerUserId: null as string | null,
  projectName: 'Kitchen remodel',
  address: '101 Test Street',
  permitNumber: 'BLD-100',
  permitType: 'Building',
  status: 'Submitted',
  notes: '',
  portalUrl: null,
  portalCurrentStatus: null,
  portalStatusObservedAt: null,
  archivedAt: null,
  createdAt: new Date('2026-01-02T12:00:00.000Z'),
  updatedAt: new Date('2026-01-02T12:00:00.000Z'),
  statusEvents: [],
};

const teamOwner = { teamId: 'team-1', userId: 'owner-1', role: 'owner' };
const acceptedManager = {
  teamId: 'team-1',
  userId: 'manager-1',
  role: 'project_manager',
};

function makeRequest(projectManagerUserId: string | null) {
  return new Request('http://localhost/api/permits', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'assign',
      id: 'permit-1',
      teamId: 'team-1',
      projectManagerUserId,
    }),
  });
}

function configureTransaction() {
  const stored = structuredClone(permitRow);
  mocks.transactionPermitFind.mockImplementation(async (args: { select?: { id: true } }) =>
    args.select ? { id: stored.id } : { ...stored, statusEvents: [] },
  );
  mocks.transactionPermitUpdate.mockImplementation(
    async (args: { data: { assignedProjectManagerUserId: string | null } }) => {
      Object.assign(stored, args.data);
      return { count: 1 };
    },
  );
  mocks.transaction.mockImplementation(
    async (callback: (transaction: unknown) => unknown) =>
      callback({
        teamMembership: { findUnique: mocks.transactionMembershipFind },
        permit: {
          findFirst: mocks.transactionPermitFind,
          updateMany: mocks.transactionPermitUpdate,
        },
      }),
  );
  return stored;
}

describe('permit assignment route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.requireTeamAccess.mockResolvedValue({
      membership: teamOwner,
      accessActive: true,
      response: null,
    });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.responseMembershipFind.mockResolvedValue(acceptedManager);
    mocks.responseUserFind.mockResolvedValue({ id: 'manager-1', name: 'Morgan Manager' });
  });

  it('persists the assignee and leaves the permit team and status unchanged', async () => {
    const stored = configureTransaction();
    mocks.transactionMembershipFind
      .mockResolvedValueOnce(teamOwner)
      .mockResolvedValueOnce(acceptedManager);

    const response = await PATCH(makeRequest('manager-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 'permit-1',
      teamId: 'team-1',
      status: 'Submitted',
      assignedProjectManager: { id: 'manager-1', name: 'Morgan Manager' },
    });
    expect(stored.assignedProjectManagerUserId).toBe('manager-1');
    expect(stored.teamId).toBe('team-1');
    expect(stored.status).toBe('Submitted');
    expect(mocks.transactionPermitUpdate).toHaveBeenCalledWith({
      where: { id: 'permit-1', teamId: 'team-1', archivedAt: null },
      data: { assignedProjectManagerUserId: 'manager-1' },
    });
  });

  it('rejects non-owners, users without membership, and teams without paid access', async () => {
    configureTransaction();
    mocks.requireTeamAccess.mockResolvedValueOnce({
      membership: { ...teamOwner, role: 'project_manager' },
      accessActive: true,
      response: null,
    });
    const nonOwnerResponse = await PATCH(makeRequest('manager-1'));
    expect(nonOwnerResponse.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();

    const noMembership = Response.json({ error: 'team_membership_required' }, { status: 403 });
    mocks.requireTeamAccess.mockResolvedValueOnce({ response: noMembership });
    const noMembershipResponse = await PATCH(makeRequest('manager-1'));
    expect(noMembershipResponse.status).toBe(403);

    const unpaid = Response.json({ error: 'team_subscription_required' }, { status: 402 });
    mocks.requireTeamAccess.mockResolvedValueOnce({ response: unpaid });
    const unpaidResponse = await PATCH(makeRequest('manager-1'));
    expect(unpaidResponse.status).toBe(402);
    expect(mocks.transactionPermitUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['a pending invitee', null],
    ['a non-project-manager member', { ...acceptedManager, role: 'purchaser' }],
    ['a manager from another team', { ...acceptedManager, teamId: 'team-2' }],
  ])('rejects assignment to %s without changing the permit', async (_label, membership) => {
    const stored = configureTransaction();
    mocks.transactionMembershipFind
      .mockResolvedValueOnce(teamOwner)
      .mockResolvedValueOnce(membership);

    const response = await PATCH(makeRequest('manager-1'));

    expect(response.status).toBe(422);
    expect(stored.assignedProjectManagerUserId).toBeNull();
    expect(stored.teamId).toBe('team-1');
    expect(stored.status).toBe('Submitted');
    expect(mocks.transactionPermitUpdate).not.toHaveBeenCalled();
  });

  it('rejects an owner whose membership was revoked before the write', async () => {
    const stored = configureTransaction();
    mocks.transactionMembershipFind.mockResolvedValue({
      ...teamOwner,
      role: 'project_manager',
    });

    const response = await PATCH(makeRequest('manager-1'));

    expect(response.status).toBe(403);
    expect(stored.assignedProjectManagerUserId).toBeNull();
    expect(mocks.transactionPermitUpdate).not.toHaveBeenCalled();
  });
});
