// @polsia:user-owned — sourced City of Tampa permit coverage page.

import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ComparisonTable } from '@/components/custom/comparison-table';
import { Reveal } from '@/components/custom/motion-kit/reveal';
import { Button } from '@/components/ui/button';
import {
  comparisonAccessLimits,
  comparisonCitations,
  comparisonContent,
  comparisonResearchNote,
  comparisonSources,
} from '@/lib/comparison/content';
import { publicSocialImage, publicUrl } from '@/lib/public-origin';
import { siteName } from '@/lib/site';

const description =
  'See the official City of Tampa permit portal, what public records expose, and the limits of DocketKite’s on-demand checks.';
const canonical = publicUrl('/compare');
const socialImage = publicSocialImage(siteName);

export const metadata: Metadata = {
  title: 'City of Tampa Permit Coverage',
  description,
  alternates: { canonical },
  openGraph: {
    title: `City of Tampa Permit Coverage · ${siteName}`,
    description:
      'A sourced guide to City of Tampa public permits, record status fields, correction files, and on-demand team alerts.',
    url: canonical,
    type: 'website',
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    images: [socialImage.url],
  },
};

export default function ComparePage() {
  return (
    <main className="dk-yard relative isolate overflow-hidden text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <Reveal as="header" trigger="load" className="flex max-w-4xl flex-col items-start gap-5">
          <p className="dk-kicker">{comparisonContent.eyebrow}</p>
          <div className="dk-titleblock w-full">
            <span>Sheet 02</span>
            <span>Coverage</span>
            <span>City of Tampa</span>
            <span>Residential remodel permits</span>
          </div>
          <h1 className="max-w-3xl font-display text-5xl font-semibold uppercase leading-[0.92] tracking-wide sm:text-6xl lg:text-7xl">
            {comparisonContent.title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {comparisonContent.intro}
          </p>
        </Reveal>

        <Reveal>
          <ComparisonTable
            content={comparisonContent}
            sources={comparisonSources}
            citations={comparisonCitations}
          />
        </Reveal>

        <Reveal>
          <section aria-labelledby="public-access-heading" className="grid gap-6">
            <header className="grid max-w-4xl gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
                {comparisonAccessLimits.eyebrow}
              </p>
              <h2
                id="public-access-heading"
                className="font-display text-3xl font-semibold tracking-tight sm:text-4xl"
              >
                {comparisonAccessLimits.heading}
              </h2>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="grid content-start gap-3 rounded-xl border bg-card p-5 sm:p-6">
                <h3 className="font-display text-xl font-semibold">
                  {comparisonAccessLimits.publicHeading}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {comparisonAccessLimits.publicCopy}
                </p>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {comparisonAccessLimits.sampleCopy}
                </p>
              </article>

              <article className="grid content-start gap-3 rounded-xl border bg-card p-5 sm:p-6">
                <h3 className="font-display text-xl font-semibold">
                  {comparisonAccessLimits.secureHeading}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {comparisonAccessLimits.secureCopy}
                </p>
              </article>

              <article className="grid content-start gap-3 rounded-xl border bg-card p-5 sm:p-6">
                <h3 className="font-display text-xl font-semibold">
                  {comparisonAccessLimits.workflowHeading}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {comparisonAccessLimits.workflowCopy}
                </p>
              </article>

              <article className="grid content-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.045] p-5 sm:p-6">
                <h3 className="font-display text-xl font-semibold">
                  {comparisonAccessLimits.requestHeading}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {comparisonAccessLimits.requestCopy}
                </p>
              </article>
            </div>

            <aside className="grid gap-3 rounded-xl border bg-card p-5 sm:p-6">
              <h3 className="font-semibold">{comparisonAccessLimits.unverifiedHeading}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {comparisonAccessLimits.unverifiedIntro}
              </p>
              <ul className="grid list-disc gap-2 pl-5 text-sm leading-6 text-muted-foreground">
                {comparisonAccessLimits.unverifiedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </aside>
          </section>
        </Reveal>

        <Reveal>
          <section
            aria-labelledby="current-status-heading"
            className="grid gap-4 rounded-xl border border-primary/20 bg-primary/[0.045] p-5 sm:grid-cols-[minmax(12rem,0.4fr)_1fr] sm:gap-8 sm:p-7"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
                DocketKite today
              </p>
              <h2 id="current-status-heading" className="mt-2 font-display text-2xl font-semibold">
                On-demand checks, no scheduled monitoring
              </h2>
            </div>
            <div className="grid gap-3 text-sm leading-6 text-muted-foreground sm:text-base">
              <p>
                A paid team member can start a check against a saved City of Tampa Accela Building
                record link. DocketKite stores a raw Record Status only after the page confirms the
                permit number. Verified status transitions can trigger project-manager email; an
                interrupted check can trigger team-owner email.
              </p>
              <p className="font-medium text-foreground">
                Checks are on demand, not scheduled or continuous. The sampled records did not
                confirm a public correction-letter attachment, and the City says secure files need
                an authorized contact. SMS is planned and unavailable; correction-letter uploads,
                extraction review, and checklists remain team workflows.
              </p>
            </div>
          </section>
        </Reveal>

        <aside className="grid gap-3 rounded-xl border bg-card p-5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6 sm:p-6">
          <p className="font-medium text-foreground">Reviewed {comparisonContent.lastReviewed}</p>
          <p className="leading-6 text-muted-foreground">{comparisonContent.disclaimer}</p>
        </aside>

        <Reveal>
          <section aria-labelledby="sources-heading" className="grid gap-5">
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
                Evidence
              </p>
              <h2
                id="sources-heading"
                className="font-display text-3xl font-semibold tracking-tight"
              >
                Sources reviewed
              </h2>
            </div>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
              {comparisonResearchNote}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {comparisonSources.map((source) => (
                <li key={source.id} className="rounded-lg border bg-card px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground">{source.publisher}</p>
                  <a
                    href={source.href}
                    target={source.href.startsWith('/') ? undefined : '_blank'}
                    rel={source.href.startsWith('/') ? undefined : 'noreferrer'}
                    className="mt-1 block w-full break-normal text-sm font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        <Reveal
          id="comparison-cta"
          as="section"
          className="grid gap-4 border-2 border-foreground bg-primary p-6 text-primary-foreground shadow-[6px_6px_0_#1c1915] sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8 sm:p-8 dark:shadow-[6px_6px_0_#f0c14b]"
        >
          <div className="grid gap-2">
            <h2 className="font-display text-2xl font-semibold">{comparisonContent.cta.title}</h2>
            <p className="max-w-2xl text-sm leading-6 text-primary-foreground sm:text-base">
              {comparisonContent.cta.description}
            </p>
          </div>
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="w-fit whitespace-nowrap rounded-sm px-5"
          >
            <Link href={comparisonContent.cta.href} target="_blank" rel="noreferrer">
              {comparisonContent.cta.label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </Reveal>
      </div>
    </main>
  );
}
