// @polsia:user-owned — permit detail assignment options are team scoped.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  permitFindUnique: vi.fn(),
  permitFindFirst: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    permit: { findUnique: mocks.permitFindUnique, findFirst: mocks.permitFindFirst },
    teamMembership: {
      findUnique: mocks.membershipFindUnique,
      findMany: mocks.membershipFindMany,
    },
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: vi.fn(() => true) }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));

import { GET } from '@/app/api/permits/[permitId]/route';

const permit = {
  id: 'permit-1',
  teamId: 'team-1',
  userId: 'owner-1',
  assignedProjectManagerUserId: 'manager-1',
  projectName: 'Kitchen remodel',
  address: '101 Test Street',
  permitNumber: 'BLD-100',
  permitType: 'Building',
  status: 'Submitted',
  notes: '',
  portalUrl: null,
  archivedAt: null,
  createdAt: new Date('2026-01-02T12:00:00.000Z'),
  updatedAt: new Date('2026-01-02T12:00:00.000Z'),
  statusEvents: [],
};

describe('permit detail assignment options', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.requireTeamAccess.mockResolvedValue({
      membership: { teamId: 'team-1', userId: 'owner-1', role: 'owner' },
      accessActive: true,
      response: null,
    });
    mocks.permitFindUnique.mockResolvedValue({ teamId: 'team-1' });
    mocks.permitFindFirst.mockResolvedValue(permit);
    mocks.membershipFindUnique.mockResolvedValue({
      teamId: 'team-1',
      userId: 'manager-1',
      role: 'project_manager',
    });
    mocks.membershipFindMany.mockResolvedValue([{ userId: 'manager-1' }]);
    mocks.userFindUnique.mockResolvedValue({ id: 'manager-1', name: 'Morgan Manager' });
    mocks.userFindMany.mockResolvedValue([{ id: 'manager-1', name: 'Morgan Manager' }]);
  });

  it('returns the saved assignee and only same-team accepted project managers to the owner', async () => {
    const response = await GET(new Request('http://localhost/api/permits/permit-1'), {
      params: Promise.resolve({ permitId: 'permit-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 'permit-1',
      teamId: 'team-1',
      status: 'Submitted',
      assignedProjectManager: { id: 'manager-1', name: 'Morgan Manager' },
      canEditDetails: true,
      projectManagers: [{ id: 'manager-1', name: 'Morgan Manager' }],
    });
    expect(mocks.membershipFindMany).toHaveBeenCalledWith({
      where: { teamId: 'team-1', role: 'project_manager' },
      select: { userId: true },
    });
    expect(mocks.userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['manager-1'] } },
      select: { id: true, name: true },
    });
  });

  it('does not return assignment options to a non-owner', async () => {
    mocks.requireTeamAccess.mockResolvedValue({
      membership: { teamId: 'team-1', userId: 'manager-1', role: 'project_manager' },
      accessActive: true,
      response: null,
    });

    const response = await GET(new Request('http://localhost/api/permits/permit-1'), {
      params: Promise.resolve({ permitId: 'permit-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canEditDetails: false,
      projectManagers: [],
    });
    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});
