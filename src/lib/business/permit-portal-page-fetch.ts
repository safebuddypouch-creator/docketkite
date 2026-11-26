// @polsia:user-owned — fetch Florida Accela record pages without Polsia.
import 'server-only';
import { OFFICIAL_FLORIDA_ACCELA_RECORD_URL_HINT } from '@/lib/business/florida-accela-agencies';
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;

export class PermitPortalPageUnavailableError extends Error {
  constructor(message = 'The public City record page could not be read.') {
    super(message);
    this.name = 'PermitPortalPageUnavailableError';
  }
}

export class PermitPortalInvalidUrlError extends Error {
  constructor(message = OFFICIAL_FLORIDA_ACCELA_RECORD_URL_HINT) {
    super(message);
    this.name = 'PermitPortalInvalidUrlError';
  }
}

export type PermitPortalFetchedPage = {
  markdown: string;
  title: string;
  truncated: boolean;
  cached: boolean;
  fetchedAt: string;
};

/**
 * Reads a public Florida Accela CapDetail page over HTTPS. Only allowlisted
 * Building record URLs are allowed, so the destination cannot be steered to
 * another host or unsupported agency.
 */
export async function fetchPermitPortalPage(input: {
  url: string;
  waitMs?: number;
}): Promise<PermitPortalFetchedPage> {
  const sourceUrl = getOfficialPermitPortalUrl(input.url);
  if (!sourceUrl) throw new PermitPortalInvalidUrlError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'user-agent': 'DocketKitePermitCheck/1.0 (+https://docketkite.apps.grok.bot)',
      },
    });
    if (!response.ok) {
      throw new PermitPortalPageUnavailableError('The public City record page could not be read.');
    }
    // Refuse a redirect that left the official Building record host/path shape.
    if (!getOfficialPermitPortalUrl(response.url.split('#')[0] ?? response.url)) {
      throw new PermitPortalInvalidUrlError();
    }
    const buffer = await response.arrayBuffer();
    const truncated = buffer.byteLength > MAX_BYTES;
    const bytes = truncated ? buffer.slice(0, MAX_BYTES) : buffer;
    const markdown = new TextDecoder('utf-8').decode(bytes);
    const titleMatch = markdown.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || 'Florida Accela record';
    return {
      markdown,
      title,
      truncated,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (
      error instanceof PermitPortalInvalidUrlError ||
      error instanceof PermitPortalPageUnavailableError
    ) {
      throw error;
    }
    throw new PermitPortalPageUnavailableError('The public City record page could not be read.');
  } finally {
    clearTimeout(timer);
  }
}
