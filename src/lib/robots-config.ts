// @polsia:user-owned — crawl rules merged into /robots.txt (robots.ts is
// framework-owned). Applied only when the deploy is indexable (SEO_INDEXABLE).

// The public site is crawlable unless a deploy explicitly sets SEO_INDEXABLE=false.
// robots.ts reads the flag once, after this module loads.
if (process.env.SEO_INDEXABLE !== 'true' && process.env.SEO_INDEXABLE !== 'false') {
  process.env.SEO_INDEXABLE = 'true';
}

export const robotsConfig = {
  /** Private app paths. `/` stays allowed. */
  disallow: ['/admin', '/dashboard', '/api'] as string[],
  /** Optional crawl-delay (seconds) for the default user-agent. */
  crawlDelay: undefined as number | undefined,
};
