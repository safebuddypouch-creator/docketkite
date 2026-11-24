// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    POLSIA_OWNER_EMAIL: 'owner@example.test',
    POLSIA_OWNER_ACCESS_CODE: 'correct-horse-battery',
  },
}));

import {
  ownerAccessCodeConfigured,
  ownerAccessEligible,
  ownerAccessMatches,
} from '@/lib/owner-access';

describe('owner access code', () => {
  it('accepts the configured owner email and code together', () => {
    expect(ownerAccessCodeConfigured()).toBe(true);
    expect(ownerAccessEligible(' OWNER@example.test ')).toBe(true);
    expect(ownerAccessMatches(' OWNER@example.test ', 'correct-horse-battery')).toBe(true);
  });

  it('rejects a different account or a different code', () => {
    expect(ownerAccessEligible('other@example.test')).toBe(false);
    expect(ownerAccessMatches('other@example.test', 'correct-horse-battery')).toBe(false);
    expect(ownerAccessMatches('owner@example.test', 'correct-horse-batteries')).toBe(false);
  });
});
