// @polsia:user-owned — allowlist for legacy Polsia R2 letter fetches (SSRF guard).
import 'server-only';
import { env } from '@/lib/env';

const R2_STORAGE_HOST = /^([a-z0-9-]+\.)*r2\.cloudflarestorage\.com$/i;

function configuredR2Hostname(): string | null {
  const base = env.POLSIA_R2_BASE_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Legacy letter `fileUrl` values may only point at Polsia's Cloudflare R2
 * upload host (or the deploy's configured R2 base). Every other https host is
 * refused so a paid member cannot probe arbitrary endpoints through the app.
 */
export function isAllowedLegacyLetterSourceUrl(fileUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return false;
  }
  // Block literal IPs / localhost — R2 is always a DNS hostname.
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(':')
  ) {
    return false;
  }
  if (host === 'files.docketkitepermits.com') {
    return false;
  }
  if (R2_STORAGE_HOST.test(host)) {
    return true;
  }
  const configured = configuredR2Hostname();
  return configured !== null && host === configured;
}
