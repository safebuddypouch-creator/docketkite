// @polsia:user-owned — seeded by polsia/modules/better-auth; restyle freely.
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/auth-client';

export function WorkspaceCta({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <Button type="button" disabled className={className}>
        Preparing workspace…
      </Button>
    );
  }

  return (
    <Button asChild className={className}>
      <Link href={session?.user ? '/dashboard' : '/signup'}>
        {session?.user ? 'Open permit workspace' : 'Create your workspace'} {children}
      </Link>
    </Button>
  );
}

export function AuthNav({ className }: { className?: string }) {
  const { data: session, isPending } = useSession();

  // Render nothing until the session resolves — avoids a Sign-in→Profile flash.
  if (isPending) return null;

  if (!session?.user) {
    return (
      <nav aria-label="Account" className={`flex items-center gap-1 sm:gap-2 ${className ?? ''}`}>
        <Button asChild variant="ghost" size="sm">
          <Link href="/login" data-auth-secondary="true">
            Sign in
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/signup" data-auth-primary="true">
            Create account
          </Link>
        </Button>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className={`flex items-center gap-1 sm:gap-2 ${className ?? ''}`}>
      <Button asChild size="sm">
        <Link href="/dashboard">Workspace</Link>
      </Button>
      <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
        <Link href="/profile">Account</Link>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          await signOut();
          window.location.assign('/');
        }}
      >
        Sign out
      </Button>
    </nav>
  );
}
