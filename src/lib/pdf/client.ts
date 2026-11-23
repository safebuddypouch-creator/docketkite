// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/pdf@0.2.1. Drift = commit rejected.
//
// Server-only PDF renderer. Lays out configurable document blocks or the
// compatible invoice spec into a paginated PDF using pure-JS `pdf-lib`.
// No secrets, env, or network: rendering is local.

import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import {
  type BlockDocumentSpec,
  type DocumentBlock,
  type DocumentSpec,
  type InvoiceDocumentSpec,
  pageGeometry,
} from '@/lib/pdf/schema';

const { width: PAGE_WIDTH, height: PAGE_HEIGHT } = pageGeometry(undefined);
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEXT = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.88);
const ZEBRA = rgb(0.96, 0.97, 0.98);

// Column layout for the line-item table (x offsets from the left margin).
const COL_DESCRIPTION = 0;
const COL_QTY = CONTENT_WIDTH * 0.56;
const COL_UNIT = CONTENT_WIDTH * 0.72;
const COL_AMOUNT_RIGHT = CONTENT_WIDTH; // right-aligned edge

/** Most pages one block document may render. */
const MAX_RENDERED_PAGES = 200;
/** Most decoded image bytes one block document may embed, all images together. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Space above a heading, in ems of its font size; dropped at the top of a page. */
const HEADING_SPACE_BEFORE_EM = 0.6;
/** Gap between a list marker and its item text, in ems. */
const LIST_MARKER_GAP_EM = 0.5;
const LIST_BULLET = '\u2022';
/** Gap between a key-value label and its value, in ems (8 pt at the invoice's 10 pt). */
const KEY_VALUE_GAP_EM = 0.8;
/** Extra space under each key-value row, in ems (2 pt at the invoice's 10 pt). */
const KEY_VALUE_ROW_GAP_EM = 0.2;
/** Widest share of the content width a key-value label column may take. */
const KEY_VALUE_LABEL_SHARE = 1 / 3;

function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${frac}`;
}

export class UnsupportedPdfCharacterError extends Error {
  readonly codePoint: string;

  constructor(codePoint: number) {
    const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    super(`The PDF font does not support character ${label}.`);
    this.name = 'UnsupportedPdfCharacterError';
    this.codePoint = label;
  }
}

/** A block document exceeds a rendering cap (pages or decoded image bytes). */
export class PdfTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTooLargeError';
  }
}

/** Schema-valid input that cannot be laid out, e.g. one line taller than the page content area. */
export class PdfLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfLayoutError';
  }
}

/** Image bytes pdf-lib cannot embed: wrong type behind the data URI, or truncated data. */
export class PdfImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfImageError';
  }
}

// Supply font bytes from trusted server code. Font names and filesystem paths
// are deliberately absent from the public DocumentSpec/request body.
export interface PdfFontSource {
  regular: Uint8Array | ArrayBuffer;
  bold?: Uint8Array | ArrayBuffer;
}

export interface PdfRenderOptions {
  fonts?: readonly PdfFontSource[];
}

const characterSets = new WeakMap<PDFFont, Set<number>>();
const fallbackFonts = new WeakMap<PDFFont, PDFFont[]>();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

function supports(font: PDFFont, text: string): boolean {
  let supported = characterSets.get(font);
  if (!supported) {
    supported = new Set(font.getCharacterSet());
    characterSets.set(font, supported);
  }
  return Array.from(text).every((character) => supported.has(character.codePointAt(0) ?? 0));
}

function supportsWithFallbacks(font: PDFFont, text: string): boolean {
  return [font, ...(fallbackFonts.get(font) ?? [])].some((candidate) => supports(candidate, text));
}

function needsFallback(text: string, regular: PDFFont, bold: PDFFont): boolean {
  return Array.from(text).some(
    (character) =>
      character !== '\n' &&
      (!supportsWithFallbacks(regular, character) || !supportsWithFallbacks(bold, character)),
  );
}

function appendFallback(regular: PDFFont, bold: PDFFont, nextRegular: PDFFont, nextBold: PDFFont) {
  fallbackFonts.set(regular, [...(fallbackFonts.get(regular) ?? []), nextRegular]);
  fallbackFonts.set(bold, [...(fallbackFonts.get(bold) ?? []), nextBold]);
}

// Select a font per grapheme, then coalesce adjacent glyphs into text runs.
// One document can contain both Romanian Latin and Japanese characters.
// Refuse an incomplete document instead of silently drawing empty boxes.
function fontRuns(font: PDFFont, text: string): { font: PDFFont; text: string }[] {
  const runs: { font: PDFFont; text: string }[] = [];
  for (const { segment } of graphemes.segment(text)) {
    const selected = [font, ...(fallbackFonts.get(font) ?? [])].find((candidate) =>
      supports(candidate, segment),
    );
    if (!selected) throw new UnsupportedPdfCharacterError(segment.codePointAt(0) ?? 0);
    const last = runs[runs.length - 1];
    if (last?.font === selected) last.text += segment;
    else runs.push({ font: selected, text: segment });
  }
  return runs;
}

// Measuring shapes the text with fontkit; wrapping measures the same graphemes over and over.
const textWidths = new WeakMap<PDFFont, Map<string, number>>();

function widthOf(font: PDFFont, text: string, size: number): number {
  let widths = textWidths.get(font);
  if (!widths) {
    widths = new Map();
    textWidths.set(font, widths);
  }

  const key = `${size}|${text}`;
  const cached = widths.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const width = fontRuns(font, text).reduce(
    (sum, run) => sum + run.font.widthOfTextAtSize(run.text, size),
    0,
  );
  widths.set(key, width);
  return width;
}

function drawRuns(
  page: PDFPage,
  text: string,
  font: PDFFont,
  x: number,
  y: number,
  size: number,
  color: typeof TEXT,
): void {
  let runX = x;
  for (const run of fontRuns(font, text)) {
    page.drawText(run.text, { x: runX, y, size, font: run.font, color });
    runX += run.font.widthOfTextAtSize(run.text, size);
  }
}

// Preserve explicit paragraph boundaries, including blank lines. Long tokens
// (including Japanese text without spaces) wrap at grapheme boundaries.
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const spaceWidth = widthOf(font, ' ', size);
  for (const paragraph of normalizeText(text).split('\n')) {
    let current = '';
    let currentWidth = 0;

    // Widths are summed so a paragraph wraps in linear time. Kerning can pull an
    // overflowing sum back under the limit, so only then is the line re-measured.
    const append = (piece: string, pieceWidth: number): boolean => {
      const candidate = current + piece;
      let candidateWidth = currentWidth + pieceWidth;
      if (candidateWidth > maxWidth) {
        candidateWidth = widthOf(font, candidate, size);
      }
      if (candidateWidth > maxWidth) {
        return false;
      }

      current = candidate;
      currentWidth = candidateWidth;
      return true;
    };

    for (const word of paragraph.split(/ +/).filter(Boolean)) {
      const wordWidth = widthOf(font, word, size);
      if (append(current ? ` ${word}` : word, current ? spaceWidth + wordWidth : wordWidth)) {
        continue;
      }

      if (current) lines.push(current);
      current = '';
      currentWidth = 0;
      for (const { segment } of graphemes.segment(word)) {
        const segmentWidth = widthOf(font, segment, size);
        if (append(segment, segmentWidth)) {
          continue;
        }

        if (current) lines.push(current);
        current = segment;
        currentWidth = segmentWidth;
      }
    }
    lines.push(current);
  }
  return lines;
}

type TextAlign = 'left' | 'center' | 'right';

/** Text style of a block once the cascade is resolved: every field is set. */
interface ResolvedStyle {
  fontSize: number;
  bold: boolean;
  color: string;
  align: TextAlign;
  lineHeight: number;
  spaceAfter: number;
  /** Label color; only `keyValue` blocks read it. */
  labelColor: string;
}

/** Named style a block resolves against: `h1` to `h3` come from a heading's level. */
type StyleKind = 'text' | 'h1' | 'h2' | 'h3' | 'list' | 'keyValue';

const STYLE_KEYS = [
  'fontSize',
  'bold',
  'color',
  'align',
  'lineHeight',
  'spaceAfter',
  'labelColor',
] as const;

const BASE_STYLE: ResolvedStyle = {
  fontSize: 11,
  bold: false,
  color: '#1A1A1F',
  align: 'left',
  lineHeight: 1.3,
  spaceAfter: 0,
  labelColor: '#6B7380',
};

/**
 * Module defaults specific to a kind. They sit above `defaultTextStyle` so a
 * document-wide body size never flattens heading levels.
 */
const KIND_STYLES: Record<StyleKind, Partial<ResolvedStyle>> = {
  text: {},
  h1: { fontSize: 22, bold: true, spaceAfter: 8 },
  h2: { fontSize: 16, bold: true, spaceAfter: 6 },
  h3: { fontSize: 13, bold: true, spaceAfter: 4 },
  list: {},
  keyValue: {},
};

/** Style fields set in `layer`; undefined fields never erase a lower layer. */
function definedStyle(layer: Partial<ResolvedStyle> | undefined): Partial<ResolvedStyle> {
  if (!layer) {
    return {};
  }

  return Object.fromEntries(
    STYLE_KEYS.filter((key) => layer[key] !== undefined).map((key) => [key, layer[key]]),
  );
}

/**
 * Resolves the text style of a block, the last layer winning: module base
 * defaults, `defaultTextStyle`, module defaults of the kind (heading sizes),
 * the document's named style for the kind, then the block's own fields.
 *
 * @example resolveStyle('h2', block, spec).fontSize // 16 unless styles.h2 or the block sets it
 */
export function resolveStyle(
  kind: StyleKind,
  block: Partial<ResolvedStyle>,
  spec: Pick<BlockDocumentSpec, 'defaultTextStyle' | 'styles'>,
): ResolvedStyle {
  const named = kind === 'text' ? undefined : spec.styles?.[kind];
  return {
    ...BASE_STYLE,
    ...definedStyle(spec.defaultTextStyle),
    ...KIND_STYLES[kind],
    ...definedStyle(named),
    ...definedStyle(block),
  };
}

/** Text a block draws, for font fallback selection. */
function blockText(block: BlockDocumentSpec['blocks'][number]): string[] {
  if (block.type === 'text' || block.type === 'heading') {
    return [block.text];
  }
  if (block.type === 'table') {
    return [...block.columns.map((column) => column.heading ?? ''), ...block.rows.flat()];
  }
  if (block.type === 'list') {
    return [...block.items, ...listMarkers(block.items.length, block.ordered)];
  }
  if (block.type === 'keyValue') {
    return block.rows.flatMap((row) => [`${row.label}:`, row.value]);
  }
  return [];
}

function listMarkers(count: number, ordered: boolean | undefined): string[] {
  return Array.from({ length: count }, (_, index) => (ordered ? `${index + 1}.` : LIST_BULLET));
}

type TableBlock = Extract<DocumentBlock, { type: 'table' }>;
type ImageBlock = Extract<DocumentBlock, { type: 'image' }>;

interface RenderCursor {
  page: PDFPage;
  y: number;
}

/** Leading bytes of WOFF ('wOFF') and WOFF2 ('wOF2') files. */
const WEB_FONT_SIGNATURES = new Set(['wOFF', 'wOF2']);

/**
 * Embeds an app font. PDF viewers read TrueType or OpenType only: WOFF2 bytes
 * embedded as is render as dots, and the pinned fontkit cannot re-encode them.
 */
function embedAppFont(doc: PDFDocument, bytes: Uint8Array | ArrayBuffer): Promise<PDFFont> {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (WEB_FONT_SIGNATURES.has(String.fromCharCode(...view.subarray(0, 4)))) {
    throw new Error(
      'PDF app fonts must be TTF or OTF files; WOFF and WOFF2 are not supported. Use the TTF build, e.g. from @expo-google-fonts/<family>.',
    );
  }
  return doc.embedFont(bytes, { features: { locl: false } });
}

async function prepareFonts(doc: PDFDocument, text: string, options: PdfRenderOptions) {
  let font = await doc.embedFont(StandardFonts.Helvetica);
  let bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const customFonts = options.fonts ?? [];
  if (customFonts.length > 0) {
    doc.registerFontkit(fontkit);
    const pairs = await Promise.all(
      customFonts.map(async (source) => {
        const regular = await embedAppFont(doc, source.regular);
        // Keep separate font handles for regular/bold fallback selection even
        // when the caller has only one face for both roles.
        const bold = await embedAppFont(doc, source.bold ?? source.regular);
        return { regular, bold };
      }),
    );
    const first = pairs[0];
    if (first) {
      font = first.regular;
      bold = first.bold;
      for (const pair of pairs.slice(1)) appendFallback(font, bold, pair.regular, pair.bold);
    }
  }
  if (needsFallback(text, font, bold)) {
    doc.registerFontkit(fontkit);
    // Static local paths are traced into Next's standalone output. No runtime
    // download or dependency on fonts installed on the host machine. Ordinary
    // Latin invoices retain Helvetica. Noto Sans covers extended Latin; the
    // Japanese font is added only when the document needs its glyphs.
    const [regularBytes, boldBytes] = await Promise.all([
      readFile(
        join(
          process.cwd(),
          'node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf',
        ),
      ),
      readFile(
        join(
          process.cwd(),
          'node_modules/@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf',
        ),
      ),
    ]);
    // The pinned fontkit's subsets lose glyph outlines for these fonts even
    // though extracted text is correct. Embed complete TrueType fonts; the
    // raster regression test checks that every sample glyph is actually visible.
    // Keep the font's default glyphs: localized substitutions are absent from
    // pdf-lib's full-font Unicode map (e.g. digits in mixed Japanese text).
    const [notoRegular, notoBold] = await Promise.all([
      doc.embedFont(regularBytes, { features: { locl: false } }),
      doc.embedFont(boldBytes, { features: { locl: false } }),
    ]);
    if (customFonts.length > 0) appendFallback(font, bold, notoRegular, notoBold);
    else [font, bold] = [notoRegular, notoBold];
    if (needsFallback(text, font, bold)) {
      const [japaneseRegularBytes, japaneseBoldBytes] = await Promise.all([
        readFile(
          join(
            process.cwd(),
            'node_modules/@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf',
          ),
        ),
        readFile(
          join(
            process.cwd(),
            'node_modules/@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf',
          ),
        ),
      ]);
      const [japaneseRegular, japaneseBold] = await Promise.all([
        doc.embedFont(japaneseRegularBytes, { features: { locl: false } }),
        doc.embedFont(japaneseBoldBytes, { features: { locl: false } }),
      ]);
      appendFallback(font, bold, japaneseRegular, japaneseBold);
    }
  }

  return { font, bold };
}

async function renderInvoicePdf(
  spec: InvoiceDocumentSpec,
  options: PdfRenderOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const text = normalizeText(
    [
      spec.title,
      spec.subtitle,
      spec.notes,
      spec.footer,
      ...(spec.meta ?? []).flatMap((row) => [row.label, row.value]),
      ...(spec.lineItems ?? []).map((item) => item.description),
    ]
      .filter((value) => value !== undefined)
      .join('\n'),
  );
  const { font, bold } = await prepareFonts(doc, text, options);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const cursor: RenderCursor = { page, y: PAGE_HEIGHT - MARGIN };

  // Reserve vertical room; add a new page when the cursor would run past the
  // bottom margin so long invoices keep flowing.
  const ensureSpace = (needed: number) => {
    if (cursor.y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursor.page = page;
      cursor.y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawText = (
    text: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: typeof TEXT; rightX?: number } = {},
  ) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 11;
    const clean = normalizeText(text);
    const width = widthOf(f, clean, size);
    const x = opts.rightX !== undefined ? MARGIN + opts.rightX - width : MARGIN + (opts.x ?? 0);
    drawRuns(cursor.page, clean, f, x, cursor.y, size, opts.color ?? TEXT);
  };

  // --- Header: title + optional subtitle ---
  for (const line of wrap(bold, spec.title, 22, CONTENT_WIDTH)) {
    ensureSpace(30);
    drawText(line, { size: 22, font: bold });
    cursor.y -= 28;
  }

  if (spec.subtitle) {
    for (const line of wrap(font, spec.subtitle, 12, CONTENT_WIDTH)) {
      ensureSpace(18);
      drawText(line, { size: 12, color: MUTED });
      cursor.y -= 16;
    }
  }
  cursor.y -= 8;

  // --- Meta rows (label / value) ---
  if (spec.meta && spec.meta.length > 0) {
    const labelWidth = Math.min(
      160,
      Math.max(
        ...spec.meta.flatMap((row) =>
          normalizeText(`${row.label}:`)
            .split('\n')
            .map((line) => widthOf(bold, line, 10)),
        ),
      ) + 8,
    );
    for (const row of spec.meta) {
      const labels = wrap(bold, `${row.label}:`, 10, labelWidth - 8);
      const values = wrap(font, row.value, 10, CONTENT_WIDTH - labelWidth);
      for (let i = 0; i < Math.max(labels.length, values.length); i++) {
        ensureSpace(16);
        drawText(labels[i] ?? '', { size: 10, font: bold, color: MUTED });
        drawText(values[i] ?? '', { x: labelWidth, size: 10 });
        cursor.y -= 14;
      }
      cursor.y -= 2;
    }
    cursor.y -= 8;
  }

  // --- Line-item table ---
  if (spec.lineItems && spec.lineItems.length > 0) {
    ensureSpace(22);
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y + 14 },
      end: { x: MARGIN + CONTENT_WIDTH, y: cursor.y + 14 },
      thickness: 1,
      color: RULE,
    });
    drawText('Description', { x: COL_DESCRIPTION, size: 9, font: bold, color: MUTED });
    drawText('Qty', { x: COL_QTY, size: 9, font: bold, color: MUTED });
    drawText('Unit', { x: COL_UNIT, size: 9, font: bold, color: MUTED });
    drawText('Amount', { rightX: COL_AMOUNT_RIGHT, size: 9, font: bold, color: MUTED });
    cursor.y -= 6;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: MARGIN + CONTENT_WIDTH, y: cursor.y },
      thickness: 1,
      color: RULE,
    });
    cursor.y -= 16;

    spec.lineItems.forEach((item, index) => {
      const descLines = wrap(font, item.description, 10, COL_QTY - 8);
      const rowHeight = Math.max(18, descLines.length * 13 + 5);
      ensureSpace(rowHeight);

      if (index % 2 === 1) {
        cursor.page.drawRectangle({
          x: MARGIN - 6,
          y: cursor.y - (rowHeight - 13),
          width: CONTENT_WIDTH + 12,
          height: rowHeight,
          color: ZEBRA,
        });
      }

      const amountCents = item.quantity * item.unitAmountCents;
      const rowTop = cursor.y;
      descLines.forEach((line, i) => {
        cursor.y = rowTop - i * 13;
        drawText(line, { x: COL_DESCRIPTION, size: 10 });
      });
      cursor.y = rowTop;
      drawText(String(item.quantity), { x: COL_QTY, size: 10 });
      drawText(formatCents(item.unitAmountCents), { x: COL_UNIT, size: 10 });
      drawText(formatCents(amountCents), { rightX: COL_AMOUNT_RIGHT, size: 10 });
      cursor.y = rowTop - rowHeight;
    });

    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y + 6 },
      end: { x: MARGIN + CONTENT_WIDTH, y: cursor.y + 6 },
      thickness: 1,
      color: RULE,
    });
    cursor.y -= 8;
  }

  // --- Total ---
  if (typeof spec.totalCents === 'number') {
    ensureSpace(24);
    drawText('Total', { rightX: COL_UNIT + 40, size: 12, font: bold });
    drawText(formatCents(spec.totalCents), { rightX: COL_AMOUNT_RIGHT, size: 12, font: bold });
    cursor.y -= 24;
  }

  // --- Notes ---
  if (spec.notes) {
    cursor.y -= 8;
    for (const line of wrap(font, spec.notes, 10, CONTENT_WIDTH)) {
      ensureSpace(15);
      drawText(line, { size: 10, color: MUTED });
      cursor.y -= 14;
    }
  }

  // --- Footer (bottom of the last page) ---
  if (spec.footer) {
    const footerLines = wrap(font, spec.footer, 9, CONTENT_WIDTH);
    ensureSpace(footerLines.length * 12 + 8);
    let footerY = MARGIN - 8;
    for (const line of [...footerLines].reverse()) {
      drawRuns(cursor.page, line, font, MARGIN, footerY, 9, MUTED);
      footerY += 12;
    }
  }

  return doc.save();
}

function hexColor(value: string) {
  const hex = value.slice(1);
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
}

/** Decoded size of a base64 data URI payload, computed without decoding it. */
function decodedByteLength(dataUri: string): number {
  const payload = dataUri.slice(dataUri.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length * 3) / 4 - padding;
}

function assertImageBudget(spec: BlockDocumentSpec): void {
  const total = spec.blocks.reduce(
    (sum, block) => (block.type === 'image' ? sum + decodedByteLength(block.data) : sum),
    0,
  );
  if (total > MAX_IMAGE_BYTES) {
    throw new PdfTooLargeError(
      `The PDF images exceed ${MAX_IMAGE_BYTES / (1024 * 1024)} MB once decoded.`,
    );
  }
}

/** Vertical extent of a drawn line, in points. */
interface LineBox {
  /** From the line top down to the baseline. */
  ascent: number;
  /** Line pitch: at least the glyph box, so descenders never reach the next line or the margin. */
  height: number;
}

/**
 * Line box of `lines` drawn side by side on one baseline: the tallest ascent and
 * descent among the fonts the text uses (fallbacks included), and the pitch
 * `size * lineHeight`, raised to the glyph box when the font is taller.
 *
 * @example Noto Sans at lineHeight 1: height is 1.36 em, not 1 em.
 */
function lineBox(
  lines: { font: PDFFont; text: string }[],
  size: number,
  lineHeight: number,
): LineBox {
  const fonts = lines.flatMap(({ font, text }) => [
    font,
    ...fontRuns(font, text).map((run) => run.font),
  ]);
  const ascent = Math.max(...fonts.map((font) => font.heightAtSize(size, { descender: false })));
  const descent = Math.max(
    ...fonts.map((font) => font.heightAtSize(size) - font.heightAtSize(size, { descender: false })),
  );
  return { ascent, height: Math.max(size * lineHeight, ascent + descent) };
}

/** Embeds a PNG or JPEG data URI, or throws `PdfImageError` when pdf-lib cannot read its bytes. */
async function embedImage(doc: PDFDocument, dataUri: string) {
  // Own copy: a small Buffer is a view into Node's shared pool, and pdf-lib's JPEG
  // embedder reads `bytes.buffer` from offset 0 ("SOI not found in JPEG").
  const bytes = Uint8Array.from(Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64'));
  try {
    return dataUri.startsWith('data:image/png;')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
  } catch {
    throw new PdfImageError('An image is not a readable PNG or JPEG of its declared type.');
  }
}

async function renderBlockPdf(
  spec: BlockDocumentSpec,
  options: PdfRenderOptions,
): Promise<Uint8Array> {
  assertImageBudget(spec);
  const doc = await PDFDocument.create();
  if (spec.metadata?.title) doc.setTitle(spec.metadata.title);
  if (spec.metadata?.author) doc.setAuthor(spec.metadata.author);
  if (spec.metadata?.subject) doc.setSubject(spec.metadata.subject);

  const allText = spec.blocks.flatMap(blockText).join('\n');
  const { font, bold } = await prepareFonts(doc, allText, options);

  const { width: pageWidth, height: pageHeight, margins } = pageGeometry(spec.page);
  const contentWidth = pageWidth - margins.left - margins.right;
  const contentHeight = pageHeight - margins.top - margins.bottom;
  if (contentWidth <= 0 || contentHeight <= 0) {
    throw new PdfLayoutError('PDF page margins must leave a positive content area.');
  }

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margins.top;
  const newPage = () => {
    if (doc.getPageCount() >= MAX_RENDERED_PAGES) {
      throw new PdfTooLargeError(`The PDF would exceed ${MAX_RENDERED_PAGES} pages.`);
    }
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margins.top;
  };
  const ensureSpace = (height: number) => {
    if (height > contentHeight) {
      throw new PdfLayoutError('A PDF line or image is taller than the page content area.');
    }
    if (y - height < margins.bottom) newPage();
  };
  const advance = (height: number) => {
    let remaining = height;
    while (remaining > 0) {
      const available = y - margins.bottom;
      if (available <= 0) {
        newPage();
        continue;
      }
      const step = Math.min(remaining, available);
      y -= step;
      remaining -= step;
    }
  };
  const drawAligned = (
    text: string,
    selectedFont: PDFFont,
    size: number,
    color: typeof TEXT,
    left: number,
    width: number,
    align: 'left' | 'center' | 'right',
    baseline: number,
  ) => {
    const textWidth = widthOf(selectedFont, text, size);
    const x =
      align === 'right'
        ? left + width - textWidth
        : align === 'center'
          ? left + (width - textWidth) / 2
          : left;
    drawRuns(page, text, selectedFont, x, baseline, size, color);
  };

  /**
   * Wraps `text` into the column [left, left + width] and draws it line by
   * line, breaking pages between lines. `onFirstLine` receives the first
   * baseline before that line is drawn, so a list marker reads first.
   */
  const drawWrapped = (
    text: string,
    style: ResolvedStyle,
    left: number,
    width: number,
    onFirstLine?: (baseline: number) => void,
  ) => {
    const selectedFont = style.bold ? bold : font;
    const color = hexColor(style.color);
    wrap(selectedFont, text, style.fontSize, width).forEach((line, index) => {
      const box = lineBox([{ font: selectedFont, text: line }], style.fontSize, style.lineHeight);
      ensureSpace(box.height);
      const baseline = y - box.ascent;
      if (index === 0) {
        onFirstLine?.(baseline);
      }
      drawAligned(line, selectedFont, style.fontSize, color, left, width, style.align, baseline);
      y -= box.height;
    });
  };

  /** Height `drawWrapped` takes for `text` in a column `width` wide. */
  const wrappedHeight = (text: string, style: ResolvedStyle, width: number) => {
    const selectedFont = style.bold ? bold : font;
    return wrap(selectedFont, text, style.fontSize, width).reduce(
      (sum, line) =>
        sum +
        lineBox([{ font: selectedFont, text: line }], style.fontSize, style.lineHeight).height,
      0,
    );
  };

  /** Bullet or number right-aligned in a hanging column, item text wrapped beside it. */
  const drawList = (items: string[], ordered: boolean | undefined, style: ResolvedStyle) => {
    const markers = listMarkers(items.length, ordered);
    const markerFont = style.bold ? bold : font;
    const markerWidth = Math.max(
      ...markers.map((marker) => widthOf(markerFont, marker, style.fontSize)),
    );
    const indent = markerWidth + style.fontSize * LIST_MARKER_GAP_EM;
    const color = hexColor(style.color);
    items.forEach((item, index) => {
      drawWrapped(item, style, margins.left + indent, contentWidth - indent, (baseline) =>
        drawAligned(
          markers[index] ?? '',
          markerFont,
          style.fontSize,
          color,
          margins.left,
          markerWidth,
          'right',
          baseline,
        ),
      );
    });
  };

  /** Same layout as the invoice meta rows: muted bold labels, wrapped values, rows across pages. */
  const drawKeyValue = (rows: { label: string; value: string }[], style: ResolvedStyle) => {
    const size = style.fontSize;
    const gap = size * KEY_VALUE_GAP_EM;
    const valueFont = style.bold ? bold : font;
    const labelColor = hexColor(style.labelColor);
    const valueColor = hexColor(style.color);
    const widestLabel = Math.max(
      ...rows.flatMap((row) =>
        normalizeText(`${row.label}:`)
          .split('\n')
          .map((line) => widthOf(bold, line, size)),
      ),
    );
    const labelWidth = Math.min(contentWidth * KEY_VALUE_LABEL_SHARE, widestLabel + gap);
    const valueWidth = contentWidth - labelWidth;
    for (const row of rows) {
      const labels = wrap(bold, `${row.label}:`, size, labelWidth - gap);
      const values = wrap(valueFont, row.value, size, valueWidth);
      for (let index = 0; index < Math.max(labels.length, values.length); index++) {
        const label = labels[index] ?? '';
        const value = values[index] ?? '';
        const box = lineBox(
          [
            { font: bold, text: label },
            { font: valueFont, text: value },
          ],
          size,
          style.lineHeight,
        );
        ensureSpace(box.height);
        const baseline = y - box.ascent;
        drawAligned(
          label,
          bold,
          size,
          labelColor,
          margins.left,
          labelWidth - gap,
          'left',
          baseline,
        );
        drawAligned(
          value,
          valueFont,
          size,
          valueColor,
          margins.left + labelWidth,
          valueWidth,
          style.align,
          baseline,
        );
        y -= box.height;
      }
      advance(size * KEY_VALUE_ROW_GAP_EM);
    }
  };

  /** Height of one line in `style`, primary font only. */
  const styleLineHeight = (style: ResolvedStyle) =>
    lineBox([{ font: style.bold ? bold : font, text: '' }], style.fontSize, style.lineHeight)
      .height;

  /** Sizes of a table block, shared by its drawing and by the heading kept above it. */
  const tableLayout = (block: TableBlock) => {
    const tableFontSize = block.fontSize ?? spec.defaultTextStyle?.fontSize ?? 10;
    const lineHeight = tableFontSize * 1.3;
    const padding = block.padding ?? 5;
    const totalWeight = block.columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
    const widths = block.columns.map(
      (column) => (contentWidth * (column.width ?? 1)) / totalWeight,
    );
    const wrapRow = (cells: string[], selectedFont: PDFFont) =>
      cells.map((cell, index) =>
        wrap(selectedFont, cell, tableFontSize, (widths[index] ?? 0) - padding * 2),
      );
    const headings = block.columns.map((column) => column.heading ?? '');
    const headerLines = Math.max(...wrapRow(headings, bold).map((lines) => lines.length));
    const headerHeight = headerLines * lineHeight + padding * 2;
    const firstBodyLineHeight = lineHeight + padding * 2;
    // Repeat the header on each new page only when a body line still fits under
    // it, otherwise every page would hold nothing but the header. Same
    // arithmetic as `availableLines` in the table drawing, so both agree to the last bit.
    const bodyLinesUnderHeader = Math.floor(
      (pageHeight - margins.top - headerHeight - margins.bottom - padding * 2) / lineHeight,
    );
    const repeatHeader = headings.some(Boolean) && bodyLinesUnderHeader >= 1;
    return {
      tableFontSize,
      lineHeight,
      padding,
      widths,
      wrapRow,
      headings,
      repeatHeader,
      /** Room the table needs before it moves to the next page: header and first line, or first line. */
      startHeight: repeatHeader ? headerHeight + firstBodyLineHeight : firstBodyLineHeight,
    };
  };

  const embeddedImages = new Map<ImageBlock, PDFImage>();

  /** Embedded image of a block and its drawn size, scaled into the content area. Embeds each image once. */
  const imageLayout = async (block: ImageBlock) => {
    let image = embeddedImages.get(block);
    if (!image) {
      image = await embedImage(doc, block.data);
      embeddedImages.set(block, image);
    }

    const requestedWidth =
      block.width ?? (block.height ? (image.width * block.height) / image.height : image.width);
    const requestedHeight = block.height ?? (image.height * requestedWidth) / image.width;
    const scale = Math.min(1, contentWidth / requestedWidth, contentHeight / requestedHeight);
    return { image, width: requestedWidth * scale, height: requestedHeight * scale };
  };

  /**
   * Room a heading keeps for the block after it, at least the heading's own line
   * height: the first line of text, a table's header and first line, a whole image.
   */
  const keptAfterHeading = async (heading: ResolvedStyle, next: DocumentBlock | undefined) => {
    const floor = styleLineHeight(heading);
    if (next?.type === 'text' || next?.type === 'list' || next?.type === 'keyValue') {
      return Math.max(floor, styleLineHeight(resolveStyle(next.type, next, spec)));
    }
    if (next?.type === 'table') {
      return Math.max(floor, tableLayout(next).startHeight);
    }
    if (next?.type === 'image') {
      return Math.max(floor, (await imageLayout(next)).height);
    }
    return floor;
  };

  for (const [blockIndex, block] of spec.blocks.entries()) {
    if (block.type === 'pageBreak') {
      newPage();
      continue;
    }
    if (block.type === 'spacer') {
      advance(block.height);
      continue;
    }
    if (block.type === 'text') {
      const style = resolveStyle('text', block, spec);
      drawWrapped(block.text, style, margins.left, contentWidth);
      advance(style.spaceAfter);
      continue;
    }
    if (block.type === 'heading') {
      const style = resolveStyle(`h${block.level}`, block, spec);
      const atPageTop = y >= pageHeight - margins.top;
      const spaceBefore = atPageTop ? 0 : style.fontSize * HEADING_SPACE_BEFORE_EM;
      const keptHeight =
        spaceBefore +
        wrappedHeight(block.text, style, contentWidth) +
        style.spaceAfter +
        (await keptAfterHeading(style, spec.blocks[blockIndex + 1]));
      if (!atPageTop && y - keptHeight < margins.bottom) {
        newPage();
      } else {
        advance(spaceBefore);
      }
      drawWrapped(block.text, style, margins.left, contentWidth);
      advance(style.spaceAfter);
      continue;
    }
    if (block.type === 'list') {
      const style = resolveStyle('list', block, spec);
      drawList(block.items, block.ordered, style);
      advance(style.spaceAfter);
      continue;
    }
    if (block.type === 'keyValue') {
      const style = resolveStyle('keyValue', block, spec);
      drawKeyValue(block.rows, style);
      advance(style.spaceAfter);
      continue;
    }
    if (block.type === 'rule') {
      const thickness = block.thickness ?? 1;
      ensureSpace(thickness);
      page.drawLine({
        start: { x: margins.left, y },
        end: { x: margins.left + contentWidth, y },
        thickness,
        color: hexColor(block.color ?? '#D1D5DB'),
      });
      y -= thickness;
      advance(block.spaceAfter ?? 0);
      continue;
    }
    if (block.type === 'image') {
      const { image, width, height } = await imageLayout(block);
      ensureSpace(height);
      const x =
        block.align === 'right'
          ? margins.left + contentWidth - width
          : block.align === 'center'
            ? margins.left + (contentWidth - width) / 2
            : margins.left;
      page.drawImage(image, { x, y: y - height, width, height });
      y -= height;
      advance(block.spaceAfter ?? 0);
      continue;
    }

    const {
      tableFontSize,
      lineHeight,
      padding,
      widths,
      wrapRow,
      headings,
      repeatHeader,
      startHeight,
    } = tableLayout(block);
    const borderColor = hexColor(block.borderColor ?? '#D1D5DB');
    const textColor = hexColor(block.textColor ?? '#1A1A1F');
    if (lineHeight + padding * 2 > contentHeight) {
      throw new PdfLayoutError('A table line is taller than the page content area.');
    }
    const drawRow = (cells: string[], isHeader: boolean) => {
      const selectedFont = isHeader ? bold : font;
      const wrapped = wrapRow(cells, selectedFont);
      const rowLines = Math.max(...wrapped.map((lines) => lines.length));
      let offset = 0;
      while (offset < rowLines) {
        const availableLines = Math.floor((y - margins.bottom - padding * 2) / lineHeight);
        if (availableLines < 1) {
          newPage();
          if (repeatHeader && !isHeader) {
            drawRow(headings, true);
          }
          continue;
        }
        const count = Math.min(rowLines - offset, availableLines);
        const height = count * lineHeight + padding * 2;
        let x = margins.left;
        for (let columnIndex = 0; columnIndex < block.columns.length; columnIndex++) {
          const width = widths[columnIndex] ?? 0;
          page.drawRectangle({
            x,
            y: y - height,
            width,
            height,
            borderWidth: block.borderWidth ?? 0.5,
            borderColor,
          });
          for (let lineIndex = 0; lineIndex < count; lineIndex++) {
            const line = wrapped[columnIndex]?.[offset + lineIndex] ?? '';
            drawAligned(
              line,
              selectedFont,
              tableFontSize,
              textColor,
              x + padding,
              width - padding * 2,
              block.columns[columnIndex]?.align ?? 'left',
              y - padding - tableFontSize - lineIndex * lineHeight,
            );
          }
          x += width;
        }
        y -= height;
        offset += count;
      }
    };
    if (repeatHeader && y - startHeight < margins.bottom) {
      newPage();
    }
    if (headings.some(Boolean)) drawRow(headings, true);
    for (const row of block.rows) drawRow(row, false);
    advance(block.spaceAfter ?? 0);
  }

  return doc.save();
}

export async function renderDocumentPdf(
  spec: DocumentSpec,
  options: PdfRenderOptions = {},
): Promise<Uint8Array> {
  return spec.blocks !== undefined
    ? renderBlockPdf(spec, options)
    : renderInvoicePdf(spec, options);
}
