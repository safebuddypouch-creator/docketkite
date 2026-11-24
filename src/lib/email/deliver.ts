// @polsia:user-owned — Resend delivery for product mail (no Polsia email proxy).
import 'server-only';
import { env } from '@/lib/env';

const FROM = 'DocketKite <noreply@docketkitepermits.com>';

export class EmailDeliveryNotConfiguredError extends Error {
  constructor() {
    super('Email delivery is not configured');
    this.name = 'EmailDeliveryNotConfiguredError';
  }
}

export class EmailDeliveryFailedError extends Error {
  constructor(message = 'Email could not be delivered') {
    super(message);
    this.name = 'EmailDeliveryFailedError';
  }
}

export type DeliverEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Sends product email through Resend using the verified DocketKite domain.
 * Prefer this over the framework Polsia email proxy for all user-owned routes.
 */
export async function deliverEmail(input: DeliverEmailInput): Promise<{ id: string }> {
  if (!env.RESEND_API_KEY) throw new EmailDeliveryNotConfiguredError();

  const text =
    input.text ??
    input.html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new EmailDeliveryFailedError(
      body?.message?.trim() || 'Email could not be delivered',
    );
  }
  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new EmailDeliveryFailedError();
  return { id: json.id };
}
