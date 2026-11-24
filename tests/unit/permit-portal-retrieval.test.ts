// @polsia:user-owned — saved permit portal validation before retrieval tests.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readPermitPortalPage } from '@/lib/business/permit-portal-retrieval';
import type { PermitPortalFetchedPage } from '@/lib/business/permit-portal-page-fetch';

const SAMPLE_PAGE: PermitPortalFetchedPage = {
  markdown: 'Record Status: In Process\nPermit Number: BLD-27-0529173',
  title: 'City of Tampa Accela record',
  truncated: false,
  cached: false,
  fetchedAt: '2026-03-24T12:00:00.000Z',
};

describe('permit portal page retrieval guard', () => {
  it.each([
    '',
    'not a URL',
    'http://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
    'https://permits.sanjoseca.gov/record/2026-040404',
    'https://aca-prod.accela.com/HILLSBOROUGH/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=HILLSBOROUGH',
    'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building',
    'https://third-party.example/record/2026-040404',
    'https://sanjoseca.gov.attacker.example/permit/2026-040404',
    'https://user:password@aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
    'https://aca-prod.accela.com:8443/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
    ' https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA',
    'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA ',
    'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=%zz&agencyCode=TAMPA',
    'https://sanjoseca..gov/record/2026-040404',
  ])('rejects unsupported saved URL %s without calling the page retriever', async (savedUrl) => {
    const fetcher = vi.fn(async () => SAMPLE_PAGE);

    const result = await readPermitPortalPage(savedUrl, '2026-040404', fetcher);

    expect(result).toEqual({ kind: 'invalid_url' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retrieves a valid official portal URL through the supplied page fetcher', async () => {
    const fetcher = vi.fn(async () => SAMPLE_PAGE);
    const sourceUrl =
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

    const result = await readPermitPortalPage(sourceUrl, '2026-040404', fetcher);

    expect(fetcher).toHaveBeenCalledExactlyOnceWith({ url: sourceUrl, waitMs: 5000 });
    expect(result).toEqual({ kind: 'fetched', sourceUrl, page: SAMPLE_PAGE });
  });

  it('does not retrieve a valid portal link when the permit number is missing', async () => {
    const fetcher = vi.fn(async () => SAMPLE_PAGE);
    const sourceUrl =
      'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

    const result = await readPermitPortalPage(sourceUrl, '  ', fetcher);

    expect(result).toEqual({ kind: 'missing_permit_number', sourceUrl });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
