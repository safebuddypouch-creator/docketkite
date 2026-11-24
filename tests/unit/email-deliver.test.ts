// @polsia:user-owned — Resend deliverEmail without Polsia proxy.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { RESEND_API_KEY: 're_test_key' },
}));

import { deliverEmail, EmailDeliveryFailedError } from '@/lib/email/deliver';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deliverEmail', () => {
  it('posts to Resend with the DocketKite from address', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'email_123' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deliverEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }),
    ).resolves.toEqual({ id: 'email_123' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(call[1].body))).toMatchObject({
      from: 'DocketKite <noreply@docketkitepermits.com>',
      to: ['a@example.com'],
      subject: 'Hi',
    });
  });

  it('maps Resend failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ message: 'bad request' }),
      })),
    );

    await expect(
      deliverEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' }),
    ).rejects.toBeInstanceOf(EmailDeliveryFailedError);
  });
});
