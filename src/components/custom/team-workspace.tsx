// @polsia:user-owned — team setup, access state, and permit workspace.
'use client';

import { Check, Copy, CreditCard, LockKeyhole, MailPlus, Plus, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { OwnerAccessCode } from '@/components/custom/owner-access-code';
import { PermitWorkspace } from '@/components/custom/permit-workspace';
import { TeamStatusAlertRecipientSettings } from '@/components/custom/team-status-alert-recipient-settings';
import { TeamTrialBanner } from '@/components/custom/team-trial-banner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { useIsAdmin } from '@/lib/auth-client';
import type { PermitStatus as SavedPermitStatus } from '@/lib/contracts/permit';
import {
  OWNER_TESTING_TEAM_ID,
  TeamCheckoutResponse,
  TeamCheckoutVerification,
  TeamCheckoutVerificationRequest,
  TeamCreateOrJoin,
  TeamList,
  type TeamListItem,
  TeamListItem as TeamListItemSchema,
} from '@/lib/contracts/team';
import {
  TeamInvitationCreateRequest,
  TeamInvitationCreateResponse,
} from '@/lib/contracts/team-invitation';

function apiError(error: unknown): { code: string; message: string } {
  if (!(error instanceof Error)) return { code: '', message: '' };
  const body = error.cause;
  if (typeof body !== 'object' || body === null) return { code: '', message: error.message };
  const details = body as { error?: unknown; message?: unknown };
  return {
    code: typeof details.error === 'string' ? details.error : '',
    message: typeof details.message === 'string' ? details.message : error.message,
  };
}

function checkoutError(error: unknown): string {
  const details = apiError(error);
  if (
    details.code === 'payments_not_enabled' ||
    details.code === 'stripe_not_configured' ||
    details.code === 'stripe_not_onboarded' ||
    details.code === 'stripe_billing_not_configured'
  ) {
    return details.message || 'Stripe checkout is unavailable until payment setup is complete.';
  }
  return details.message || 'Stripe checkout could not be started. No payment was confirmed.';
}

function utcTimestamp(value: string | null): string {
  return value
    ? `${new Date(value).toISOString().replace('T', ' ').replace('Z', '')} UTC`
    : 'not available';
}

export function TeamWorkspace({
  initialTeamId,
  initialPermitStatus,
}: {
  initialTeamId: string;
  initialPermitStatus: SavedPermitStatus | null;
}) {
  const isAdmin = useIsAdmin();
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeamId, setActiveTeamId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [verificationSessionId, setVerificationSessionId] = useState('');

  const activeTeam = useMemo(
    () => teams.find((team) => team.id === activeTeamId) ?? null,
    [activeTeamId, teams],
  );
  const hasTrialStatus = Boolean(
    activeTeam?.trialStartedAt &&
      activeTeam.trialEndsAt &&
      activeTeam.trialStatus !== 'not_started' &&
      activeTeam.paymentStatus !== 'active',
  );

  const refreshTeams = useCallback(async () => {
    const result = await apiFetch('/api/teams', { schema: TeamList });
    setTeams(result.items);
    setActiveTeamId((current) =>
      result.items.some((team) => team.id === current)
        ? current
        : (result.items.find((team) => team.id === initialTeamId)?.id ?? result.items[0]?.id ?? ''),
    );
  }, [initialTeamId]);

  async function configureOwnerTestingWorkspace() {
    setError('');
    setNotice('');
    setWorking(true);
    try {
      await apiFetch('/api/owner-testing-workspace', {
        method: 'POST',
        body: JSON.stringify({}),
        schema: TeamListItemSchema,
      });
      await refreshTeams();
      setActiveTeamId(OWNER_TESTING_TEAM_ID);
      setNotice(
        'The dedicated owner testing workspace is enabled. Invite the separate test account by its verified email; other teams still use paid access.',
      );
    } catch (setupError) {
      const details = apiError(setupError);
      setError(details.message || 'Could not configure the owner testing workspace.');
    } finally {
      setWorking(false);
    }
  }

  const verifyPayment = useCallback(async (request: { session_id?: string; teamId?: string }) => {
    setError('');
    setNotice('');
    try {
      const result = await apiFetch('/api/team-checkout/verify', {
        method: 'POST',
        body: JSON.stringify(TeamCheckoutVerificationRequest.parse(request)),
        schema: TeamCheckoutVerification,
      });
      if (!result.verified) {
        setError(
          result.reason === 'subscription_link_pending'
            ? 'Stripe verified the payment and is still linking the subscription. Retry verification; permit data stays locked until the active subscription is confirmed.'
            : result.reason === 'subscription_inactive'
              ? `The payment is verified, but the linked subscription is ${result.subscriptionStatus ?? 'not active'}. No paid access was granted; retry verification after the subscription becomes active.`
              : 'Payment could not be verified. Team monitoring remains locked.',
        );
        return;
      }

      setNotice('Stripe verified the $299 monthly payment. Team access is being refreshed.');
      setVerificationSessionId('');
      const params = new URLSearchParams(window.location.search);
      params.delete('session_id');
      const search = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
      );
    } catch (verificationError) {
      const details = apiError(verificationError);
      const messages: Record<string, string> = {
        stripe_billing_not_configured: 'Payments are not configured. No paid access was granted.',
        payments_not_enabled:
          'Stripe payments are not enabled for this app. No paid access was granted; retry after payments are enabled.',
        stripe_not_configured:
          'Stripe is not set up for this business. The owner must connect Stripe before payment can be verified.',
        stripe_not_onboarded:
          'Stripe onboarding is incomplete for this business. The owner must finish setup before payment can be verified.',
        stripe_product_identity_unavailable:
          'The billing service could not confirm the customer and product identity for this checkout. No paid access was granted; retry when identity verification is available.',
        billing_authorization_unavailable:
          details.message ||
          'Billing authorization was rejected. No paid access was granted; retry after the billing connection is restored.',
        payment_verification_unavailable:
          details.message ||
          'Stripe could not confirm the active subscription. No paid access was granted; retry verification shortly.',
        payment_not_verified:
          'Stripe has not verified this checkout payment. No paid access was granted; retry verification after checkout completes.',
        checkout_identity_unverified:
          details.message ||
          'Stripe could not match this checkout to the selected team and purchaser. No paid access was granted.',
        payment_amount_unverified:
          'The checkout total did not match the $299 USD monthly team plan. No paid access was granted.',
        purchaser_email_mismatch:
          'The checkout email did not match the signed-in purchaser. No paid access was granted; sign in with the purchasing account to retry.',
      };
      setError(
        messages[details.code] ??
          details.message ??
          'Payment could not be verified. No paid access was granted. Retry verification shortly.',
      );
    }
  }, []);

  async function retryPaymentVerification() {
    if (!activeTeam) return;
    setWorking(true);
    try {
      await verifyPayment(
        verificationSessionId ? { session_id: verificationSessionId } : { teamId: activeTeam.id },
      );
      await refreshTeams();
    } catch {
      setError('Your team status could not be refreshed. Try again in a moment.');
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session_id');
      if (sessionId) {
        setVerificationSessionId(sessionId);
        await verifyPayment({ session_id: sessionId });
      } else if (params.get('checkout') === 'cancelled' && mounted) {
        setNotice(
          'Checkout was canceled. Team monitoring is still locked until payment is verified.',
        );
        params.delete('checkout');
        const search = params.toString();
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
        );
      }

      try {
        await refreshTeams();
      } catch {
        if (mounted) setError('Your teams could not be loaded. Try refreshing the page.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [refreshTeams, verifyPayment]);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const request = TeamCreateOrJoin.parse({ action: 'create', name: teamName });
      const created = await apiFetch('/api/teams', {
        method: 'POST',
        body: JSON.stringify(request),
        schema: TeamListItemSchema,
      });
      setTeamName('');
      await refreshTeams();
      setActiveTeamId(created.id);
      setNotice(
        created.accessMode === 'owner_testing'
          ? 'Owner test workspace created without checkout. Permit data and PDF downloads still require verified paid access.'
          : '',
      );
    } catch (createError) {
      const details = apiError(createError);
      setError(details.message || 'Could not create the team. Check the name and try again.');
    } finally {
      setWorking(false);
    }
  }

  async function joinTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const request = TeamCreateOrJoin.parse({ action: 'join', joinCode });
      const joined = await apiFetch('/api/teams', {
        method: 'POST',
        body: JSON.stringify(request),
        schema: TeamListItemSchema,
      });
      setJoinCode('');
      await refreshTeams();
      setActiveTeamId(joined.id);
      setNotice(
        joined.trialEndsAt
          ? ''
          : 'You joined the existing team. This team has no stored trial window; its current billing state is unchanged.',
      );
    } catch (joinError) {
      const details = apiError(joinError);
      setError(
        details.code === 'team_invite_not_found'
          ? 'That team code was not found. Check the code and try again.'
          : details.message || 'Could not join this team. Check the code and try again.',
      );
    } finally {
      setWorking(false);
    }
  }

  async function inviteProjectManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTeam || activeTeam.role !== 'owner') return;
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const request = TeamInvitationCreateRequest.parse({
        teamId: activeTeam.id,
        email: inviteEmail,
      });
      const result = await apiFetch('/api/team-invitations', {
        method: 'POST',
        body: JSON.stringify(request),
        schema: TeamInvitationCreateResponse,
      });
      setInviteEmail('');
      setNotice(`Invitation email sent to ${result.email}. The link expires in 7 days.`);
    } catch (inviteError) {
      const details = apiError(inviteError);
      setError(details.message || 'The team invitation could not be sent.');
    } finally {
      setWorking(false);
    }
  }

  async function startCheckout() {
    if (!activeTeam) return;
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const result = await apiFetch('/api/stripe-billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ teamId: activeTeam.id }),
        schema: TeamCheckoutResponse,
      });
      window.location.assign(result.url);
    } catch (checkoutFailure) {
      setError(checkoutError(checkoutFailure));
    } finally {
      setWorking(false);
    }
  }

  async function refreshBillingState() {
    setError('');
    setNotice('');
    setWorking(true);
    try {
      await refreshTeams();
      setNotice(
        'Billing status refreshed. Permit access remains locked unless the $299 monthly subscription is verified as active.',
      );
    } catch {
      setError('Billing status could not be refreshed. Try again in a moment.');
    } finally {
      setWorking(false);
    }
  }

  async function copyInviteCode() {
    if (!activeTeam?.joinCode) return;
    try {
      await navigator.clipboard.writeText(activeTeam.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the invite code. Select and copy it manually.');
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            DocketKite · Team permit desk
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Team workspace
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            New customer teams get a shared 30-day setup window. It does not unlock permit records
            or PDF downloads, and it never charges or converts automatically. Permit access starts
            only after the $299/month team subscription is verified as active. Team selection and
            billing controls stay available throughout.
          </p>
        </div>
        {activeTeam ? (
          <Badge variant={activeTeam.accessActive ? 'default' : 'secondary'}>
            {activeTeam.accessMode === 'owner_testing'
              ? 'Owner testing · permits locked'
              : activeTeam.accessMode === 'free_trial'
                ? 'Setup window · permits locked'
                : activeTeam.accessMode === 'paid_subscription'
                  ? 'Paid access active'
                  : activeTeam.trialStatus === 'expired'
                    ? 'Trial ended'
                    : 'Payment required'}
          </Badge>
        ) : null}
      </header>

      <OwnerAccessCode />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {verificationSessionId ||
      ((activeTeam?.paymentStatus === 'pending' || activeTeam?.paymentStatus === 'unavailable') &&
        (activeTeam.role === 'owner' || activeTeam.role === 'purchaser')) ? (
        <Button
          type="button"
          variant="outline"
          disabled={working}
          onClick={() => void retryPaymentVerification()}
        >
          {working ? 'Checking payment…' : 'Retry payment verification'}
        </Button>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Team status</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {!loading && activeTeam ? (
        <TeamTrialBanner
          key={activeTeam.id}
          team={activeTeam}
          working={working}
          onUpgrade={() => void startCheckout()}
        />
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0">
          {loading ? (
            <div
              className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground"
              aria-live="polite"
            >
              Loading team access…
            </div>
          ) : activeTeam?.paymentStatus === 'active' && activeTeam.accessActive ? (
            <div className="grid gap-4">
              <Card>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Selected team
                    </p>
                    <h2 className="mt-1 break-words text-xl font-semibold tracking-tight">
                      {activeTeam.name}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {activeTeam.role === 'owner'
                        ? 'You are the owner of this workspace.'
                        : activeTeam.role === 'project_manager'
                          ? 'You have project-manager access to this team only.'
                          : 'Your role includes purchaser permissions.'}
                    </p>
                  </div>
                  {activeTeam.joinCode ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        Invite code
                      </span>
                      <code className="font-semibold tracking-[0.12em]">{activeTeam.joinCode}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Copy team invite code"
                        onClick={() => void copyInviteCode()}
                      >
                        {copied ? (
                          <Check aria-hidden="true" className="size-4" />
                        ) : (
                          <Copy aria-hidden="true" className="size-4" />
                        )}
                      </Button>
                    </div>
                  ) : null}
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link
                      href={`/dashboard/monitoring?teamId=${encodeURIComponent(activeTeam.id)}`}
                    >
                      View status changes
                    </Link>
                  </Button>
                </CardContent>
              </Card>
              {activeTeam.accessMode === 'owner_testing' ? (
                <Alert>
                  <AlertTitle>Owner testing workspace</AlertTitle>
                  <AlertDescription>
                    The verified app owner and the separately invited test account can use this
                    workspace without checkout. This does not make the test account an app admin or
                    grant it access to other teams; other members remain behind the paid Team Access
                    gate.
                  </AlertDescription>
                </Alert>
              ) : null}
              {activeTeam.role === 'owner' ? (
                <TeamStatusAlertRecipientSettings
                  key={`recipients:${activeTeam.id}`}
                  teamId={activeTeam.id}
                />
              ) : null}
              <PermitWorkspace
                key={`permits:${activeTeam.id}`}
                teamId={activeTeam.id}
                role={activeTeam.role}
                initialStatus={initialPermitStatus}
              />
            </div>
          ) : activeTeam ? (
            <Card className="overflow-hidden border-primary/20">
              <CardHeader className="bg-muted/50">
                <span className="mb-2 grid size-10 place-items-center rounded-full bg-secondary text-primary">
                  <LockKeyhole aria-hidden="true" className="size-5" />
                </span>
                <CardTitle className="text-xl">
                  {activeTeam.trialStatus === 'active'
                    ? `Setup window active for ${activeTeam.name}`
                    : activeTeam.trialStatus === 'expired'
                      ? `Trial ended for ${activeTeam.name}`
                      : activeTeam.role === 'project_manager'
                        ? `${activeTeam.name} is waiting for owner billing`
                        : `${activeTeam.name} is ready for checkout`}
                </CardTitle>
                <CardDescription>
                  {activeTeam.trialStatus === 'active'
                    ? 'Permit records and paid workspace tools stay locked during the setup window. The upgrade control above opens checkout for owners and purchasers.'
                    : activeTeam.trialStatus === 'expired'
                      ? 'Paid access stays locked until an owner or purchaser starts the hosted checkout and the matching $299/month subscription is verified active.'
                      : activeTeam.role === 'owner'
                        ? 'Permit records and PDF downloads stay locked until the $299 payment and active subscription are verified.'
                        : activeTeam.role === 'project_manager'
                          ? 'Your project-manager membership is set. The team owner controls billing; permit lists open when the team subscription is active.'
                          : 'This existing team has no active trial. Permit lists and paid permit actions stay locked until the $299 payment and active subscription are verified.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-6">
                {activeTeam.joinCode ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Team invite code</p>
                      <code className="font-semibold tracking-[0.12em]">{activeTeam.joinCode}</code>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label="Copy team invite code"
                      onClick={() => void copyInviteCode()}
                    >
                      {copied ? (
                        <Check aria-hidden="true" className="size-4" />
                      ) : (
                        <Copy aria-hidden="true" className="size-4" />
                      )}
                      <span className="ml-2">{copied ? 'Copied' : 'Copy code'}</span>
                    </Button>
                  </div>
                ) : null}
                {activeTeam.role === 'project_manager' ? (
                  <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                    The team owner manages billing and invitations. You can access team permits when
                    the subscription is active.
                  </p>
                ) : (
                  <>
                    {activeTeam.paymentStatus === 'pending' ? (
                      <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                        Checkout or subscription verification is still pending. Permit access stays
                        locked until the matching payment and active team subscription are
                        confirmed.
                      </p>
                    ) : null}
                    {activeTeam.paymentStatus === 'inactive' ? (
                      <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                        The team subscription is not active. Permit access remains locked until an
                        active subscription is verified.
                      </p>
                    ) : null}
                    {activeTeam.paymentStatus === 'unavailable' ? (
                      <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                        Stripe could not confirm the team subscription status. Permit access remains
                        locked.
                      </p>
                    ) : null}
                    {activeTeam.paymentStatus === 'pending' ||
                    activeTeam.paymentStatus === 'inactive' ||
                    activeTeam.paymentStatus === 'unavailable' ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-fit"
                        disabled={working}
                        onClick={() => void refreshBillingState()}
                      >
                        {working
                          ? 'Checking billing…'
                          : activeTeam.paymentStatus === 'pending'
                            ? 'Refresh payment status'
                            : activeTeam.paymentStatus === 'inactive'
                              ? 'Refresh subscription status'
                              : 'Retry billing status'}
                      </Button>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Team subscription
                        </p>
                        <p className="text-2xl font-semibold">
                          $299{' '}
                          <span className="text-sm font-medium text-muted-foreground">/ month</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Stripe hosted subscription checkout
                        </p>
                        <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
                          The $149 second-month offer for Days 11–30 is manual; this hosted checkout
                          is the current $299/month subscription rate.
                        </p>
                      </div>
                      {!hasTrialStatus ? (
                        <Button
                          type="button"
                          onClick={() => void startCheckout()}
                          disabled={working || activeTeam.paymentStatus === 'unavailable'}
                        >
                          <CreditCard aria-hidden="true" className="mr-2 size-4" />
                          {working ? 'Starting checkout…' : 'Choose $299/month plan'}
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <span className="mb-2 grid size-10 place-items-center rounded-full bg-secondary text-primary">
                  <UsersRound aria-hidden="true" className="size-5" />
                </span>
                <CardTitle className="text-xl">Set up team access first</CardTitle>
                <CardDescription>
                  Create a private team workspace or join an existing one. Your membership is set
                  before payment, without needing an invitation to create your first team. A new
                  customer team starts a 30-day setup window at creation; an invite uses the
                  existing team's dates and never restarts them. The window does not unlock permit
                  data. Nothing automatically charges or converts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-semibold">Team subscription · $299 / month</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Stripe checkout becomes available after you select a team.
                </p>
              </CardContent>
            </Card>
          )}
        </section>

        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {isAdmin ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Owner testing</CardTitle>
                <CardDescription>
                  Configure the single no-cost test workspace. Invite a separate account after it
                  has registered and verified its email.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={working}
                  onClick={() => void configureOwnerTestingWorkspace()}
                >
                  {working
                    ? 'Configuring…'
                    : teams.some((team) => team.id === OWNER_TESTING_TEAM_ID)
                      ? 'Confirm owner testing setting'
                      : 'Set up owner testing workspace'}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your teams</CardTitle>
              <CardDescription>Select a team to view its access state.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {teams.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  No team spaces yet.
                </p>
              ) : (
                teams.map((team) => (
                  <Button
                    key={team.id}
                    type="button"
                    variant={team.id === activeTeamId ? 'secondary' : 'outline'}
                    className="h-auto w-full min-w-0 justify-between gap-3 whitespace-normal px-3 py-3 text-left"
                    onClick={() => setActiveTeamId(team.id)}
                  >
                    <span className="min-w-0 text-left">
                      <span className="block truncate">{team.name}</span>
                      {team.trialEndsAt ? (
                        <span className="block text-xs text-muted-foreground">
                          {team.trialStatus === 'expired' ? 'Trial ended' : 'Trial ends'}{' '}
                          {utcTimestamp(team.trialEndsAt)}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {team.accessMode === 'owner_testing'
                        ? 'Owner test'
                        : team.accessMode === 'free_trial'
                          ? 'Setup · locked'
                          : team.accessMode === 'paid_subscription'
                            ? 'Paid access'
                            : team.trialStatus === 'expired'
                              ? 'Trial ended'
                              : team.paymentStatus === 'pending'
                                ? 'Pending'
                                : 'Locked'}
                    </span>
                  </Button>
                ))
              )}
            </CardContent>
          </Card>

          {activeTeam?.role === 'owner' &&
          (activeTeam.accessMode !== 'owner_testing' || isAdmin) ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {activeTeam.accessMode === 'owner_testing'
                    ? 'Invite the separate test owner'
                    : 'Invite a project manager'}
                </CardTitle>
                <CardDescription>
                  {activeTeam.accessMode === 'owner_testing'
                    ? 'First have the test user register at /signup and verify their email. Enter that same email to send the private owner invitation; it expires in 7 days.'
                    : `Send a private, single-use link for ${activeTeam.name}. The recipient must sign in with this email; it expires in 7 days.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-3" onSubmit={(event) => void inviteProjectManager(event)}>
                  <label htmlFor="team-invitation-email" className="text-sm font-medium">
                    {activeTeam.accessMode === 'owner_testing'
                      ? 'Verified test account email'
                      : 'Project manager email'}
                  </label>
                  <Input
                    id="team-invitation-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    maxLength={254}
                    required
                    placeholder="Enter the account email"
                  />
                  <Button type="submit" disabled={working}>
                    <MailPlus aria-hidden="true" className="mr-2 size-4" />
                    {working ? 'Sending invitation…' : 'Send invitation'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Create a team</CardTitle>
              <CardDescription>
                Creating a team starts its shared 30-day setup window. Permit records and PDF
                downloads stay locked until paid access is verified. It will not automatically
                charge or convert; the exact UTC end time appears after creation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={(event) => void createTeam(event)}>
                <label htmlFor="new-team-name" className="text-sm font-medium">
                  Team name
                </label>
                <Input
                  id="new-team-name"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  maxLength={80}
                  minLength={2}
                  required
                  placeholder="e.g. Willow Street Remodels"
                />
                <Button type="submit" disabled={working}>
                  <Plus aria-hidden="true" className="mr-2 size-4" />
                  {working ? 'Saving…' : 'Create team'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Join a team</CardTitle>
              <CardDescription>
                Use the invite code shared by a teammate. Your team uses its saved trial dates;
                joining never starts or resets a trial.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={(event) => void joinTeam(event)}>
                <label htmlFor="team-join-code" className="text-sm font-medium">
                  Team invite code
                </label>
                <Input
                  id="team-join-code"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={32}
                  minLength={6}
                  required
                  placeholder="Paste invite code"
                />
                <Button type="submit" variant="outline" disabled={working}>
                  <UsersRound aria-hidden="true" className="mr-2 size-4" />
                  Join team
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
