// @polsia:user-owned — first-permit creation authorization and team-scoping checks.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  sameOrigin: vi.fn(),
  permitCreate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: { permit: { create: mocks.permitCreate } } }));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));
vi.mock('@/lib/business/permit-assignment', () => ({ getPermitAssignmentDenial: vi.fn() }));
vi.mock('@/lib/business/permit-list', () => ({
  buildPermitListOrderBy: vi.fn(),
  buildPermitListWhere: vi.fn(),
}));
vi.mock('@/lib/business/permit-monitoring-outcome', () => ({
  getLatestPermitMonitoringOutcomes: vi.fn(),
}));
vi.mock('@/lib/business/permit-updates', () => ({
  updatePermitWithStatusNotifications: vi.fn(),
}));

import { POST } from '@/app/api/permits/route';

const tampaRecordUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

const requestFields = {
  projectName: 'Kitchen Remodel',
  address: '101 Sample Street, Tampa, FL',
  permitNumber: 'BLD-27-0529173',
  permitType: 'Building',
  status: 'Planning',
  notes: '',
  portalUrl: tampaRecordUrl,
};

const teamOwner = { teamId: 'team-1', userId: 'owner-1', role: 'owner' };
const projectManager = { teamId: 'team-1', userId: 'manager-1', role: 'project_manager' };

function makeRequest(body: Record<string, unknown> = { ...requestFields, teamId: 'team-1' }) {
  return new Request('https://app.example/api/permits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function permitRecord(userId: string) {
  return {
    id: 'permit-1',
    teamId: 'team-1',
    userId,
    assignedProjectManagerUserId: null,
    ...requestFields,
    portalCurrentStatus: null,
    portalStatusObservedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-11-16T12:00:00.000Z'),
    updatedAt: new Date('2026-11-16T12:00:00.000Z'),
    statusEvents: [],
  };
}

describe('first permit creation route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.requireTeamAccess.mockResolvedValue({
      membership: teamOwner,
      accessActive: true,
      response: null,
    });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.permitCreate.mockResolvedValue(permitRecord('owner-1'));
  });

  it('creates the owner’s first permit in the selected team without requiring an existing record', async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: 'permit-1',
      teamId: 'team-1',
      permitNumber: 'BLD-27-0529173',
      portalUrl: tampaRecordUrl,
    });
    expect(mocks.requireTeamAccess).toHaveBeenCalledWith('team-1', 'owner-1');
    expect(mocks.permitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: 'team-1',
          userId: 'owner-1',
          permitNumber: 'BLD-27-0529173',
          portalUrl: tampaRecordUrl,
        }),
      }),
    );
  });

  it('lets an authorized project manager create without changing their membership role', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'manager-1', email: 'manager@example.test' });
    mocks.requireTeamAccess.mockResolvedValue({
      membership: projectManager,
      accessActive: true,
      response: null,
    });
    mocks.permitCreate.mockResolvedValue(permitRecord('manager-1'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(201);
    expect(mocks.requireTeamAccess).toHaveBeenCalledWith('team-1', 'manager-1');
    expect(mocks.permitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: 'team-1', userId: 'manager-1' }),
      }),
    );
    expect(mocks.permitCreate.mock.calls[0]?.[0].data).not.toHaveProperty('role');
  });

  it('rejects missing required create fields and unsupported portal URLs before saving', async () => {
    const response = await POST(
      makeRequest({ ...requestFields, permitNumber: '', portalUrl: '', teamId: 'team-1' }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      errors: {
        permitNumber: expect.any(String),
        portalUrl: expect.any(String),
      },
    });
    expect(mocks.permitCreate).not.toHaveBeenCalled();
  });

  it('rejects unauthorized and cross-team writes without saving', async () => {
    const denied = Response.json({ error: 'team_membership_required' }, { status: 403 });
    mocks.requireTeamAccess.mockResolvedValueOnce({ response: denied });

    const unauthorized = await POST(makeRequest());
    expect(unauthorized.status).toBe(403);
    expect(mocks.permitCreate).not.toHaveBeenCalled();

    mocks.requireTeamAccess.mockResolvedValueOnce({ response: denied });
    const crossTeam = await POST(makeRequest({ ...requestFields, teamId: 'team-2' }));
    expect(crossTeam.status).toBe(403);
    expect(mocks.requireTeamAccess).toHaveBeenLastCalledWith('team-2', 'owner-1');
    expect(mocks.permitCreate).not.toHaveBeenCalled();
  });

  it('keeps same-origin protection and active-team access as write prerequisites', async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const foreignOrigin = await POST(makeRequest());
    expect(foreignOrigin.status).toBe(403);
    expect(mocks.requireAuth).not.toHaveBeenCalled();

    mocks.sameOrigin.mockReturnValue(true);
    mocks.requireTeamAccess.mockResolvedValueOnce({
      response: Response.json({ error: 'team_subscription_required' }, { status: 402 }),
    });
    const inactiveAccess = await POST(makeRequest());
    expect(inactiveAccess.status).toBe(402);
    expect(mocks.permitCreate).not.toHaveBeenCalled();
  });
});
