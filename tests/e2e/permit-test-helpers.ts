// @polsia:user-owned — synthetic direct City of Tampa Accela URLs for integration tests.
export function tampaRecordUrl(
  permitNumber: string,
  extraQuery: Record<string, string> = {},
): string {
  const url = new URL('https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx');
  url.searchParams.set('Module', 'Building');
  url.searchParams.set('TabName', 'Building');
  url.searchParams.set('capID1', '26CAP');
  url.searchParams.set('capID2', '00000');
  url.searchParams.set('capID3', permitNumber);
  url.searchParams.set('agencyCode', 'TAMPA');
  url.searchParams.set('permit', permitNumber);
  for (const [key, value] of Object.entries(extraQuery)) url.searchParams.set(key, value);
  return url.toString();
}
