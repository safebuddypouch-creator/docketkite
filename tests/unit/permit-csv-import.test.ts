// @polsia:user-owned — regression coverage for City of Tampa permit CSV validation.
import { describe, expect, it } from 'vitest';
import {
  parsePermitImportKey,
  parsePermitImportRow,
  permitImportKey,
} from '@/lib/business/permit-csv-import';
import { CSV_LIMITS } from '@/modules/csv-import/contracts';
import { decodeCsv, parseCsv } from '@/modules/csv-import/parser';

const validRow = {
  project_name: 'Kitchen remodel',
  job_address: '101 Sample Street, Tampa, FL 33602',
  permit_number: '0012',
  permit_type: 'Building',
  status: 'Planning',
  notes: 'Sample note',
  portal_url:
    'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
};

describe('permit CSV rows', () => {
  it('uses the CSV module limits for UTF-8 bytes and record counts', () => {
    expect(CSV_LIMITS.bytes).toBe(10_485_760);
    expect(CSV_LIMITS.records).toBe(10_000);
    expect(() => decodeCsv(Uint8Array.from([0xff]))).toThrow();
    expect(() => parseCsv(`col\n${'x'.repeat(CSV_LIMITS.bytes)}`, ',')).toThrow(
      /10 Mio/,
    );
    const rows = Array.from({ length: CSV_LIMITS.records }, () => 'x').join('\n');
    expect(parseCsv(`col\n${rows}`, ',').rows).toHaveLength(CSV_LIMITS.records);
    expect(() => parseCsv(`col\n${rows}\nx`, ',')).toThrow(/10.000/);
  });

  it('accepts supported permit fields and defaults optional columns when the record link is present', () => {
    const parsed = parsePermitImportRow({
      project_name: 'Kitchen remodel',
      job_address: '101 Sample Street, Tampa, Florida 33602',
      permit_type: 'Building',
      status: 'Planning',
      portal_url: validRow.portal_url,
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        projectName: 'Kitchen remodel',
        address: '101 Sample Street, Tampa, Florida 33602',
        permitNumber: '',
        permitType: 'Building',
        status: 'Planning',
        notes: '',
        portalUrl: validRow.portal_url,
      },
    });
  });

  it('reports each required field and rejects unsupported permit types and statuses', () => {
    const missing = parsePermitImportRow({});
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('Missing required fields must be invalid.');
    expect(missing.issues.map((issue) => issue.field)).toEqual([
      'project_name',
      'job_address',
      'permit_type',
      'status',
    ]);

    const permitType = parsePermitImportRow({ ...validRow, permit_type: 'Solar' });
    expect(permitType).toMatchObject({
      ok: false,
      issues: [{ field: 'permit_type', message: expect.stringContaining('Building, Electrical') }],
    });

    const status = parsePermitImportRow({ ...validRow, status: 'Approved' });
    expect(status).toMatchObject({
      ok: false,
      issues: [{ field: 'status', message: expect.stringContaining('Corrections requested, Issued') }],
    });
  });

  it('rejects a missing direct record link as a portal_url row issue', () => {
    expect(parsePermitImportRow({ ...validRow, portal_url: '' })).toMatchObject({
      ok: false,
      issues: [
        {
          field: 'portal_url',
          message: expect.stringContaining('Every imported permit must include'),
        },
      ],
    });
  });

  it('does not infer City jurisdiction from a mailing address', () => {
    for (const job_address of ['101 Sample Street, Hillsborough County, FL', '101 Sample Street, St. Petersburg, FL']) {
      const result = parsePermitImportRow({ ...validRow, job_address });
      expect(result.ok).toBe(true);
    }
  });

  it('accepts direct Tampa Accela records and rejects legacy or other-jurisdiction links', () => {
    const tampaRecordUrl =
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';
    expect(parsePermitImportRow({ ...validRow, portal_url: tampaRecordUrl }).ok).toBe(true);
    for (const portalUrl of [
      'https://permits.example.invalid/record/2019-010101',
      'https://records.example.invalid/record/2019-010101',
      'https://aca-prod.accela.com/HILLSBOROUGH/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=HILLSBOROUGH',
      'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=OTHER',
      'https://example.test/record/2019-010101',
    ]) {
      const result = parsePermitImportRow({ ...validRow, portal_url: portalUrl });
      expect(result).toMatchObject({
        ok: false,
        issues: [{ field: 'portal_url' }],
      });
    }
  });

  it('uses permit-number or project/address/type keys without losing leading zeroes', () => {
    const parsed = parsePermitImportRow(validRow);
    if (!parsed.ok) throw new Error('The key fixture must be valid.');
    const key = permitImportKey(parsed.value);
    expect(key).toBe('number:0012');
    expect(parsePermitImportKey(key)).toEqual({ kind: 'number', permitNumber: '0012' });

    const noNumber = parsePermitImportRow({ ...validRow, permit_number: '' });
    if (!noNumber.ok) throw new Error('The fallback key fixture must be valid.');
    expect(parsePermitImportKey(permitImportKey(noNumber.value))).toEqual({
      kind: 'fields',
      projectName: 'kitchen remodel',
      address: '101 sample street, tampa, fl 33602',
      permitType: 'building',
    });

    const unaccentedAddress = parsePermitImportRow({
      ...validRow,
      job_address: '101 Sample Street, Tampa, FL 33602',
      permit_number: '',
    });
    if (!unaccentedAddress.ok) throw new Error('The unaccented fixture must be valid.');
    expect(permitImportKey(unaccentedAddress.value)).toBe(permitImportKey(noNumber.value));
  });
});
