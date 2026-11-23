// @polsia:user-owned — resolve alert recipients against one team's current members.

export interface TeamStatusAlertMemberRecord {
  userId: string;
  email: string | null;
  role: string;
}

export function resolveTeamStatusAlertRecipients(options: {
  hasCustomSelection: boolean;
  selectedUserIds: readonly string[];
  currentTeamMembers: readonly TeamStatusAlertMemberRecord[];
  assignedProjectManagerUserId: string | null;
}): string[] {
  const membersById = new Map(options.currentTeamMembers.map((member) => [member.userId, member]));

  if (options.hasCustomSelection) {
    return [...new Set(options.selectedUserIds)]
      .map((userId) => membersById.get(userId))
      .flatMap((member) => (member?.email?.trim() ? [member.email] : []));
  }

  if (!options.assignedProjectManagerUserId) return [];
  const assignedMember = membersById.get(options.assignedProjectManagerUserId);
  return assignedMember?.role === 'project_manager' && assignedMember.email?.trim()
    ? [assignedMember.email]
    : [];
}
