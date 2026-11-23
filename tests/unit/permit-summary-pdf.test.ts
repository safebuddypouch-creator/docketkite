// @polsia:user-owned — public permit PDF content and check selection tests.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPermitSummaryPdf, type PermitSummaryPdfCheck } from '@/lib/business/permit-summary-pdf';

const recordUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

function check(overrides: Partial<PermitSummaryPdfCheck> = {}): PermitSummaryPdfCheck {
  return {
    id: 'check-1',
    permitNumber: 'BLD-27-0529173',
    sourceUrl: recordUrl,
    status: 'Under Review',
    result: 'checked',
    checkedAt: new Date('2026-11-14T09:12:30.000Z'),
    requestSequence: 1,
    sourceFetchedAt: new Date('2026-11-14T09:12:28.000Z'),
    ...overrides,
  };
}

describe('Tampa permit summary PDF content', () => {
  it('uses the newest eligible successful check and omits private notes', () => {
    const older = check({ id: 'old', status: 'Submitted', checkedAt: new Date('2026-11-10T09:00:00Z') });
    const newestSuccess = check({
      id: 'latest-success',
      status: 'Corrections Requested',
      checkedAt: new Date('2026-11-14T09:12:30.000Z'),
      requestSequence: 5,
    });
    const record = {
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: recordUrl,
      notes: 'PRIVATE PERMIT NOTES MUST NOT APPEAR',
      portalStatusChecks: [
        older,
        newestSuccess,
        check({
          id: 'later-failure',
          result: 'unavailable',
          status: null,
          checkedAt: new Date('2026-11-15T09:12:30.000Z'),
          requestSequence: 6,
        }),
        check({
          id: 'later-unverified',
          result: 'unverified',
          status: null,
          checkedAt: new Date('2026-11-16T09:12:30.000Z'),
          requestSequence: 7,
        }),
      ],
    };

    const result = buildPermitSummaryPdf(record);

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('Expected permit summary data to be available.');
    const content = JSON.stringify(result.spec);
    expect(content).toContain('BLD-27-0529173');
    expect(content).toContain('101 Sample Street, Tampa, FL');
    expect(content).toContain('Corrections Requested');
    expect(content).toContain('2026-11-14 09:12:30.000 UTC');
    expect(content).toContain(recordUrl);
    expect(content).not.toContain('PRIVATE PERMIT NOTES MUST NOT APPEAR');
    expect(content).not.toContain('later-failure');
    expect(content).not.toContain('later-unverified');
  });

  it('says the verified result and UTC check time are unavailable when there is no successful check', () => {
    const result = buildPermitSummaryPdf({
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: recordUrl,
      portalStatusChecks: [check({ result: 'unverified', status: null })],
    });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('Expected the saved official link to keep the PDF available.');
    const content = JSON.stringify(result.spec);
    expect(content).toContain('No verified result available.');
    expect(content).toContain('Not available');
    expect(content).toContain(recordUrl);
  });

  it('does not use a generic or unsupported URL when no official record link is saved', () => {
    const result = buildPermitSummaryPdf({
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: 'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx',
      portalStatusChecks: [check({ sourceUrl: null })],
    });

    expect(result).toMatchObject({
      available: false,
      error: 'official_record_link_required',
    });
  });

  it('requires the official URL saved with the latest successful check', () => {
    const result = buildPermitSummaryPdf({
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: recordUrl,
      portalStatusChecks: [check({ sourceUrl: 'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx' })],
    });

    expect(result).toMatchObject({
      available: false,
      error: 'official_record_link_required',
    });
  });

  it('does not attach an older check to a changed permit reference', () => {
    const result = buildPermitSummaryPdf({
      permitNumber: 'BLD-27-9999999',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: recordUrl,
      portalStatusChecks: [check({ status: 'Issued' })],
    });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('Expected the saved official link to keep the PDF available.');
    const content = JSON.stringify(result.spec);
    expect(content).toContain('No verified result available.');
    expect(content).not.toContain('Issued');
  });

  it('keeps the download unavailable until the permit reference is present', () => {
    expect(
      buildPermitSummaryPdf({
        permitNumber: ' ',
        address: '101 Sample Street, Tampa, FL',
        portalUrl: recordUrl,
        portalStatusChecks: [],
      }),
    ).toMatchObject({ available: false, error: 'permit_reference_required' });
  });
});
