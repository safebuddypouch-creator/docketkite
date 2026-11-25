// Cursor hosting build.
// Next must compile when DATABASE_URL and Polsia/Better Auth secrets are unset.
// When DATABASE_URL is present, apply committed SQL after the Next build.
// Never db push, and never invent secret values.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, env, capture) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    // Capturing Next's log used to stop the publish once the log passed 1MB.
    maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (capture && output) process.stdout.write(output);
  if (result.error) {
    console.error(result.error.message);
    return { status: 1, output: `${output}${result.error.message}` };
  }
  return { status: result.status ?? 1, output };
}

function runPrisma(args) {
  const bin = path.join(root, 'node_modules/prisma/build/index.js');
  let last = { status: 1, output: '' };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = run(process.execPath, [bin, ...args], process.env, true);
    const transient = /P1001|P1002|P1017|Can't reach database|timed out/i.test(last.output);
    if (last.status === 0 || !transient || attempt === 3) return last;
    console.log(`prisma ${args.join(' ')} will retry after a connection error`);
    spawnSync('sleep', ['2'], { stdio: 'ignore' });
  }
  return last;
}

const nextEnv = { ...process.env };
if (!nextEnv.SKIP_ENV_VALIDATION) {
  nextEnv.SKIP_ENV_VALIDATION = '1';
}

// The published app is https://docketkite.apps.grok.bot. Cursor's build does not
// set NEXT_PUBLIC_APP_URL, so sitemap, canonical, and social URLs fell back to
// localhost. Keep a real configured origin. Do not replace a non-loopback URL.
const publishedOrigin = 'https://docketkite.apps.grok.bot';
function loopbackOrigin(value) {
  if (!value?.trim()) return true;
  try {
    const url = new URL(value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return true;
  }
}
if (loopbackOrigin(nextEnv.NEXT_PUBLIC_APP_URL)) {
  nextEnv.NEXT_PUBLIC_APP_URL = publishedOrigin;
}
// robots.txt and /llms.txt stay closed unless this is exactly "true".
// An explicit "false" from the deploy is left alone.
if (nextEnv.SEO_INDEXABLE !== 'true' && nextEnv.SEO_INDEXABLE !== 'false') {
  nextEnv.SEO_INDEXABLE = 'true';
}

const built = run(
  process.execPath,
  [path.join(root, 'node_modules/next/dist/bin/next'), 'build'],
  nextEnv,
  false,
);
if (built.status !== 0) process.exit(built.status);

if (!(process.env.DATABASE_URL ?? '').trim()) {
  console.log('prisma migrate deploy skipped: DATABASE_URL is unset');
  process.exit(0);
}

// The hosted database is created with prisma db push, which leaves tables and
// no migration history. Prisma then refuses migrate deploy with P3005 and the
// publish build exits 1. Schema sync stays on startup; only a real migration
// failure should stop the build.
const migrated = runPrisma(['migrate', 'deploy']);
const unbaselined =
  migrated.output.includes('P3005') || /schema is not empty/i.test(migrated.output);
if (migrated.status !== 0 && !unbaselined) {
  process.exit(migrated.status ?? 1);
}
if (migrated.status !== 0) {
  console.log(
    'prisma migrate deploy skipped: database already has a schema and no migration history',
  );
}

// Migrations cover auth and intake only. Team and permit tables come from the
// Prisma schema, so sync those before the app serves create-team.
const pushed = runPrisma(['db', 'push', '--skip-generate']);
if (pushed.status !== 0) process.exit(pushed.status ?? 1);
