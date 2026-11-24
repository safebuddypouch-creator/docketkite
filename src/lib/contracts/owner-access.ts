import { z } from 'zod';

export const OwnerAccessEligibility = z.object({
  eligible: z.boolean(),
});

export type OwnerAccessEligibility = z.infer<typeof OwnerAccessEligibility>;
