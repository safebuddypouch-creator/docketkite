// @polsia:user-owned
//
// POST /api/waitlist — plain REST route handler that writes a WaitlistEntry and
// then surfaces it in the founder's Polsia dashboard, so a signup is actually
// SEEN by someone — and can be answered.
// Lives under /api, which proxy.ts's matcher excludes (no CSP/nonce, not proxied).
//
// The POST is intentionally PUBLIC — anyone can join the waitlist.
// Do NOT add a public GET that lists signups here: the emails are PII. To let the
// founder VIEW signups, gate that view/route behind the auth module's role
// (install better-auth + use requireAdmin) — never list signups on a public route
// or page. (Only expose them publicly if the founder EXPLICITLY asks for one.)
//
// Requires the `email` module (@/lib/email/submissions + send + templates).

import 'server-only';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { companyNotificationInbox } from '@/lib/email/company-inbox';
import { deliverEmail } from '@/lib/email/deliver';
import { recordSubmission } from '@/lib/email/submissions';
import { notificationEmail } from '@/lib/email/templates';
import { env } from '@/lib/env';
import { clientIp, isRateLimited } from '@/lib/public-form-rate-limit';
import { sameOrigin } from '@/lib/same-origin';
import { waitlistSchema } from '@/lib/waitlist/schema';

export const dynamic = 'force-dynamic';

/** Per-IP cap before Postgres write / email / Polsia submission fan-out. */
const WAITLIST_MAX_PER_WINDOW = 5;
const WAITLIST_WINDOW_MS = 15 * 60 * 1000;
/** Shared cap so a rotated forwarding header cannot open a new bucket each time. */
const WAITLIST_GLOBAL_MAX = 30;
const WAITLIST_GLOBAL_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  if (
    isRateLimited(`waitlist:${clientIp(req)}`, WAITLIST_MAX_PER_WINDOW, WAITLIST_WINDOW_MS) ||
    isRateLimited('waitlist:global', WAITLIST_GLOBAL_MAX, WAITLIST_GLOBAL_WINDOW_MS)
  ) {
    return NextResponse.json(
      { errors: { email: 'Too many signups from this network. Please try again later.' } },
      { status: 429 },
    );
  }

  const body = await req.json();
  const result = waitlistSchema.safeParse({ email: body.email });
  if (!result.success) {
    const message = result.error.flatten().fieldErrors.email?.[0];
    return NextResponse.json({ errors: { email: message } }, { status: 400 });
  }

  let saved: { id: string };
  try {
    saved = await prisma.waitlistEntry.create({ data: { email: result.data.email } });
  } catch (err: unknown) {
    const isUniqueViolation = err instanceof Error && err.message.includes('Unique constraint');
    if (isUniqueViolation) {
      // Already on the list — a duplicate is not a new signup, so don't notify.
      return NextResponse.json(
        { errors: { email: "You're already on the waitlist." } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { errors: { email: 'Something went wrong. Please try again.' } },
      { status: 500 },
    );
  }

  await notifyCompany(result.data.email, saved.id);

  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * Surface the signup to the founder. The row above is already committed and is
 * the source of truth, so this whole function is best-effort by design: a
 * rate-limited or failing call must never turn a captured signup into an error
 * for the visitor.
 *
 * Two paths, in order:
 *
 *  1. `recordSubmission` — the good one. Records the signup in the Polsia
 *     dashboard as a message FROM the person who signed up, so it lands in the
 *     dashboard's waitlist view and the founder can REPLY to them.
 *  2. The email fallback, used only when step 1 recorded nothing (`recorded:
 *     false` = company not ramped, or a deployment older than the endpoint) or
 *     threw. Mails the company's own inbox (`{slug}@polsia.app`). The founder
 *     still hears about the signup, but cannot reply from the dashboard.
 *
 * Never a made-up brand address (`hello@brand.com`) or a placeholder — both go
 * nowhere.
 *
 * Either way this tells the COMPANY. It is not a welcome email to the person who
 * signed up; add that separately if the brief asks for one.
 */
async function notifyCompany(email: string, submissionId: string) {
  try {
    const { recorded } = await recordSubmission({
      source: 'waitlist',
      email,
      // The row id — dedupes a retried submission on the platform side.
      idempotencyKey: submissionId,
    });
    if (recorded) return;
  } catch {
    // Anomaly (validation, cap, transport). Fall through to the email fallback
    // rather than lose the notification.
  }

  // Absent when the company has no inbox address yet — nothing to fall back to.
  const to = companyNotificationInbox(env.POLSIA_COMPANY_EMAIL);
  if (!to) return;

  try {
    await deliverEmail({
      to,
      ...notificationEmail({
        subject: 'New waitlist signup',
        title: 'New waitlist signup',
        lines: [email],
      }),
    });
  } catch {
    // Deliberately swallowed — see the best-effort note above.
  }
}
