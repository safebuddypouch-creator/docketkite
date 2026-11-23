// @polsia:user-owned
'use client';

import { ArrowLeft, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { BrandMark } from '@/components/custom/brand-mark';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/auth-client';
import { DashboardNav } from './dashboard-nav';

export interface DashboardShellProps {
  children: ReactNode;
}

function hasRole(role: string | null | undefined, expected: string) {
  return (
    role
      ?.split(',')
      .map((item) => item.trim())
      .includes(expected) ?? false
  );
}

export function DashboardShell({ children }: DashboardShellProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const isAdmin = hasRole(session?.user?.role, 'admin');

  useEffect(() => {
    if (!isPending && !session?.user) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
  }, [isPending, router, session?.user]);

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  if (isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-gutter">
        <p className="text-sm text-muted-foreground">Loading dashboard...</p>
      </main>
    );
  }

  if (!session?.user) {
    // The effect above redirects to /login; this is the brief transition state,
    // not a stable screen.
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-gutter">
        <p className="text-sm text-muted-foreground">Redirecting to sign in...</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top_left,var(--brand-100),transparent_42%)]">
        <header className="border-b border-border/70 bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-gutter">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <BrandMark className="size-6" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight text-foreground">
                  DocketKite
                </span>
                <span className="hidden text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:block">
                  City of Tampa permit desk
                </span>
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/" aria-label="Return to DocketKite home">
                  <ArrowLeft aria-hidden="true" className="mr-1.5 size-4" />
                  Home
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/profile">Account</Link>
              </Button>
              {isAdmin && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin">Administration</Link>
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={handleSignOut}>
                <LogOut aria-hidden="true" className="mr-1.5 hidden size-4 sm:block" />
                Sign out
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] gap-6 px-gutter py-5 sm:py-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="lg:border-r lg:border-border/70 lg:pr-6">
            <DashboardNav />
          </aside>

          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </main>
  );
}
