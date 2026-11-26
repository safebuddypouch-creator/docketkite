// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const env = vi.hoisted(() => ({
  POLSIA_R2_BASE_URL: undefined as string | undefined,
}));

vi.mock('@/lib/env', () => ({ env }));

import { isAllowedLegacyLetterSourceUrl } from '@/lib/business/legacy-letter-source-url';

describe('legacy letter source URL allowlist', () => {
  beforeEach(() => {
    env.POLSIA_R2_BASE_URL = undefined;
  });

  it('allows Cloudflare R2 storage hosts only', () => {
    expect(
      isAllowedLegacyLetterSourceUrl(
        'https://acct.r2.cloudflarestorage.com/bucket/company/letter.pdf',
      ),
    ).toBe(true);
    expect(
      isAllowedLegacyLetterSourceUrl('https://evil.example/private/letter.pdf'),
    ).toBe(false);
    expect(
      isAllowedLegacyLetterSourceUrl('https://files.docketkitepermits.com/stored/x'),
    ).toBe(false);
    expect(isAllowedLegacyLetterSourceUrl('http://acct.r2.cloudflarestorage.com/x')).toBe(
      false,
    );
  });

  it('allows the configured R2 base host when set', () => {
    env.POLSIA_R2_BASE_URL = 'https://files.example-company.polsia.app';
    expect(isAllowedLegacyLetterSourceUrl('https://files.example-company.polsia.app/a.pdf')).toBe(
      true,
    );
    expect(isAllowedLegacyLetterSourceUrl('https://other.polsia.app/a.pdf')).toBe(false);
  });
});
