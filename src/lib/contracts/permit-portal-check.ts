// @polsia:user-owned — private City portal status history contract.
import { z } from 'zod';
import { getOfficialPermitPortalUrl } from '@/lib/contracts/permit';

export const PermitPortalCheckRequest = z.object({ teamId: z.string().min(1) });

export const INVALID_PERMIT_PORTAL_URL_MESSAGE =
  'This saved link is outside active Florida Accela coverage. Edit the permit and save its direct Building record URL from a supported official Accela portal before checking it.';

export const PermitPortalCheckUrlError = z.object({
  error: z.literal('invalid_portal_url'),
  message: z.literal(INVALID_PERMIT_PORTAL_URL_MESSAGE),
});

export const PermitPortalCheckItem = z.object({
  id: z.string(),
  permitId: z.string(),
  permitNumber: z.string(),
  // Check history is immutable and may point to a retired jurisdiction.
  sourceUrl: z.union([z.string().trim().min(1), z.null()]),
  status: z.string().nullable(),
  result: z.enum(['checked', 'unverified', 'unavailable']),
  message: z.string().nullable(),
  checkedAt: z.string().datetime(),
  sourceFetchedAt: z.string().datetime().nullable(),
  monitoringStatus: z.string().nullable(),
  monitoringAgreement: z.enum(['matches_portal', 'not_verified']),
  redlineStatus: z.string().nullable(),
  redlineResult: z.enum(['not_connected', 'checked', 'discrepancy', 'unverified']),
  redlineMessage: z.string().nullable(),
});

export const PermitPortalMonitoringState = z.object({
  lastSuccessfulPortalCheckAt: z.string().datetime().nullable(),
  interruptedAt: z.string().datetime().nullable(),
  reason: z.string().nullable(),
});

export const PermitPortalVerifiedResult = z.object({
  permitNumber: z.string().trim().min(1),
  status: z.string().refine((value) => value.trim().length > 0),
  sourceUrl: z
    .string()
    .url()
    .refine((value) => getOfficialPermitPortalUrl(value) === value),
  checkedAt: z.string().datetime(),
  sourceFetchedAt: z.string().datetime(),
});

export const PermitPortalCheckList = z.object({
  items: z.array(PermitPortalCheckItem),
  monitoring: PermitPortalMonitoringState,
  latestVerified: PermitPortalVerifiedResult.nullable(),
  canRetry: z.boolean(),
});

export const PermitPortalCheckMutation = z.object({
  check: PermitPortalCheckItem,
  monitoring: PermitPortalMonitoringState,
});

export type PermitPortalCheckItem = z.infer<typeof PermitPortalCheckItem>;
export type PermitPortalMonitoringState = z.infer<typeof PermitPortalMonitoringState>;
export type PermitPortalVerifiedResult = z.infer<typeof PermitPortalVerifiedResult>;
