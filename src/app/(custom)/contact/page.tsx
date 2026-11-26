// @polsia:user-owned — public DocketKite contact page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactForm } from '@/components/custom/contact-form';
import { siteName } from '@/lib/brand';
import { publicSocialImage, publicUrl } from '@/lib/public-origin';

const description =
  'Ask DocketKite a question about State of Florida Accela permit checks or the current team workflow.';

const canonical = publicUrl('/contact');
const socialImage = publicSocialImage(siteName);

export const metadata: Metadata = {
  title: 'Contact us',
  description,
  alternates: { canonical },
  openGraph: {
    title: `Contact us · ${siteName}`,
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

export default function ContactPage() {
  return (
    <main className="dk-yard min-h-[calc(100dvh-3.5rem)] text-foreground">
      <div className="mx-auto grid w-full max-w-6xl gap-9 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,0.82fr)_minmax(25rem,1fr)] lg:items-start lg:gap-16 lg:px-8 lg:py-20">
        <header className="flex flex-col items-start gap-5 lg:pt-5">
          <p className="dk-kicker">DocketKite · State of Florida permit desk</p>
          <h1 className="max-w-xl font-display text-5xl font-semibold uppercase leading-[0.92] tracking-wide sm:text-6xl lg:text-7xl">
            Questions about a permit?
          </h1>
          <p className="max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Send the DocketKite team a question about State of Florida Accela permit checks or the current
            workflow. Add the email address where you&apos;d like a reply.
          </p>
          <div className="mt-2 max-w-lg border-t border-border pt-5">
            <p className="text-sm font-semibold text-foreground">A focused, on-demand workflow</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              DocketKite currently supports team-managed State of Florida Accela permit checks. A team member
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

        <section aria-labelledby="contact-form-title" className="dk-sheet">
          <div className="dk-titleblock">
            <span>Field ticket</span>
            <span>State of Florida</span>
            <span>Reply by email</span>
          </div>
          <div className="p-5 sm:p-7 lg:p-8">
            <div className="mb-6 border-b-2 border-foreground pb-5">
              <p className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-primary">
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
            <p className="mt-5 border-t-2 border-foreground pt-4 text-xs leading-5 text-muted-foreground">
              Please don&apos;t include passwords, payment details, or other sensitive information.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
