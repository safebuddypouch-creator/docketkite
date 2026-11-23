// Cursor hosting build.
// Next must compile when DATABASE_URL and Polsia/Better Auth secrets are unset.
// When DATABASE_URL is present, apply committed SQL after the Next build.
// Never db push, and never invent secret values.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output) process.stdout.write(output);
  if (result.error) {
    console.error(result.error.message);
    return { status: 1, output: `${output}${result.error.message}` };
  }
  return { status: result.status ?? 1, output };
}

const nextEnv = { ...process.env };
if (!nextEnv.SKIP_ENV_VALIDATION) {
  nextEnv.SKIP_ENV_VALIDATION = '1';
}

const built = run(
  process.execPath,
  [path.join(root, 'node_modules/next/dist/bin/next'), 'build'],
  nextEnv,
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
const migrated = run(
  process.execPath,
  [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  process.env,
);
if (migrated.status !== 0) {
  if (migrated.output.includes('P3005')) {
    console.log(
      'prisma migrate deploy skipped: database already has a schema and no migration history',
    );
    process.exit(0);
  }
  process.exit(migrated.status);
}
