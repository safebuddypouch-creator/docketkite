// @polsia:user-owned — shared contract for private permit correction letters.
import { z } from 'zod';

export const CorrectionLetterMimeType = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export const MAX_CORRECTION_LETTER_SIZE_BYTES = 50 * 1024 * 1024;

export const CorrectionLetterUploadIntent = z.object({
  filename: z.string().trim().min(1).max(255),
  mime_type: CorrectionLetterMimeType,
  size: z.number().int().positive().max(MAX_CORRECTION_LETTER_SIZE_BYTES),
});

export const PermitLetterUploadReceipt = z.object({ fileId: z.number().int().positive() });

function isSecureUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const RegisteredCorrectionLetterFile = z.object({
  id: z.number().int().positive(),
  key: z.string().min(1).max(2048),
  url: z.string().url().refine(isSecureUrl, 'Use a secure file URL'),
  filename: z.string().min(1).max(255),
  mime_type: CorrectionLetterMimeType,
  size: z.number().int().positive().max(MAX_CORRECTION_LETTER_SIZE_BYTES),
  created_at: z.string().datetime(),
});

export const PermitLetterRequest = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('authorize'),
    permitId: z.string().min(1),
    teamId: z.string().min(1),
    file: CorrectionLetterUploadIntent.optional(),
  }),
  z.object({
    action: z.literal('attach'),
    permitId: z.string().min(1),
    teamId: z.string().min(1),
    uploadId: z.number().int().positive(),
  }),
]);

export const PermitCorrectionDraftItem = z.object({
  id: z.string().min(1),
  action: z.string().trim().min(1, 'Enter a correction request.'),
  location: z.string().trim().nullable(),
  planReference: z.string().trim().nullable(),
});

export const PermitCorrectionDraft = z.object({
  status: z.enum(['draft', 'confirmed']),
  items: z.array(PermitCorrectionDraftItem),
  fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })),
  extractedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  confirmedAt: z.string().datetime().nullable(),
});

export const PermitCorrectionChecklistSummary = z
  .object({
    id: z.string().min(1),
    sourceLetterId: z.string().min(1),
    completedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  })
  .refine((summary) => summary.completedCount <= summary.totalCount, {
    message: 'Completed checklist items cannot exceed the total item count',
  });

export const PermitCorrectionDraftResponse = z.object({ draft: PermitCorrectionDraft });
export const PermitCorrectionReviewRequest = z.object({
  action: z.enum(['save', 'confirm']),
  items: z.array(PermitCorrectionDraftItem),
});
export const PermitCorrectionReviewResponse = z.object({ draft: PermitCorrectionDraft });

export const PermitLetterItem = z.object({
  id: z.string(),
  permitId: z.string(),
  teamId: z.string(),
  uploadId: z.number().int().positive(),
  fileName: z.string(),
  mimeType: CorrectionLetterMimeType,
  size: z.number().int().positive(),
  createdAt: z.string().datetime(),
  correctionDraft: PermitCorrectionDraft.nullable(),
  correctionChecklist: PermitCorrectionChecklistSummary.nullable(),
});

export const PermitLetterExtractRequest = z.object({
  teamId: z.string().min(1),
  permitId: z.string().min(1),
});

export const PermitLetterSourceRequest = z.object({
  teamId: z.string().min(1),
  permitId: z.string().min(1),
});

export const PermitLetterList = z.object({ items: z.array(PermitLetterItem) });
export const PermitLetterAuthorization = z.object({ authorized: z.literal(true) });
export const PermitCorrectionReviewDetails = z.object({
  letter: PermitLetterItem,
  checklistId: z.string().nullable(),
  permit: z.object({
    id: z.string(),
    projectName: z.string(),
    address: z.string(),
    permitNumber: z.string(),
  }),
});

export const PermitCorrectionChecklistRequest = z.object({
  teamId: z.string().min(1),
  permitId: z.string().min(1),
});

export const PermitCorrectionChecklistItem = z.object({
  id: z.string(),
  sourceLetterId: z.string(),
  sourceItemId: z.string(),
  action: z.string(),
  location: z.string().nullable(),
  planReference: z.string().nullable(),
  completed: z.boolean(),
});

export const PermitCorrectionChecklistItemUpdateRequest = z.object({
  itemId: z.string().min(1),
  completed: z.boolean(),
});

export const PermitCorrectionChecklistItemUpdateResponse = z.object({
  item: PermitCorrectionChecklistItem,
});

export const PermitCorrectionChecklist = z.object({
  id: z.string(),
  teamId: z.string(),
  permitId: z.string(),
  sourceLetterId: z.string(),
  sourceFileName: z.string(),
  createdAt: z.string().datetime(),
  items: z.array(PermitCorrectionChecklistItem),
});

export const PermitCorrectionChecklistResponse = z.object({
  checklist: PermitCorrectionChecklist,
});

export type PermitLetterItem = z.infer<typeof PermitLetterItem>;
export type PermitLetterList = z.infer<typeof PermitLetterList>;
export type PermitCorrectionDraftItem = z.infer<typeof PermitCorrectionDraftItem>;
export type PermitCorrectionChecklistSummary = z.infer<typeof PermitCorrectionChecklistSummary>;
export type PermitCorrectionReviewDetailsData = z.infer<typeof PermitCorrectionReviewDetails>;
export type PermitCorrectionChecklistData = z.infer<typeof PermitCorrectionChecklist>;
