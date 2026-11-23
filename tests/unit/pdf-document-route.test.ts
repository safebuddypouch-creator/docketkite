// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  renderDocumentPdf: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
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
  });

  it('does not render a PDF for an anonymous caller', async () => {
    mocks.requireAuth.mockRejectedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(
      new Request('http://localhost/api/pdf/document', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Open document' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });
});
