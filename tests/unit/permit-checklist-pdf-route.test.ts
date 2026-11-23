// @polsia:user-owned — paid-team correction checklist PDF route tests.
// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  findLetter: vi.fn(),
  renderDocumentPdf: vi.fn(),
  loadPdfFonts: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: { permitLetter: { findFirst: mocks.findLetter } } }));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));
vi.mock('@/lib/pdf/client', () => ({
  renderDocumentPdf: mocks.renderDocumentPdf,
  PdfImageError: class PdfImageError extends Error {},
  PdfLayoutError: class PdfLayoutError extends Error {},
  PdfTooLargeError: class PdfTooLargeError extends Error {},
  UnsupportedPdfCharacterError: class UnsupportedPdfCharacterError extends Error {
    codePoint = 0x1f600;
  },
}));
vi.mock('@/lib/pdf/font-config', () => ({ loadPdfFonts: mocks.loadPdfFonts }));
vi.mock('@/lib/site', () => ({ siteUrl: 'http://localhost' }));

import { GET } from '@/app/api/permit-letters/[letterId]/checklist-pdf/route';

function request() {
  return new Request(
    'http://localhost/api/permit-letters/letter-1/checklist-pdf?permitId=permit-1',
  );
}

function context() {
  return { params: Promise.resolve({ letterId: 'letter-1' }) };
}

describe('paid team correction checklist PDF route', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'owner-1', email: 'owner@example.test' });
    mocks.requireTeamAccess.mockResolvedValue({
      response: null,
      membership: { role: 'owner' },
      paymentStatus: 'active',
      accessActive: true,
    });
    mocks.findLetter.mockResolvedValueOnce({ teamId: 'paid-team' }).mockResolvedValueOnce({
      id: 'letter-1',
      permitId: 'permit-1',
      teamId: 'paid-team',
      fileName: 'correction-letter.pdf',
      permit: {
        teamId: 'paid-team',
        permitNumber: 'BLD-27-0529173',
        projectName: 'Sample kitchen remodel',
      },
      correctionChecklist: {
        id: 'checklist-1',
        permitId: 'permit-1',
        teamId: 'paid-team',
        items: [
          {
            action: 'Show the revised wall section',
            location: 'Sheet A2',
            planReference: 'Detail 4',
            completed: false,
          },
        ],
      },
    });
    mocks.loadPdfFonts.mockResolvedValue([]);
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage();
    mocks.renderDocumentPdf.mockResolvedValue(await sourcePdf.save());
  });

  it('returns a generated checklist PDF after authorizing the paid team', async () => {
    const response = await GET(request(), context());

    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(
      'correction-checklist-BLD-27-0529173.pdf',
    );
    const generatedPdf = new Uint8Array(await response.arrayBuffer());
    expect(generatedPdf.slice(0, 5)).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
    expect(mocks.requireTeamAccess).toHaveBeenCalledWith('paid-team', 'owner-1');
    expect(mocks.renderDocumentPdf).toHaveBeenCalled();
    expect(JSON.stringify(mocks.renderDocumentPdf.mock.calls[0]?.[0])).toContain(
      'Show the revised wall section',
    );
  });

  it('does not read checklist contents or render a PDF when the team is unpaid', async () => {
    mocks.requireTeamAccess.mockResolvedValue({
      response: Response.json({ error: 'team_subscription_required' }, { status: 402 }),
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(402);
    expect(mocks.findLetter).toHaveBeenCalledTimes(1);
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });
});
