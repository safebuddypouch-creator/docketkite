// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { RESEND_API_KEY: 'test-resend-key', POLSIA_EMAIL_PROXY_URL: undefined },
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));

import { authConfig } from '@/lib/auth-config';

describe('verification email', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'email_1' }),
      }),
    );
  });

  it('sends through Resend when that key is set', async () => {
    await authConfig.emailVerification?.sendVerificationEmail?.({
      user: {
        id: 'user-1',
        createdAt: new Date('2026-11-24T00:00:00.000Z'),
        updatedAt: new Date('2026-11-24T00:00:00.000Z'),
        email: 'owner@example.test',
        emailVerified: false,
        name: 'Owner',
      },
      url: 'https://docketkite.apps.grok.bot/verify-email?token=abc',
      token: 'abc',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
