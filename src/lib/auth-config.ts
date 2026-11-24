// @polsia:user-owned — configure better-auth here (spread into betterAuth() by @/lib/auth).
// Add emailAndPassword options, plugins, session, socialProviders, databaseHooks, etc.
// Framework owns db/secret/baseURL/admin(), verified-owner bootstrap, and disables
// session cookie caching so verification/role changes appear on the next session read.
// Verification delivery through the email module and sendOnSignUp are provided
// by auth.ts. Override emailVerification here only for intentional customization.
// The supplied profile and admin screens expose a resend button. Email/password
// owners receive admin access only after following their verification link.
// A verified social-provider email can also bootstrap the owner.
//
// Welcome email / signup side-effect (runs alongside the owner-admin grant — install `email`):
//   import { sendEmail } from '@/lib/email/send';
//   databaseHooks: { user: { create: { after: async (user) => {
//     await sendEmail({ to: user.email, subject: 'Welcome', html: '<p>Welcome!</p>' }).catch(() => {});
//   } } } },
// Add a plugin: `plugins: [organization()]` (admin() is added for you).
//
// Per-user fields (a `username`, profile, prefs): don't add a column to `User` (auth.prisma
// is locked) or use `user.additionalFields` (needs that locked column). Make a user-owned
// `prisma/schema/profile.prisma` (model UserProfile { userId String @unique /* fields */ },
// scalar userId) and create the row at signup:
//   import { prisma } from '@/lib/db';
//   databaseHooks: { user: { create: { after: async (user) => {
//     await prisma.userProfile.create({ data: { userId: user.id } }).catch(() => {});
//   } } } },

import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { deliverEmail } from '@/lib/email/deliver';

const PUBLISHED_ORIGIN = 'https://docketkite.apps.grok.bot';
const PUBLISHED_HOST = /(?:^|\.)apps\.grok\.bot$|(?:^|\.)(?:staging\.)?polsia\.(?:app|io)$/;

function verificationHref(url: string): string {
  return url
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function publishedOrigin(request?: Request): string {
  const origin = request?.headers.get('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol === 'https:' && PUBLISHED_HOST.test(url.hostname)) return url.origin;
    } catch {
      // Keep the known live origin.
    }
  }
  const forwarded = request?.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedHost = forwarded?.split(':')[0];
  if (forwardedHost && PUBLISHED_HOST.test(forwardedHost)) return `https://${forwardedHost}`;
  return PUBLISHED_ORIGIN;
}

/** Auth builds the link from the local fallback when the public URL is unset. */
function publicVerificationUrl(url: string, request?: Request): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!isLoopback(parsed.hostname)) return url;

  const target = new URL(publishedOrigin(request));
  parsed.protocol = target.protocol;
  parsed.hostname = target.hostname;
  parsed.port = target.port;
  const callback = parsed.searchParams.get('callbackURL');
  if (callback) {
    try {
      const callbackUrl = new URL(callback);
      if (isLoopback(callbackUrl.hostname)) {
        callbackUrl.protocol = target.protocol;
        callbackUrl.hostname = target.hostname;
        callbackUrl.port = target.port;
        parsed.searchParams.set('callbackURL', callbackUrl.toString());
      }
    } catch {
      // A relative callback stays on the rewritten host.
    }
  }
  return parsed.toString();
}

export const authConfig: BetterAuthOptions = {
  emailAndPassword: {
    enabled: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }, request) => {
      const link = publicVerificationUrl(url, request);
      const href = verificationHref(link);
      const html = `<p><a href="${href}">Verify your email</a></p>`;
      const text = `Verify your email: ${link}`;
      try {
        const result = await deliverEmail({
          to: user.email,
          subject: 'Verify your email',
          html,
          text,
        });
        if (!result.id) {
          throw APIError.from('FORBIDDEN', {
            message: 'Verification email could not be delivered. Try again in a moment.',
            code: 'VERIFICATION_EMAIL_NOT_DELIVERED',
          });
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Verification email could not be delivered. Try again in a moment.';
        throw APIError.from('FORBIDDEN', {
          message,
          code: 'VERIFICATION_EMAIL_NOT_DELIVERED',
        });
      }
    },
  },
};
