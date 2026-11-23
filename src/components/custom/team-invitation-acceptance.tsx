// @polsia:user-owned — accept a team invitation after the recipient signs in.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmailVerification } from '@/components/custom/email-verification';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import {
  type TeamInvitationAcceptResponse as AcceptedInvitation,
  TeamInvitationAcceptRequest,
  TeamInvitationAcceptResponse,
} from '@/lib/contracts/team-invitation';
import { teamInviteAuthHref } from '@/lib/team-invite-url';

function apiError(error: unknown): { code: string; message: string } {
  if (!(error instanceof Error))
    return { code: '', message: 'The invitation could not be accepted.' };
  const body = error.cause;
  if (typeof body !== 'object' || body === null) return { code: '', message: error.message };
  const details = body as { error?: unknown; message?: unknown };
  return {
    code: typeof details.error === 'string' ? details.error : '',
    message: typeof details.message === 'string' ? details.message : error.message,
  };
}

export function TeamInvitationAcceptance() {
  const { data, isPending: sessionPending } = useSession();
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function acceptInvitation() {
    setError('');
    setWorking(true);
    try {
      const request = TeamInvitationAcceptRequest.parse({ token });
      const result = await apiFetch('/api/team-invitations/accept', {
        method: 'POST',
        body: JSON.stringify(request),
        schema: TeamInvitationAcceptResponse,
      });
      setAccepted(result);
    } catch (acceptError) {
      const details = apiError(acceptError);
      setError(
        details.message ||
          'This invitation could not be accepted. Ask the owner to send a new one.',
      );
    } finally {
      setWorking(false);
    }
  }

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Invitation link is incomplete</AlertTitle>
        <AlertDescription>Ask the team owner to send you a new invitation email.</AlertDescription>
      </Alert>
    );
  }

  if (sessionPending) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Checking your sign-in…
      </p>
    );
  }

  if (accepted) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertTitle>You joined {accepted.teamName}</AlertTitle>
          <AlertDescription>
            {accepted.role === 'owner'
              ? 'You are the separate test owner of this workspace. This does not make your account an app admin or grant access to other teams.'
              : 'Your project-manager access is limited to this team. Owner and admin controls remain with the team owner.'}
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href={`/dashboard?teamId=${encodeURIComponent(accepted.teamId)}`}>
            Open team workspace
          </Link>
        </Button>
      </div>
    );
  }

  if (!data?.user) {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          Sign in or create an account with the email address that received this invitation. The
          link expires after 7 days.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button asChild>
            <Link href={teamInviteAuthHref('/signup', token)}>Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={teamInviteAuthHref('/login', token)}>Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!data.user.emailVerified) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertTitle>Verify this email to continue</AlertTitle>
          <AlertDescription>
            The invitation is tied to this address. Verify it before joining the team.
          </AlertDescription>
        </Alert>
        <EmailVerification
          email={data.user.email}
          callbackURL={`/team-invite?token=${encodeURIComponent(token)}`}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-muted-foreground">
        You’re signed in as <strong className="break-all text-foreground">{data.user.email}</strong>
        . {token ? 'Accepting grants only the role and team access named in this invitation.' : ''}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Invitation not accepted</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" onClick={() => void acceptInvitation()} disabled={working}>
        {working ? 'Accepting invitation…' : 'Accept invitation'}
      </Button>
    </div>
  );
}
