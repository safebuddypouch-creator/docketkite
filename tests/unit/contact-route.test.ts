// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendEmail: vi.fn(),
  recordSubmission: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: { contactMessage: { create: mocks.create } },
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/email/submissions', () => ({ recordSubmission: mocks.recordSubmission }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: () => true }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/public-form-rate-limit', () => ({
  clientIp: () => '203.0.113.10',
  isRateLimited: mocks.isRateLimited,
}));

import { POST } from '@/app/api/contact/route';

function request() {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      message: 'Where is the inspection scheduled?',
    }),
  });
}

describe('public contact route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'message-1' });
    mocks.recordSubmission.mockResolvedValue({ recorded: true });
    mocks.isRateLimited.mockResolvedValue(false);
  });

  it('saves the message and does not email a personal inbox', async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('still accepts the message when company notification is unavailable', async () => {
    mocks.recordSubmission.mockResolvedValue({ recorded: false });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a flood with 429 before writing', async () => {
    mocks.isRateLimited.mockResolvedValue(true);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
