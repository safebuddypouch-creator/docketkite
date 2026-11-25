// @polsia:user-owned — invitation entry point; acceptance is handled by its client island.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/custom/auth-shell';
import { TeamInvitationAcceptance } from '@/components/custom/team-invitation-acceptance';
import { publicSocialImage } from '@/lib/public-origin';

const socialImage = publicSocialImage();

export const metadata: Metadata = {
  title: 'Team invitation',
  description: 'Accept a private DocketKite team invitation as a project manager.',
  openGraph: { images: [socialImage] },
  twitter: { card: 'summary_large_image', images: [socialImage.url] },
};

export default function TeamInvitePage() {
  return (
    <AuthShell
      eyebrow="Team invitation"
      title="Join a permit workspace."
      description="Use the email address that received the invitation to join the team."
      footer={
        <Link href="/" className="font-semibold text-primary underline-offset-4 hover:underline">
          Return to DocketKite
        </Link>
      }
    >
      <TeamInvitationAcceptance />
    </AuthShell>
  );
}
