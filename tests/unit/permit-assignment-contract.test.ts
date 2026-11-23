// @polsia:user-owned — permit assignment request and response contract tests.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PermitDetailsPage, PermitItem, PermitList, PermitMutation } from '@/lib/contracts/permit';

describe('permit assignment contract', () => {
  it('accepts assigning an accepted project manager or clearing the assignment', () => {
    expect(
      PermitMutation.parse({
        action: 'assign',
        id: 'permit-1',
        teamId: 'team-1',
        projectManagerUserId: 'manager-1',
      }),
    ).toEqual({
      action: 'assign',
      id: 'permit-1',
      teamId: 'team-1',
      projectManagerUserId: 'manager-1',
    });
    const cleared = PermitMutation.parse({
        action: 'assign',
        id: 'permit-1',
        teamId: 'team-1',
        projectManagerUserId: null,
      });
    expect(cleared).toMatchObject({ action: 'assign', projectManagerUserId: null });
  });

  it('rejects missing assignment targets and returns the assigned manager in permit lists', () => {
    expect(
      PermitMutation.safeParse({ action: 'assign', id: 'permit-1', teamId: 'team-1' }).success,
    ).toBe(false);

    const manager = { id: 'manager-1', name: 'Accepted Project Manager' };
    const permit = PermitItem.parse({
      id: 'permit-1',
      teamId: 'team-1',
      projectName: 'Kitchen Remodel',
      address: '101 Test Street',
      permitNumber: '',
      permitType: 'Building',
      status: 'Planning',
      notes: '',
      portalUrl: '',
      portalCurrentStatus: null,
      portalStatusObservedAt: null,
      archivedAt: null,
      createdAt: '2026-10-28T12:00:00.000Z',
      updatedAt: '2026-10-28T12:00:00.000Z',
      assignedProjectManager: manager,
      statusEvents: [],
    });
    expect(PermitList.parse({ items: [permit], projectManagers: [manager] }).items[0])
      .toMatchObject({ assignedProjectManager: manager });

    const details = PermitDetailsPage.parse({
      ...permit,
      canEditDetails: true,
      projectManagers: [manager],
    });
    expect(details.projectManagers).toEqual([manager]);
    expect(details.canEditDetails).toBe(true);
  });
});
