// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/doc-parse@0.2.0. Drift = commit rejected.
//
// Wire schemas, presets and types for the Polsia docs proxy
// (/api/v2/app-docs/parse). Safe to import from client components: zod only,
// no env, no secrets, no network.

import { z } from 'zod/v4';

/** Upper bound on `fileUrl`. */
export const MAX_FILE_URL_LENGTH = 2048;
/** Upper bound on `instructions`, appended to the proxy's fixed instruction. */
export const MAX_INSTRUCTIONS_LENGTH = 2000;
/** Largest document the proxy reads: 20 MB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Most pages extracted when only fields are requested. */
export const MAX_FIELD_PAGES = 10;
/** Most pages extracted when the text is requested (`includeText`, or no schema). */
export const MAX_TEXT_PAGES = 5;
/** Documents parsed per company per UTC day. */
export const DAILY_DOCUMENT_CAP = 100;

export const DOC_PARSE_PRESETS = ['receipt', 'invoice'] as const;
export type DocParsePreset = (typeof DOC_PARSE_PRESETS)[number];

/** HTTP statuses of the proxy answers. */
export const HTTP_STATUS = {
  ok: 200,
  badRequest: 400,
  notFound: 404,
  payloadTooLarge: 413,
  unsupportedMediaType: 415,
  unprocessable: 422,
  tooManyRequests: 429,
  serviceUnavailable: 503,
} as const;

/** Business error codes the proxy answers with `{ ok: false, error }`. */
export const DOC_PARSE_ERROR_CODES = [
  'invalid_request',
  'invalid_file_url',
  'invalid_schema',
  'unsupported_model',
  'not_enabled',
  'file_not_found',
  'file_too_large',
  'unsupported_type',
  'document_too_long',
  'document_rejected',
  'document_unreadable',
  'quota_exceeded',
  'provider_unavailable',
] as const;
export type DocParseErrorCode = (typeof DOC_PARSE_ERROR_CODES)[number];

/** Set on a result whose fields did not match the requested schema; `fields` is then null. */
export const INVALID_OUTPUT = 'invalid_output';

const nullableText = z.string().nullable();
const nullableCents = z.number().int().nullable();

export const vatLineSchema = z.object({
  ratePercent: z.number().nullable(),
  amountCents: nullableCents,
});

/** Preset `receipt`. Amounts in integer cents, dates ISO `YYYY-MM-DD`, unreadable values null. */
export const receiptSchema = z.object({
  merchant: nullableText,
  date: nullableText,
  currency: nullableText,
  totalCents: nullableCents,
  subtotalCents: nullableCents,
  vat: z.array(vatLineSchema),
  category: nullableText,
  paymentMethod: nullableText,
});

export const invoiceLineSchema = z.object({
  description: nullableText,
  quantity: z.number().nullable(),
  unitPriceCents: nullableCents,
  totalCents: nullableCents,
});

/** Preset `invoice`. Amounts in integer cents, dates ISO `YYYY-MM-DD`, unreadable values null. */
export const invoiceSchema = z.object({
  supplier: nullableText,
  invoiceNumber: nullableText,
  issueDate: nullableText,
  dueDate: nullableText,
  currency: nullableText,
  totalCents: nullableCents,
  subtotalCents: nullableCents,
  vat: z.array(vatLineSchema),
  lines: z.array(invoiceLineSchema),
});

export const PRESET_SCHEMAS = {
  receipt: receiptSchema,
  invoice: invoiceSchema,
} as const;

/** The plain-data part of a parse call; the free `schema` is checked separately. */
export const parseOptionsSchema = z.object({
  fileUrl: z.url().max(MAX_FILE_URL_LENGTH),
  preset: z.enum(DOC_PARSE_PRESETS).optional(),
  instructions: z.string().trim().min(1).max(MAX_INSTRUCTIONS_LENGTH).optional(),
  includeText: z.boolean().optional(),
  model: z.string().trim().min(1).optional(),
});

export const docPageSchema = z.object({
  index: z.number().int(),
  markdown: z.string(),
});

export const parseResponseSchema = z.object({
  ok: z.literal(true),
  fields: z.record(z.string(), z.unknown()).nullable(),
  fieldsError: z.literal(INVALID_OUTPUT).optional(),
  text: z.string().optional(),
  pages: z.array(docPageSchema).optional(),
  pageCount: z.number().int(),
  model: z.string(),
});

/**
 * One model an app may pick, as `GET /api/v2/app-docs/models` lists it. Read
 * the list with `listDocModels()`; never hard-code ids. Open string fields
 * mirror the proxy, so a new catalog value never breaks the parse.
 */
export const docModelInfoSchema = z.object({
  id: z.string().min(1),
  /** Document kinds the model reads: `image`, `pdf`. */
  inputs: z.array(z.string()),
  /** Typical duration of a one-page receipt photo, in milliseconds. */
  p50Ms: z.number().nonnegative(),
  /** Indicative price in USD per `per` (`page`). */
  priceUsd: z.number().nonnegative(),
  per: z.string(),
  /** The model a request gets when it names none. */
  default: z.boolean(),
});

/** `200` body of `GET /api/v2/app-docs/models`. */
export const docModelsResultSchema = z.object({
  ok: z.literal(true),
  models: z.array(docModelInfoSchema),
});

export const docParseErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  /** Why a 400 was refused, for the developer (at most 500 characters). */
  detail: z.string().optional(),
});

/** Extra fields of a 429 `quota_exceeded` body. */
export const quotaWindowSchema = z.object({
  cap: z.number(),
  used: z.number(),
  resetsAt: z.string(),
});

export type VatLine = z.infer<typeof vatLineSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type DocPage = z.infer<typeof docPageSchema>;
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;
export type DocModelInfo = z.infer<typeof docModelInfoSchema>;

interface BaseParseOptions {
  /** URL of a file uploaded to the company's storage (`POST /api/proxy/r2/upload`); keep it on the server. */
  fileUrl: string;
  /** Extra guidance appended to the fixed instruction (language, field hints). */
  instructions?: string;
  /** An id from `listDocModels()`; omit it for the default. */
  model?: string;
}

/** Fields from a built-in preset; `includeText: true` also returns the text (5 pages max). */
export interface PresetParseOptions<P extends DocParsePreset> extends BaseParseOptions {
  preset: P;
  schema?: never;
  includeText?: boolean;
}

/** Fields from your own zod/v4 object schema; `includeText: true` also returns the text. */
export interface SchemaParseOptions<S extends z.ZodType> extends BaseParseOptions {
  schema: S;
  preset?: never;
  includeText?: boolean;
}

/** Text only: no preset, no schema. */
export interface TextParseOptions extends BaseParseOptions {
  preset?: never;
  schema?: never;
  includeText?: boolean;
}

export type ParseOptions =
  | PresetParseOptions<DocParsePreset>
  | SchemaParseOptions<z.ZodType>
  | TextParseOptions;

/** One reason the extracted fields failed the preset or your schema. */
export interface DocFieldError {
  /** Dotted path of the failing value (`iban`, `lines.3.totalCents`); `''` for the whole object. */
  path: string;
  /** zod's message for that value. */
  message: string;
}

/** `T` with optional keys at every depth; arrays keep their items. */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface DocParseResult<T> {
  /** Extracted fields, validated against the preset or your schema; null when none were requested or valid. */
  fields: T | null;
  /** `invalid_output` when the model answered fields that failed validation. */
  fieldsError?: typeof INVALID_OUTPUT;
  /**
   * Set with `fieldsError` when the fields reached the app but failed its
   * object schema: every valid value, nested objects and array items reduced
   * the same way (an array is dropped when one item has nothing valid).
   * Prefill a review form from it. Absent when `fields` is valid or the proxy
   * sent none.
   */
  partialFields?: DeepPartial<T>;
  /** Set with `fieldsError` when the fields reached the app: why they failed, one entry per issue. */
  fieldErrors?: DocFieldError[];
  /** Whole document as markdown, when the text was requested. */
  text?: string;
  /** Per-page markdown, when the text was requested. */
  pages?: DocPage[];
  pageCount: number;
  /** Model id that served the call. */
  model: string;
}

export interface DocParseTextResult extends DocParseResult<null> {
  text: string;
  pages: DocPage[];
}
