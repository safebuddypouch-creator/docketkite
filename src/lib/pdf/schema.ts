// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/pdf@0.2.1. Drift = commit rejected.
//
// Shared schemas for server-side PDF document generation. Safe to import from
// client components: this file has no server-only imports and does not expose
// secrets, env, or the pdf-lib renderer. It is the input contract shared by the
// /api/pdf/document route, the renderer, and the user-owned download button.
//
// The compatible invoice shape uses integer cents. New block documents carry
// app-formatted text and have no currency assumption.

import { z } from 'zod';

/** Most blocks one document may carry; larger documents are refused with a 400. */
const MAX_DOCUMENT_BLOCKS = 2000;
/** Most items one `list` block may carry. */
const MAX_LIST_ITEMS = 1000;
/** Most rows one `keyValue` block may carry. */
const MAX_KEY_VALUE_ROWS = 1000;
/** Most columns one `table` block may carry; each one costs a cell per row and per page. */
const MAX_TABLE_COLUMNS = 50;
/**
 * Most characters of text one block document may carry, all blocks together:
 * about 200 pages of body text. Text is wrapped before the page cap can stop it.
 */
const MAX_DOCUMENT_TEXT_CHARS = 1_000_000;
/** Base64 image data URI, PNG or JPEG only. */
const IMAGE_DATA_URI = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
/** Leading bytes of each accepted image type. */
const IMAGE_SIGNATURES: Record<string, readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
};
/** Base64 characters that decode to the first 9 bytes, enough for either signature. */
const SIGNATURE_BASE64_CHARS = 12;

/**
 * True when the data URI's bytes start with the signature of its declared type,
 * so WebP or GIF bytes behind `data:image/png` fail validation. Decodes only the
 * first bytes. A URI the regex refuses passes here: the regex reports it.
 */
function hasDeclaredSignature(dataUri: string): boolean {
  const match = IMAGE_DATA_URI.exec(dataUri);
  if (!match) {
    return true;
  }

  const [, type = '', payload = ''] = match;
  const head = payload.slice(0, SIGNATURE_BASE64_CHARS);
  if (head.length < SIGNATURE_BASE64_CHARS) {
    return false;
  }

  const bytes = Array.from(atob(head), (character) => character.charCodeAt(0));
  return (IMAGE_SIGNATURES[type] ?? []).every((byte, index) => bytes[index] === byte);
}

export const documentLineItemSchema = z.object({
  description: z.string().min(1, 'description is required'),
  quantity: z.number().nonnegative(),
  unitAmountCents: z.number().int(),
});

export const documentMetaRowSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
});

export const invoiceDocumentSpecSchema = z.object({
  title: z.string().min(1, 'title is required'),
  subtitle: z.string().optional(),
  meta: z.array(documentMetaRowSchema).optional(),
  lineItems: z.array(documentLineItemSchema).optional(),
  totalCents: z.number().int().optional(),
  notes: z.string().optional(),
  footer: z.string().optional(),
  /** Refuses a mixed spec: `blocks` beside invoice fields fails instead of being dropped. */
  blocks: z.undefined().optional(),
});

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color');
const textStyleSchema = z
  .object({
    fontSize: z.number().min(4).max(144).optional(),
    bold: z.boolean().optional(),
    color: colorSchema.optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().min(1).max(3).optional(),
    spaceAfter: z.number().min(0).max(200).optional(),
  })
  .strict();
const keyValueStyleSchema = textStyleSchema.extend({ labelColor: colorSchema.optional() });

export const documentBlockSchema = z.discriminatedUnion('type', [
  textStyleSchema.extend({ type: z.literal('text'), text: z.string() }),
  textStyleSchema.extend({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  }),
  textStyleSchema.extend({
    type: z.literal('list'),
    items: z.array(z.string()).min(1).max(MAX_LIST_ITEMS),
    ordered: z.boolean().optional(),
  }),
  keyValueStyleSchema.extend({
    type: z.literal('keyValue'),
    rows: z.array(documentMetaRowSchema).min(1).max(MAX_KEY_VALUE_ROWS),
  }),
  z
    .object({
      type: z.literal('table'),
      columns: z
        .array(
          z
            .object({
              heading: z.string().optional(),
              width: z.number().positive().optional(),
              align: z.enum(['left', 'center', 'right']).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_TABLE_COLUMNS),
      rows: z.array(z.array(z.string())).min(1),
      fontSize: z.number().min(4).max(144).optional(),
      padding: z.number().min(0).max(40).optional(),
      borderColor: colorSchema.optional(),
      borderWidth: z.number().min(0).max(10).optional(),
      textColor: colorSchema.optional(),
      spaceAfter: z.number().min(0).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      data: z
        .string()
        .max(8_000_000)
        .regex(IMAGE_DATA_URI)
        .refine(hasDeclaredSignature, 'Image bytes must match the declared PNG or JPEG type'),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      spaceAfter: z.number().min(0).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('rule'),
      color: colorSchema.optional(),
      thickness: z.number().positive().max(20).optional(),
      spaceAfter: z.number().min(0).max(200).optional(),
    })
    .strict(),
  z.object({ type: z.literal('spacer'), height: z.number().positive().max(2000) }).strict(),
  z.object({ type: z.literal('pageBreak') }).strict(),
]);

/** A4 portrait, in points. */
const DEFAULT_PAGE_WIDTH = 595.28;
const DEFAULT_PAGE_HEIGHT = 841.89;
const DEFAULT_MARGIN = 40;

const marginSchema = z.number().min(0).max(400);
const pageSchema = z
  .object({
    width: z.number().min(144).max(2000).optional(),
    height: z.number().min(144).max(2000).optional(),
    margins: z
      .union([
        marginSchema,
        z
          .object({
            top: marginSchema,
            right: marginSchema,
            bottom: marginSchema,
            left: marginSchema,
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

/**
 * Page size and margins of a block document, defaults applied. The schema
 * checks and the renderer lays out the same geometry.
 *
 * @example pageGeometry({ margins: 20 }) // { width: 595.28, height: 841.89, margins: { top: 20, right: 20, bottom: 20, left: 20 } }
 */
export function pageGeometry(page: z.infer<typeof pageSchema> | undefined) {
  const margins = page?.margins ?? DEFAULT_MARGIN;
  return {
    width: page?.width ?? DEFAULT_PAGE_WIDTH,
    height: page?.height ?? DEFAULT_PAGE_HEIGHT,
    margins:
      typeof margins === 'number'
        ? { top: margins, right: margins, bottom: margins, left: margins }
        : margins,
  };
}

/** Characters of text a block draws, counted against MAX_DOCUMENT_TEXT_CHARS. */
function textLength(block: z.infer<typeof documentBlockSchema>): number {
  const sum = (texts: string[]) => texts.reduce((total, text) => total + text.length, 0);
  if (block.type === 'text' || block.type === 'heading') {
    return block.text.length;
  }
  if (block.type === 'list') {
    return sum(block.items);
  }
  if (block.type === 'keyValue') {
    return sum(block.rows.flatMap((row) => [row.label, row.value]));
  }
  if (block.type === 'table') {
    return sum([...block.columns.map((column) => column.heading ?? ''), ...block.rows.flat()]);
  }
  return 0;
}

export const blockDocumentSpecSchema = z
  .object({
    blocks: z.array(documentBlockSchema).min(1).max(MAX_DOCUMENT_BLOCKS),
    page: pageSchema.optional(),
    defaultTextStyle: textStyleSchema.optional(),
    /** Named styles, applied over `defaultTextStyle` and under each block's own fields. */
    styles: z
      .object({
        h1: textStyleSchema.optional(),
        h2: textStyleSchema.optional(),
        h3: textStyleSchema.optional(),
        list: textStyleSchema.optional(),
        keyValue: keyValueStyleSchema.optional(),
      })
      .strict()
      .optional(),
    metadata: z
      .object({
        title: z.string().optional(),
        author: z.string().optional(),
        subject: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((spec, context) => {
    const { width, height, margins } = pageGeometry(spec.page);
    if (
      spec.blocks.reduce((total, block) => total + textLength(block), 0) > MAX_DOCUMENT_TEXT_CHARS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A document carries at most ${MAX_DOCUMENT_TEXT_CHARS} characters of text`,
        path: ['blocks'],
      });
    }
    spec.blocks.forEach((block, blockIndex) => {
      if (block.type !== 'table') return;
      const contentWidth = width - margins.left - margins.right;
      const totalWeight = block.columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
      block.columns.forEach((column, columnIndex) => {
        if ((contentWidth * (column.width ?? 1)) / totalWeight <= (block.padding ?? 5) * 2) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Table column is too narrow for its padding',
            path: ['blocks', blockIndex, 'columns', columnIndex],
          });
        }
      });
      block.rows.forEach((row, rowIndex) => {
        if (row.length !== block.columns.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Every table row must have one cell per column',
            path: ['blocks', blockIndex, 'rows', rowIndex],
          });
        }
      });
    });
    if (margins.left + margins.right >= width || margins.top + margins.bottom >= height) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Page margins must leave a positive content area',
        path: ['page', 'margins'],
      });
    }
  });

// The invoice shape remains valid for already installed apps. New documents can
// use ordered blocks without inheriting its labels, currency or page layout.
export const documentSpecSchema = z.union([blockDocumentSpecSchema, invoiceDocumentSpecSchema]);

export type DocumentLineItem = z.infer<typeof documentLineItemSchema>;
export type DocumentMetaRow = z.infer<typeof documentMetaRowSchema>;
export type InvoiceDocumentSpec = z.infer<typeof invoiceDocumentSpecSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type BlockDocumentSpec = z.infer<typeof blockDocumentSpecSchema>;
export type DocumentSpec = z.infer<typeof documentSpecSchema>;
