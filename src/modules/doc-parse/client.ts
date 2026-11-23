// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/doc-parse@0.2.0. Drift = commit rejected.
//
// Server-side Polsia doc-parse helper. No provider SDK, no provider key in the
// app: `parseDocument` goes through the Polsia docs proxy with the company API
// key. This file deliberately does NOT import `server-only`: that marker
// throws outside a React server bundle, which would break the cron use case
// (`npx --yes tsx jobs/x.ts`). The browser guard below is its runtime
// equivalent. Full guide in AGENT.md.

import { z } from 'zod/v4';
import { env } from '@/lib/env';
import {
  type DocModelInfo,
  type DocParsePreset,
  type DocParseResult,
  type DocParseTextResult,
  docModelsResultSchema,
  HTTP_STATUS,
  INVALID_OUTPUT,
  type Invoice,
  type ParseOptions,
  PRESET_SCHEMAS,
  type PresetParseOptions,
  parseOptionsSchema,
  parseResponseSchema,
  type QuotaWindow,
  quotaWindowSchema,
  type Receipt,
  type SchemaParseOptions,
  type TextParseOptions,
} from '@/modules/doc-parse/schema';

const PARSE_PATH = '/api/v2/app-docs/parse';
const MODELS_PATH = '/api/v2/app-docs/models';

/** The proxy answers within ~45 s and the hosting gateway cuts app requests at 60 s. */
const REQUEST_TIMEOUT_MS = 55_000;
const TIMEOUT_ERROR_NAME = 'TimeoutError';

/** First server-error status: this one and above are transient. */
const HTTP_SERVER_ERROR_MIN = 500;

const CODE_NOT_ENABLED = 'not_enabled';
const CODE_QUOTA_EXCEEDED = 'quota_exceeded';
const CODE_INVALID_FILE_URL = 'invalid_file_url';

/** Own property of every zod v4 schema; a zod v3 schema has none. */
const ZOD_V4_MARKER = '_zod';
/** Joins a zod issue path into a `DocFieldError.path`: `['lines', 3, 'totalCents']` -> `lines.3.totalCents`. */
const FIELD_PATH_SEPARATOR = '.';
const RETRY_HINT = 'Transient: retry later.';

/** Refusals tied to the document itself: fixing the call does not help, a different file might. */
const UNSUPPORTED_DOCUMENT_ERRORS: ReadonlyArray<readonly [number, string]> = [
  [HTTP_STATUS.payloadTooLarge, 'file_too_large'],
  [HTTP_STATUS.unsupportedMediaType, 'unsupported_type'],
  [HTTP_STATUS.unprocessable, 'document_too_long'],
  [HTTP_STATUS.unprocessable, 'document_rejected'],
  [HTTP_STATUS.unprocessable, 'document_unreadable'],
];

if (typeof window !== 'undefined') {
  throw new Error(
    'doc-parse client runs on the server only (route handler or cron job). Never import it from a client component.',
  );
}

/** `message`, followed by the proxy's `detail` when it sent one. */
function withDetail(message: string, detail: string | null): string {
  return detail ? `${message}: ${detail}` : message;
}

export class DocParseConfigurationError extends Error {
  constructor(message = 'Document parsing is not configured for this app.') {
    super(message);
    this.name = 'DocParseConfigurationError';
  }
}

/** Rollout flag off for this company. Surface it; NEVER fall back to an OCR SDK or a provider key. */
export class DocParseNotEnabledError extends Error {
  constructor(
    message = 'Document parsing is not enabled for this app yet. Ask Polsia support to enable it for the company.',
  ) {
    super(message);
    this.name = 'DocParseNotEnabledError';
  }
}

/** Daily cap reached. Keep what is saved and retry after `resetsAt` (next UTC day). */
export class QuotaExceededError extends Error {
  readonly cap: number | null;
  readonly used: number | null;
  /** ISO timestamp of the next quota window, null when the proxy did not send it. */
  readonly resetsAt: string | null;

  constructor(window: QuotaWindow | null) {
    super('Daily document-parsing quota exceeded for this app.');
    this.name = 'QuotaExceededError';
    this.cap = window?.cap ?? null;
    this.used = window?.used ?? null;
    this.resetsAt = window?.resetsAt ?? null;
  }
}

/** `fileUrl` does not point into this company's storage. Upload the file first, then pass its URL. */
export class InvalidFileUrlError extends Error {
  constructor(message = "The file URL is not an object in this company's storage.") {
    super(message);
    this.name = 'InvalidFileUrlError';
  }
}

/**
 * The document itself was refused: 413 `file_too_large` (over 20 MB), 415
 * `unsupported_type` (not jpeg, png, webp or pdf), 422 `document_too_long`
 * (too many pages, split it), 422 `document_rejected` (content filter) or 422
 * `document_unreadable` (empty file). Fixing the call does not
 * help; a different file might.
 */
export class UnsupportedDocumentError extends Error {
  readonly status: number;
  readonly code: string;
  /** Why, when the proxy says; for the developer, not the end user. */
  readonly detail: string | null;

  constructor(status: number, code: string, detail: string | null = null) {
    super(withDetail(`The document cannot be parsed: ${code}`, detail));
    this.name = 'UnsupportedDocumentError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Transient: the model provider or the proxy is down, unreachable or too slow
 * (any 5xx, a network failure, or no answer within 55 s). Retry once later.
 */
export class DocParseUnavailableError extends Error {
  /** HTTP status of the proxy answer; null for a network failure or the timeout. */
  readonly status: number | null;

  constructor(
    message = `Document parsing is temporarily unavailable. ${RETRY_HINT}`,
    options?: ErrorOptions & { status?: number },
  ) {
    super(message, options);
    this.name = 'DocParseUnavailableError';
    this.status = options?.status ?? null;
  }
}

/**
 * The call must be fixed, retrying it as is fails again: 400
 * `invalid_request` | `invalid_schema` | `unsupported_model` (`detail` says
 * why), 404 `file_not_found`, 401 (company key), or any other unexpected 4xx.
 */
export class DocParseError extends Error {
  readonly status: number;
  readonly code: string;
  /** Why the proxy refused the call (a 400), for the developer; null when it does not say. */
  readonly detail: string | null;

  constructor(status: number, code: string, detail: string | null = null) {
    super(withDetail(`Polsia doc-parse API request failed: ${status} ${code}`.trim(), detail));
    this.name = 'DocParseError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function polsiaApiBaseUrl() {
  return env.POLSIA_API_BASE_URL.replace(/\/+$/, '');
}

function polsiaApiKey() {
  const key = env.POLSIA_API_KEY;
  if (!key) {
    throw new DocParseConfigurationError(
      'POLSIA_API_KEY is missing. Polsia injects it into deployed apps and cron jobs; local dev must set it manually.',
    );
  }
  return key;
}

// Business errors are `{ ok: false, error: "<code>" }`; the frozen company-token
// auth contract (401) is `{ error: { message, type, code } }`.
function errorCodeOf(body: unknown): string {
  if (!body || typeof body !== 'object' || !('error' in body)) {
    return '';
  }
  const error = (body as { error: unknown }).error;
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return '';
}

/** The proxy's `detail` (why a 400 was refused), or null when the body has none. */
function detailOf(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('detail' in body)) {
    return null;
  }
  const detail = (body as { detail: unknown }).detail;
  return typeof detail === 'string' ? detail : null;
}

function isUnsupportedDocument(status: number, code: string) {
  return UNSUPPORTED_DOCUMENT_ERRORS.some(([s, c]) => s === status && c === code);
}

function throwTypedError(status: number, body: unknown): never {
  const code = errorCodeOf(body);
  const detail = detailOf(body);
  if (status === HTTP_STATUS.notFound && code === CODE_NOT_ENABLED) {
    throw new DocParseNotEnabledError();
  }
  if (status === HTTP_STATUS.tooManyRequests && code === CODE_QUOTA_EXCEEDED) {
    const window = quotaWindowSchema.safeParse(body);
    throw new QuotaExceededError(window.success ? window.data : null);
  }
  if (status === HTTP_STATUS.badRequest && code === CODE_INVALID_FILE_URL) {
    throw new InvalidFileUrlError();
  }
  if (isUnsupportedDocument(status, code)) {
    throw new UnsupportedDocumentError(status, code, detail);
  }
  if (status >= HTTP_SERVER_ERROR_MIN) {
    throw new DocParseUnavailableError(
      `Document parsing is temporarily unavailable (HTTP ${status}). ${RETRY_HINT}`,
      { status },
    );
  }
  throw new DocParseError(status, code, detail);
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === TIMEOUT_ERROR_NAME) {
      throw new DocParseUnavailableError(
        `Document parsing did not answer within ${REQUEST_TIMEOUT_MS / 1000} s. Retry once, or split the document.`,
      );
    }
    throw new DocParseUnavailableError(
      `Document parsing could not reach the Polsia proxy. ${RETRY_HINT}`,
      { cause: error },
    );
  }
}

async function polsiaJson(
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
): Promise<unknown> {
  const res = await send(`${polsiaApiBaseUrl()}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${polsiaApiKey()}`,
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    throwTypedError(res.status, responseBody);
  }
  return responseBody;
}

/** Throws a readable error for a zod v3 schema, which `z.toJSONSchema` would crash on. */
function assertZodV4(schema: unknown) {
  if (schema && typeof schema === 'object' && ZOD_V4_MARKER in schema) {
    return;
  }
  throw new TypeError(
    "parseDocument needs a zod v4 schema: import { z } from 'zod/v4' (the root 'zod' import is v3).",
  );
}

/**
 * The valid part of `value`: the parsed value when it passes; for an object
 * schema, its keys that have a valid part; for an array schema, each item's
 * valid part, the array dropped when one item has none (indices stay those of
 * `fieldErrors`). Undefined when nothing is valid or the schema is neither.
 */
function validPartOf(schema: z.ZodType, value: unknown): unknown {
  const checked = schema.safeParse(value);
  if (checked.success) {
    return checked.data;
  }

  const { shape, element } = schema as {
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
  };
  if (shape && value && typeof value === 'object' && !Array.isArray(value)) {
    const partial: Record<string, unknown> = {};
    for (const [key, keySchema] of Object.entries(shape)) {
      const part = validPartOf(keySchema, (value as Record<string, unknown>)[key]);
      if (part !== undefined) {
        partial[key] = part;
      }
    }
    return partial;
  }

  if (element && Array.isArray(value)) {
    const parts = value.map((item) => validPartOf(element, item));
    return parts.includes(undefined) ? undefined : parts;
  }

  return undefined;
}

/**
 * Revalidates the proxy's fields with the caller's schema. A mismatch becomes
 * `invalid_output` with null `fields`, the issues in `fieldErrors` and, for an
 * object schema, the valid part in `partialFields`.
 */
function toResult(
  response: z.infer<typeof parseResponseSchema>,
  fieldsSchema: z.ZodType | undefined,
): DocParseResult<unknown> {
  const { ok: _ok, fields, ...rest } = response;
  if (fields === null || !fieldsSchema) {
    return { ...rest, fields };
  }

  const checked = fieldsSchema.safeParse(fields);
  if (!checked.success) {
    const partialFields = validPartOf(fieldsSchema, fields);
    const fieldErrors = checked.error.issues.map((issue) => ({
      path: issue.path.map(String).join(FIELD_PATH_SEPARATOR),
      message: issue.message,
    }));
    return {
      ...rest,
      fields: null,
      fieldsError: INVALID_OUTPUT,
      ...(partialFields !== undefined ? { partialFields } : {}),
      fieldErrors,
    };
  }
  return { ...rest, fields: checked.data };
}

/**
 * The document models this app may pick, with the inputs they read, typical
 * duration and indicative price per page. Omit `model` in `parseDocument`:
 * the proxy picks the default. If the app needs a specific model, take its id
 * from this list, never hard-code one: the catalog changes without a module
 * release.
 */
export async function listDocModels(): Promise<DocModelInfo[]> {
  const body = await polsiaJson(MODELS_PATH, { method: 'GET' });
  return docModelsResultSchema.parse(body).models;
}

/**
 * Extracts a document through the Polsia proxy. Upload the file first and
 * pass its URL. Call from a route handler or cron job, and show the fields to
 * a human before saving them.
 *
 *   const { fields } = await parseDocument({ fileUrl, preset: 'receipt' });
 *   // fields: { merchant, date, currency, totalCents, subtotalCents, vat, category, paymentMethod } | null
 *
 *   // `z` from 'zod/v4'. fields null: prefill from `partialFields`, show `fieldErrors`.
 *   const { fields, partialFields, fieldErrors } = await parseDocument({
 *     fileUrl,
 *     schema: z.object({ iban: z.string().nullable() }),
 *   });
 *
 *   const { text, pages } = await parseDocument({ fileUrl }); // text only, 5 pages max
 */
export function parseDocument(
  options: PresetParseOptions<'receipt'>,
): Promise<DocParseResult<Receipt>>;
export function parseDocument(
  options: PresetParseOptions<'invoice'>,
): Promise<DocParseResult<Invoice>>;
export function parseDocument<S extends z.ZodType>(
  options: SchemaParseOptions<S>,
): Promise<DocParseResult<z.output<S>>>;
export function parseDocument(options: TextParseOptions): Promise<DocParseTextResult>;
export async function parseDocument(
  options: ParseOptions,
): Promise<DocParseResult<unknown> | DocParseTextResult> {
  if (options.preset !== undefined && options.schema !== undefined) {
    throw new TypeError('parseDocument takes either `preset` or `schema`, not both.');
  }
  if (options.schema !== undefined) {
    assertZodV4(options.schema);
  }

  const parsed = parseOptionsSchema.parse({
    fileUrl: options.fileUrl,
    preset: options.preset,
    instructions: options.instructions,
    includeText: options.includeText,
    model: options.model,
  });
  const preset: DocParsePreset | undefined = parsed.preset;
  const fieldsSchema = options.schema ?? (preset ? PRESET_SCHEMAS[preset] : undefined);

  const body = await polsiaJson(PARSE_PATH, {
    method: 'POST',
    body: {
      fileUrl: parsed.fileUrl,
      ...(preset !== undefined ? { preset } : {}),
      ...(options.schema !== undefined ? { jsonSchema: z.toJSONSchema(options.schema) } : {}),
      ...(parsed.instructions !== undefined ? { instructions: parsed.instructions } : {}),
      ...(parsed.includeText !== undefined ? { includeText: parsed.includeText } : {}),
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
    },
  });
  const result = toResult(parseResponseSchema.parse(body), fieldsSchema);
  if (fieldsSchema) {
    return result;
  }

  return { ...result, text: result.text ?? '', pages: result.pages ?? [] };
}
