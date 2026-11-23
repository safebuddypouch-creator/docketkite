import { describe, expect, it } from 'vitest';
import {
  classifyPermitMonitoringOutcome,
  getLatestPermitMonitoringOutcomes,
  type PermitMonitoringCheckSnapshot,
} from '@/lib/business/permit-monitoring-outcome';

function check(
  input: Partial<PermitMonitoringCheckSnapshot> &
    Pick<PermitMonitoringCheckSnapshot, 'id' | 'permitId' | 'result'>,
): PermitMonitoringCheckSnapshot {
  return {
    checkedAt: new Date('2026-11-05T10:00:00.000Z'),
    requestSequence: 1,
    ...input,
  };
}

describe('latest saved permit monitoring outcome', () => {
  it('classifies all outcomes from the newest record, with the check-history tie breakers', () => {
    const sameTime = new Date('2026-11-05T10:00:00.000Z');
    const outcomes = getLatestPermitMonitoringOutcomes([
      check({
        id: 'success-old',
        permitId: 'successful-permit',
        result: 'unavailable',
        checkedAt: new Date(sameTime.getTime() - 1_000),
      }),
      check({
        id: 'success-new',
        permitId: 'successful-permit',
        result: 'checked',
        checkedAt: sameTime,
      }),
      check({
        id: 'failure-old',
        permitId: 'failed-permit',
        result: 'checked',
        checkedAt: sameTime,
        requestSequence: 2,
      }),
      check({
        id: 'failure-new',
        permitId: 'failed-permit',
        result: 'unverified',
        checkedAt: sameTime,
        requestSequence: 3,
      }),
      check({ id: 'unavailable', permitId: 'unavailable-permit', result: 'unavailable' }),
      check({
        id: 'tie-a',
        permitId: 'id-tie-permit',
        result: 'unavailable',
        checkedAt: sameTime,
        requestSequence: 4,
      }),
      check({
        id: 'tie-z',
        permitId: 'id-tie-permit',
        result: 'checked',
        checkedAt: sameTime,
        requestSequence: 4,
      }),
    ]);

    expect(outcomes.get('successful-permit')).toBe('successful');
    expect(outcomes.get('failed-permit')).toBe('failed');
    expect(outcomes.get('unavailable-permit')).toBe('failed');
    expect(outcomes.get('id-tie-permit')).toBe('successful');
    expect(classifyPermitMonitoringOutcome(undefined)).toBe('not_checked');
  });
});
