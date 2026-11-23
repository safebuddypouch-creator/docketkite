// @polsia:user-owned — private direct permit destination for status emails.
import type { Metadata } from 'next';
import { PermitDetails } from '@/components/custom/permit-details';

export const metadata: Metadata = {
  title: 'Permit details — DocketKite',
  description: 'View a permit in your private DocketKite team workspace.',
};

export default async function PermitDetailsPage({
  params,
}: {
  params: Promise<{ permitId: string }>;
}) {
  const { permitId } = await params;
  return <PermitDetails permitId={permitId} />;
}
