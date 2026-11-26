import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { companyNotificationInbox } from '@/lib/email/company-inbox';
import { navItems } from '@/lib/nav';
import { publicOrigin, publicUrl, publishedOrigin } from '@/lib/public-origin';
import {
  plainSignupValidationMessage,
  rewriteSignupValidationResponse,
  signupClientError,
} from '@/lib/signup-validation';

describe('public origin', () => {
  it('uses the published site when the configured URL is missing or loopback', () => {
    expect(publicOrigin(undefined)).toBe(publishedOrigin);
    expect(publicOrigin('')).toBe(publishedOrigin);
    expect(publicOrigin('http://localhost:3000')).toBe(publishedOrigin);
    expect(publicOrigin('http://127.0.0.1:3000/')).toBe(publishedOrigin);
  });

  it('keeps a configured non-loopback origin', () => {
    expect(publicOrigin('https://permits.example.com/app/')).toBe('https://permits.example.com');
  });

  it('builds absolute public URLs', () => {
    expect(publicUrl('/', 'http://localhost:3000')).toBe(`${publishedOrigin}/`);
    expect(publicUrl('/pricing', 'http://localhost:3000')).toBe(`${publishedOrigin}/pricing`);
    expect(publicUrl('/opengraph-image')).toBe(`${publishedOrigin}/opengraph-image`);
  });
});

describe('signup validation sentences', () => {
  it('replaces raw validator paths', () => {
    expect(
      plainSignupValidationMessage(
        '[body.email] Invalid email address; [body.password] Too small: expected string to have >=1 characters',
      ),
    ).toBe('Enter a valid email address. Enter a password.');
    expect(plainSignupValidationMessage('[body.email] Invalid email address')).toBe(
      'Enter a valid email address.',
    );
    expect(
      plainSignupValidationMessage(
        '[body.password] Too small: expected string to have >=8 characters',
      ),
    ).toBe('Use at least 8 characters for your password.');
  });

  it('leaves ordinary auth messages alone', () => {
    expect(plainSignupValidationMessage('Invalid email or password')).toBe(
      'Invalid email or password',
    );
  });

  it('checks the form before submit', () => {
    expect(signupClientError('', '')).toBe('Enter a valid email address. Enter a password.');
    expect(signupClientError('not-an-email', 'long-enough-password')).toBe(
      'Enter a valid email address.',
    );
    expect(signupClientError('ada@example.com', 'short')).toBe(
      'Use at least 8 characters for your password.',
    );
    expect(signupClientError('ada@example.com', 'long-enough')).toBeUndefined();
  });
});

describe('home title block', () => {
  it('uses the product name instead of a drawing-sheet cover label', () => {
    const home = readFileSync(path.join(process.cwd(), 'src/app/(setup)/page.tsx'), 'utf8');
    expect(home).not.toContain('Sheet 01');
    expect(home).not.toContain('<span>Cover</span>');
    expect(home).toContain('<span>DocketKite</span>');
    expect(home).toContain('<span>Florida Accela</span>');
    expect(home).toContain('<span>Residential remodel permits</span>');
    expect(home).toContain('id="coverage"');
    expect(home).toContain('FloridaAccelaAgencyOptions');
  });
});

describe('retired Polsia inbox', () => {
  it('is not a mail destination and is not on the home page', () => {
    expect(companyNotificationInbox('docketkite-8vdtwl@polsia.app')).toBeUndefined();
    expect(companyNotificationInbox('  DocketKite-8vdtwl@polsia.app ')).toBeUndefined();
    expect(companyNotificationInbox('owner@example.com')).toBe('owner@example.com');
    expect(companyNotificationInbox(undefined)).toBeUndefined();

    const home = readFileSync(path.join(process.cwd(), 'src/app/(setup)/page.tsx'), 'utf8');
    expect(home).not.toContain('docketkite-8vdtwl@polsia.app');
    expect(home).not.toContain('mailto:');
    expect(navItems.some((item) => item.href === '/example')).toBe(false);
  });
});

describe('signup validation response', () => {
  it('replaces the raw API message and leaves other responses', async () => {
    const raw = Response.json(
      {
        message:
          '[body.email] Invalid email address; [body.password] Too small: expected string to have >=1 characters',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
    const rewritten = await rewriteSignupValidationResponse(raw);
    expect(rewritten?.status).toBe(400);
    await expect(rewritten?.json()).resolves.toEqual({
      message: 'Enter a valid email address. Enter a password.',
      code: 'VALIDATION_ERROR',
    });

    const ok = Response.json({ message: 'Invalid email', code: 'INVALID_EMAIL' }, { status: 400 });
    expect(await rewriteSignupValidationResponse(ok)).toBeUndefined();
  });
});
