// @polsia:user-owned — public DocketKite contact page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactForm } from '@/components/custom/contact-form';
import { siteName } from '@/lib/brand';

const description =
  'Ask DocketKite a question about City of Tampa permit checks or the current team workflow.';

export const metadata: Metadata = {
  title: `Contact us · ${siteName}`,
  description,
  alternates: { canonical: '/contact' },
  openGraph: {
    title: `Contact us · ${siteName}`,
    description,
    url: '/contact',
    type: 'website',
  },
};

export default function ContactPage() {
  return (
    <main className="min-h-[calc(100dvh-3.5rem)] bg-background text-foreground">
      <div className="mx-auto grid w-full max-w-6xl gap-9 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,0.82fr)_minmax(25rem,1fr)] lg:items-start lg:gap-16 lg:px-8 lg:py-20">
        <header className="flex flex-col items-start gap-5 lg:pt-5">
          <p className="border-l-2 border-primary pl-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            DocketKite · City of Tampa permit desk
          </p>
          <h1 className="max-w-xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Questions about a permit?
          </h1>
          <p className="max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Send the DocketKite team a question about City of Tampa permit checks or the current
            workflow. Add the email address where you&apos;d like a reply.
          </p>
          <div className="mt-2 max-w-lg border-t border-border pt-5">
            <p className="text-sm font-semibold text-foreground">A focused, on-demand workflow</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              DocketKite currently supports team-managed City of Tampa permit checks. A team member
              starts each check; scheduled monitoring and SMS are not available today.
            </p>
          </div>
          <Link
            href="/"
            className="mt-1 text-sm font-semibold text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            Back to DocketKite
          </Link>
        </header>

        <section
          aria-labelledby="contact-form-title"
          className="rounded-xl border border-border bg-card p-5 shadow-[0_18px_55px_var(--elevation-1)] sm:p-7 lg:p-8"
        >
          <div className="mb-6 border-b border-border pb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Contact the team
            </p>
            <h2
              id="contact-form-title"
              className="mt-2 font-display text-2xl font-semibold tracking-tight text-card-foreground sm:text-3xl"
            >
              Send us a question
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              We&apos;ll use your email address to respond to your message.
            </p>
          </div>
          <ContactForm />
          <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            Please don&apos;t include passwords, payment details, or other sensitive information.
          </p>
        </section>
      </div>
    </main>
  );
}
