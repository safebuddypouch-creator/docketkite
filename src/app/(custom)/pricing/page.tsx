// @polsia:user-owned — the DocketKite team pricing page.
import type { Metadata } from 'next';
import { Reveal } from '@/components/custom/motion-kit/reveal';
import { PricingTiers } from '@/components/custom/pricing-tiers';
import { pricingContent, tierAmount } from '@/lib/pricing/content';
import { siteName, siteUrl } from '@/lib/site';
import { PricingJsonLd } from '@/modules/pricing-page/pricing-jsonld';

const pageDescription =
  'New DocketKite teams get a shared 30-day setup window with no automatic charge or paid conversion. Permit records and PDF downloads unlock only after the $299 per month team subscription is verified as active. Members can start an on-demand check of a linked public Accela record; a verified status transition can email the assigned project manager, and an interrupted check can email the team owner. Checks are not scheduled and do not access applicant-only information. SMS alerts are planned and unavailable today.';

export const metadata: Metadata = {
  title: 'Pricing',
  description: pageDescription,
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: `Pricing · ${siteName}`,
    description: pageDescription,
    url: '/pricing',
    type: 'website',
  },
};

const offers = pricingContent.tiers.flatMap((tier) => {
  const amount = tierAmount(tier, pricingContent.defaultInterval);
  if (amount === undefined) return [];
  return [
    {
      name: tier.name,
      price: amount.amount,
      originalPrice: amount.originalAmount,
      ...(tier.billing === 'one-time' ? {} : { interval: pricingContent.defaultInterval }),
      description: tier.description,
      url: `${siteUrl}/pricing#${encodeURIComponent(tier.id)}`,
    },
  ];
});

export default function PricingPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
      <PricingJsonLd
        name="DocketKite private team workspace"
        description={pageDescription}
        brand={siteName}
        url={`${siteUrl}/pricing`}
        currency={pricingContent.currency}
        offers={offers}
      />

      <Reveal
        as="header"
        trigger="load"
        distance={12}
        className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center"
      >
        <p className="rounded-sm border border-primary/20 bg-secondary px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-secondary-foreground">
          {pricingContent.eyebrow}
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-medium leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
          {pricingContent.title}
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {pricingContent.intro}
        </p>
      </Reveal>

      <Reveal as="section" id="team-plan" trigger="view" distance={16} className="mt-10 sm:mt-12">
        <PricingTiers content={pricingContent} />
      </Reveal>

      <section aria-labelledby="permit-updates-title" className="mx-auto mt-8 max-w-3xl">
        <h2 id="permit-updates-title" className="font-semibold text-foreground">
          Public checks and team status updates
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A team member starts each check for a linked official City of Tampa public Accela record.
          DocketKite stores the exact Record Status only after the page confirms the permit number.
          Checks do not run continuously or on a schedule and do not access applicant-only
          information. A verified transition can email the assigned project manager; an interrupted
          check can email the team owner. Email is available now; SMS remains planned and
          unavailable.
        </p>
      </section>

      {pricingContent.reassurance.length > 0 ? (
        <ul className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {pricingContent.reassurance.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {pricingContent.footnote ? (
        <p className="mx-auto mt-3 max-w-3xl text-center text-xs leading-5 text-muted-foreground">
          {pricingContent.footnote}
        </p>
      ) : null}

      <section aria-labelledby="team-setup-title" className="mt-16 border-t border-border pt-10">
        <div className="mb-6 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Start with your team
          </p>
          <h2
            id="team-setup-title"
            className="mt-2 font-display text-2xl font-medium tracking-tight text-foreground sm:text-3xl"
          >
            Set up access, then continue to checkout.
          </h2>
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          <li className="border border-border bg-card p-4 sm:p-5">
            <span className="text-xs font-semibold tracking-[0.12em] text-primary">01</span>
            <h3 className="mt-3 font-semibold text-foreground">Create a team</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The person creating a new customer team receives owner permissions and starts its
              shared 30-day setup window. Permit records and PDF downloads stay locked until the
              $299/month subscription is verified as active. The window never automatically charges
              or converts; its exact end timestamp appears in UTC in the workspace.
            </p>
          </li>
          <li className="border border-border bg-card p-4 sm:p-5">
            <span className="text-xs font-semibold tracking-[0.12em] text-primary">02</span>
            <h3 className="mt-3 font-semibold text-foreground">Or join with a team code</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              A valid team invite code adds the account with purchaser permissions.
            </p>
          </li>
          <li className="border border-border bg-card p-4 sm:p-5">
            <span className="text-xs font-semibold tracking-[0.12em] text-primary">03</span>
            <h3 className="mt-3 font-semibold text-foreground">Open hosted checkout</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              An owner or purchaser can actively choose the current $299/month per-team checkout
              during or after the setup window. No paid plan starts automatically.
            </p>
          </li>
        </ol>
      </section>

      <aside
        aria-labelledby="planned-features-title"
        className="mt-8 border-l-4 border-accent bg-secondary/70 px-5 py-4 sm:px-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-secondary-foreground">
          Planned · not available today
        </p>
        <h2 id="planned-features-title" className="mt-2 font-semibold text-foreground">
          SMS alerts
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Text-message alerts are planned and are not available today or included in the current
          workspace offer.
        </p>
      </aside>
    </main>
  );
}
