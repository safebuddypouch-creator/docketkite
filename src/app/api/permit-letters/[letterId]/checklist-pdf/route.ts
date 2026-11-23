// @polsia:user-owned — paid-team-only download of the current saved checklist.
import 'server-only';
import { NextResponse } from 'next/server';
import { PDFDocument, PDFString, rgb, StandardFonts } from 'pdf-lib';
import { buildPermitChecklistPdfSpec } from '@/lib/business/permit-checklist-pdf';
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
import { siteUrl } from '@/lib/site';
import { requireTeamAccess } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

async function getUser(request: Request): Promise<SessionUser | Response> {
  try {
    return await requireAuth(request);
  } catch (response) {
    return response as Response;
  }
}

function pdfErrorResponse(error: unknown): Response {
  if (error instanceof PdfTooLargeError) {
    return NextResponse.json({ error: 'pdf_too_large' }, { status: 413 });
  }
  if (error instanceof UnsupportedPdfCharacterError) {
    return NextResponse.json(
      { error: 'unsupported_pdf_character', codePoint: error.codePoint },
      { status: 422 },
    );
  }
  if (error instanceof PdfLayoutError) {
    return NextResponse.json({ error: 'pdf_layout_invalid' }, { status: 400 });
  }
  if (error instanceof PdfImageError) {
    return NextResponse.json({ error: 'pdf_image_invalid' }, { status: 400 });
  }
  return NextResponse.json({ error: 'pdf_generation_failed' }, { status: 500 });
}

async function addProtectedSourceLink(
  pdfBytes: Uint8Array,
  sourceUrl: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const left = 52;
  const top = page.getHeight() - 68;
  const linkLabel = 'Open source letter';
  const linkY = top - 106;
  const linkSize = 12;
  const linkWidth = bold.widthOfTextAtSize(linkLabel, linkSize);

  page.drawText('Source letter', {
    x: left,
    y: top,
    size: 23,
    font: bold,
    color: rgb(0.13, 0.15, 0.17),
  });
  page.drawText('This link opens the saved source letter through its protected app route.', {
    x: left,
    y: top - 38,
    size: 11,
    font: regular,
    color: rgb(0.29, 0.31, 0.34),
  });
  page.drawText(linkLabel, {
    x: left,
    y: linkY,
    size: linkSize,
    font: bold,
    color: rgb(0.62, 0.14, 0.17),
  });
  page.drawLine({
    start: { x: left, y: linkY - 2 },
    end: { x: left + linkWidth, y: linkY - 2 },
    thickness: 0.7,
    color: rgb(0.62, 0.14, 0.17),
  });

  const linkAnnotation = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [left, linkY - 3, left + linkWidth, linkY + linkSize + 3],
      Border: [0, 0, 0],
      A: {
        Type: 'Action',
        S: 'URI',
        URI: PDFString.of(sourceUrl),
      },
    }),
  );
  page.node.addAnnot(linkAnnotation);

  return pdf.save();
}

function safeFileName(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `correction-checklist-${slug || 'permit'}.pdf`;
}

export async function GET(request: Request, { params }: { params: Promise<{ letterId: string }> }) {
  const user = await getUser(request);
  if (user instanceof Response) return user;

  const { letterId } = await params;
  const permitId = new URL(request.url).searchParams.get('permitId') ?? '';
  if (!permitId) return NextResponse.json({ error: 'permit_id_required' }, { status: 400 });

  const accessLetter = await prisma.permitLetter.findFirst({
    where: { id: letterId, permitId },
    select: { teamId: true },
  });
  if (!accessLetter)
    return NextResponse.json({ error: 'permit_letter_not_found' }, { status: 404 });

  const access = await requireTeamAccess(accessLetter.teamId, user.id);
  if (access.response) return access.response;

  const letter = await prisma.permitLetter.findFirst({
    where: { id: letterId, permitId, teamId: accessLetter.teamId },
    select: {
      id: true,
      permitId: true,
      teamId: true,
      fileName: true,
      permit: {
        select: {
          teamId: true,
          permitNumber: true,
          projectName: true,
        },
      },
      correctionChecklist: {
        select: {
          id: true,
          permitId: true,
          teamId: true,
          items: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: {
              action: true,
              location: true,
              planReference: true,
              completed: true,
            },
          },
        },
      },
    },
  });
  const checklist = letter?.correctionChecklist;
  if (
    !letter ||
    !checklist ||
    checklist.permitId !== permitId ||
    checklist.teamId !== accessLetter.teamId ||
    letter.permit.teamId !== accessLetter.teamId
  ) {
    return NextResponse.json({ error: 'correction_checklist_not_found' }, { status: 404 });
  }

  const permitReference = letter.permit.permitNumber.trim() || letter.permit.projectName;
  const sourcePath = `/api/permit-letters/${encodeURIComponent(letter.id)}/source?${new URLSearchParams({ teamId: letter.teamId, permitId: letter.permitId }).toString()}`;
  const sourceUrl = new URL(sourcePath, siteUrl).toString();
  const spec = buildPermitChecklistPdfSpec({
    permitReference,
    sourceFileName: letter.fileName,
    generatedAt: new Date(),
    items: checklist.items,
  });
  const parsed = blockDocumentSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_document_spec' }, { status: 500 });
  }

  try {
    const rendered = await renderDocumentPdf(parsed.data, { fonts: await loadPdfFonts() });
    const linkedPdf = await addProtectedSourceLink(rendered, sourceUrl);
    return new Response(Buffer.from(linkedPdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${safeFileName(permitReference)}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
