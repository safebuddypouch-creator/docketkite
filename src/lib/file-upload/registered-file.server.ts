// @polsia:user-owned — resolve completed uploads from local Postgres storage.
import 'server-only';
import { z } from 'zod';
import { findStoredUpload } from '@/lib/business/stored-upload';

const RegisteredR2File = z.object({
  id: z.number().int().positive(),
  key: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size: z.number().int().positive(),
  created_at: z.string().datetime(),
});

export type RegisteredFileLookup =
  | { status: 'registered'; file: z.infer<typeof RegisteredR2File> }
  | { status: 'not_registered' }
  | { status: 'unavailable' };

/** Fetches trusted file metadata by the ID returned from the local letter upload. */
export async function findRegisteredUpload(uploadId: number): Promise<RegisteredFileLookup> {
  try {
    const stored = await findStoredUpload(uploadId);
    if (!stored) return { status: 'not_registered' };
    const file = RegisteredR2File.safeParse(stored);
    if (!file.success) return { status: 'unavailable' };
    return { status: 'registered', file: file.data };
  } catch {
    return { status: 'unavailable' };
  }
}
