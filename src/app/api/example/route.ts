// @polsia:user-owned — reference route disabled for public launch (attack surface).
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
