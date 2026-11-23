// @polsia:user-owned — brand identity. Edit freely. `site.ts` re-exports
// siteName/siteDescription; `manifest.ts` + `opengraph-image.tsx` read `brandVisual`.

export const siteName = 'DocketKite';
export const siteDescription =
  'City of Tampa permit checks for residential remodeling teams. DocketKite records publicly visible status from manually started Accela checks; background monitoring and SMS remain unavailable.';

// PWA + social-share colors. HEX only (CSS variables aren't readable here) — set
// them to match the theme you define in src/app/brand-theme.css. The starter
// values are achromatic placeholders, not a palette.
export const brandVisual = {
  /** PWA browser-UI / status-bar color — usually your background or primary. */
  themeColor: '#173c30',
  /** PWA splash + install background. */
  backgroundColor: '#f6f7f1',
  /** Social-share (OG/Twitter) image. */
  og: {
    background: '#173c30',
    foreground: '#f4f5eb',
    /** Second line under the site name; '' hides it. */
    tagline: 'Permit updates reach the jobsite before the schedule slips.',
    /** Optional https PNG/JPEG background photo; '' keeps the plain-color card. */
    image: '',
  },
} as const;
