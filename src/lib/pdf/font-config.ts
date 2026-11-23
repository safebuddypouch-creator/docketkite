// @polsia:user-owned - Configure fonts for the PDF document route here.
//
// Return font bytes in priority order. Use TTF or OTF assets bundled with the
// app or a dependency (WOFF and WOFF2 throw: PDF viewers cannot read them);
// never use a request-supplied path or font URL. The renderer falls back to
// bundled Noto fonts for glyphs these faces lack.

import 'server-only';
import type { PdfFontSource } from '@/lib/pdf/client';

export async function loadPdfFonts(): Promise<PdfFontSource[]> {
  return [];
}
