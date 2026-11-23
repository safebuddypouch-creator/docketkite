// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'local-signup-check-secret-not-a-real-key';

async function loadAuth() {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', databaseUrl ?? 'postgresql://user:pass@127.0.0.1:5432/docketkite');
  vi.stubEnv('BETTER_AUTH_SECRET', secret);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://docketkite.apps.grok.bot');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SKIP_ENV_VALIDATION', '');
  // biome-ignore lint/style/noRestrictedImports: this server test calls the auth handler directly.
  return import('@/lib/auth');
}

function signup(email: string, headers: Record<string, string>) {
  return new Request('http://10.0.0.12:3000/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://docketkite.apps.grok.bot',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      ...headers,
    },
    body: JSON.stringify({
      name: 'Signup Check',
      email,
      password: 'signup-check-pass-32chars',
    }),
  });
}

describe('account signup', () => {
  afterAll(async () => {
    if (!databaseUrl) return;
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('BETTER_AUTH_SECRET', secret);
    vi.stubEnv('SKIP_ENV_VALIDATION', '');
    // biome-ignore lint/style/noRestrictedImports: cleanup uses the server database client.
    const { prisma } = await import('@/lib/db');
    await prisma.account.deleteMany({
      where: { user: { email: { endsWith: '@example.com' } } },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { endsWith: '@example.com' } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@example.com' } } });
    await prisma.$disconnect();
  });

  it('exposes the handler better-auth calls', async () => {
    const { auth } = await loadAuth();
    expect('handler' in auth).toBe(true);
    expect(typeof auth.handler).toBe('function');
  });

  it.skipIf(!databaseUrl)('creates an account for the public host', async () => {
    const { auth } = await loadAuth();
    const response = await auth.handler(
      signup('signup-check-forwarded@example.com', {
        host: '10.0.0.12:3000',
        'x-forwarded-host': 'docketkite.apps.grok.bot',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(response.status).toBe(200);
  });
});
