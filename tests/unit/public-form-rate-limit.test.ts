// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  clientIp,
  isRateLimited,
  resetPublicFormRateLimits,
} from '@/lib/public-form-rate-limit';

describe('public form rate limit', () => {
  afterEach(() => {
    resetPublicFormRateLimits();
  });

  it('reads the first forwarded hop', () => {
    const request = new Request('http://localhost/api/contact', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('allows up to max hits then blocks inside the window', () => {
    const now = 1_000_000;
    expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now)).toBe(false);
    expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now + 1)).toBe(false);
    expect(isRateLimited('contact:1.1.1.1', 2, 60_000, now + 2)).toBe(true);
  });

  it('resets after the window', () => {
    const now = 1_000_000;
    expect(isRateLimited('waitlist:2.2.2.2', 1, 1_000, now)).toBe(false);
    expect(isRateLimited('waitlist:2.2.2.2', 1, 1_000, now + 10)).toBe(true);
    expect(isRateLimited('waitlist:2.2.2.2', 1, 1_000, now + 1_001)).toBe(false);
  });
});
