// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  renderDocumentPdf: vi.fn(),
  sameOrigin: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/same-origin', () => ({ sameOrigin: mocks.sameOrigin }));
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
});
