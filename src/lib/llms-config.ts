// @polsia:user-owned — per-app content for /llms.txt (route.ts is
// framework-owned). Applied only when the deploy is indexable (SEO_INDEXABLE).
//
// The SHAPE (types) is framework-owned in src/lib/llms.ts; here you declare the
// VALUE. The `## Pages` list is generated for you from the public
// routes in src/lib/nav.ts + src/lib/seo-routes.ts — enrich it here with an
// intro, per-page descriptions, extra curated sections, and an `## Optional`
// section. Example:
//
//   export const llmsConfig: LlmsConfig = {
//     intro: 'Acme helps teams ship faster with a hosted CI pipeline.',
//     pageDescriptions: {
//       '/': 'Product overview and sign-up.',
//       '/pricing': 'Plans, limits, and pricing.',
//     },
//     sections: [
//       {
//         title: 'Docs',
//         links: [
//           { label: 'API reference', href: '/docs/api', description: 'REST endpoints.' },
//           { label: 'Status', href: 'https://status.acme.com' }, // external URL, kept as-is
//         ],
//       },
//     ],
//     optional: [{ label: 'Changelog', href: '/changelog' }],
//   };
import type { LlmsConfig } from '@/lib/llms';

// /llms.txt 404s unless the deploy is indexable. The public site is.
// The route reads the flag on each request, after this module loads.
if (process.env.SEO_INDEXABLE !== 'true' && process.env.SEO_INDEXABLE !== 'false') {
  process.env.SEO_INDEXABLE = 'true';
}

export const llmsConfig: LlmsConfig = {
  intro:
    'DocketKite is for residential remodeling teams checking City of Tampa permits. A team member starts each check of a linked public Accela record. DocketKite stores that publicly visible record status. Checks are not scheduled, do not read applicant-only files, and do not send SMS. Background monitoring is unavailable.',
  pageDescriptions: {
    '/': 'Overview of on-demand City of Tampa permit checks for remodeling teams.',
    '/pricing':
      'Shared 30-day setup window and the $299 per month team subscription. Permit records and PDF downloads require a verified active subscription.',
    '/compare':
      'What the City of Tampa public portal shows, and what an on-demand DocketKite check can read from it.',
    '/contact':
      'Contact form for questions about City of Tampa permit checks and the team workflow.',
    '/faq':
      'Answers about saved permit status, the latest saved monitoring outcome, and assigning a project manager on the same team.',
  },
};
