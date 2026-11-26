// @polsia:user-owned — signup presentation composed with Better Auth's form.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/custom/auth-shell';
import { SignUpForm } from '@/components/custom/sign-up-form';
import { publicSocialImage } from '@/lib/public-origin';
import { safeReturnPath } from '@/lib/team-invite-url';

const socialImage = publicSocialImage();

export const metadata: Metadata = {
  title: 'Create your workspace',
  description:
    'Create an account and a DocketKite team. The shared 30-day setup window does not unlock permit records or PDF downloads; those require a verified active $299/month team subscription.',
  openGraph: { images: [socialImage] },
  twitter: { card: 'summary_large_image', images: [socialImage.url] },
};

type SignupPageProps = {
  searchParams: Promise<{ invite?: string | string[]; returnTo?: string | string[] }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const invite = Array.isArray(params.invite) ? params.invite[0] : params.invite;
  const returnToValue = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnPath(returnToValue);
  const loginHref =
    invite && /^[A-Za-z0-9_-]{20,128}$/.test(invite)
      ? `/login?invite=${encodeURIComponent(invite)}`
      : returnTo
        ? `/login?returnTo=${encodeURIComponent(returnTo)}`
        : '/login';

  return (
    <AuthShell
      eyebrow="State of Florida permit desk"
      title="Start with one job."
      description="Create your account and team, then choose whether to open the $299/month hosted checkout. The shared 30-day setup window does not unlock permit records or PDF downloads, never automatically charges or converts, and its UTC end time appears in your workspace. Your team and records remain stored if you do not subscribe."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={loginHref}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
