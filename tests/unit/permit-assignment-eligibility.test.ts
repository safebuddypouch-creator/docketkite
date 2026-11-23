// @polsia:user-owned — permit assignment owner and same-team eligibility checks.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getPermitAssignmentDenial } from '@/lib/business/permit-assignment';

const validMembership = {
  teamId: 'team-1',
  userId: 'manager-1',
  role: 'project_manager',
};

describe('permit assignment eligibility', () => {
  it('allows the team owner to assign an accepted same-team project manager', () => {
    expect(
      getPermitAssignmentDenial({
        teamId: 'team-1',
        requesterRole: 'owner',
        projectManagerUserId: 'manager-1',
        projectManagerMembership: validMembership,
      }),
    ).toBeNull();
  });

  it.each(['project_manager', 'purchaser', ''])('rejects a %s requester', (requesterRole) => {
    expect(
      getPermitAssignmentDenial({
        teamId: 'team-1',
        requesterRole,
        projectManagerUserId: 'manager-1',
        projectManagerMembership: validMembership,
      }),
    ).toBe('team_owner_required');
  });

  it('allows an owner to clear an assignment', () => {
    expect(
      getPermitAssignmentDenial({
        teamId: 'team-1',
        requesterRole: 'owner',
        projectManagerUserId: null,
        projectManagerMembership: null,
      }),
    ).toBeNull();
  });

  it.each([
    ['pending invitee', null],
    ['non-project-manager member', { ...validMembership, role: 'purchaser' }],
    ['another team member', { ...validMembership, teamId: 'team-2' }],
    ['different user membership', { ...validMembership, userId: 'manager-2' }],
  ])('rejects a %s', (_label, projectManagerMembership) => {
    expect(
      getPermitAssignmentDenial({
        teamId: 'team-1',
        requesterRole: 'owner',
        projectManagerUserId: 'manager-1',
        projectManagerMembership,
      }),
    ).toBe('project_manager_not_accepted_team_member');
  });
});
