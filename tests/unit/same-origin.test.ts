// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_URL = 'https://acme.polsia.app';
const INTERNAL_URL = 'http://10.0.0.12:3000/api/creations';
const DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/docketkite';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Loads the helper with a fresh env so NEXT_PUBLIC_APP_URL is re-read. */
async function load(appUrl = PUBLIC_URL, trusted = '') {
  vi.stubEnv('DATABASE_URL', DATABASE_URL);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl);
  vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', trusted);
  vi.resetModules();
  return (await import('@/lib/same-origin')).sameOrigin;
}

/** A POST as seen behind the platform proxy: request.url carries the internal host. */
function post(origin?: string): Request {
  const headers = origin ? { origin } : undefined;
  return new Request(INTERNAL_URL, { method: 'POST', headers });
}

describe('sameOrigin', () => {
  it('accepts the public origin even though request.url is the internal host', async () => {
    const sameOrigin = await load();
    expect(sameOrigin(post(PUBLIC_URL))).toBe(true);
  });

  it('accepts the platform twin domain of the same app', async () => {
    const sameOrigin = await load();
    expect(sameOrigin(post('https://acme.polsia.io'))).toBe(true);
  });

  it('accepts an exact brand domain from BETTER_AUTH_TRUSTED_ORIGINS', async () => {
    const sameOrigin = await load(PUBLIC_URL, 'https://acme.com, https://*.polsia.app');
    expect(sameOrigin(post('https://acme.com'))).toBe(true);
  });

  it('refuses the internal request.url origin', async () => {
    const sameOrigin = await load();
    expect(sameOrigin(post(new URL(INTERNAL_URL).origin))).toBe(false);
  });

  it('refuses a foreign origin, including another tenant', async () => {
    const sameOrigin = await load(PUBLIC_URL, 'https://*.polsia.app');
    expect(sameOrigin(post('https://evil.example'))).toBe(false);
    expect(sameOrigin(post('https://other.polsia.app'))).toBe(false);
  });

  it('refuses a request without an Origin header', async () => {
    const sameOrigin = await load();
    expect(sameOrigin(post())).toBe(false);
  });

  it('accepts the published host when the browser says the request is same-origin', async () => {
    const sameOrigin = await load('http://localhost:3000');
    const request = new Request(INTERNAL_URL, {
      method: 'POST',
      headers: {
        origin: 'https://docketkite.apps.grok.bot',
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(sameOrigin(request)).toBe(true);
  });

  it('accepts the published host from the forwarded host', async () => {
    const sameOrigin = await load('http://localhost:3000');
    const request = new Request(INTERNAL_URL, {
      method: 'POST',
      headers: {
        origin: 'https://docketkite.apps.grok.bot',
        'x-forwarded-host': 'docketkite.apps.grok.bot',
      },
    });
    expect(sameOrigin(request)).toBe(true);
  });

  it('still refuses a foreign origin that only claims the published host', async () => {
    const sameOrigin = await load('http://localhost:3000');
    const request = new Request(INTERNAL_URL, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'x-forwarded-host': 'docketkite.apps.grok.bot',
      },
    });
    expect(sameOrigin(request)).toBe(false);
  });
});
