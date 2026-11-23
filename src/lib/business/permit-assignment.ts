// @polsia:user-owned — eligibility rules for assigning a permit to a project manager.

export type PermitAssignmentMembership = {
  teamId: string;
  userId: string;
  role: string;
};

export type PermitAssignmentDenial =
  | 'team_owner_required'
  | 'project_manager_not_accepted_team_member';

export function getPermitAssignmentDenial(input: {
  teamId: string;
  requesterRole: string;
  projectManagerUserId: string | null;
  projectManagerMembership: PermitAssignmentMembership | null;
}): PermitAssignmentDenial | null {
  if (input.requesterRole !== 'owner') return 'team_owner_required';
  if (input.projectManagerUserId === null) return null;

  const membership = input.projectManagerMembership;
  if (
    !membership ||
    membership.teamId !== input.teamId ||
    membership.userId !== input.projectManagerUserId ||
    membership.role !== 'project_manager'
  ) {
    return 'project_manager_not_accepted_team_member';
  }

  return null;
}
