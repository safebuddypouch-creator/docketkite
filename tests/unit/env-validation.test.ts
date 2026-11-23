// @vitest-environment node
// node not jsdom — jsdom makes @t3-oss skip server-var validation.
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => vi.resetModules());

test('next.config wires env validation (throws on a missing required var)', async () => {
  const prevDb = process.env.DATABASE_URL;
  const prevSkip = process.env.SKIP_ENV_VALIDATION;
  delete process.env.DATABASE_URL;
  delete process.env.SKIP_ENV_VALIDATION;
  vi.resetModules();
  try {
    await expect(import('../../next.config')).rejects.toThrow(/Invalid environment variables/);
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    if (prevSkip !== undefined) process.env.SKIP_ENV_VALIDATION = prevSkip;
  }
});

test('homepage env loads without Polsia or Better Auth secrets', async () => {
  const prevDb = process.env.DATABASE_URL;
  const prevSkip = process.env.SKIP_ENV_VALIDATION;
  const prevEmail = process.env.POLSIA_EMAIL_PROXY_URL;
  const prevSecret = process.env.BETTER_AUTH_SECRET;
  const prevUrl = process.env.BETTER_AUTH_URL;
  const prevOwner = process.env.POLSIA_OWNER_EMAIL;
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/docketkite';
  delete process.env.SKIP_ENV_VALIDATION;
  delete process.env.POLSIA_EMAIL_PROXY_URL;
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.POLSIA_OWNER_EMAIL;
  vi.resetModules();
  try {
    const { env } = await import('../../src/lib/env');
    expect(env.DATABASE_URL).toBe(process.env.DATABASE_URL);
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.POLSIA_EMAIL_PROXY_URL).toBeUndefined();
    expect(env.POLSIA_OWNER_EMAIL).toBe('johnchaisson2610@gmail.com');
  } finally {
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
    if (prevSkip === undefined) delete process.env.SKIP_ENV_VALIDATION;
    else process.env.SKIP_ENV_VALIDATION = prevSkip;
    if (prevEmail === undefined) delete process.env.POLSIA_EMAIL_PROXY_URL;
    else process.env.POLSIA_EMAIL_PROXY_URL = prevEmail;
    if (prevSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = prevSecret;
    if (prevUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = prevUrl;
    if (prevOwner === undefined) delete process.env.POLSIA_OWNER_EMAIL;
    else process.env.POLSIA_OWNER_EMAIL = prevOwner;
  }
});

test('SKIP_ENV_VALIDATION bypasses validation', async () => {
  const prevDb = process.env.DATABASE_URL;
  const prevSkip = process.env.SKIP_ENV_VALIDATION;
  delete process.env.DATABASE_URL;
  process.env.SKIP_ENV_VALIDATION = '1';
  vi.resetModules();
  try {
    await expect(import('../../next.config')).resolves.toBeDefined();
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    if (prevSkip === undefined) delete process.env.SKIP_ENV_VALIDATION;
    else process.env.SKIP_ENV_VALIDATION = prevSkip;
  }
});
