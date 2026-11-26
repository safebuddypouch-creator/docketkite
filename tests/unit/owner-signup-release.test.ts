// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { RESEND_API_KEY: 'test-resend-key', POLSIA_EMAIL_PROXY_URL: undefined },
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/owner-mailbox-release', () => ({
  releaseUnverifiedOwnerMailbox: mocks.release,
}));

import { authConfig, releaseUnverifiedOwnerBeforeSignup } from '@/lib/auth-config';

describe('owner signup mailbox release', () => {
  beforeEach(() => {
    mocks.release.mockReset();
    mocks.release.mockResolvedValue(undefined);
  });

  it('hooks only the email signup path', () => {
    const plugin = authConfig.plugins?.find(
      (entry) => entry.id === 'docketkite-release-unverified-owner-mailbox',
    );
    expect(
      plugin?.hooks?.before?.[0]?.matcher({ path: '/sign-up/email', context: {} as never }),
    ).toBe(true);
    expect(
      plugin?.hooks?.before?.[0]?.matcher({ path: '/sign-in/email', context: {} as never }),
    ).toBe(false);
  });

  it('reads a cloned body and leaves the original request readable', async () => {
    const request = new Request('https://docketkite.apps.grok.bot/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner',
        email: 'owner@example.test',
        password: 'correct-horse-battery',
      }),
    });

    await releaseUnverifiedOwnerBeforeSignup({ request });

    expect(mocks.release).toHaveBeenCalledWith('owner@example.test');
    await expect(request.json()).resolves.toMatchObject({ email: 'owner@example.test' });
  });

  it('uses an already parsed body when the stream cannot be cloned', async () => {
    const request = new Request('https://docketkite.apps.grok.bot/api/auth/sign-up/email', {
      method: 'POST',
      body: 'not-json',
    });
    await releaseUnverifiedOwnerBeforeSignup({
      request,
      body: { email: 'owner@example.test' },
    });
    expect(mocks.release).toHaveBeenCalledWith('owner@example.test');
  });
});
