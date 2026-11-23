import { describe, expect, it } from 'vitest';
import { checklistItemsFromConfirmedReview } from '@/lib/business/permit-checklist';

describe('checklistItemsFromConfirmedReview', () => {
  const sourceLetterId = 'letter-42';
  const confirmedAt = new Date('2026-10-28T12:00:00.000Z');

  it('does not use extraction draft items before review confirmation', () => {
    const result = checklistItemsFromConfirmedReview(
      {
        status: 'draft',
        confirmedAt: null,
        reviewedItems: null,
      },
      sourceLetterId,
    );

    expect(result).toBeNull();
  });

  it('maps only confirmed reviewed items and keeps the exact source letter on each item', () => {
    const result = checklistItemsFromConfirmedReview(
      {
        status: 'confirmed',
        confirmedAt,
        reviewedItems: [
          {
            id: 'reviewed-item-1',
            action: 'Revise the north elevation notes.',
            location: 'North elevation',
            planReference: 'A2.1',
          },
        ],
      },
      sourceLetterId,
    );

    expect(result).toEqual([
      {
        sourceLetterId,
        sourceItemId: 'reviewed-item-1',
        action: 'Revise the north elevation notes.',
        location: 'North elevation',
        planReference: 'A2.1',
      },
    ]);
  });

  it('rejects malformed confirmed review data instead of falling back to extraction drafts', () => {
    const result = checklistItemsFromConfirmedReview(
      {
        status: 'confirmed',
        confirmedAt,
        reviewedItems: [{ id: 'bad-item', action: '', location: null, planReference: null }],
      },
      sourceLetterId,
    );

    expect(result).toBeNull();
  });
});
