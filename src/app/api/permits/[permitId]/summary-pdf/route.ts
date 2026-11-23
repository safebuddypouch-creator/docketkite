// @polsia:user-owned — paid-team PDF generated from persisted permit history.
import 'server-only';
import { NextResponse } from 'next/server';
import { buildPermitSummaryPdf } from '@/lib/business/permit-summary-pdf';
import { prisma } from '@/lib/db';
import {
  PdfImageError,
  PdfLayoutError,
  PdfTooLargeError,
  renderDocumentPdf,
  UnsupportedPdfCharacterError,
} from '@/lib/pdf/client';
import { loadPdfFonts } from '@/lib/pdf/font-config';
import { blockDocumentSpecSchema } from '@/lib/pdf/schema';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

function fileNameForPermit(permitNumber: string): string {
  const safeReference = permitNumber
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `tampa-permit-${safeReference || 'summary'}.pdf`;
}

function generationError(error: unknown) {
  if (error instanceof UnsupportedPdfCharacterError) {
    return NextResponse.json(
      { error: 'unsupported_pdf_character', codePoint: error.codePoint, message: error.message },
      { status: 422 },
    );
  }
  if (error instanceof PdfTooLargeError) {
    return NextResponse.json({ error: 'pdf_too_large', message: error.message }, { status: 413 });
  }
  if (error instanceof PdfLayoutError) {
    return NextResponse.json(
      { error: 'pdf_layout_invalid', message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof PdfImageError) {
    return NextResponse.json(
      { error: 'pdf_image_invalid', message: error.message },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: 'pdf_generation_failed' }, { status: 500 });
}

export async function GET(request: Request, context: { params: Promise<{ permitId: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return response as Response;
  }

  const { permitId } = await context.params;
  try {
    const scope = await prisma.permit.findUnique({
      where: { id: permitId },
      select: { id: true, teamId: true },
    });
    if (!scope?.teamId) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    const access = await requireTeamAccess(scope.teamId, user.id);
    if (access.response) return access.response;

    const record = await prisma.permit.findFirst({
      where: { id: permitId, teamId: scope.teamId },
      select: {
        permitNumber: true,
        address: true,
        portalUrl: true,
        portalStatusChecks: {
          select: {
            id: true,
            permitNumber: true,
            sourceUrl: true,
            status: true,
            result: true,
            checkedAt: true,
            requestSequence: true,
            sourceFetchedAt: true,
          },
          orderBy: [{ checkedAt: 'desc' }, { requestSequence: 'desc' }, { id: 'desc' }],
        },
      },
    });
    if (!record) return NextResponse.json({ error: 'permit_not_found' }, { status: 404 });

    const result = buildPermitSummaryPdf(record);
    if (!result.available) {
      return NextResponse.json({ error: result.error, message: result.message }, { status: 409 });
    }

    const spec = blockDocumentSpecSchema.safeParse(result.spec);
    if (!spec.success) {
      return NextResponse.json({ error: 'invalid_document_spec' }, { status: 400 });
    }

    const bytes = await renderDocumentPdf(spec.data, { fonts: await loadPdfFonts() });
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${fileNameForPermit(record.permitNumber)}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return generationError(error);
  }
}
