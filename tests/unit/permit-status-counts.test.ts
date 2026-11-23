// @polsia:user-owned — saved team permit status count behavior.
import { describe, expect, it } from 'vitest';
import { buildPermitStatusCounts } from '@/lib/business/permit-status-counts';

describe('buildPermitStatusCounts', () => {
  it('returns every saved status in order, including zero counts, and ignores raw portal values', () => {
    expect(
      buildPermitStatusCounts([
        { status: 'Planning', count: 2 },
        { status: 'Submitted', count: 1 },
        { status: 'Record Status: Corrections Issued', count: 9 },
      ]),
    ).toEqual([
      { status: 'Planning', count: 2 },
      { status: 'Ready to submit', count: 0 },
      { status: 'Submitted', count: 1 },
      { status: 'Under review', count: 0 },
      { status: 'Corrections requested', count: 0 },
      { status: 'Issued', count: 0 },
    ]);
  });
});
