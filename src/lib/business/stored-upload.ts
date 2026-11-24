// @polsia:user-owned — local Postgres storage for permit letter bytes (no Polsia R2).
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

export type StoredUploadRecord = {
  id: number;
  key: string;
  url: string;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
};

function publicFileUrl(key: string): string {
  // Stable https URL shape for contracts; bytes are served from Postgres, not this host path.
  return `https://files.docketkitepermits.com/stored/${encodeURIComponent(key)}`;
}

export async function storeUploadBytes(input: {
  userId: string;
  teamId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<StoredUploadRecord> {
  const key = `letters/${input.teamId}/${Date.now()}-${randomBytes(8).toString('hex')}`;
  const created = await prisma.storedUpload.create({
    data: {
      key,
      userId: input.userId,
      teamId: input.teamId,
      fileName: input.filename,
      mimeType: input.mimeType,
      size: input.bytes.byteLength,
      bytes: input.bytes,
      contentSha256: createHash('sha256').update(input.bytes).digest('hex'),
    },
  });
  return {
    id: created.id,
    key: created.key,
    url: publicFileUrl(created.key),
    filename: created.fileName,
    mime_type: created.mimeType,
    size: created.size,
    created_at: created.createdAt.toISOString(),
  };
}

export async function findStoredUpload(uploadId: number): Promise<StoredUploadRecord | null> {
  const row = await prisma.storedUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      key: true,
      fileName: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    url: publicFileUrl(row.key),
    filename: row.fileName,
    mime_type: row.mimeType,
    size: row.size,
    created_at: row.createdAt.toISOString(),
  };
}

export async function readStoredUploadBytes(uploadId: number): Promise<{
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  size: number;
} | null> {
  const row = await prisma.storedUpload.findUnique({
    where: { id: uploadId },
    select: { bytes: true, fileName: true, mimeType: true, size: true },
  });
  if (!row) return null;
  return {
    bytes: Buffer.from(row.bytes),
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
  };
}
