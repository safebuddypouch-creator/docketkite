// @polsia:user-owned — doc-parse client tests use only the module's sample proxy answers.
// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import {
  DOC_PARSE_ANSWERS,
  docParseFetch,
  sampleBankDetailsSchema,
} from '@/modules/doc-parse/testing';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('doc-parse preserves valid partial fields from its documented sample answer', async () => {
  vi.stubEnv('SKIP_ENV_VALIDATION', '1');
  vi.stubEnv('POLSIA_API_BASE_URL', 'https://polsia.test');
  vi.stubGlobal('fetch', docParseFetch(DOC_PARSE_ANSWERS.offRuleField));
  vi.resetModules();

  const { parseDocument } = await import('@/modules/doc-parse/client');
  const result = await parseDocument({
    fileUrl: 'https://files.example.test/sample-document.pdf',
    schema: sampleBankDetailsSchema,
  });

  expect(result.fields).toBeNull();
  expect(result.partialFields).toEqual({ holder: 'Sample Holder', amountCents: 4200 });
  expect(result.fieldErrors?.map((error) => error.path)).toEqual(['iban']);
});

test('doc-parse translates its documented provider outage sample to a retryable error', async () => {
  vi.stubEnv('SKIP_ENV_VALIDATION', '1');
  vi.stubEnv('POLSIA_API_BASE_URL', 'https://polsia.test');
  vi.stubGlobal('fetch', docParseFetch(DOC_PARSE_ANSWERS.providerUnavailable));
  vi.resetModules();

  const { DocParseUnavailableError, parseDocument } = await import('@/modules/doc-parse/client');
  await expect(
    parseDocument({ fileUrl: 'https://files.example.test/sample-document.pdf' }),
  ).rejects.toBeInstanceOf(DocParseUnavailableError);
});
