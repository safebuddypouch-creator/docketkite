// @polsia:user-owned — preserve a validated team invite across auth navigation.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

const PUBLISHED_HOST =
  /^(?:[a-z0-9-]+\.)*apps\.grok\.bot$|^(?:[a-z0-9-]+\.)*(?:staging\.)?polsia\.(?:app|io)$/;

function webOrigin(value: string | null | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function isLoopback(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
}

/**
 * Origin for an emailed invite. A configured public URL wins. The published host
 * often has no NEXT_PUBLIC_APP_URL, so a same-site https Origin on the platform
 * is used instead. Loopback and other hosts are refused so a local fallback
 * cannot be mailed out.
 */
export function invitationAppUrl(request: {
  headers: { get(name: string): string | null };
}): string | undefined {
  const configured = webOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configured && !isLoopback(configured)) return configured.origin;

  const origin = webOrigin(request.headers.get('origin'));
  if (!origin || origin.protocol !== 'https:' || !PUBLISHED_HOST.test(origin.hostname)) {
    return undefined;
  }
  return origin.origin;
}

export function teamInvitationPageUrl(token: string, appUrl: string | undefined): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid invitation token');
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not configured');

  const configuredUrl = new URL(appUrl);
  if (
    !['http:', 'https:'].includes(configuredUrl.protocol) ||
    configuredUrl.username ||
    configuredUrl.password
  ) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an HTTP application origin');
  }

  const inviteUrl = new URL('/team-invite', configuredUrl.origin);
  inviteUrl.searchParams.set('token', token);
  return inviteUrl.toString();
}

export function teamInviteReturnUrl(search: string): string {
  const token = new URLSearchParams(search).get('invite');
  return token && TOKEN_PATTERN.test(token)
    ? `/team-invite?token=${encodeURIComponent(token)}`
    : '/dashboard';
}

/** Keep a local destination through sign-in without accepting open redirects. */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  if (
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint <= 31;
    }) ||
    value.includes(String.fromCharCode(127))
  ) {
    return null;
  }

  try {
    const destination = new URL(value, 'https://docketkite.invalid');
    if (destination.origin !== 'https://docketkite.invalid') return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

export function authReturnUrl(search: string): string {
  const invitationDestination = teamInviteReturnUrl(search);
  if (invitationDestination !== '/dashboard') return invitationDestination;

  const returnTo = new URLSearchParams(search).get('returnTo');
  return safeReturnPath(returnTo) ?? '/dashboard';
}

export function teamInviteAuthHref(path: '/login' | '/signup', token: string): string {
  return TOKEN_PATTERN.test(token) ? `${path}?invite=${encodeURIComponent(token)}` : path;
}
