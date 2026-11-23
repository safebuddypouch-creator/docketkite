// @polsia:user-owned — signed-in permit workspace page shell.
import type { Metadata } from 'next';
import { TeamWorkspace } from '@/components/custom/team-workspace';
import { PermitStatus } from '@/lib/contracts/permit';

type DashboardSearchParams = Promise<{
  teamId?: string | string[];
  status?: string | string[];
}>;

export const metadata: Metadata = {
  title: 'Team workspace — DocketKite',
  description: 'Set up team access and manage your City of Tampa permit workspace.',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const params = await searchParams;
  const initialTeamId = typeof params.teamId === 'string' ? params.teamId : '';
  const requestedStatus =
    typeof params.status === 'string' ? PermitStatus.safeParse(params.status) : null;

  return (
    <TeamWorkspace
      initialTeamId={initialTeamId}
      initialPermitStatus={requestedStatus?.success ? requestedStatus.data : null}
    />
  );
}
