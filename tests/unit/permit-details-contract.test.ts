// @polsia:user-owned — permit reference and address edit contract.
import { describe, expect, it } from 'vitest';
import { PermitDetailsUpdate } from '@/lib/contracts/permit';

describe('permit details updates', () => {
  it('allows an empty reference and accepts the documented maximum lengths', () => {
    const result = PermitDetailsUpdate.safeParse({
      teamId: 'team-1',
      permitNumber: '',
      address: 'A'.repeat(200),
    });

    expect(result.success).toBe(true);
  });

  it('requires an address and rejects values over the documented limits', () => {
    expect(
      PermitDetailsUpdate.safeParse({ teamId: 'team-1', permitNumber: '', address: '' }).success,
    ).toBe(false);
    expect(
      PermitDetailsUpdate.safeParse({
        teamId: 'team-1',
        permitNumber: 'R'.repeat(81),
        address: 'Valid address',
      }).success,
    ).toBe(false);
    expect(
      PermitDetailsUpdate.safeParse({
        teamId: 'team-1',
        permitNumber: 'Optional',
        address: 'A'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('rejects browser-supplied fields outside the selected team and editable values', () => {
    expect(
      PermitDetailsUpdate.safeParse({
        teamId: 'team-1',
        permitNumber: 'R-1',
        address: 'Valid address',
        status: 'Issued',
      }).success,
    ).toBe(false);
  });
});
