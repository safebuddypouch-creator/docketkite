// @polsia:user-owned
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

function verificationFailure(message: string | undefined): string {
  if (/only send testing emails/i.test(message ?? '') || /verify a domain/i.test(message ?? '')) {
    return 'Resend can only deliver a test message to the email that owns the Resend account. This address will not get a link until a domain you control is verified. Use the owner access code on this page for admin and paid access.';
  }
  if (/not configured/i.test(message ?? '')) {
    return 'No verification email was sent. This site is not connected to an email service, so there is nothing to click in your inbox. Use the owner access code on this page instead.';
  }
  return (
    message?.trim() ||
    'No verification email was sent. Try again in a moment, or use the owner access code on this page.'
  );
}

export function EmailVerification({
  email,
  callbackURL = '/profile',
}: {
  email: string;
  callbackURL?: string;
}) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState('');

  async function resend() {
    setPending(true);
    setSent(false);
    setFailure('');
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL });
      if (result.error) setFailure(verificationFailure(result.error.message));
      else setSent(true);
    } catch {
      setFailure(verificationFailure(''));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Verify your email</h2>
      <p className="text-sm text-muted-foreground">
        Confirm {email} using a verification link. If you haven’t received an email, request one
        below.
      </p>
      {sent ? <output>Check your inbox for your verification link.</output> : null}
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      <Button type="button" onClick={resend} disabled={pending}>
        {pending ? 'Sending…' : 'Resend verification email'}
      </Button>
    </div>
  );
}
