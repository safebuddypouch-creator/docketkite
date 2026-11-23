// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendEmail: vi.fn(),
  recordSubmission: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: { contactMessage: { create: mocks.create } },
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/email/submissions', () => ({ recordSubmission: mocks.recordSubmission }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: () => true }));
vi.mock('@/lib/env', () => ({ env: {} }));

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
});
