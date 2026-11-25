// @polsia:user-owned — focused review screen for one permit letter draft.
import type { Metadata } from 'next';
import { PermitCorrectionReview } from '@/components/custom/permit-correction-review';

export const metadata: Metadata = {
  title: 'Review correction items',
  description: 'Review proposed correction items from a permit letter before confirming them.',
};

export default async function PermitCorrectionReviewPage({
  params,
}: {
  params: Promise<{ permitId: string; letterId: string }>;
}) {
  const { permitId, letterId } = await params;
  return <PermitCorrectionReview permitId={permitId} letterId={letterId} />;
}
