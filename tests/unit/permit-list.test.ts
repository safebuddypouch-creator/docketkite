import { describe, expect, it } from 'vitest';
import { buildPermitListOrderBy, buildPermitListWhere } from '@/lib/business/permit-list';

describe('buildPermitListOrderBy', () => {
  it('sorts by permit reference ascending with a stable tie-breaker', () => {
    expect(buildPermitListOrderBy('reference')).toEqual([
      { permitNumber: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('sorts by address ascending with a stable tie-breaker', () => {
    expect(buildPermitListOrderBy('address')).toEqual([{ address: 'asc' }, { id: 'asc' }]);
  });

  it('sorts most recently updated permits first with a stable tie-breaker', () => {
    expect(buildPermitListOrderBy('activity')).toEqual([
      { updatedAt: 'desc' },
      { id: 'asc' },
    ]);
  });
});

describe('buildPermitListWhere', () => {
  it('returns the selected team active list when no assignee filter is set', () => {
    expect(
      buildPermitListWhere({ teamId: 'team-a', view: 'active', assignedToMeUserId: null }),
    ).toEqual({ teamId: 'team-a', archivedAt: null });
  });

  it('combines team, archived view, and the authenticated assignee identity', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'archived',
        assignedToMeUserId: 'signed-in-manager',
      }),
    ).toEqual({
      teamId: 'team-a',
      archivedAt: { not: null },
      assignedProjectManagerUserId: 'signed-in-manager',
    });
  });

  it('keeps the archived team list unfiltered for owners', () => {
    expect(
      buildPermitListWhere({ teamId: 'team-a', view: 'archived', assignedToMeUserId: null }),
    ).toEqual({ teamId: 'team-a', archivedAt: { not: null } });
  });

  it('filters the selected active team to saved interrupted monitoring outcomes', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'active',
        assignedToMeUserId: null,
        interruptedMonitoring: true,
      }),
    ).toEqual({
      teamId: 'team-a',
      archivedAt: null,
      portalMonitoringInterruptedAt: { not: null },
    });
  });

  it('combines archived view, saved interruption, and the signed-in manager assignment', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'archived',
        assignedToMeUserId: 'signed-in-manager',
        interruptedMonitoring: true,
      }),
    ).toEqual({
      teamId: 'team-a',
      archivedAt: { not: null },
      assignedProjectManagerUserId: 'signed-in-manager',
      portalMonitoringInterruptedAt: { not: null },
    });
  });

  it('does not add a monitoring condition when the filter is off', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'active',
        assignedToMeUserId: null,
        interruptedMonitoring: false,
      }),
    ).toEqual({ teamId: 'team-a', archivedAt: null });
  });

  it('filters the selected team to the exact saved permit status', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'active',
        assignedToMeUserId: null,
        status: 'Corrections requested',
      }),
    ).toEqual({
      teamId: 'team-a',
      archivedAt: null,
      status: 'Corrections requested',
    });
  });

  it('adds a case-insensitive permit-number or address search without replacing the view scope', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'archived',
        assignedToMeUserId: 'signed-in-manager',
        interruptedMonitoring: true,
        searchTerm: '  Willow St  ',
      }),
    ).toEqual({
      teamId: 'team-a',
      archivedAt: { not: null },
      assignedProjectManagerUserId: 'signed-in-manager',
      portalMonitoringInterruptedAt: { not: null },
      OR: [
        { permitNumber: { contains: 'Willow St', mode: 'insensitive' } },
        { address: { contains: 'Willow St', mode: 'insensitive' } },
      ],
    });
  });

  it('combines reference-or-address search with the selected status and list view', () => {
    expect(
      buildPermitListWhere({
        teamId: 'team-a',
        view: 'archived',
        assignedToMeUserId: null,
        status: 'Issued',
        searchTerm: '  willow  ',
      }),
    ).toEqual({
      teamId: 'team-a',
      archivedAt: { not: null },
      status: 'Issued',
      OR: [
        { permitNumber: { contains: 'willow', mode: 'insensitive' } },
        { address: { contains: 'willow', mode: 'insensitive' } },
      ],
    });
  });
});
