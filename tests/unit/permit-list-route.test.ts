// @polsia:user-owned — paid-team permit list route tests.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  findPermits: vi.fn(),
  findManagerMemberships: vi.fn(),
  findManagers: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    permit: { findMany: mocks.findPermits },
    teamMembership: { findMany: mocks.findManagerMemberships },
    user: { findMany: mocks.findManagers },
  },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));
vi.mock('@/lib/business/permit-updates', () => ({ updatePermitWithStatusNotifications: vi.fn() }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: () => true }));

import { GET } from '@/app/api/permits/route';

const permit = {
  id: 'permit-1',
  teamId: 'paid-team',
  assignedProjectManagerUserId: null,
  projectName: 'Sample kitchen remodel',
  address: '101 Sample Street, Tampa, FL',
  permitNumber: 'BLD-27-0529173',
  permitType: 'Building',
  status: 'Submitted',
  notes: '',
  portalUrl:
    'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
  portalCurrentStatus: 'Submitted',
  portalStatusObservedAt: new Date('2026-11-14T09:12:30.000Z'),
  archivedAt: null,
  createdAt: new Date('2026-11-01T12:00:00.000Z'),
  updatedAt: new Date('2026-11-14T09:12:30.000Z'),
  statusEvents: [],
};

function request() {
  return new Request('http://localhost/api/permits?teamId=paid-team');
}

describe('paid team permit list route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'member-1', email: 'member@example.test' });
    mocks.requireTeamAccess.mockResolvedValue({
      response: null,
      membership: { role: 'owner' },
      paymentStatus: 'active',
      accessActive: true,
    });
    mocks.findPermits.mockResolvedValue([permit]);
    mocks.findManagerMemberships.mockResolvedValue([]);
    mocks.findManagers.mockResolvedValue([]);
  });

  it('returns records scoped to the paid team after team authorization', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'permit-1',
      teamId: 'paid-team',
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
    });
    expect(mocks.requireTeamAccess).toHaveBeenCalledWith('paid-team', 'member-1');
    expect(mocks.findPermits).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 'paid-team', archivedAt: null } }),
    );
  });

  it('does not query or return permit data while team access is unpaid', async () => {
    mocks.requireTeamAccess.mockResolvedValue({
      response: Response.json({ error: 'team_subscription_required' }, { status: 402 }),
    });

    const response = await GET(request());

    expect(response.status).toBe(402);
    expect(mocks.findPermits).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('BLD-27-0529173');
  });
});
