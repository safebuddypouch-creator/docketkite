// @polsia:user-owned — curated Florida Accela Citizen Access Building agencies.
/**
 * Agency path/agencyCode values verified on aca-prod.accela.com CapHome Building
 * pages. Exclude lookalike codes that resolve to other states (e.g. CHARLOTTE =
 * Mecklenburg NC, COSA = San Antonio TX).
 */
export type FloridaAccelaAgency = {
  /** Uppercase Accela path segment and agencyCode. */
  code: string;
  name: string;
};

export const FLORIDA_ACCELA_AGENCIES: readonly FloridaAccelaAgency[] = [
  { code: 'BREVARD', name: 'Brevard County' },
  { code: 'BOCC', name: 'Charlotte County' },
  { code: 'CITRUS', name: 'Citrus County' },
  { code: 'CLEARWATER', name: 'City of Clearwater' },
  { code: 'FTL', name: 'City of Fort Lauderdale' },
  { code: 'HCFL', name: 'Hillsborough County' },
  { code: 'LEONCO', name: 'Leon County' },
  { code: 'MANATEE', name: 'Manatee County' },
  { code: 'MARTINCO', name: 'Martin County' },
  { code: 'PASCO', name: 'Pasco County' },
  { code: 'PINELLAS', name: 'Pinellas County' },
  { code: 'POLKCO', name: 'Polk County' },
  { code: 'SARASOTACO', name: 'Sarasota County' },
  { code: 'SEMINOLECO', name: 'Seminole County' },
  { code: 'TAMPA', name: 'City of Tampa' },
] as const;

const FLORIDA_ACCELA_AGENCY_CODES = new Set(FLORIDA_ACCELA_AGENCIES.map((agency) => agency.code));

export const OFFICIAL_FLORIDA_ACCELA_RECORD_URL_HINT =
  'Enter a direct Florida Accela Building record URL from an official supported portal.';

export function normalizeAccelaAgencyCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isFloridaAccelaAgencyCode(value: string): boolean {
  return FLORIDA_ACCELA_AGENCY_CODES.has(normalizeAccelaAgencyCode(value));
}

export function getFloridaAccelaAgency(code: string): FloridaAccelaAgency | undefined {
  const normalized = normalizeAccelaAgencyCode(code);
  return FLORIDA_ACCELA_AGENCIES.find((agency) => agency.code === normalized);
}

/** Official Building CapHome for a curated Florida Accela agency. */
export function floridaAccelaPortalHomeUrl(code: string): string {
  return `https://aca-prod.accela.com/${normalizeAccelaAgencyCode(code)}/Cap/CapHome.aspx?TabName=Building&module=Building`;
}

/** Agencies sorted by display name for selects and coverage lists. */
export function floridaAccelaAgenciesByName(): FloridaAccelaAgency[] {
  return [...FLORIDA_ACCELA_AGENCIES].sort((a, b) => a.name.localeCompare(b.name));
}
