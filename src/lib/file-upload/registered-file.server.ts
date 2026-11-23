// @polsia:user-owned — resolve completed uploads against Polsia's registered file list.
import 'server-only';
import { z } from 'zod';
import { env } from '@/lib/env';

const RegisteredR2File = z.object({
  id: z.number().int().positive(),
  key: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size: z.number().int().positive(),
  created_at: z.string().datetime(),
});

const RegisteredR2FileList = z.object({ files: z.array(z.unknown()) });

export type RegisteredFileLookup =
  | { status: 'registered'; file: z.infer<typeof RegisteredR2File> }
  | { status: 'not_registered' }
  | { status: 'unavailable' };

type RegisteredFileList =
  | { status: 'available'; files: z.infer<typeof RegisteredR2File>[] }
  | { status: 'unavailable' };

async function listRegisteredFiles(): Promise<RegisteredFileList> {
  const origin = env.POLSIA_R2_BASE_URL || env.POLSIA_API_BASE_URL;
  const apiKey = env.POLSIA_API_KEY;
  if (!origin || !apiKey) return { status: 'unavailable' };

  try {
    const response = await fetch(`${origin.replace(/\/+$/, '')}/api/proxy/r2/files?limit=50`, {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: 'unavailable' };

    const body = RegisteredR2FileList.safeParse(await response.json());
    if (!body.success) return { status: 'unavailable' };

    const files: z.infer<typeof RegisteredR2File>[] = [];
    for (const candidate of body.data.files) {
      const file = RegisteredR2File.safeParse(candidate);
      if (file.success) files.push(file.data);
    }
    return { status: 'available', files };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Fetches trusted file metadata by the ID returned from uploadFile(). */
export async function findRegisteredUpload(uploadId: number): Promise<RegisteredFileLookup> {
  const result = await listRegisteredFiles();
  if (result.status === 'unavailable') return { status: 'unavailable' };
  const file = result.files.find((candidate) => candidate.id === uploadId);
  return file ? { status: 'registered', file } : { status: 'not_registered' };
}
