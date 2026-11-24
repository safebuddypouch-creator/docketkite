// @polsia:user-owned — direct Accela CapDetail fetch without Polsia.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  fetchPermitPortalPage,
  PermitPortalInvalidUrlError,
  PermitPortalPageUnavailableError,
} from '@/lib/business/permit-portal-page-fetch';

const OFFICIAL_URL =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchPermitPortalPage', () => {
  it('rejects non-official URLs before calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPermitPortalPage({ url: 'https://evil.example/CapDetail.aspx' }),
    ).rejects.toBeInstanceOf(PermitPortalInvalidUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns Accela HTML as markdown for status extraction', async () => {
    const html = `<html><head><title>Record Detail</title></head><body>
      <span id="ctl00_PlaceHolderMain_lblPermitNumber">BLD-27-0529173</span>
      <span id="ctl00_PlaceHolderMain_lblRecordStatusTitle">Record Status:</span>
      <span id="ctl00_PlaceHolderMain_lblRecordStatus">In Process</span>
    </body></html>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        url: OFFICIAL_URL,
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      })),
    );

    const page = await fetchPermitPortalPage({ url: OFFICIAL_URL });

    expect(page.title).toBe('Record Detail');
    expect(page.markdown).toContain('Record Status:');
    expect(page.markdown).toContain('In Process');
    expect(page.truncated).toBe(false);
    expect(page.cached).toBe(false);
  });

  it('maps non-OK HTTP responses to unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        url: OFFICIAL_URL,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    await expect(fetchPermitPortalPage({ url: OFFICIAL_URL })).rejects.toBeInstanceOf(
      PermitPortalPageUnavailableError,
    );
  });

  it('rejects when the final redirect leaves the official Accela record URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        url: 'https://evil.example/phish',
        arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
      })),
    );

    await expect(fetchPermitPortalPage({ url: OFFICIAL_URL })).rejects.toBeInstanceOf(
      PermitPortalInvalidUrlError,
    );
  });
});
