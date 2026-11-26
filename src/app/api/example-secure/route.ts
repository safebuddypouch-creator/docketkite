// @polsia:user-owned — reference owner-scoped API disabled for public launch.
//
// Keep this file as a COPYABLE SHAPE for per-user resources:
// `requireAuth()` + every query scoped by the caller's id.
// Never query user data without `where: { userId: user.id }` (IDOR).
//
// Live handlers below return 404 so the demo no longer mutates production
// profile rows. Restore the sample GET/POST/PATCH bodies from the better-auth
// module docs when scaffolding a real resource.

import 'server-only';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function disabled() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET() {
  return disabled();
}

export async function POST() {
  return disabled();
}

export async function PATCH() {
  return disabled();
}
