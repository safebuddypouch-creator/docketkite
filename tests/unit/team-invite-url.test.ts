import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authReturnUrl,
  invitationAppUrl,
  safeReturnPath,
  teamInvitationPageUrl,
  teamInviteAuthHref,
  teamInviteReturnUrl,
} from '@/lib/team-invite-url';

const token = 'A'.repeat(43);

describe('team invitation URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the emailed page URL from the configured application origin', () => {
    expect(teamInvitationPageUrl(token, 'https://app.example.test/account?old=1')).toBe(
      `https://app.example.test/team-invite?token=${token}`,
    );
  });

  it('uses the published site when no public app URL is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const request = {
      headers: {
        get: (name: string) => (name === 'origin' ? 'https://docketkite.apps.grok.bot' : null),
      },
    };
    expect(invitationAppUrl(request)).toBe('https://docketkite.apps.grok.bot');
    expect(
      invitationAppUrl({
        headers: { get: () => 'https://evil.example' },
      }),
    ).toBeUndefined();
  });

  it('refuses a missing, malformed, or non-web application origin', () => {
    expect(() => teamInvitationPageUrl(token, undefined)).toThrow('NEXT_PUBLIC_APP_URL');
    expect(() => teamInvitationPageUrl(token, 'not a URL')).toThrow();
    expect(() => teamInvitationPageUrl(token, 'ftp://app.example.test')).toThrow(
      'HTTP application origin',
    );
  });

  it('keeps a valid token through sign-in, sign-up, and the return path', () => {
    expect(teamInviteAuthHref('/signup', token)).toBe(`/signup?invite=${token}`);
    expect(teamInviteAuthHref('/login', token)).toBe(`/login?invite=${token}`);
    expect(teamInviteReturnUrl(`?invite=${token}`)).toBe(`/team-invite?token=${token}`);
  });

  it('keeps a local deep link through sign-in and rejects external return URLs', () => {
    const permitPath = '/dashboard/permits/permit_1?tab=history';
    expect(authReturnUrl(`?returnTo=${encodeURIComponent(permitPath)}`)).toBe(permitPath);
    expect(authReturnUrl('?returnTo=%2F%2Fevil.example')).toBe('/dashboard');
    expect(safeReturnPath('https://evil.example/dashboard')).toBeNull();
    expect(safeReturnPath('//evil.example/dashboard')).toBeNull();
    expect(safeReturnPath('/\\evil.example/dashboard')).toBeNull();
  });
});
