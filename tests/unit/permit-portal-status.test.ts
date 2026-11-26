// @polsia:user-owned — public permit status extraction tests.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  applyPortalMonitoringOutcome,
  extractPermitPortalStatus,
  isNewerPortalPageRead,
  isNewPortalMonitoringInterruption,
  isPortalObservationLater,
  portalMonitoringFromHistory,
  shouldRecordPortalStatusTransition,
} from '@/lib/business/permit-portal-status';
import { PermitPortalUrl } from '@/lib/contracts/permit';

describe('public City of Tampa permit status extraction', () => {
  it('keeps the exact Record Status value when the same record number is visible', () => {
    const page = [
      '# Record BLD-27-0529173',
      '| Record Number | Record Status |',
      '| --- | --- |',
      '| BLD-27-0529173 | Awaiting Client Reply |',
      '| Record Status | Awaiting Client Reply |',
    ].join('\n');

    expect(extractPermitPortalStatus(page, 'BLD-27-0529173')).toEqual({
      result: 'checked',
      status: 'Awaiting Client Reply',
      message: null,
    });
  });

  it('accepts the City portal number with or without its display punctuation', () => {
    const result = extractPermitPortalStatus(
      '# Record BLD-27-0529173\nRecord Status: In Process',
      'BLD-27-0529173',
    );

    expect(result).toEqual({ result: 'checked', status: 'In Process', message: null });
  });

  it('reads the exact Tampa Accela h1 status from adjacent HTML spans', () => {
    const page = [
      '<h1><span id="ctl00_PlaceHolderMain_lblPermitNumber">BLD-26-0526342-REV1</span></h1>',
      '<div id="ctl00_PlaceHolderMain_divRecordStatus" class="dv-recordstatus">',
      '<h1><span id="ctl00_PlaceHolderMain_lblRecordStatusTitle">Record Status:</span>&nbsp;',
      '<span id="ctl00_PlaceHolderMain_lblRecordStatus">Complete</span></h1></div>',
    ].join('');

    expect(extractPermitPortalStatus(page, 'BLD-26-0526342-REV1')).toEqual({
      result: 'checked',
      status: 'Complete',
      message: null,
    });
  });

  it('reads the heading-formatted markdown representation', () => {
    expect(
      extractPermitPortalStatus(
        '# Record BLD-26-0526342-REV1\n## Record Status: Complete',
        'BLD-26-0526342-REV1',
      ),
    ).toEqual({ result: 'checked', status: 'Complete', message: null });
  });

  it('reads a markdown heading whose adjacent-span value was placed on the next line', () => {
    expect(
      extractPermitPortalStatus(
        '# Record BLD-26-0526342-REV1\n## Record Status:\nComplete',
        'BLD-26-0526342-REV1',
      ),
    ).toEqual({ result: 'checked', status: 'Complete', message: null });
  });

  it('does not trust a status in adjacent HTML spans when the page names another permit', () => {
    const page = [
      '<h1><span id="ctl00_PlaceHolderMain_lblPermitNumber">BLD-26-0526342-REV2</span></h1>',
      '<h1><span id="ctl00_PlaceHolderMain_lblRecordStatusTitle">Record Status:</span>&nbsp;',
      '<span id="ctl00_PlaceHolderMain_lblRecordStatus">Complete</span></h1>',
    ].join('');

    expect(extractPermitPortalStatus(page, 'BLD-26-0526342-REV1')).toEqual({
      result: 'unverified',
      status: null,
      message: 'The public page did not confirm this permit number.',
    });
  });

  it('does not infer public status from an applicant-only Application Status field', () => {
    const result = extractPermitPortalStatus(
      '# Record BLD-27-0529173\nApplication Status: Submitted',
      'BLD-27-0529173',
    );

    expect(result).toEqual({
      result: 'unverified',
      status: null,
      message: 'The public page did not show a readable public Record Status field.',
    });
  });

  it.each(['Status: In Process', 'Permit Status: In Process'])(
    'does not treat the unverified label %s as the public Record Status',
    (field) => {
      expect(extractPermitPortalStatus(`# Record BLD-27-0529173\n${field}`, 'BLD-27-0529173')).toEqual({
        result: 'unverified',
        status: null,
        message: 'The public page did not show a readable public Record Status field.',
      });
    },
  );

  it('does not accept a status when the public page does not confirm the requested permit', () => {
    const result = extractPermitPortalStatus('# Record BLD-27-0529172\nRecord Status: Issued', 'BLD-27-0529173');

    expect(result).toEqual({
      result: 'unverified',
      status: null,
      message: 'The public page did not confirm this permit number.',
    });
  });

  it('does not accept a longer near-match permit identifier as the requested record', () => {
    const result = extractPermitPortalStatus(
      '# Record BLD-27-05291731\nRecord Status: Issued',
      'BLD-27-0529173',
    );

    expect(result).toEqual({
      result: 'unverified',
      status: null,
      message: 'The public page did not confirm this permit number.',
    });
  });

  it('does not accept the requested identifier as a prefix of another hyphenated record', () => {
    const result = extractPermitPortalStatus(
      '# Record BLD-27-0529173-OTHER\nRecord Status: Issued',
      'BLD-27-0529173',
    );

    expect(result).toEqual({
      result: 'unverified',
      status: null,
      message: 'The public page did not confirm this permit number.',
    });
  });

  it('accepts City status labels without mapping them onto the team status choices', () => {
    const result = extractPermitPortalStatus(
      'Record Number: BLD-27-0529173\nRecord Status: Review Complete – Fees Due',
      'BLD-27-0529173',
    );

    expect(result).toEqual({
      result: 'checked',
      status: 'Review Complete – Fees Due',
      message: null,
    });
  });

  it('accepts the verified City of Tampa direct record link and rejects other jurisdictions', () => {
    expect(
      PermitPortalUrl.safeParse(
        'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
      ).success,
    ).toBe(true);
    expect(PermitPortalUrl.safeParse('https://example.invalid/search/').success).toBe(false);
    expect(
      PermitPortalUrl.safeParse(
        'https://aca-prod.accela.com/HILLSBOROUGH/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=HILLSBOROUGH',
      ).success,
    ).toBe(false);
  });
});

describe('public permit status transition eligibility', () => {
  it.each(['unverified', 'unavailable'] as const)(
    'never creates a status transition from a %s result',
    (result) => {
      expect(
        shouldRecordPortalStatusTransition({
          result,
          isCurrentSourceObservation: true,
          previousStatus: 'Complete',
          status: 'Issued',
        }),
      ).toBe(false);
    },
  );

  it('does not create a transition for an unchanged or stale successful observation', () => {
    expect(
      shouldRecordPortalStatusTransition({
        result: 'checked',
        isCurrentSourceObservation: true,
        previousStatus: 'Complete',
        status: ' complete  ',
      }),
    ).toBe(false);
    expect(
      shouldRecordPortalStatusTransition({
        result: 'checked',
        isCurrentSourceObservation: false,
        previousStatus: 'Complete',
        status: 'Issued',
      }),
    ).toBe(false);
  });

  it('allows a transition only for a verified current status that differs', () => {
    expect(
      shouldRecordPortalStatusTransition({
        result: 'checked',
        isCurrentSourceObservation: true,
        previousStatus: 'Complete',
        status: 'Issued',
      }),
    ).toBe(true);
  });
});

describe('per-permit portal monitoring state from saved check history', () => {
  const lastSuccess = new Date('2026-10-01T12:00:00.000Z');
  const lastFailure = new Date('2026-10-02T12:00:00.000Z');

  it.each(['unverified', 'unavailable'] as const)(
    'retains the last verified check and an explicit %s reason',
    (result) => {
      expect(
        portalMonitoringFromHistory(
          { checkedAt: lastSuccess },
          {
            checkedAt: lastFailure,
            result,
            message: 'The public City record could not be verified.',
          },
        ),
      ).toEqual({
        lastSuccessfulPortalCheckAt: lastSuccess,
        portalMonitoringInterruptedAt: lastFailure,
        portalMonitoringReason: 'The public City record could not be verified.',
      });
    },
  );

  it('clears the current interruption when the latest saved check succeeds', () => {
    const recoveryAt = new Date('2026-10-03T12:00:00.000Z');
    expect(
      portalMonitoringFromHistory(
        { checkedAt: recoveryAt },
        { checkedAt: recoveryAt, result: 'checked', message: null },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: recoveryAt,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    });
  });

  it('keeps an older failure from restoring interruption after a newer success is saved', () => {
    const newerSuccess = new Date('2026-10-03T12:00:00.000Z');
    expect(
      portalMonitoringFromHistory(
        { checkedAt: newerSuccess },
        { checkedAt: newerSuccess, result: 'checked', message: null },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: newerSuccess,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    });
  });

  it('leaves the last successful time empty before the first successful check', () => {
    expect(
      portalMonitoringFromHistory(null, {
        checkedAt: lastFailure,
        result: 'unavailable',
        message: 'The public City record could not be read.',
      }),
    ).toEqual({
      lastSuccessfulPortalCheckAt: null,
      portalMonitoringInterruptedAt: lastFailure,
      portalMonitoringReason: 'The public City record could not be read.',
    });
  });

  it('does not let an older failed transaction overwrite a committed success', () => {
    const newerSuccess = new Date('2026-10-03T12:00:00.000Z');
    expect(
      applyPortalMonitoringOutcome(
        {
          lastSuccessfulPortalCheckAt: newerSuccess,
          portalMonitoringInterruptedAt: null,
          portalMonitoringReason: null,
        },
        {
          result: 'unavailable',
          checkedAt: lastFailure,
          requestSequence: 1,
          message: 'A concurrent request could not read the portal.',
        },
        { checkedAt: newerSuccess, requestSequence: 2 },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: newerSuccess,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    });
  });

  it('does not let an older failed transaction restore an interruption after recovery', () => {
    const newerSuccess = new Date('2026-10-03T12:00:00.000Z');
    expect(
      applyPortalMonitoringOutcome(
        {
          lastSuccessfulPortalCheckAt: newerSuccess,
          portalMonitoringInterruptedAt: null,
          portalMonitoringReason: null,
        },
        {
          result: 'unverified',
          checkedAt: lastFailure,
          requestSequence: 1,
          message: 'A stale response did not verify the record.',
        },
        { checkedAt: newerSuccess, requestSequence: 2 },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: newerSuccess,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    });
  });

  it('clears an interruption when a successful outcome ties its timestamp', () => {
    const tiedAt = new Date('2026-10-03T12:00:00.000Z');
    expect(
      applyPortalMonitoringOutcome(
        {
          lastSuccessfulPortalCheckAt: lastSuccess,
          portalMonitoringInterruptedAt: tiedAt,
          portalMonitoringReason: 'The latest portal attempt was unavailable.',
        },
        { result: 'checked', checkedAt: tiedAt, requestSequence: 8, message: null },
        { checkedAt: tiedAt, requestSequence: 7 },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: tiedAt,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    });
  });

  it('keeps a same-time failed outcome from replacing a success', () => {
    const tiedAt = new Date('2026-10-03T12:00:00.000Z');
    expect(
      applyPortalMonitoringOutcome(
        {
          lastSuccessfulPortalCheckAt: tiedAt,
          portalMonitoringInterruptedAt: null,
          portalMonitoringReason: null,
        },
        {
          result: 'unavailable',
          checkedAt: tiedAt,
          requestSequence: 6,
          message: 'A concurrent request could not read the portal.',
        },
        { checkedAt: tiedAt, requestSequence: 7 },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: tiedAt,
      portalMonitoringInterruptedAt: null,
      portalMonitoringReason: null,
    });
  });

  it('applies a same-time failure when its request sequence is newer', () => {
    const tiedAt = new Date('2026-10-03T12:00:00.000Z');
    expect(
      applyPortalMonitoringOutcome(
        {
          lastSuccessfulPortalCheckAt: tiedAt,
          portalMonitoringInterruptedAt: null,
          portalMonitoringReason: null,
        },
        {
          result: 'unverified',
          checkedAt: tiedAt,
          requestSequence: 8,
          message: 'The latest public record did not confirm the permit.',
        },
        { checkedAt: tiedAt, requestSequence: 7 },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: tiedAt,
      portalMonitoringInterruptedAt: tiedAt,
      portalMonitoringReason: 'The latest public record did not confirm the permit.',
    });
  });

  it('does not clear a same-time interruption from an older request sequence', () => {
    const tiedAt = new Date('2026-10-03T12:00:00.000Z');
    expect(
      applyPortalMonitoringOutcome(
        {
          lastSuccessfulPortalCheckAt: lastSuccess,
          portalMonitoringInterruptedAt: tiedAt,
          portalMonitoringReason: 'The later request could not read the City record.',
        },
        { result: 'checked', checkedAt: tiedAt, requestSequence: 6, message: null },
        { checkedAt: tiedAt, requestSequence: 7 },
      ),
    ).toEqual({
      lastSuccessfulPortalCheckAt: tiedAt,
      portalMonitoringInterruptedAt: tiedAt,
      portalMonitoringReason: 'The later request could not read the City record.',
    });
  });
});

describe('public status freshness and request ordering', () => {
  it('rejects equal or older source reads as new observations', () => {
    const sourceRead = new Date('2026-10-01T10:00:00.000Z');
    expect(isNewerPortalPageRead(sourceRead, sourceRead)).toBe(false);
    expect(isNewerPortalPageRead(new Date('2026-10-01T09:59:59.000Z'), sourceRead)).toBe(false);
    expect(isNewerPortalPageRead(new Date('2026-10-01T10:00:01.000Z'), sourceRead)).toBe(true);
  });

  it('uses request sequence to order observations with the same request time', () => {
    const checkedAt = new Date('2026-10-01T10:00:00.000Z');
    expect(
      isPortalObservationLater(
        { checkedAt, requestSequence: 8 },
        { checkedAt, requestSequence: 7 },
      ),
    ).toBe(true);
    expect(
      isPortalObservationLater(
        { checkedAt, requestSequence: 7 },
        { checkedAt, requestSequence: 8 },
      ),
    ).toBe(false);
  });
});

describe('source page freshness for public status transitions', () => {
  it('accepts a newer fetched page and rejects an equal or older cached page', () => {
    const previous = new Date('2026-10-20T12:00:00.000Z');
    expect(isNewerPortalPageRead(new Date('2026-10-21T12:00:00.000Z'), previous)).toBe(true);
    expect(isNewerPortalPageRead(previous, previous)).toBe(false);
    expect(isNewerPortalPageRead(new Date('2026-10-19T12:00:00.000Z'), previous)).toBe(false);
    expect(isNewerPortalPageRead(previous, null)).toBe(true);
  });
});

describe('portal observation order', () => {
  it('uses request sequence to preserve a genuine transition when checkedAt ties', () => {
    const checkedAt = new Date('2026-10-31T10:00:00.000Z');

    expect(
      isPortalObservationLater(
        { checkedAt, requestSequence: 8 },
        { checkedAt, requestSequence: 7 },
      ),
    ).toBe(true);
    expect(
      isPortalObservationLater(
        { checkedAt, requestSequence: 6 },
        { checkedAt, requestSequence: 7 },
      ),
    ).toBe(false);
  });

  it('keeps an earlier timestamp historical even if its request sequence is larger', () => {
    expect(
      isPortalObservationLater(
        {
          checkedAt: new Date('2026-10-31T09:59:59.999Z'),
          requestSequence: 20,
        },
        {
          checkedAt: new Date('2026-10-31T10:00:00.000Z'),
          requestSequence: 19,
        },
      ),
    ).toBe(false);
  });
});

describe('owner interruption notification transitions', () => {
  const checkedAt = new Date('2026-10-31T10:00:00.000Z');

  it('notifies on a new unavailable or unverified current outcome', () => {
    for (const result of ['unavailable', 'unverified'] as const) {
      expect(
        isNewPortalMonitoringInterruption(
          { result, checkedAt, requestSequence: 1, message: 'The City page could not be read.' },
          null,
        ),
      ).toBe(true);
    }
  });

  it('does not notify again for the same current failure result and reason', () => {
    expect(
      isNewPortalMonitoringInterruption(
        {
          result: 'unavailable',
          checkedAt: new Date(checkedAt.getTime() + 1_000),
          requestSequence: 2,
          message: 'The City page could not be read.',
        },
        {
          result: 'unavailable',
          checkedAt,
          requestSequence: 1,
          message: 'The City page could not be read.',
        },
      ),
    ).toBe(false);
  });

  it('notifies again for a changed result or reason and after a successful check clears the interruption', () => {
    const previous = {
      result: 'unavailable',
      checkedAt,
      requestSequence: 1,
      message: 'The City page could not be read.',
    };
    expect(
      isNewPortalMonitoringInterruption(
        {
          result: 'unverified',
          checkedAt: new Date(checkedAt.getTime() + 1_000),
          requestSequence: 2,
          message: 'The permit number was not confirmed.',
        },
        previous,
      ),
    ).toBe(true);
    expect(
      isNewPortalMonitoringInterruption(
        {
          result: 'unavailable',
          checkedAt: new Date(checkedAt.getTime() + 1_000),
          requestSequence: 2,
          message: 'The City page timed out.',
        },
        previous,
      ),
    ).toBe(true);
    expect(
      isNewPortalMonitoringInterruption(
        {
          result: 'unverified',
          checkedAt: new Date(checkedAt.getTime() + 2_000),
          requestSequence: 4,
          message: 'The permit number was not confirmed.',
        },
        {
          result: 'checked',
          checkedAt: new Date(checkedAt.getTime() + 1_500),
          requestSequence: 3,
          message: null,
        },
      ),
    ).toBe(true);
  });

  it('does not notify for successful or historical outcomes', () => {
    expect(
      isNewPortalMonitoringInterruption(
        { result: 'checked', checkedAt, requestSequence: 2, message: null },
        {
          result: 'unavailable',
          checkedAt: new Date(checkedAt.getTime() - 1_000),
          requestSequence: 1,
          message: 'The City page could not be read.',
        },
      ),
    ).toBe(false);
    expect(
      isNewPortalMonitoringInterruption(
        {
          result: 'unavailable',
          checkedAt: new Date(checkedAt.getTime() - 1_000),
          requestSequence: 1,
          message: 'A late response could not read the City page.',
        },
        {
          result: 'checked',
          checkedAt,
          requestSequence: 2,
          message: null,
        },
      ),
    ).toBe(false);
  });
});
