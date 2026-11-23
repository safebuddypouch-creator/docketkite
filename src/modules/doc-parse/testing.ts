// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/doc-parse@0.2.0. Drift = commit rejected.
//
// Sample answers of the Polsia docs proxy, for the app's tests. The proxy
// cannot be called while the app is built: test against these answers and
// never invent another one. Ids and values are fake and the models are not
// the live catalog (`listDocModels()` is). No env, no network: safe in any test.
// Usage in AGENT.md (Testing).

import { z } from 'zod/v4';
import {
  DAILY_DOCUMENT_CAP,
  type DocModelInfo,
  type DocParseErrorCode,
  type docModelsResultSchema,
  type docParseErrorSchema,
  HTTP_STATUS,
  type parseResponseSchema,
  type QuotaWindow,
  type Receipt,
} from '@/modules/doc-parse/schema';

const JSON_HEADERS = { 'content-type': 'application/json' };

/** The model every sample extraction answers with; not a real catalog id. */
const SAMPLE_MODEL_ID = 'sample-model';

/** Country code, check digits, then 11 to 30 letters or digits, no spaces. */
const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** One proxy answer: its HTTP status and JSON body. */
export interface DocParseAnswer<Body = unknown> {
  readonly status: number;
  readonly body: Body;
}

type ParseBody = z.input<typeof parseResponseSchema>;
type ModelsBody = z.input<typeof docModelsResultSchema>;
/** An error body whose `error` is a known code. */
type ErrorBody = z.input<typeof docParseErrorSchema> & {
  error: DocParseErrorCode;
};
/** `429 quota_exceeded` body: the daily window that `QuotaExceededError` carries. */
type QuotaExceededBody = ErrorBody & QuotaWindow;

/**
 * A sample app schema with a rule the proxy cannot enforce: it strips
 * `pattern` before the model sees the schema, so an `iban` off the regex
 * still arrives and only the client's revalidation catches it.
 */
export const sampleBankDetailsSchema = z.object({
  holder: z.string().nullable(),
  iban: z.string().regex(IBAN_PATTERN),
  amountCents: z.number().int().nullable(),
});

/** Reads images and PDFs, the catalog default. */
const SAMPLE_MODEL: DocModelInfo = {
  id: SAMPLE_MODEL_ID,
  inputs: ['image', 'pdf'],
  p50Ms: 5_000,
  priceUsd: 0.001,
  per: 'page',
  default: true,
};

const RECEIPT: Receipt = {
  merchant: 'Sample Bakery',
  date: '2026-09-28',
  currency: 'EUR',
  totalCents: 1250,
  subtotalCents: 1136,
  vat: [{ ratePercent: 10, amountCents: 114 }],
  category: 'meals',
  paymentMethod: null,
};

const PAGE_MARKDOWN = '# Sample Bakery\n\n2026-09-28\n\nTotal 12.50 EUR';

/** Every proxy answer the client handles, by name. */
export const DOC_PARSE_ANSWERS = {
  /** `listDocModels()`: the catalog, one `default`. */
  models: {
    status: HTTP_STATUS.ok,
    body: { ok: true, models: [SAMPLE_MODEL] } satisfies ModelsBody,
  },
  /** `parseDocument({ preset: 'receipt' })`: every field valid. */
  receipt: {
    status: HTTP_STATUS.ok,
    body: {
      ok: true,
      fields: RECEIPT,
      pageCount: 1,
      model: SAMPLE_MODEL_ID,
    } satisfies ParseBody,
  },
  /**
   * `parseDocument({ schema: sampleBankDetailsSchema })`: `iban` breaks the
   * app's regex, the rest is valid. `fields` comes back null, `partialFields`
   * holds `holder` and `amountCents`, `fieldErrors` names `iban`.
   */
  offRuleField: {
    status: HTTP_STATUS.ok,
    body: {
      ok: true,
      fields: {
        holder: 'Sample Holder',
        iban: 'FR76 3000 6000 0112 3456 7890 189',
        amountCents: 4200,
      },
      pageCount: 1,
      model: SAMPLE_MODEL_ID,
    } satisfies ParseBody,
  },
  /** `parseDocument({ fileUrl })`: text only, no fields. */
  textOnly: {
    status: HTTP_STATUS.ok,
    body: {
      ok: true,
      fields: null,
      text: PAGE_MARKDOWN,
      pages: [{ index: 1, markdown: PAGE_MARKDOWN }],
      pageCount: 1,
      model: SAMPLE_MODEL_ID,
    } satisfies ParseBody,
  },
  /** Too many pages, refused after the model read it: `UnsupportedDocumentError`, split it. */
  documentTooLong: {
    status: HTTP_STATUS.unprocessable,
    body: { ok: false, error: 'document_too_long' } satisfies ErrorBody,
  },
  /** Empty file: `UnsupportedDocumentError`, a different file might work. */
  documentUnreadable: {
    status: HTTP_STATUS.unprocessable,
    body: { ok: false, error: 'document_unreadable' } satisfies ErrorBody,
  },
  /** A schema outside what the proxy accepts: `DocParseError`, `detail` says why. */
  invalidSchema: {
    status: HTTP_STATUS.badRequest,
    body: {
      ok: false,
      error: 'invalid_schema',
      detail: "root.lines: anyOf is only supported as [schema, { type: 'null' }]",
    } satisfies ErrorBody,
  },
  /** Daily cap reached: `QuotaExceededError`, retry after `resetsAt`. */
  quotaExceeded: {
    status: HTTP_STATUS.tooManyRequests,
    body: {
      ok: false,
      error: 'quota_exceeded',
      cap: DAILY_DOCUMENT_CAP,
      used: DAILY_DOCUMENT_CAP,
      resetsAt: '2026-10-03T00:00:00.000Z',
    } satisfies QuotaExceededBody,
  },
  /** Model provider down: `DocParseUnavailableError`, retry later. */
  providerUnavailable: {
    status: HTTP_STATUS.serviceUnavailable,
    body: { ok: false, error: 'provider_unavailable' } satisfies ErrorBody,
  },
} satisfies Record<string, DocParseAnswer>;

/**
 * A `fetch` stub answering `answer`: the real client then parses it, or
 * throws its typed error. For `vi.stubGlobal('fetch', ...)` or any runner's stub.
 */
export function docParseFetch(answer: DocParseAnswer): typeof fetch {
  return async () =>
    new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: JSON_HEADERS,
    });
}
