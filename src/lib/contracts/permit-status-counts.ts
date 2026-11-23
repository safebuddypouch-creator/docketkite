// @polsia:user-owned — saved team permit status count contract.
import { z } from 'zod';
import { PermitStatus } from '@/lib/contracts/permit';

export const PermitStatusCount = z.object({
  status: PermitStatus,
  count: z.number().int().nonnegative(),
});

export const PermitStatusCounts = z.object({
  teamId: z.string().min(1),
  items: z.array(PermitStatusCount).length(PermitStatus.options.length),
});

export type PermitStatusCount = z.infer<typeof PermitStatusCount>;
export type PermitStatusCounts = z.infer<typeof PermitStatusCounts>;
