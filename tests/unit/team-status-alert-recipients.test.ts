import { describe, expect, it } from 'vitest';
import { resolveTeamStatusAlertRecipients } from '@/lib/business/team-status-alert-recipients';

describe('resolveTeamStatusAlertRecipients', () => {
  const members = [
    { userId: 'owner', role: 'owner', email: 'owner@example.test' },
    { userId: 'manager', role: 'project_manager', email: 'manager@example.test' },
    { userId: 'purchaser', role: 'purchaser', email: 'purchaser@example.test' },
    { userId: 'no-email', role: 'purchaser', email: null },
  ];

  it('keeps the assigned project manager as the sole default recipient', () => {
    expect(
      resolveTeamStatusAlertRecipients({
        hasCustomSelection: false,
        selectedUserIds: [],
        currentTeamMembers: members,
        assignedProjectManagerUserId: 'manager',
      }),
    ).toEqual(['manager@example.test']);
    expect(
      resolveTeamStatusAlertRecipients({
        hasCustomSelection: false,
        selectedUserIds: [],
        currentTeamMembers: members.map((member) =>
          member.userId === 'manager' ? { ...member, role: 'purchaser' } : member,
        ),
        assignedProjectManagerUserId: 'manager',
      }),
    ).toEqual([]);
    expect(
      resolveTeamStatusAlertRecipients({
        hasCustomSelection: false,
        selectedUserIds: [],
        currentTeamMembers: members,
        assignedProjectManagerUserId: null,
      }),
    ).toEqual([]);
    expect(
      resolveTeamStatusAlertRecipients({
        hasCustomSelection: false,
        selectedUserIds: [],
        currentTeamMembers: members.map((member) =>
          member.userId === 'manager' ? { ...member, email: '   ' } : member,
        ),
        assignedProjectManagerUserId: 'manager',
      }),
    ).toEqual([]);
  });

  it('uses only saved current-member recipients of any team role', () => {
    expect(
      resolveTeamStatusAlertRecipients({
        hasCustomSelection: true,
        selectedUserIds: ['purchaser', 'owner', 'outside-team', 'no-email', 'purchaser'],
        currentTeamMembers: members,
        assignedProjectManagerUserId: 'manager',
      }),
    ).toEqual(['purchaser@example.test', 'owner@example.test']);
  });

  it('does not fall back to the assigned manager after a custom selection is saved', () => {
    expect(
      resolveTeamStatusAlertRecipients({
        hasCustomSelection: true,
        selectedUserIds: ['former-member'],
        currentTeamMembers: members,
        assignedProjectManagerUserId: 'manager',
      }),
    ).toEqual([]);
  });
});
