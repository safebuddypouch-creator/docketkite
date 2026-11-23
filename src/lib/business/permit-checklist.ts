// @polsia:user-owned — converts only confirmed review values into source-linked checklist items.
import { PermitCorrectionDraftItem } from '@/lib/contracts/permit-letter';

export interface ConfirmedPermitReview {
  status: string;
  confirmedAt: Date | null;
  reviewedItems: unknown;
}

export interface PermitChecklistItemInput {
  sourceLetterId: string;
  sourceItemId: string;
  action: string;
  location: string | null;
  planReference: string | null;
}

export function checklistItemsFromConfirmedReview(
  review: ConfirmedPermitReview,
  sourceLetterId: string,
): PermitChecklistItemInput[] | null {
  if (review.status !== 'confirmed' || !review.confirmedAt) return null;

  const parsedItems = PermitCorrectionDraftItem.array().safeParse(review.reviewedItems);
  if (!parsedItems.success) return null;

  return parsedItems.data.map((item) => ({
    sourceLetterId,
    sourceItemId: item.id,
    action: item.action,
    location: item.location,
    planReference: item.planReference,
  }));
}
