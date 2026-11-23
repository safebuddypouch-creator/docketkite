// @polsia:user-owned — login presentation composed with Better Auth's form.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/custom/auth-shell';
import { SignInForm } from '@/components/custom/sign-in-form';
import { safeReturnPath } from '@/lib/team-invite-url';

export const metadata: Metadata = {
  title: 'Sign in — DocketKite',
  description: 'Sign in to your private City of Tampa permit workspace.',
};

type LoginPageProps = {
  searchParams: Promise<{ invite?: string | string[]; returnTo?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const invite = Array.isArray(params.invite) ? params.invite[0] : params.invite;
  const returnToValue = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnPath(returnToValue);
  const signupHref =
    invite && /^[A-Za-z0-9_-]{20,128}$/.test(invite)
      ? `/signup?invite=${encodeURIComponent(invite)}`
      : returnTo
        ? `/signup?returnTo=${encodeURIComponent(returnTo)}`
        : '/signup';

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Pick up where the job left off."
      description="Sign in to return to your private City of Tampa permit list and team notes."
      footer={
        <>
          New to DocketKite?{' '}
          <Link
            href={signupHref}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
