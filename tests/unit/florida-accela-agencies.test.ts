// @polsia:user-owned — Florida Accela allowlist regression coverage.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FLORIDA_ACCELA_AGENCIES,
  floridaAccelaAgenciesByName,
  floridaAccelaPortalHomeUrl,
  isFloridaAccelaAgencyCode,
} from '@/lib/business/florida-accela-agencies';
import { PermitFields } from '@/lib/contracts/permit';

const requiredFields = {
  projectName: 'Kitchen Remodel',
  address: '101 Sample Street, Tampa, FL',
  permitNumber: 'BLD-27-0529173',
  permitType: 'Building',
  status: 'Planning',
  notes: '',
} as const;

describe('Florida Accela agency allowlist', () => {
  it('lists unique uppercase agency codes including Tampa and Hillsborough', () => {
    const codes = FLORIDA_ACCELA_AGENCIES.map((agency) => agency.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('TAMPA');
    expect(codes).toContain('HCFL');
    expect(codes.every((code) => code === code.toUpperCase())).toBe(true);
  });

  it('rejects lookalike out-of-state Accela codes', () => {
    expect(isFloridaAccelaAgencyCode('CHARLOTTE')).toBe(false); // Mecklenburg NC
    expect(isFloridaAccelaAgencyCode('COSA')).toBe(false); // San Antonio TX
    expect(isFloridaAccelaAgencyCode('DENVER')).toBe(false);
  });

  it('accepts CapDetail Building URLs for every curated Florida agency', () => {
    for (const agency of FLORIDA_ACCELA_AGENCIES) {
      const portalUrl = `https://aca-prod.accela.com/${agency.code}/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=${agency.code}`;
      expect(PermitFields.parse({ ...requiredFields, portalUrl }).portalUrl).toBe(portalUrl);
    }
  });

  it('exposes sorted agency options with CapHome portal links', () => {
    const sorted = floridaAccelaAgenciesByName();
    expect(sorted).toHaveLength(FLORIDA_ACCELA_AGENCIES.length);
    expect(sorted.map((agency) => agency.name)).toEqual(
      [...FLORIDA_ACCELA_AGENCIES].map((agency) => agency.name).sort((a, b) => a.localeCompare(b)),
    );
    expect(floridaAccelaPortalHomeUrl('tampa')).toBe(
      'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
    );
    expect(floridaAccelaPortalHomeUrl('HCFL')).toContain('/HCFL/Cap/CapHome.aspx');
  });
});
