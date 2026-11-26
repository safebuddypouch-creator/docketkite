// @polsia:user-owned — DocketKite's public offer and the page's content shape.

export type BillingInterval = 'month' | 'year';

export interface PricingAmount {
  /** What the customer is charged, in major currency units. */
  amount: number;
  originalAmount?: number;
  discountNote?: string;
}

export type PricingPrice = number | PricingAmount;

export interface PricingCheckout {
  endpoint: string;
  productIds: Partial<Record<BillingInterval | 'oneTime', string>>;
}

export interface PricingCta {
  label: string;
  href: string;
  checkout?: PricingCheckout;
}

export interface PricingTier {
  id: string;
  name: string;
  description?: string;
  billing?: 'recurring' | 'one-time';
  prices?: Partial<Record<BillingInterval, PricingPrice>>;
  price?: PricingPrice;
  pricePrefix?: string;
  priceLabel?: string;
  unit?: string;
  note?: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
  cta: PricingCta;
}

export interface PricingComparisonRow {
  label: string;
  values: Record<string, boolean | string>;
}

export interface PricingComparisonGroup {
  label: string;
  rows: PricingComparisonRow[];
}

export interface PricingComparison {
  title?: string;
  description?: string;
  groups: PricingComparisonGroup[];
}

export interface PricingContent {
  eyebrow?: string;
  title: string;
  intro?: string;
  currency: 'USD';
  locale: string;
  intervals: BillingInterval[];
  defaultInterval: BillingInterval;
  intervalNote?: string;
  tiers: PricingTier[];
  comparison: PricingComparison | null;
  reassurance: string[];
  footnote?: string;
}

export const pricingContent: PricingContent = {
  eyebrow: 'DOCKETKITE · TEAM PRICING',
  title: 'One private permit workspace for your team.',
  intro:
    'New customer teams get a shared 30-day setup window starting at team creation. It never automatically charges or converts. Permit records and PDF downloads stay locked until an owner or purchaser chooses the $299/month per-team plan and its subscription is verified as active; team and permit records remain stored.',
  currency: 'USD',
  locale: 'en-US',
  intervals: ['month'],
  defaultInterval: 'month',
  tiers: [
    {
      id: 'private-team-workspace',
      name: 'Private team workspace',
      description:
        'A shared Florida Accela permit workspace with on-demand checks of linked official public Accela Building records and email alerts after a verified public status transition.',
      prices: { month: 299 },
      unit: 'per team',
      features: [
        'Private Florida Accela permit workspace',
        'On-demand checks of linked official Florida Accela Building record pages',
        'Email to the assigned project manager after a verified public record status transition',
        'Email to the team owner when a public record check is interrupted',
        'Owner and purchaser permissions',
        'Shared permit records and status updates',
        'Correction letter review and checklists',
      ],
      highlighted: true,
      cta: { label: 'Create or join a team', href: '/dashboard' },
      note: 'Choose a team before opening hosted checkout.',
    },
  ],
  comparison: null,
  reassurance: [
    '30-day setup window; permit data remains locked',
    'No automatic charge or paid conversion',
    'One monthly subscription for the team',
    'Hosted checkout only after an owner or purchaser chooses it',
  ],
  footnote:
    'Pilot terms: $149 is the manual second-month offer for Days 11–30. $299/month is the later Days 61–90 rate and longer-term target. The current paid checkout remains $299/month per team; the setup window does not unlock permit data or automatically enroll a team in either offer.',
};

function toMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The amount displayed on the card and emitted by pricing JSON-LD. */
export function tierAmount(
  tier: PricingTier,
  interval: BillingInterval,
): PricingAmount | undefined {
  const price = tier.billing === 'one-time' ? tier.price : tier.prices?.[interval];
  if (price === undefined) return undefined;
  const raw = typeof price === 'number' ? { amount: price } : price;
  if (!Number.isFinite(raw.amount) || raw.amount < 0) return undefined;
  const originalAmount =
    raw.originalAmount !== undefined &&
    Number.isFinite(raw.originalAmount) &&
    raw.originalAmount >= 0
      ? toMoney(raw.originalAmount)
      : undefined;
  return {
    ...raw,
    amount: toMoney(raw.amount),
    ...(originalAmount === undefined ? {} : { originalAmount }),
  };
}

export function formatPrice(amount: number, content: PricingContent = pricingContent): string {
  try {
    return new Intl.NumberFormat(content.locale, {
      style: 'currency',
      currency: content.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${content.currency}`;
  }
}
