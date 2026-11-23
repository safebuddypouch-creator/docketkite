// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/pdf@0.2.1. Drift = commit rejected.
//
// POST /api/pdf/document
// Generates a PDF from a validated DocumentSpec in the request body and streams
// it back as application/pdf.
//
// SECURITY: this route renders a PDF from arbitrary caller input. It is NOT an
// authorization boundary by itself. In production it MUST be gated behind an
// authenticated session / authorization check (e.g. verify the caller may
// generate this document) before it is exposed. Add that check in app-owned
// code; do not treat this route as safe to expose unauthenticated.

import 'server-only';
import { NextResponse } from 'next/server';
import {
  PdfImageError,
  PdfLayoutError,
  PdfTooLargeError,
  renderDocumentPdf,
  UnsupportedPdfCharacterError,
} from '@/lib/pdf/client';
import { loadPdfFonts } from '@/lib/pdf/font-config';
import { documentSpecSchema } from '@/lib/pdf/schema';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;

function tooLarge(message: string) {
  return NextResponse.json({ error: 'pdf_too_large', message }, { status: HTTP_PAYLOAD_TOO_LARGE });
}

/**
 * Reads the body as text, or returns null once it passes MAX_BODY_BYTES.
 * Counts the bytes actually received, so a missing or understated
 * `content-length` cannot slip a larger body through.
 */
async function readCappedBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) {
    return null;
  }

  const reader = req.body?.getReader();
  if (!reader) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    received += chunk.value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request) {
  try {
    await requireAuth(req);
  } catch (response) {
    return response as Response;
  }

  const text = await readCappedBody(req);
  if (text === null) {
    return tooLarge(`The request body exceeds ${MAX_BODY_BYTES / (1024 * 1024)} MB.`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = documentSpecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_document_spec', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const bytes = await renderDocumentPdf(parsed.data, { fonts: await loadPdfFonts() });
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="document.pdf"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnsupportedPdfCharacterError) {
      return NextResponse.json(
        { error: 'unsupported_pdf_character', codePoint: error.codePoint, message: error.message },
        { status: 422 },
      );
    }
    if (error instanceof PdfTooLargeError) {
      return tooLarge(error.message);
    }
    if (error instanceof PdfLayoutError) {
      return NextResponse.json(
        { error: 'pdf_layout_invalid', message: error.message },
        { status: HTTP_BAD_REQUEST },
      );
    }
    if (error instanceof PdfImageError) {
      return NextResponse.json(
        { error: 'pdf_image_invalid', message: error.message },
        { status: HTTP_BAD_REQUEST },
      );
    }
    return NextResponse.json({ error: 'pdf_generation_failed' }, { status: 500 });
  }
}
