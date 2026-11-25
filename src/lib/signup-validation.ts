// @polsia:user-owned — plain signup validation sentences.
// Better Auth's default body errors look like "[body.email] Invalid email address".

const EMAIL_SENTENCE = 'Enter a valid email address.';
const PASSWORD_SENTENCE = 'Enter a password.';
const NAME_SENTENCE = 'Enter your name.';

function passwordSentence(detail: string): string {
  const minimum = detail.match(/>=\s*(\d+)/);
  const count = minimum ? Number(minimum[1]) : 1;
  if (!Number.isFinite(count) || count <= 1) return PASSWORD_SENTENCE;
  return `Use at least ${count} characters for your password.`;
}

function sentenceFor(field: string, detail: string): string {
  const name = field.split('.').pop() ?? field;
  if (name === 'email') return EMAIL_SENTENCE;
  if (name === 'password') return passwordSentence(detail);
  if (name === 'name') return NAME_SENTENCE;
  return 'Check the form and try again.';
}

/** Turn raw validator paths into sentences. Other messages pass through. */
export function plainSignupValidationMessage(message: string): string {
  if (!message.includes('[body.')) return message.trim();
  const sentences = message
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^\[body\.([^\]]+)\]\s*(.*)$/i);
      if (!match) return 'Check the form and try again.';
      return sentenceFor(match[1] ?? '', match[2] ?? '');
    });
  return sentences.join(' ');
}

/** Rewrite a 400 validation body. Other responses are left untouched. */
export async function rewriteSignupValidationResponse(
  response: Response,
): Promise<Response | undefined> {
  if (response.status !== 400) return;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as {
    message?: unknown;
    code?: unknown;
  } | null;
  if (!body || body.code !== 'VALIDATION_ERROR' || typeof body.message !== 'string') return;
  if (!body.message.includes('[body.')) return;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json(
    { ...body, message: plainSignupValidationMessage(body.message) },
    { status: response.status, headers },
  );
}

/** Client check before sign-up. Empty when the fields can be submitted. */
export function signupClientError(email: string, password: string): string | undefined {
  const sentences: string[] = [];
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) sentences.push(EMAIL_SENTENCE);
  if (password.length < 1) sentences.push(PASSWORD_SENTENCE);
  else if (password.length < 8) sentences.push('Use at least 8 characters for your password.');
  return sentences.length > 0 ? sentences.join(' ') : undefined;
}
