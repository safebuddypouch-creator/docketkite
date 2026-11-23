import { describe, expect, it } from 'vitest';
import {
  authReturnUrl,
  safeReturnPath,
  teamInvitationPageUrl,
  teamInviteAuthHref,
  teamInviteReturnUrl,
} from '@/lib/team-invite-url';

const token = 'A'.repeat(43);

describe('team invitation URLs', () => {
  it('builds the emailed page URL from the configured application origin', () => {
    expect(teamInvitationPageUrl(token, 'https://app.example.test/account?old=1')).toBe(
      `https://app.example.test/team-invite?token=${token}`,
    );
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
