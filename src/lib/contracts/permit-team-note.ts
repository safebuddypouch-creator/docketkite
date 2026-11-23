// @polsia:user-owned — shared contract for private, team-scoped permit notes.
import { z } from 'zod';

export const PermitTeamNoteCreate = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a note before saving.')
    .max(2000, 'Use 2,000 characters or fewer.'),
});

export const PermitTeamNoteItem = z.object({
  id: z.string(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.string().datetime(),
});

export const PermitTeamNoteList = z.object({ items: z.array(PermitTeamNoteItem) });

export type PermitTeamNoteCreate = z.infer<typeof PermitTeamNoteCreate>;
export type PermitTeamNoteItem = z.infer<typeof PermitTeamNoteItem>;
export type PermitTeamNoteList = z.infer<typeof PermitTeamNoteList>;
