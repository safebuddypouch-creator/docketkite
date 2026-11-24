// @polsia:user-owned — validate a saved permit portal URL before public retrieval.
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';
import type { PermitPortalFetchedPage } from '@/lib/business/permit-portal-page-fetch';

export type PermitPortalPageFetcher = (input: {
  url: string;
  waitMs: number;
}) => Promise<PermitPortalFetchedPage>;

export type PermitPortalPageRead =
  | { kind: 'invalid_url' }
  | { kind: 'missing_permit_number'; sourceUrl: string }
  | { kind: 'fetched'; sourceUrl: string; page: PermitPortalFetchedPage }
  | { kind: 'failed'; sourceUrl: string; error: unknown };

export async function readPermitPortalPage(
  savedUrl: string | null,
  permitNumber: string,
  fetcher: PermitPortalPageFetcher,
): Promise<PermitPortalPageRead> {
  const sourceUrl = getOfficialPermitPortalUrl(savedUrl ?? '');
  if (!sourceUrl) return { kind: 'invalid_url' };
  if (!permitNumber.trim()) return { kind: 'missing_permit_number', sourceUrl };

  try {
    const page = await fetcher({ url: sourceUrl, waitMs: 5000 });
    return { kind: 'fetched', sourceUrl, page };
  } catch (error) {
    return { kind: 'failed', sourceUrl, error };
  }
}
