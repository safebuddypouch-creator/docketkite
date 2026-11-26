import { describe, expect, it } from 'vitest';
import { formatPrice, pricingContent, tierAmount } from '@/lib/pricing/content';

describe('DocketKite pricing content', () => {
  it('publishes one flat $299 monthly team offer that enters the existing team flow', () => {
    expect(pricingContent.currency).toBe('USD');
    expect(pricingContent.intervals).toEqual(['month']);
    expect(pricingContent.tiers).toHaveLength(1);

    const tier = pricingContent.tiers[0];
    expect(tier).toBeDefined();
    if (!tier) throw new Error('The team pricing tier is missing.');

    expect(tierAmount(tier, pricingContent.defaultInterval)?.amount).toBe(299);
    expect(formatPrice(299, pricingContent)).toBe('$299');
    expect(tier.unit).toBe('per team');
    expect(tier.cta.href).toBe('/dashboard');
    expect(tier.cta.checkout).toBeUndefined();
    expect(pricingContent.intro).toMatch(/30-day free trial/i);
    expect(pricingContent.intro).toMatch(/never automatically charges or converts/i);
    expect(pricingContent.intro).toMatch(/paid team features lock/i);
    expect(pricingContent.intro).toMatch(/team and permit records remain stored/i);
    expect(pricingContent.reassurance).toContain('No automatic charge or paid conversion');
    expect(pricingContent.footnote).toContain('$149');
    expect(pricingContent.footnote).toContain('Days 11–30');
    expect(pricingContent.footnote).toContain('Days 61–90');
    expect(pricingContent.footnote).toContain('current paid checkout remains $299/month per team');
  });

  it('describes live on-demand public checks and project-manager email alerts', () => {
    const tier = pricingContent.tiers[0];
    expect(tier).toBeDefined();
    if (!tier) throw new Error('The team pricing tier is missing.');

    const includedOffer = [tier.description, ...tier.features].join(' ');
    expect(includedOffer).toMatch(/on-demand checks of linked official Florida Accela Building record pages/i);
    expect(includedOffer).toMatch(/assigned project manager after a verified public record status transition/i);
    expect(includedOffer).toMatch(/team owner when a public record check is interrupted/i);
    expect(includedOffer).not.toMatch(/monitoring.{0,30}planned|automated.*portal|sms alerts/i);
  });
});
