// @polsia:user-owned — contracts for inviting and accepting team project managers.
import { z } from 'zod';

export const TeamInvitationCreateRequest = z.object({
  teamId: z.string().min(1),
  email: z.string().trim().email().max(254),
});

export const TeamInvitationCreateResponse = z.object({
  email: z.string().email(),
  expiresAt: z.string().datetime(),
});

export const TeamInvitationAcceptRequest = z.object({
  token: z.string().min(20).max(128),
});

export const TeamInvitationAcceptResponse = z.object({
  teamId: z.string(),
  teamName: z.string(),
  role: z.enum(['project_manager', 'owner']),
});

export type TeamInvitationAcceptResponse = z.infer<typeof TeamInvitationAcceptResponse>;
