// @polsia:user-owned — checklist destination for a confirmed permit letter review.
import type { Metadata } from 'next';
import { PermitCorrectionChecklistView } from '@/components/custom/permit-correction-checklist';

export const metadata: Metadata = {
  title: 'Correction checklist — DocketKite',
  description: 'A source-linked checklist of confirmed corrections from your permit letter.',
};

export default async function PermitCorrectionChecklistPage({
  params,
}: {
  params: Promise<{ permitId: string; letterId: string }>;
}) {
  const { permitId, letterId } = await params;
  return <PermitCorrectionChecklistView permitId={permitId} letterId={letterId} />;
}
