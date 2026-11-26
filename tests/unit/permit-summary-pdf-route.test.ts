// @polsia:user-owned — authorized permit summary PDF route tests.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTeamAccess: vi.fn(),
  findPermitScope: vi.fn(),
  findPermitRecord: vi.fn(),
  renderDocumentPdf: vi.fn(),
  loadPdfFonts: vi.fn(),
  isRateLimited: vi.fn(),
  clientIp: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: { permit: { findUnique: mocks.findPermitScope, findFirst: mocks.findPermitRecord } },
}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/team-access', () => ({ requireTeamAccess: mocks.requireTeamAccess }));
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
    codePoint = 0x1f600;
  },
}));
vi.mock('@/lib/pdf/font-config', () => ({ loadPdfFonts: mocks.loadPdfFonts }));

import { GET } from '@/app/api/permits/[permitId]/summary-pdf/route';

const recordUrl =
  'https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=26CAP&capID2=00000&capID3=02UTH&agencyCode=TAMPA';

function request() {
  return new Request('http://localhost/api/permits/permit-1/summary-pdf', { method: 'GET' });
}

function context() {
  return { params: Promise.resolve({ permitId: 'permit-1' }) };
}

describe('paid permit summary PDF route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@example.test',
      emailVerified: true,
    });
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.clientIp.mockReturnValue('203.0.113.10');
    mocks.requireTeamAccess.mockResolvedValue({
      response: null,
      membership: { role: 'owner' },
      paymentStatus: 'active',
      accessActive: true,
    });
    mocks.findPermitScope.mockResolvedValue({ id: 'permit-1', teamId: 'team-1' });
    mocks.findPermitRecord.mockResolvedValue({
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: recordUrl,
      notes: 'PRIVATE TEAM NOTE MUST NOT LEAVE THE DATABASE',
      teamNotes: [{ body: 'PRIVATE TEAM NOTE MUST NOT LEAVE THE DATABASE' }],
      portalStatusChecks: [
        {
          id: 'check-1',
          permitNumber: 'BLD-27-0529173',
          sourceUrl: recordUrl,
          status: 'Issued',
          result: 'checked',
          checkedAt: new Date('2026-11-14T09:12:30.000Z'),
          requestSequence: 1,
          sourceFetchedAt: new Date('2026-11-14T09:12:29.000Z'),
        },
      ],
    });
    mocks.loadPdfFonts.mockResolvedValue([]);
    mocks.renderDocumentPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  });

  it('renders an attachment from persisted permit and check history after paid team authorization', async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(
      'filename="tampa-permit-BLD-27-0529173.pdf"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(mocks.findPermitRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'permit-1', teamId: 'team-1' },
        select: expect.not.objectContaining({ notes: true, teamNotes: true }),
      }),
    );
    const renderedSpec = JSON.stringify(mocks.renderDocumentPdf.mock.calls[0]?.[0]);
    expect(renderedSpec).toContain('BLD-27-0529173');
    expect(renderedSpec).toContain('101 Sample Street, Tampa, FL');
    expect(renderedSpec).toContain('Issued');
    expect(renderedSpec).toContain('2026-11-14 09:12:30.000 UTC');
    expect(renderedSpec).toContain(recordUrl);
    expect(renderedSpec).not.toContain('PRIVATE TEAM NOTE MUST NOT LEAVE THE DATABASE');
  });

  it('returns the sign-in response before reading a permit for an unauthenticated request', async () => {
    mocks.requireAuth.mockRejectedValue(Response.json({ error: 'unauthorized' }, { status: 401 }));

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(mocks.findPermitScope).not.toHaveBeenCalled();
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });

  it('fails closed for nonmembers and every unpaid or unverified billing state', async () => {
    const states = [
      ['nonmember', 403],
      ['unpaid', 402],
      ['pending', 402],
      ['unverified', 402],
      ['inactive', 402],
      ['unavailable', 503],
    ] as const;

    for (const [state, status] of states) {
      mocks.findPermitRecord.mockClear();
      mocks.renderDocumentPdf.mockClear();
      mocks.requireTeamAccess.mockResolvedValue({
        response: Response.json({ error: state }, { status }),
      });

      const response = await GET(request(), context());
      const body = await response.text();

      expect(response.status, state).toBe(status);
      expect(body, state).not.toContain('BLD-27-0529173');
      expect(body, state).not.toContain('101 Sample Street');
      expect(mocks.findPermitRecord, state).not.toHaveBeenCalled();
      expect(mocks.renderDocumentPdf, state).not.toHaveBeenCalled();
    }
  });

  it('keeps the download unavailable when there is no saved official Tampa record URL', async () => {
    mocks.findPermitRecord.mockResolvedValue({
      permitNumber: 'BLD-27-0529173',
      address: '101 Sample Street, Tampa, FL',
      portalUrl: 'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx',
      portalStatusChecks: [],
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'official_record_link_required' });
    expect(response.headers.get('content-type')).not.toContain('application/pdf');
    expect(mocks.renderDocumentPdf).not.toHaveBeenCalled();
  });

  it('returns only an error response when PDF rendering fails', async () => {
    mocks.renderDocumentPdf.mockRejectedValue(new Error('render failed'));

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'pdf_generation_failed' });
  });
});
