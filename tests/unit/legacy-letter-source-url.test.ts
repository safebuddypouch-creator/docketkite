// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isAllowedLegacyLetterSourceUrl } from '@/lib/business/legacy-letter-source-url';

describe('legacy letter source URL', () => {
  it('refuses every remote URL, including R2 and the old storage host', () => {
    expect(
      isAllowedLegacyLetterSourceUrl(
        'https://acct.r2.cloudflarestorage.com/bucket/company/letter.pdf',
      ),
    ).toBe(false);
    expect(isAllowedLegacyLetterSourceUrl('https://evil.example/private/letter.pdf')).toBe(false);
    expect(isAllowedLegacyLetterSourceUrl('https://files.docketkitepermits.com/stored/x')).toBe(
      false,
    );
    expect(isAllowedLegacyLetterSourceUrl('not a url')).toBe(false);
  });
});
