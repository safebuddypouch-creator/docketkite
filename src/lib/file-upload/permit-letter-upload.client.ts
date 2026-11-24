// @polsia:user-owned — multipart permit letter upload into app-owned Postgres storage.
'use client';

import {
  UploadErrorBody,
} from '@/lib/contracts/file-upload';
import { PermitLetterUploadReceipt } from '@/lib/contracts/permit-letter';
import { FileUploadError, type FileUploadErrorCode } from '@/modules/file-upload/client';

const UPLOAD_PATH = '/api/permit-letters/upload';
const SUCCESS_MIN = 200;
const SUCCESS_MAX = 299;

const ERROR_CODES: Record<string, FileUploadErrorCode> = {
  file_too_large: 'file_too_large',
  invalid_file_type: 'invalid_file_type',
  unsupported_image_format: 'invalid_file_type',
  missing_file: 'invalid_file_type',
  upload_rejected: 'upload_rejected',
  upload_changed: 'upload_changed',
  upload_not_found: 'upload_not_found',
  copy_unavailable: 'copy_unavailable',
  unauthorized: 'unauthorized',
};

type ProgressHandler = (percent: number) => void;
type JsonReply = { status: number; body: unknown };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function send(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  onProgress?: ProgressHandler,
): Promise<JsonReply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => resolve({ status: xhr.status, body: parseJson(xhr.responseText) });
    xhr.onerror = () => reject(new FileUploadError('network'));
    xhr.send(body);
  });
}

function throwReplyError(reply: JsonReply): never {
  const nested = UploadErrorBody.safeParse(reply.body);
  if (nested.success) {
    const { code, message, max_size } = nested.data.error;
    throw new FileUploadError(ERROR_CODES[code] ?? 'unknown', message, max_size);
  }
  const body = reply.body as { error?: { code?: string; message?: string; max_size?: number } } | null;
  if (body?.error?.code) {
    throw new FileUploadError(
      ERROR_CODES[body.error.code] ?? 'unknown',
      body.error.message,
      body.error.max_size,
    );
  }
  throw new FileUploadError('unknown', `Upload failed (HTTP ${reply.status}).`);
}

/** Uploads the letter into DocketKite storage and returns the confirmed file id. */
export async function uploadPermitLetter(
  file: File,
  onProgress?: ProgressHandler,
): Promise<number> {
  const form = new FormData();
  form.append('file', file);
  const reply = await send('POST', UPLOAD_PATH, form, {}, onProgress);
  if (reply.status < SUCCESS_MIN || reply.status > SUCCESS_MAX) throwReplyError(reply);
  const receipt = PermitLetterUploadReceipt.safeParse(reply.body);
  if (!receipt.success) throw new FileUploadError('unknown');
  onProgress?.(100);
  return receipt.data.fileId;
}
