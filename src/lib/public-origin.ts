// @polsia:user-owned — public origin for canonical, Open Graph, and JSON-LD.
// A loopback NEXT_PUBLIC_APP_URL is the unset-build fallback, not the live site.

/** The published DocketKite origin. Not a DNS change. */
export const publishedOrigin = 'https://docketkite.apps.grok.bot';

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** Configured public origin, or the published site when that value is missing or loopback. */
export function publicOrigin(configured = process.env.NEXT_PUBLIC_APP_URL): string {
  const value = configured?.trim().replace(/\/+$/, '');
  if (!value) return publishedOrigin;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return publishedOrigin;
    if (isLoopback(url.hostname)) return publishedOrigin;
    return url.origin;
  } catch {
    return publishedOrigin;
  }
}

/** Absolute URL on the public origin. `path` is app-absolute (`/` or `/pricing`). */
export function publicUrl(path: string, configured?: string): string {
  const origin = publicOrigin(configured);
  if (path === '/' || path === '') return `${origin}/`;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export function publicSocialImage(alt = 'DocketKite') {
  return {
    url: publicUrl('/opengraph-image'),
    alt,
    width: 1200,
    height: 630,
  };
}
