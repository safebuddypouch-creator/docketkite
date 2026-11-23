// @polsia:user-owned — team-wide public permit status detections contract.
import { z } from 'zod';

export const PermitStatusDetection = z.object({
  id: z.string(),
  permitId: z.string(),
  permitNumber: z.string(),
  projectName: z.string(),
  address: z.string(),
  permitType: z.string(),
  previousStatus: z.string(),
  newStatus: z.string(),
  detectedAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  sourceUrl: z.string().url(),
  targetedRole: z.enum(['project_manager', 'unassigned']),
  textDeliveryStatus: z.enum(['delivered', 'failed', 'unverified']),
  textDeliveryMessage: z.string(),
  checklistMatchStatus: z.enum(['matched', 'mismatched', 'unverified']),
  checklistMatchMessage: z.string(),
});

export const PermitStatusDetectionList = z.object({
  items: z.array(PermitStatusDetection),
});

export type PermitStatusDetection = z.infer<typeof PermitStatusDetection>;
export type PermitStatusDetectionList = z.infer<typeof PermitStatusDetectionList>;
