// @polsia:user-owned — permit CSV export gated by team membership and paid access.

import 'server-only';
import { PermitExportFilters } from '@/lib/contracts/permit-export';
import { authorizeCsvExport, csvExportSources } from '@/lib/csv-export/sources.server';
import { stripPolsiaCsvMetadata } from '@/lib/csv-export/strip-polsia-metadata';
import { requireAuth } from '@/lib/require-auth';
import { sameOrigin } from '@/lib/same-origin';
import { siteUrl } from '@/lib/site';
import { requireTeamAccess } from '@/lib/team-access';
import {
  CSV_EXPORT_ERRORS,
  CSV_EXPORT_LIMITS,
  exportResponseSchema,
} from '@/modules/csv-export/contracts';
import { createCsvExportHandlers } from '@/modules/csv-export/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Framework handler only accepts one exact Origin string. We validate with
// sameOrigin() (which trusts the live apps.grok.bot host), then rewrite Origin
// to this baked value before calling the handler.
const allowedOrigin = new URL(siteUrl).origin;
const handlers = createCsvExportHandlers({
  sources: csvExportSources,
  authorize: authorizeCsvExport,
  allowedOrigin,
});
export const GET = handlers.GET;

function moduleError(
  code: keyof typeof CSV_EXPORT_ERRORS,
  status: number = CSV_EXPORT_ERRORS[code].status,
) {
  return Response.json(
    { ok: false, error: { code, message: CSV_EXPORT_ERRORS[code].message } },
    {
      status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    },
  );
}

async function readBoundedBody(request: Request): Promise<Uint8Array | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > CSV_EXPORT_LIMITS.requestBytes) {
    return moduleError('BODY_LIMIT');
  }
  const reader = request.clone().body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CSV_EXPORT_LIMITS.requestBytes) {
        await reader.cancel();
        return moduleError('BODY_LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requestForHandler(request: Request, extraHeaders?: Record<string, string>): Request {
  const headers = new Headers(request.headers);
  headers.set('origin', allowedOrigin);
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  }
  return new Request(request, { headers });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return moduleError('FORBIDDEN', 403);
  }

  const body = await readBoundedBody(request);
  if (body instanceof Response) return body;

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return handlers.POST(requestForHandler(request));
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return handlers.POST(requestForHandler(request));
  }
  const bodyRecord = parsedBody as Record<string, unknown>;
  if (bodyRecord.sourceId !== 'permits') {
    return handlers.POST(requestForHandler(request));
  }

  const filterResult = PermitExportFilters.safeParse(bodyRecord.filters);
  if (!filterResult.success) return moduleError('INVALID_FILTERS');

  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(request);
  } catch (response) {
    return moduleError('UNAUTHENTICATED', response instanceof Response ? response.status : 401);
  }

  const access = await requireTeamAccess(filterResult.data.teamId, user.id);
  if (access.response) {
    // Map unpaid (402) and membership/origin denials to FORBIDDEN so the UI
    // can show the paid-membership copy; keep the HTTP status for clients.
    return moduleError('FORBIDDEN', access.response.status);
  }

  const exported = await handlers.POST(
    requestForHandler(request, {
      'x-polsia-csv-actor-id': user.id,
      'x-polsia-csv-team-id': filterResult.data.teamId,
    }),
  );
  if (!exported.ok) return exported;

  const payload = exportResponseSchema.safeParse(await exported.clone().json().catch(() => null));
  if (!payload.success) return exported;

  return Response.json(
    {
      ok: true,
      data: {
        ...payload.data.data,
        csv: stripPolsiaCsvMetadata(payload.data.data.csv),
        filename: 'permits.csv',
      },
    },
    {
      status: exported.status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}
