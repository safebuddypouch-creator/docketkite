// @polsia:user-owned — direct-to-storage permit letter upload with server confirmation.
'use client';

import { apiFetch } from '@/lib/api-client';
import {
  UploadErrorBody,
  UploadTicket,
  type UploadTicket as UploadTicketValue,
} from '@/lib/contracts/file-upload';
import { PermitLetterUploadReceipt } from '@/lib/contracts/permit-letter';
import { FileUploadError, type FileUploadErrorCode } from '@/modules/file-upload/client';

const UPLOAD_PATH = '/api/permit-letters/upload';
const DIRECT_UPLOAD_DISABLED = 'direct_upload_disabled';
const COPY_UNAVAILABLE = 'copy_unavailable';
const RETRY_DELAYS_MS = [0, 1000, 3000];
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

function errorBody(error: unknown) {
  if (!(error instanceof Error)) return null;
  const parsed = UploadErrorBody.safeParse(error.cause);
  return parsed.success ? parsed.data.error : null;
}

function toUploadError(error: unknown): FileUploadError {
  const body = errorBody(error);
  if (body)
    return new FileUploadError(ERROR_CODES[body.code] ?? 'unknown', body.message, body.max_size);
  return error instanceof TypeError
    ? new FileUploadError('network')
    : new FileUploadError('unknown');
}

function statusFromError(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /failed \((\d{3})\)/.exec(error.message);
  return match?.[1] ? Number(match[1]) : null;
}

function shouldRetry(error: unknown): boolean {
  const status = statusFromError(error);
  const code = errorBody(error)?.code;
  return (
    (status !== null && status >= 500) || code === COPY_UNAVAILABLE || error instanceof TypeError
  );
}

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
  const parsed = UploadErrorBody.safeParse(reply.body);
  if (parsed.success) {
    const { code, message, max_size } = parsed.data.error;
    throw new FileUploadError(ERROR_CODES[code] ?? 'unknown', message, max_size);
  }
  throw new FileUploadError('unknown', `Upload failed (HTTP ${reply.status}).`);
}

async function uploadMultipart(file: File, onProgress?: ProgressHandler): Promise<number> {
  const form = new FormData();
  form.append('file', file);
  const reply = await send('POST', UPLOAD_PATH, form, {}, onProgress);
  if (reply.status < SUCCESS_MIN || reply.status > SUCCESS_MAX) throwReplyError(reply);
  const receipt = PermitLetterUploadReceipt.safeParse(reply.body);
  if (!receipt.success) throw new FileUploadError('unknown');
  return receipt.data.fileId;
}

async function confirmUpload(uploadId: string): Promise<number> {
  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const receipt = await apiFetch(UPLOAD_PATH, {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm', upload_id: uploadId }),
        signal: AbortSignal.timeout(100_000),
        schema: PermitLetterUploadReceipt,
      });
      return receipt.fileId;
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) throw toUploadError(error);
    }
  }
  throw toUploadError(lastError);
}

/** Uploads through the installed file-upload proxy and records its server confirmation. */
export async function uploadPermitLetter(
  file: File,
  onProgress?: ProgressHandler,
): Promise<number> {
  let ticket: UploadTicketValue;
  try {
    ticket = await apiFetch(UPLOAD_PATH, {
      method: 'POST',
      body: JSON.stringify({ action: 'mint' }),
      schema: UploadTicket,
    });
  } catch (error) {
    if (errorBody(error)?.code === DIRECT_UPLOAD_DISABLED) {
      const fileId = await uploadMultipart(file, onProgress);
      onProgress?.(100);
      return fileId;
    }
    throw toUploadError(error);
  }

  const putReply = await send('PUT', ticket.upload_url, file, ticket.headers, onProgress);
  if (putReply.status < SUCCESS_MIN || putReply.status > SUCCESS_MAX) {
    throw new FileUploadError('unknown', `Storage refused the upload (HTTP ${putReply.status}).`);
  }
  const fileId = await confirmUpload(ticket.upload_id);
  onProgress?.(100);
  return fileId;
}
