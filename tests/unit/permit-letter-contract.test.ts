// @polsia:user-owned — correction letter type and size contract tests.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_CORRECTION_LETTER_SIZE_BYTES,
  PermitCorrectionDraft,
  PermitCorrectionChecklistItem,
  PermitCorrectionChecklistSummary,
  PermitCorrectionChecklistItemUpdateRequest,
  PermitCorrectionReviewRequest,
  PermitLetterItem,
  RegisteredCorrectionLetterFile,
  PermitLetterRequest,
} from '@/lib/contracts/permit-letter';

const pdf = {
  id: 701,
  key: 'permit-letters/letter.pdf',
  url: 'https://files.example.test/letter.pdf',
  filename: 'letter.pdf',
  mime_type: 'application/pdf',
  size: 1024,
  created_at: '2026-10-28T12:00:00.000Z',
};

describe('correction letter contract', () => {
  it('models persisted checklist completion and accepts only boolean team updates', () => {
    const item = {
      id: 'checklist-item-1',
      sourceLetterId: 'letter-1',
      sourceItemId: 'reviewed-item-1',
      action: 'Revise the north elevation notes.',
      location: 'North elevation',
      planReference: 'A2.1',
      completed: false,
    };

    expect(PermitCorrectionChecklistItem.parse(item)).toEqual(item);
    expect(
      PermitCorrectionChecklistItemUpdateRequest.parse({ itemId: item.id, completed: true }),
    ).toEqual({ itemId: item.id, completed: true });
    expect(
      PermitCorrectionChecklistItemUpdateRequest.safeParse({
        itemId: item.id,
        completed: 'yes',
      }).success,
    ).toBe(false);
  });

  it('represents saved checklist progress by its source letter and rejects invalid counts', () => {
    const summary = {
      id: 'checklist-1',
      sourceLetterId: 'letter-1',
      completedCount: 1,
      totalCount: 2,
    };

    expect(PermitCorrectionChecklistSummary.parse(summary)).toEqual(summary);
    expect(PermitCorrectionChecklistSummary.safeParse({ ...summary, completedCount: -1 }).success)
      .toBe(false);
    expect(PermitCorrectionChecklistSummary.safeParse({ ...summary, completedCount: 3 }).success)
      .toBe(false);
    expect(
      PermitCorrectionChecklistSummary.safeParse({ ...summary, totalCount: 1.5 }).success,
    ).toBe(false);
  });

  it('accepts a secure PDF upload result and an authorized permit request', () => {
    expect(RegisteredCorrectionLetterFile.parse(pdf)).toEqual(pdf);
    expect(
      PermitLetterRequest.parse({ action: 'authorize', teamId: 'team-1', permitId: 'permit-1' }),
    ).toEqual({ action: 'authorize', teamId: 'team-1', permitId: 'permit-1' });
  });

  it.each(['application/zip', 'application/msword'])('rejects non-letter MIME %s', (mimeType) => {
    expect(RegisteredCorrectionLetterFile.safeParse({ ...pdf, mime_type: mimeType }).success).toBe(false);
  });

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts parseable image MIME %s', (mimeType) => {
    expect(RegisteredCorrectionLetterFile.safeParse({ ...pdf, mime_type: mimeType }).success).toBe(true);
  });

  it('rejects insecure URLs and files over the module document limit', () => {
    expect(RegisteredCorrectionLetterFile.safeParse({ ...pdf, url: 'http://files.example.test/letter.pdf' }).success).toBe(
      false,
    );
    expect(
      RegisteredCorrectionLetterFile.safeParse({ ...pdf, size: MAX_CORRECTION_LETTER_SIZE_BYTES + 1 }).success,
    ).toBe(false);
  });

  it('requires an upload ID instead of client-supplied metadata when attaching', () => {
    expect(
      PermitLetterRequest.safeParse({
        action: 'attach',
        teamId: 'team-1',
        permitId: 'permit-1',
        uploadId: 701,
      }).success,
    ).toBe(true);
    expect(
      PermitLetterRequest.safeParse({
        action: 'attach',
        teamId: 'team-1',
        permitId: 'permit-1',
        file: pdf,
      }).success,
    ).toBe(false);
  });

  it('models extracted corrections as a reviewable draft, separate from permit status', () => {
    const draft = {
      status: 'draft',
      items: [
        {
          id: 'correction-1',
          action: 'Revise the north elevation notes.',
          location: 'North elevation',
          planReference: 'A2.1',
        },
      ],
      fieldErrors: [],
      extractedAt: '2026-10-28T12:00:00.000Z',
      reviewedAt: null,
      confirmedAt: null,
    };

    expect(PermitCorrectionDraft.parse(draft)).toEqual(draft);
    expect(PermitCorrectionDraft.safeParse({ ...draft, status: 'approved' }).success).toBe(false);
    const letter = PermitLetterItem.parse({
      id: 'letter-1',
      permitId: 'permit-1',
      teamId: 'team-1',
      uploadId: 701,
      fileName: 'letter.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      createdAt: '2026-10-28T12:00:00.000Z',
      correctionDraft: draft,
      correctionChecklist: null,
      fileKey: 'private/key.pdf',
      fileUrl: 'https://files.example.test/private/key.pdf',
    });
    expect(letter.correctionDraft).toEqual(draft);
    expect(letter).not.toHaveProperty('fileKey');
    expect(letter).not.toHaveProperty('fileUrl');
  });

  it('accepts edited items for save and confirmation while rejecting blank correction text', () => {
    const items = [
      {
        id: 'correction-1',
        action: 'Revise the north elevation notes.',
        location: 'North elevation',
        planReference: 'A2.1',
      },
    ];

    expect(PermitCorrectionReviewRequest.parse({ action: 'save', items })).toEqual({ action: 'save', items });
    expect(PermitCorrectionReviewRequest.parse({ action: 'confirm', items })).toEqual({
      action: 'confirm',
      items,
    });
    expect(
      PermitCorrectionReviewRequest.safeParse({
        action: 'confirm',
        items: [{ ...items[0], action: '  ' }],
      }).success,
    ).toBe(false);
  });
});
