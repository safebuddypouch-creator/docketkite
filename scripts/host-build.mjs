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
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const nextEnv = { ...process.env };
if (!nextEnv.SKIP_ENV_VALIDATION) {
  nextEnv.SKIP_ENV_VALIDATION = '1';
}

run(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], nextEnv);

if (!(process.env.DATABASE_URL ?? '').trim()) {
  console.log('prisma migrate deploy skipped: DATABASE_URL is unset');
  process.exit(0);
}

run(
  process.execPath,
  [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  process.env,
);
