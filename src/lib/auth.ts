// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/better-auth@0.13.1. Drift = commit rejected.
// Protected core (db/secret/base URL, admin plugin, multi-host trusted origins, Google sign-in
// through Polsia or the owner's client, with its multi-host base URL) + owner-admin grant, composed with the app's own databaseHooks. Configure auth
// in @/lib/auth-config (user-owned).

import 'server-only';
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { admin, type GenericOAuthConfig, genericOAuth } from 'better-auth/plugins';
import { authConfig } from '@/lib/auth-config';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { env } from '@/lib/env';

// Compose the owner-admin grant with the app's hooks — don't overwrite them.
const appHooks = authConfig.databaseHooks;
const ownerEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();

// Multi-host auth: ONE build is served on <slug>.polsia.app, the <slug>.polsia.io
// backup domain, and custom brand domains — each must pass better-auth's
// Origin/CSRF check on sign-in/sign-up. The wildcards cover the Polsia serving
// domains (incl. any post-rename slug); BETTER_AUTH_TRUSTED_ORIGINS is injected
// per-deploy by the Polsia backend with the company's active custom domains.
// baseURL's own origin is always trusted implicitly. Framework-owned so an
// app can't accidentally narrow it back to a single host.
const customOrigins =
  env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) ?? [];
function trustedOrigins(request?: Request): string[] {
  const origins = ['https://*.polsia.app', 'https://*.polsia.io', ...customOrigins];
  // A browser cannot claim Sec-Fetch-Site: same-origin from another site.
  // Trust that page's origin so signup works on the published host.
  if (request?.headers.get('sec-fetch-site') === 'same-origin') {
    const origin = request.headers.get('origin');
    if (origin) origins.push(origin);
  }
  return origins;
}

const WILDCARD = '*';
const HTTP_PROTOCOL = 'http:';

/** Provider id of Google sign-in (Polsia broker or the owner's client); the button signs in with it. */
const GOOGLE_PROVIDER_ID = 'google';
/**
 * Google's redirect URI path under /api/auth: the one the Polsia broker accepts and owners
 * registered in their Google client. better-auth 1.7 mounts the callback at `/callback/google`.
 */
const GOOGLE_CALLBACK_PATH = `/oauth2/callback/${GOOGLE_PROVIDER_ID}`;
const GOOGLE_CALLBACK_ENDPOINT = `/callback/${GOOGLE_PROVIDER_ID}`;
const GOOGLE_SCOPES = ['openid', 'email', 'profile'];
const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Parses an absolute URL; `undefined` when absent or invalid (env validation is skipped at build). */
function parseURL(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Multi-host base URL, only while Google sign-in is on (otherwise BETTER_AUTH_URL as
 * before): OAuth redirect URIs and email links follow the request host when it is the app URL
 * or an exact custom domain (e.g. `brand.com`), so a Google sign-in started on a custom domain
 * returns there. Wildcards are never allowed (a forged `Host` would poison links); any other
 * host falls back to BETTER_AUTH_URL. `http` only when BETTER_AUTH_URL is (local dev).
 */
function resolveBaseURL(): BetterAuthOptions['baseURL'] {
  const appURL = parseURL(env.BETTER_AUTH_URL);
  const publicURL = parseURL(env.NEXT_PUBLIC_APP_URL);
  const customHosts = customOrigins
    .filter((origin) => !origin.includes(WILDCARD))
    .flatMap((origin) => parseURL(origin)?.host ?? []);
  // The published app is served on *.apps.grok.bot while request.url stays on the
  // internal host. Allow that public host so signup's origin check can pass.
  const allowedHosts = [
    ...new Set(
      [
        '*.polsia.app',
        '*.polsia.io',
        '*.apps.grok.bot',
        'localhost',
        '127.0.0.1',
        appURL?.host,
        publicURL?.host,
        ...customHosts,
      ].filter((host): host is string => Boolean(host)),
    ),
  ];
  const fallback = env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL;
  const protocol = (appURL ?? publicURL)?.protocol === HTTP_PROTOCOL ? 'http' : 'https';
  return { allowedHosts, fallback, protocol };
}

type GoogleEndpoints = Pick<GenericOAuthConfig, 'authorizationUrl' | 'tokenUrl' | 'userInfoUrl'>;

/**
 * The generic provider `google` at the given endpoints: PKCE, client secret posted. The account
 * is keyed by the OpenID `sub` (the broker's userinfo has no `id`), as before better-auth 1.7,
 * so linked Google accounts keep matching.
 */
function googleProvider(
  clientId: string,
  clientSecret: string,
  endpoints: GoogleEndpoints,
): GenericOAuthConfig {
  return {
    providerId: GOOGLE_PROVIDER_ID,
    clientId,
    clientSecret,
    ...endpoints,
    scopes: GOOGLE_SCOPES,
    pkce: true,
    authentication: 'post',
    accountSubject: ({ profile }) => profile.sub ?? '',
  };
}

/**
 * Serves Google sign-in at {@link GOOGLE_CALLBACK_PATH}: the provider's redirect URI uses that
 * path, and its callback is routed to better-auth's endpoint. Registered after `genericOAuth`,
 * whose init creates the provider.
 */
const googleCallbackPath: BetterAuthPlugin = {
  id: 'polsia-google-callback',
  init(ctx) {
    const google = ctx.socialProviders.find((provider) => provider.id === GOOGLE_PROVIDER_ID);
    if (google) {
      google.callbackPath = GOOGLE_CALLBACK_PATH;
    }
  },
  async onRequest(request) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith(GOOGLE_CALLBACK_PATH)) {
      return;
    }

    url.pathname = `${url.pathname.slice(0, -GOOGLE_CALLBACK_PATH.length)}${GOOGLE_CALLBACK_ENDPOINT}`;
    return { request: new Request(url, request) };
  },
};

/**
 * The owner's own Google OAuth client, set as app secrets (`NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`,
 * `GOOGLE_SIGNIN_CLIENT_SECRET`): Google directly, identity from the `id_token` its token
 * endpoint returns. `undefined` unless both are set.
 */
function ownGoogle(): GenericOAuthConfig | undefined {
  const clientId = env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
  const clientSecret = env.GOOGLE_SIGNIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return undefined;
  }

  return googleProvider(clientId, clientSecret, {
    authorizationUrl: GOOGLE_AUTHORIZATION_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    userInfoUrl: GOOGLE_USERINFO_URL,
  });
}

/**
 * Google sign-in as one generic provider `google`: the owner's own client when both
 * id and secret are set. None when the app configures `socialProviders.google`: the
 * generic provider would shadow it.
 */
function googleSignIn() {
  if (authConfig.socialProviders?.google) {
    return [];
  }

  const config = ownGoogle();
  if (!config) {
    return [];
  }

  return [genericOAuth({ config: [config] }), googleCallbackPath];
}

// Set by api/auth/[...all]/route.ts beside the partitioned cookies of a session
// opened inside the Polsia dashboard preview. Direct visits never send it.
const PREVIEW_MARKER_COOKIE = '__Host-polsia-preview';

/**
 * A preview session cookie is SameSite=None, so any page loaded under the dashboard
 * could send it. Strip the cookies of cross-origin requests that carry an Origin
 * (every write and CORS call; never a navigation, so the preview's own page loads
 * keep their session) when that session is present.
 */
const previewSessionCsrf: BetterAuthPlugin = {
  id: 'polsia-preview-csrf',
  hooks: {
    before: [
      {
        matcher: (ctx) => isCrossOriginPreviewRequest(ctx.headers),
        handler: createAuthMiddleware(async (ctx) => {
          // The app's hooks run before this one and may have read the session; later
          // hooks and the endpoint read these same headers.
          ctx.context.session = null;
          ctx.headers?.delete('cookie');
        }),
      },
    ],
  },
};

function isCrossOriginPreviewRequest(headers: Headers | undefined): boolean {
  const site = headers?.get('sec-fetch-site');
  return (
    (site === 'cross-site' || site === 'same-site') &&
    Boolean(headers?.get('origin')) &&
    (headers?.get('cookie') ?? '')
      .split(';')
      .some((cookie) => cookie.trim().startsWith(`${PREVIEW_MARKER_COOKIE}=`))
  );
}

/** The Google provider, empty unless enabled; also gates the multi-host base URL. */
const googlePlugins = googleSignIn();

function configuredAuthSecret(): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('Better Auth is not configured');
  }
  return secret;
}

function createAuth() {
  return betterAuth({
    ...authConfig,
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    secret: configuredAuthSecret(),
    baseURL: resolveBaseURL(),
    trustedOrigins,
    // Signup must open a session: paywalls and protected pages right after signup
    // depend on it. Gate sensitive actions on user.emailVerified instead.
    emailAndPassword: {
      ...authConfig.emailAndPassword,
      enabled: authConfig.emailAndPassword?.enabled ?? false,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      ...authConfig.emailVerification,
      sendVerificationEmail:
        authConfig.emailVerification?.sendVerificationEmail ??
        (async ({ user, url }) => {
          // Account creation does not depend on the email proxy. Skip the
          // message when that proxy is unset instead of failing the signup.
          if (!env.POLSIA_EMAIL_PROXY_URL) return;
          const href = url
            .replaceAll('&', '&amp;')
            .replaceAll('"', '&quot;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll("'", '&#39;');
          const result = await sendEmail({
            to: user.email,
            subject: 'Verify your email',
            html: `<p><a href="${href}">Verify your email</a></p>`,
            text: `Verify your email: ${url}`,
          });
          // The proxy can accept a suppressed recipient without sending mail.
          if (!result.id) throw new Error('Verification email could not be delivered');
        }),
    },
    // better-auth 1.7 answers every auth request with a 500 when the Prisma schema lacks a column
    // or table the config declares (an app's additionalFields or plugin), which 1.6 did not check.
    // Keep 1.6's behavior unless the app opts in with advanced.database.validateSchema.
    advanced: {
      ...authConfig.advanced,
      trustedProxyHeaders: true,
      database: {
        ...authConfig.advanced?.database,
        validateSchema: authConfig.advanced?.database?.validateSchema ?? false,
      },
    },
    // Better Auth's verification callback can write the pre-verification user to
    // its cookie cache. Always read authorization state from the session store.
    session: {
      ...authConfig.session,
      cookieCache: { ...authConfig.session?.cookieCache, enabled: false },
    },
    databaseHooks: {
      ...appHooks,
      session: {
        ...appHooks?.session,
        create: {
          ...appHooks?.session?.create,
          after: async (session, ctx) => {
            // A matching address is not proof of control. Promote only a mailbox
            // Better Auth has already marked verified.
            if (ownerEmail && session.userId) {
              await prisma.user.updateMany({
                where: { id: session.userId, email: ownerEmail, emailVerified: true },
                data: { role: 'admin' },
              });
            }
            await appHooks?.session?.create?.after?.(session, ctx);
          },
        },
      },
      user: {
        ...appHooks?.user,
        create: {
          ...appHooks?.user?.create,
          before: async (user, ctx) => {
            // Capture the SDK's identity before application hooks can mutate it.
            const originalEmail = user.email.toLowerCase();
            const originallyVerified = user.emailVerified === true;
            const r = await appHooks?.user?.create?.before?.(user, ctx);
            if (r === false) return false;
            const base = { ...user, ...(r && typeof r === 'object' && 'data' in r ? r.data : {}) };
            // Signup cannot claim a mailbox. Keep a provider's existing
            // verification only when this hook did not change the address.
            const emailVerified =
              originallyVerified &&
              base.emailVerified === true &&
              base.email.toLowerCase() === originalEmail;
            return {
              data: {
                ...base,
                emailVerified,
                // Unverified identities never receive an administrative role.
                ...(!emailVerified ? { role: 'user' } : {}),
              },
            };
          },
        },
        update: {
          ...appHooks?.user?.update,
          after: async (user, ctx) => {
            // Verification updates carry the full persisted user. Check the stored
            // identity again so a stale update cannot promote a changed address.
            if (ownerEmail && user.emailVerified && user.email.toLowerCase() === ownerEmail) {
              await prisma.user.updateMany({
                where: { id: user.id, email: user.email, emailVerified: true },
                data: { role: 'admin' },
              });
            }
            await appHooks?.user?.update?.after?.(user, ctx);
          },
        },
      },
    },
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
      previewSessionCsrf,
      ...googlePlugins,
      ...(authConfig.plugins ?? []),
    ],
  });
}

// Construct Better Auth on first use. The hosted build imports every route while
// BETTER_AUTH_SECRET is unset, and an eager constructor fails that import.
let cachedAuth: ReturnType<typeof createAuth> | undefined;

function getAuth() {
  cachedAuth ??= createAuth();
  return cachedAuth;
}

// better-auth calls `auth(request)` and also checks `"handler" in auth`.
// A get-only proxy hides both, so every signup request crashes before auth runs.
export const auth = new Proxy((() => {}) as unknown as ReturnType<typeof createAuth>, {
  apply(_target, _thisArg, args) {
    const instance = getAuth() as unknown as (...params: unknown[]) => unknown;
    return Reflect.apply(instance, getAuth(), args);
  },
  get(_target, property) {
    const instance = getAuth();
    const value = instance[property as keyof typeof instance];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in getAuth();
  },
});
