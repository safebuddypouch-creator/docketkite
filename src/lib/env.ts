// @polsia:shared — edit only through declared slots. Code installed by polsia/template-next@0.3.0.
//
// Typed env via @t3-oss/env-nextjs.
//
// Modules contribute env vars via their manifest `contributions` block.
// The installer regenerates this file's slots between the markers below.
// Hand-editing outside those slots is rejected by the ownership validator.
//
// The `no-secrets-in-client-bundle` validator scans the build output and rejects
// the install if any non-NEXT_PUBLIC_ env name appears in client chunks.

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // D24: Prisma is the framework-native DB client. DATABASE_URL is
    // injected by Polsia at deploy time (D23). The actual Postgres is
    // provisioned by a separate Polsia service; this module ships the
    // client only.
    DATABASE_URL: z.string().url(),
    // @polsia:slot env_vars_server start
    // Modules append additional server-side env vars here at install time.
    // @polsia:contrib email start
    // Optional so the public homepage can render before Polsia email is configured.
    POLSIA_EMAIL_PROXY_URL: z.string().url().optional(),
    POLSIA_COMPANY_EMAIL: z.string().optional(),
    // @polsia:contrib email end
    // @polsia:contrib better-auth start
    // Optional so the public homepage can render before Better Auth is configured.
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    // Optional. The site owner address. It does not grant access by itself.
    POLSIA_OWNER_EMAIL: z.string().email().optional(),
    // Optional. The owner types this once after sign-in. At least 12 characters.
    POLSIA_OWNER_ACCESS_CODE: z.string().min(1).optional(),
    POLSIA_GOOGLE_SIGNIN_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_SIGNIN_CLIENT_SECRET: z.string().min(1).optional(),
    // @polsia:contrib better-auth end
    // @polsia:contrib stripe-billing start
    POLSIA_API_BASE_URL: z.string().url().default('https://polsia.com'),
    POLSIA_API_KEY: z.string().min(1).optional(),
    POLSIA_API_TOKEN: z.string().min(1).optional(),
    // The account's own Stripe secret and webhook signing secret. Never a publishable key.
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    // @polsia:contrib stripe-billing end
    // @polsia:contrib file-upload start
    POLSIA_R2_BASE_URL: z.string().url().optional(),
    // @polsia:contrib file-upload end
    // @polsia:contrib doc-parse start
    // @polsia:contrib doc-parse end
    // @polsia:contrib web-search start
    // @polsia:contrib web-search end
    // @polsia:slot env_vars_server end
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    // Base for @/lib/api-client + proxy.ts connect-src. Default-empty
    // (unset) means same-origin `/api`; set only for an external API origin.
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    // @polsia:slot env_vars_client start
    // Modules append NEXT_PUBLIC_* env vars here at install time.
    // @polsia:contrib better-auth start
    NEXT_PUBLIC_POLSIA_GOOGLE_SIGNIN: z.string().optional(),
    NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID: z.string().min(1).optional(),
    // @polsia:contrib better-auth end
    // @polsia:slot env_vars_client end
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    // @polsia:slot env_runtime start
    // Modules append runtime-env entries here at install time.
    // @polsia:contrib email start
    POLSIA_EMAIL_PROXY_URL: process.env.POLSIA_EMAIL_PROXY_URL,
    POLSIA_COMPANY_EMAIL: process.env.POLSIA_COMPANY_EMAIL,
    // @polsia:contrib email end
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    POLSIA_OWNER_EMAIL: process.env.POLSIA_OWNER_EMAIL,
    POLSIA_OWNER_ACCESS_CODE: process.env.POLSIA_OWNER_ACCESS_CODE,
    POLSIA_GOOGLE_SIGNIN_CLIENT_ID: process.env.POLSIA_GOOGLE_SIGNIN_CLIENT_ID,
    GOOGLE_SIGNIN_CLIENT_SECRET: process.env.GOOGLE_SIGNIN_CLIENT_SECRET,
    // @polsia:contrib better-auth start
    NEXT_PUBLIC_POLSIA_GOOGLE_SIGNIN: process.env.NEXT_PUBLIC_POLSIA_GOOGLE_SIGNIN,
    NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID,
    // @polsia:contrib better-auth end
    // @polsia:contrib stripe-billing start
    POLSIA_API_BASE_URL: process.env.POLSIA_API_BASE_URL,
    POLSIA_API_KEY: process.env.POLSIA_API_KEY,
    POLSIA_API_TOKEN: process.env.POLSIA_API_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    // @polsia:contrib stripe-billing end
    // @polsia:contrib file-upload start
    POLSIA_R2_BASE_URL: process.env.POLSIA_R2_BASE_URL,
    // @polsia:contrib file-upload end
    // @polsia:contrib doc-parse start
    // @polsia:contrib doc-parse end
    // @polsia:contrib web-search start
    // @polsia:contrib web-search end
    // @polsia:slot env_runtime end
  },
  emptyStringAsUndefined: true,
  // SKIP_ENV_VALIDATION=1 bypasses validation for envless builds (lint/CI/local).
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
