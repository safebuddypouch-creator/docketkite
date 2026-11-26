// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    OPENROUTER_API_KEY: undefined,
    LETTER_EXTRACT_BASE_URL: undefined,
    LETTER_EXTRACT_MODEL: undefined,
    LETTER_EXTRACT_API_KEY: undefined,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.LETTER_EXTRACT_BASE_URL;
  delete process.env.LETTER_EXTRACT_MODEL;
  delete process.env.LETTER_EXTRACT_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_API_KEY;
  delete process.env.OPENROUTER_FREE_API_KEY;
});

async function loadExtract() {
  return import('../../src/lib/business/letter-extract');
}

test('normalizeOpenAiCompatibleBaseUrl appends /v1 when missing', async () => {
  const { normalizeOpenAiCompatibleBaseUrl } = await loadExtract();
  expect(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434')).toBe(
    'http://127.0.0.1:11434/v1',
  );
  expect(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1/')).toBe(
    'http://127.0.0.1:11434/v1',
  );
});

test('resolveLetterExtractProvider prefers local base URL over OpenRouter', async () => {
  process.env.LETTER_EXTRACT_BASE_URL = 'http://127.0.0.1:11434';
  process.env.LETTER_EXTRACT_MODEL = 'phi3:mini';
  process.env.OPENROUTER_API_KEY = 'sk-or-should-not-win';
  const { resolveLetterExtractProvider } = await loadExtract();
  expect(resolveLetterExtractProvider()).toEqual({
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'phi3:mini',
    apiKey: 'ollama',
  });
});

test('resolveLetterExtractProvider falls back to OpenRouter when local unset', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  const { resolveLetterExtractProvider } = await loadExtract();
  expect(resolveLetterExtractProvider()).toEqual({
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    apiKey: 'sk-or-test',
  });
});

test('extractCorrectionItems posts to local OpenAI-compatible chat completions', async () => {
  process.env.LETTER_EXTRACT_BASE_URL = 'http://127.0.0.1:11434/v1';
  process.env.LETTER_EXTRACT_MODEL = 'llama3.1';
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                { action: 'Revise footing detail', location: 'Sheet S1', planReference: null },
              ],
            }),
          },
        },
      ],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);

  const { extractCorrectionItems } = await loadExtract();
  const result = await extractCorrectionItems({
    bytes: Buffer.from('Please revise footing detail on Sheet S1.', 'utf8'),
    mimeType: 'text/plain',
    fileName: 'letter.txt',
  });

  expect(result.fields.items).toEqual([
    { action: 'Revise footing detail', location: 'Sheet S1', planReference: null },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
  const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
  expect(body.model).toBe('llama3.1');
  expect(init.headers).toMatchObject({
    authorization: 'Bearer ollama',
    'content-type': 'application/json',
  });
});
