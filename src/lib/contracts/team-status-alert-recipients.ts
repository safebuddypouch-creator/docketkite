// @polsia:user-owned — owner-only recipients for verified team status alerts.
import { z } from 'zod';

export const TeamStatusAlertRecipientMember = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
});

export const TeamStatusAlertRecipientsResponse = z.object({
  teamId: z.string(),
  members: z.array(TeamStatusAlertRecipientMember),
  recipientUserIds: z.array(z.string()),
  usesAssignedProjectManagerDefault: z.boolean(),
});

export const TeamStatusAlertRecipientsUpdate = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    teamId: z.string().min(1),
    recipientUserIds: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Choose each team member only once.'),
  }),
  z.object({
    action: z.literal('use_assigned_project_manager'),
    teamId: z.string().min(1),
  }),
]);

export type TeamStatusAlertRecipientMember = z.infer<typeof TeamStatusAlertRecipientMember>;
export type TeamStatusAlertRecipientsResponse = z.infer<typeof TeamStatusAlertRecipientsResponse>;
