// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  renderDocumentPdf: vi.fn(),
  sameOrigin: vi.fn(),
  isRateLimited: vi.fn(),
  clientIp: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock('@/lib/public-form-rate-limit', () => ({
  isRateLimited: mocks.isRateLimited,
  clientIp: mocks.clientIp,
}));
vi.mock('@/lib/pdf/client', () => ({
  renderDocumentPdf: mocks.renderDocumentPdf,
  PdfImageError: class PdfImageError extends Error {},
  PdfLayoutError: class PdfLayoutError extends Error {},
  PdfTooLargeError: class PdfTooLargeError extends Error {},
  UnsupportedPdfCharacterError: class UnsupportedPdfCharacterError extends Error {
    codePoint = 0;
  },
}));
vi.mock('@/lib/pdf/font-config', () => ({ loadPdfFonts: vi.fn() }));

import { POST } from '@/app/api/pdf/document/route';

describe('generic PDF route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sameOrigin.mockReturnValue(true);
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.clientIp.mockReturnValue('203.0.113.10');
    mocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      emailVerified: true,
    });
  });

  it('does not render a PDF for an anonymous caller', async () => {
    mocks.requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(
      new Request('http://localhost/api/pdf/document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ title: 'Open document' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });

  it('rejects cross-origin POSTs before auth or render', async () => {
    mocks.sameOrigin.mockReturnValue(false);

    const response = await POST(
      new Request('http://localhost/api/pdf/document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ title: 'Open document' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });

  it('rejects unverified sessions before render', async () => {
    mocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      emailVerified: false,
    });

    const response = await POST(
      new Request('http://localhost/api/pdf/document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ title: 'Open document' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'email_verification_required' });
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });

  it('rejects when the shared rate limit is exhausted', async () => {
    mocks.isRateLimited.mockResolvedValueOnce(true);

    const response = await POST(
      new Request('http://localhost/api/pdf/document', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ title: 'Open document' }),
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'pdf_rate_limited' });
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });
});
