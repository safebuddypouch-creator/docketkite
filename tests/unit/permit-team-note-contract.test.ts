// @polsia:user-owned — contract checks for private permit notes.
import { describe, expect, it } from 'vitest';
import {
  PermitTeamNoteCreate,
  PermitTeamNoteItem,
  PermitTeamNoteList,
} from '@/lib/contracts/permit-team-note';

describe('permit team note contract', () => {
  it('trims non-empty note text and rejects empty or overlong notes', () => {
    expect(PermitTeamNoteCreate.parse({ body: '  Call the inspector on Thursday.  ' })).toEqual({
      body: 'Call the inspector on Thursday.',
    });
    expect(PermitTeamNoteCreate.safeParse({ body: '   ' }).success).toBe(false);
    expect(PermitTeamNoteCreate.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('validates saved notes and the list wrapper used by the client', () => {
    const item = {
      id: 'note_1',
      body: 'Call the inspector on Thursday.',
      authorName: 'QA Member',
      createdAt: '2026-10-31T12:00:00.000Z',
    };

    expect(PermitTeamNoteItem.parse(item)).toEqual(item);
    expect(PermitTeamNoteList.parse({ items: [item] })).toEqual({ items: [item] });
    expect(PermitTeamNoteList.safeParse({ items: [{ ...item, createdAt: 'later' }] }).success).toBe(
      false,
    );
  });
});
