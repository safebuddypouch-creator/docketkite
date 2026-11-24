// @polsia:user-owned — server-side check for the site owner's access code.
import { createHash, timingSafeEqual } from 'node:crypto';
import 'server-only';
import { env } from '@/lib/env';

const MINIMUM_CODE_LENGTH = 12;

export function ownerAccessCodeConfigured(): boolean {
  const code = env.POLSIA_OWNER_ACCESS_CODE;
  return Boolean(code && code.length >= MINIMUM_CODE_LENGTH && env.POLSIA_OWNER_EMAIL);
}

/** True only for the configured owner mailbox. Invited teammates never qualify. */
export function ownerAccessEligible(email: string): boolean {
  const expectedEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  if (!expectedEmail || !ownerAccessCodeConfigured()) return false;
  return email.trim().toLowerCase() === expectedEmail;
}

export function ownerAccessMatches(email: string, code: string): boolean {
  const expectedCode = env.POLSIA_OWNER_ACCESS_CODE;
  if (!expectedCode || expectedCode.length < MINIMUM_CODE_LENGTH) return false;
  if (!ownerAccessEligible(email)) return false;
  return sameSecret(code, expectedCode);
}

function sameSecret(input: string, secret: string): boolean {
  const actual = createHash('sha256').update(input).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(actual, expected);
}
