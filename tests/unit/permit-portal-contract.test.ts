// @polsia:user-owned — City of Tampa permit portal URL and legacy-record contract tests.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  getOfficialPermitPortalUrl,
  PermitCreate,
  PermitCreateFields,
  PermitFields,
  PermitItem,
  PermitPortalUrlUpdate,
} from '@/lib/contracts/permit';

const requiredFields = {
  projectName: 'Kitchen Remodel',
  address: '101 Sample Street, Tampa, FL',
  permitNumber: 'BLD-27-0529173',
  permitType: 'Building',
  status: 'Planning',
  notes: '',
} as const;

const tampaRecordUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

describe('City of Tampa permit portal URL contract', () => {
  it('defaults an omitted optional portal URL to an empty value', () => {
    expect(PermitFields.parse(requiredFields).portalUrl).toBe('');
  });

  it('requires a permit reference and direct official record URL only when creating', () => {
    const createFields = {
      ...requiredFields,
      permitNumber: 'BLD-27-0529173',
      portalUrl: tampaRecordUrl,
      teamId: 'team-1',
    };

    expect(PermitCreate.parse(createFields)).toMatchObject({
      permitNumber: 'BLD-27-0529173',
      portalUrl: tampaRecordUrl,
      teamId: 'team-1',
    });
    expect(
      PermitCreateFields.safeParse({
        ...requiredFields,
        permitNumber: '',
        portalUrl: tampaRecordUrl,
      }).success,
    ).toBe(false);
    expect(
      PermitCreateFields.safeParse({ ...requiredFields, permitNumber: 'BLD-27-0529173' }).success,
    ).toBe(false);
    expect(
      PermitCreateFields.safeParse({
        ...requiredFields,
        permitNumber: 'BLD-27-0529173',
        portalUrl:
          'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
      }).success,
    ).toBe(false);

    // Legacy list and edit parsing keep accepting records saved before these create requirements.
    expect(PermitFields.parse({ ...requiredFields, permitNumber: '' })).toMatchObject({
      permitNumber: '',
      portalUrl: '',
    });
  });

  it('accepts only a direct record URL from the official City of Tampa Accela Building agency', () => {
    expect(PermitFields.parse({ ...requiredFields, portalUrl: tampaRecordUrl }).portalUrl).toBe(
      tampaRecordUrl,
    );
    for (const portalUrl of [
      // Accela search results and shared links often change query-name casing.
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&CapID1=26CAP&CapID2=00000&CapID3=02UTH&agencyCode=tampa',
      'https://aca-prod.accela.com:443/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
    ]) {
      expect(PermitFields.parse({ ...requiredFields, portalUrl }).portalUrl).toBe(portalUrl);
    }
  });

  it('rejects other jurisdictions, portal landing/search pages, malformed links, and forged hosts', () => {
    for (const portalUrl of [
      'https://permits.example.invalid/record/2026-010101',
      'https://records.example.invalid/record/2026-010101',
      'https://aca-prod.accela.com/HILLSBOROUGH/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=HILLSBOROUGH',
      'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=OTHER',
      'http://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
      'https://aca-prod.accela.com.attacker.example/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
      'https://user@aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
      'https://aca-prod.accela.com:8443/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&agencyCode=TAMPA',
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA&agencyCode=TAMPA',
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA%20OTHER',
      'not a URL',
    ]) {
      expect(PermitFields.safeParse({ ...requiredFields, portalUrl }).success).toBe(false);
    }
  });

  it('keeps unsupported saved links loadable while excluding them from active coverage', () => {
    const oldLink = 'https://permits.example.invalid/record/2026-010101';
    const legacyPermit = {
      ...requiredFields,
      id: 'legacy-1',
      teamId: 'team-1',
      portalUrl: oldLink,
    };

    expect(PermitFields.shape.portalUrl.safeParse(oldLink).success).toBe(false);
    expect(PermitItem.shape.portalUrl.parse(oldLink)).toBe(oldLink);
    expect(getOfficialPermitPortalUrl(oldLink)).toBeNull();
    expect(getOfficialPermitPortalUrl(tampaRecordUrl)).toBe(tampaRecordUrl);
    expect(getOfficialPermitPortalUrl(` ${tampaRecordUrl}`)).toBeNull();
    expect(getOfficialPermitPortalUrl(`${tampaRecordUrl} `)).toBeNull();
    expect(PermitItem.shape.portalUrl.parse(legacyPermit.portalUrl)).toBe(oldLink);
  });

  it('requires the same direct Tampa record link when repairing a saved portal URL', () => {
    expect(PermitPortalUrlUpdate.safeParse({ portalUrl: tampaRecordUrl }).success).toBe(true);
    for (const portalUrl of ['', 'https://records.example.invalid/record/2026-010101']) {
      const parsed = PermitPortalUrlUpdate.safeParse({ portalUrl });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.flatten().fieldErrors.portalUrl?.[0]).toMatch(
          /direct (public City record URL|City of Tampa Building record URL)/i,
        );
      }
    }
  });

  it('does not treat a Tampa-looking job address as jurisdiction proof', () => {
    expect(
      PermitFields.safeParse({ ...requiredFields, address: '1 Tampa Bay Way, Tampa, FL' }).success,
    ).toBe(true);
    expect(
      PermitFields.safeParse({
        ...requiredFields,
        portalUrl:
          'https://aca-prod.accela.com/HILLSBOROUGH/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=HILLSBOROUGH',
      }).success,
    ).toBe(false);
  });
});
