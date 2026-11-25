// @polsia:framework-owned — DO NOT EDIT. Code installed by polsia/template-next@0.3.19.
//
// Page-view capture is off. The root layout and proxy.ts still call these helpers;
// an ingestion origin is added only when a capture config is passed in.

import type { CspExtraSources } from '@/lib/csp';
import type { PosthogCapture } from '@/lib/polsia-posthog';

/** Page-view capture stays off. No capture config is read from the environment. */
export function posthogCaptureFromEnv(
  _env: Readonly<Record<string, string | undefined>>,
): PosthogCapture | null {
  return null;
}

/**
 * The app's CSP extras plus the ingestion origin in connect-src, only when capture is
 * configured: the base policy, which every app's own csp.test.ts pins, never changes.
 */
export function withPosthogConnectSrc(
  extra: CspExtraSources,
  capture: PosthogCapture | null,
): CspExtraSources {
  if (!capture) return extra;
  return { ...extra, connectSrc: [...(extra.connectSrc ?? []), capture.host] };
}
