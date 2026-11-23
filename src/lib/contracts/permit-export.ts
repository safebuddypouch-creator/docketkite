// @polsia:user-owned — strict filters shared by the permit CSV export source and workspace.
import { z } from 'zod';
import { PermitListSort, PermitStatus } from '@/lib/contracts/permit';

export const PermitExportFilters = z
  .object({
    teamId: z.string().min(1).max(128),
    view: z.enum(['active', 'archived']),
    sort: PermitListSort.default('activity'),
    status: PermitStatus.nullable().default(null),
    assignedToMe: z.boolean(),
    interruptedMonitoring: z.boolean().default(false),
    searchTerm: z.string().trim().max(200).default(''),
  })
  .strict();

export type PermitExportFilters = z.infer<typeof PermitExportFilters>;
