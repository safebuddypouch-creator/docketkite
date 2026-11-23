// @polsia:user-owned — invitation entry point; acceptance is handled by its client island.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/custom/auth-shell';
import { TeamInvitationAcceptance } from '@/components/custom/team-invitation-acceptance';

export const metadata: Metadata = {
  title: 'Team invitation — DocketKite',
  description: 'Accept a private DocketKite team invitation as a project manager.',
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
