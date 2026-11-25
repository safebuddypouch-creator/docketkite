// @polsia:user-owned — team-wide public permit status monitoring view.
import type { Metadata } from 'next';
import { TeamStatusMonitoring } from '@/components/custom/team-status-monitoring';

export const metadata: Metadata = {
  title: 'Team monitoring',
  description: 'Review recent public permit status changes detected across a DocketKite team.',
};

export default async function TeamMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ teamId?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialTeamId = typeof params.teamId === 'string' ? params.teamId : '';

  return <TeamStatusMonitoring initialTeamId={initialTeamId} />;
}
