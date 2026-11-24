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
import { sendEmail } from '@/lib/email/send';
import { env } from '@/lib/env';

function verificationHref(url: string): string {
  return url
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

export const authConfig: BetterAuthOptions = {
  emailAndPassword: {
    enabled: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const href = verificationHref(url);
      const html = `<p><a href="${href}">Verify your email</a></p>`;
      const text = `Verify your email: ${url}`;
      if (env.RESEND_API_KEY) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: 'DocketKite <noreply@docketkitepermits.com>',
            to: [user.email],
            subject: 'Verify your email',
            html,
            text,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          const message = body?.message?.trim();
          throw APIError.from('FORBIDDEN', {
            message: message || 'Verification email could not be delivered. Try again in a moment.',
            code: 'VERIFICATION_EMAIL_NOT_DELIVERED',
          });
        }
        const json = (await response.json()) as { id?: string };
        if (!json.id) {
          throw APIError.from('FORBIDDEN', {
            message: 'Verification email could not be delivered. Try again in a moment.',
            code: 'VERIFICATION_EMAIL_NOT_DELIVERED',
          });
        }
        return;
      }
      // This host does not inject an email service. Fail the resend request
      // instead of telling the person to check an inbox that will stay empty.
      if (!env.POLSIA_EMAIL_PROXY_URL) {
        throw new Error('Email delivery is not configured');
      }
      const result = await sendEmail({
        to: user.email,
        subject: 'Verify your email',
        html,
        text,
      });
      if (!result.id) throw new Error('Verification email could not be delivered');
    },
  },
};
