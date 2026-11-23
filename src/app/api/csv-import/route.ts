// @polsia:user-owned — bind module requests to one selected team scope.
import 'server-only';
import { NextResponse } from 'next/server';
import { authorizeCsvImport, csvImportTargets } from '@/lib/csv-import/targets.server';
import { siteUrl } from '@/lib/site';
import { createCsvImportHandlers } from '@/modules/csv-import/server';

export const dynamic = 'force-dynamic';

const selectedTeamHeader = 'x-docketkite-csv-team-id';
const handlers = createCsvImportHandlers({
  targets: csvImportTargets,
  authorize: authorizeCsvImport,
  allowedOrigin: new URL(siteUrl).origin,
});

function withSelectedTeam(request: Request): Request | Response {
  const url = new URL(request.url);
  const teamIds = url.searchParams.getAll('teamId');
  if (teamIds.length !== 1 || !teamIds[0]?.trim()) {
    return NextResponse.json({ error: 'team_id_required' }, { status: 400 });
  }

  const headers = new Headers(request.headers);
  headers.set(selectedTeamHeader, teamIds[0]);
  url.searchParams.delete('teamId');

  return new Proxy(request, {
    get(target, property) {
      if (property === 'url') return url.toString();
      if (property === 'headers') return headers;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function GET(request: Request) {
  const scoped = withSelectedTeam(request);
  if (scoped instanceof Response) return scoped;
  return handlers.GET(scoped);
}

export async function POST(request: Request) {
  const scoped = withSelectedTeam(request);
  if (scoped instanceof Response) return scoped;
  return handlers.POST(scoped);
}
