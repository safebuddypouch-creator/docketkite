// @polsia:user-owned — public DocketKite FAQ page.
import type { Metadata } from 'next';
import { faqContent } from '@/lib/faq/content';
import { siteName } from '@/lib/site';
import { FaqJsonLd } from '@/modules/faq-page/faq-jsonld';

const description =
  'Answers about saved permit status history, the latest saved monitoring outcome, and assigning a project manager within the same team.';

export const metadata: Metadata = {
  title: `Permit workflow FAQ — ${siteName}`,
  description,
  alternates: { canonical: '/faq' },
  openGraph: {
    title: `Permit workflow FAQ — ${siteName}`,
    description,
    url: '/faq',
    type: 'website',
  },
};

export default function FaqPage() {
  return (
    <main className="relative isolate overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <FaqJsonLd items={faqContent.items} />

        <header className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            DocketKite team workflows
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Three permit workflows, explained.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {faqContent.intro}
          </p>
        </header>

        <ol className="m-0 list-none p-0">
          {faqContent.items.map((item, index) => (
            <li key={item.id} className="border-t border-border py-6 last:border-b sm:py-8">
              <article className="grid gap-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-5">
                <span
                  aria-hidden="true"
                  className="pt-1 font-mono text-xs font-semibold tracking-[0.12em] text-primary"
                >
                  0{index + 1}
                </span>
                <div className="grid gap-3">
                  <h2 className="font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                    {item.question}
                  </h2>
                  <p className="max-w-4xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    {item.answer}
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
