// Stripe webhook. Signature verification is the authentication for this route.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  constructStripeEvent,
  StripeBillingConfigurationError,
  StripeWebhookSignatureError,
} from '@/lib/stripe-billing/client';
import { handleStripeEvent } from '@/lib/stripe-billing/webhook-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  const payload = await request.text();
  try {
    const event = constructStripeEvent(payload, signature);
    await handleStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof StripeBillingConfigurationError) {
      return NextResponse.json(
        { error: 'payments_not_configured', message: 'Payments are not configured.' },
        { status: 503 },
      );
    }
    if (error instanceof StripeWebhookSignatureError) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
    // Static message only: never log the payload, signature, or secret.
    // biome-ignore lint/suspicious/noConsole: webhook failures must be visible without dumping the event
    console.error('[stripe] webhook handler failed');
    return NextResponse.json({ error: 'webhook_failed' }, { status: 500 });
  }
}
