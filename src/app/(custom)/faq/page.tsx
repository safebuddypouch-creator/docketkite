// @polsia:user-owned — public DocketKite FAQ page.
import type { Metadata } from 'next';
import { faqContent } from '@/lib/faq/content';
import { publicSocialImage, publicUrl } from '@/lib/public-origin';
import { siteName } from '@/lib/site';
import { FaqJsonLd } from '@/modules/faq-page/faq-jsonld';

const description =
  'Answers about saved permit status history, the latest saved monitoring outcome, and assigning a project manager within the same team.';

const canonical = publicUrl('/faq');
const socialImage = publicSocialImage(siteName);

export const metadata: Metadata = {
  title: 'Permit workflow FAQ',
  description,
  alternates: { canonical },
  openGraph: {
    title: `Permit workflow FAQ · ${siteName}`,
    description,
    url: canonical,
    type: 'website',
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    images: [socialImage.url],
  },
};

export default function FaqPage() {
  return (
    <main className="dk-yard relative isolate overflow-hidden text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <FaqJsonLd items={faqContent.items} />

        <header className="flex max-w-3xl flex-col items-start gap-5">
          <p className="dk-kicker">DocketKite team workflows</p>
          <div className="dk-titleblock w-full">
            <span>Sheet 03</span>
            <span>RFI log</span>
            <span>City of Tampa</span>
            <span>Residential remodel permits</span>
          </div>
          <h1 className="font-display text-5xl font-semibold uppercase leading-[0.92] tracking-wide sm:text-6xl lg:text-7xl">
            Three permit workflows, explained.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {faqContent.intro}
          </p>
        </header>

        <ol className="dk-rfi m-0 list-none bg-card p-0">
          {faqContent.items.map((item, index) => (
            <li key={item.id} className="border-t border-border py-6 last:border-b sm:py-8">
              <article className="grid gap-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-5">
                <span
                  aria-hidden="true"
                  className="pt-1 font-display text-3xl font-semibold leading-none tracking-[0.08em] text-primary"
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
