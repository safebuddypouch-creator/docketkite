// @polsia:user-owned — remote letter URLs are never fetched (SSRF guard).

/**
 * Stored letter URLs are not requested by the server. Letter bytes come from
 * Postgres. Every remote URL, including R2, is refused.
 */
export function isAllowedLegacyLetterSourceUrl(_fileUrl: string): boolean {
  return false;
}
