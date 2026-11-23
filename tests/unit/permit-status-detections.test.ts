import { describe, expect, it } from 'vitest';
import {
  deriveRecentPermitStatusDetections,
  type PermitPortalStatusObservation,
} from '@/lib/business/permit-status-detections';

function observation(
  id: string,
  permitId: string,
  status: string,
  checkedAt: string,
): PermitPortalStatusObservation {
  return {
    id,
    permitId,
    permitNumber: `Permit-${permitId}`,
    status,
    checkedAt: new Date(checkedAt),
    sourceFetchedAt: new Date(checkedAt),
    sourceUrl:
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02LZA&agencyCode=TAMPA&IsToShowInspection=',
    permit: {
      projectName: `Project ${permitId}`,
      address: `${permitId} Test Street, Tampa`,
      permitType: 'Building',
    },
  };
}

describe('deriveRecentPermitStatusDetections', () => {
  it('skips a permit baseline and repeated public statuses, then lists real changes newest first', () => {
    const firstChange = observation('check-b', 'permit-a', 'Corrections requested', '2026-10-01T10:00:00.000Z');
    const secondChange = observation('check-c', 'permit-a', 'Issued', '2026-10-02T10:00:00.000Z');

    const detections = deriveRecentPermitStatusDetections([
      secondChange,
      observation('check-a', 'permit-a', 'Submitted', '2026-09-30T10:00:00.000Z'),
      observation('check-repeat', 'permit-a', ' submitted  ', '2026-10-01T08:00:00.000Z'),
      firstChange,
      observation('other-baseline', 'permit-b', 'Under review', '2026-10-01T11:00:00.000Z'),
    ]);

    expect(detections.map(({ id, previousStatus, newStatus }) => ({ id, previousStatus, newStatus }))).toEqual([
      { id: 'check-c', previousStatus: 'Corrections requested', newStatus: 'Issued' },
      { id: 'check-b', previousStatus: ' submitted  ', newStatus: 'Corrections requested' },
    ]);
    expect(detections[0]?.projectName).toBe('Project permit-a');
  });

  it('returns no detection for one baseline and ignores blank observations', () => {
    expect(
      deriveRecentPermitStatusDetections([
        observation('baseline', 'permit-a', 'Submitted', '2026-10-01T10:00:00.000Z'),
        observation('blank', 'permit-a', '  ', '2026-10-02T10:00:00.000Z'),
      ]),
    ).toEqual([]);
  });

  it('ignores repeated cached page reads and older source snapshots', () => {
    const detections = deriveRecentPermitStatusDetections([
      observation('baseline', 'permit-a', 'In Process', '2026-10-01T10:00:00.000Z'),
      {
        ...observation('cached-repeat', 'permit-a', 'Awaiting Client Reply', '2026-10-02T10:00:00.000Z'),
        sourceFetchedAt: new Date('2026-10-01T10:00:00.000Z'),
      },
      {
        ...observation('fresh-change', 'permit-a', 'Awaiting Client Reply', '2026-10-03T10:00:00.000Z'),
        sourceFetchedAt: new Date('2026-10-03T10:00:00.000Z'),
      },
    ]);

    expect(detections.map(({ id, previousStatus, newStatus }) => ({ id, previousStatus, newStatus }))).toEqual([
      { id: 'fresh-change', previousStatus: 'In Process', newStatus: 'Awaiting Client Reply' },
    ]);
  });

  it('ignores observations without a source fetch timestamp', () => {
    const legacy = observation('legacy', 'permit-a', 'In Process', '2026-10-01T10:00:00.000Z');
    const current = observation('current', 'permit-a', 'Issued', '2026-10-02T10:00:00.000Z');
    legacy.sourceFetchedAt = null;
    current.sourceFetchedAt = null;

    expect(deriveRecentPermitStatusDetections([legacy, current])).toEqual([]);
  });

  it('keeps only the newest requested number of detected changes', () => {
    const observations = [
      observation('a1', 'permit-a', 'Submitted', '2026-10-01T10:00:00.000Z'),
      observation('a2', 'permit-a', 'Issued', '2026-10-02T10:00:00.000Z'),
      observation('b1', 'permit-b', 'Submitted', '2026-10-03T10:00:00.000Z'),
      observation('b2', 'permit-b', 'Issued', '2026-10-04T10:00:00.000Z'),
    ];

    expect(deriveRecentPermitStatusDetections(observations, 1).map((item) => item.id)).toEqual([
      'b2',
    ]);
  });
});
