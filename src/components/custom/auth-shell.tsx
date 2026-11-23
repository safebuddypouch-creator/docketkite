// @polsia:user-owned — shared visual frame for the installed auth module's pages.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/custom/brand-mark';

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[minmax(300px,0.82fr)_minmax(440px,1.18fr)]">
      <aside className="relative flex min-h-[250px] flex-col justify-between overflow-hidden bg-primary px-6 py-7 text-primary-foreground sm:px-10 sm:py-9 lg:min-h-dvh lg:px-12 lg:py-12">
        <div className="pointer-events-none absolute -right-32 -top-36 size-[28rem] rounded-full border border-primary-foreground/10 shadow-[0_0_0_34px_rgba(244,245,235,0.025),0_0_0_68px_rgba(244,245,235,0.025)]" />
        <Link href="/" className="relative flex w-fit items-center gap-2.5 text-primary-foreground">
          <BrandMark className="size-8 shrink-0" />
          <span className="text-lg font-semibold tracking-tight">DocketKite</span>
        </Link>
        <div className="relative mt-10 max-w-lg lg:mb-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">
            CITY OF TAMPA PERMIT DESK
          </p>
          <h1 className="mt-4 max-w-md font-display text-3xl leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Keep every permit detail within reach.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-primary-foreground/80 sm:text-base sm:leading-7">
            A private workspace for your team&apos;s City of Tampa permit records.
          </p>
        </div>
        <p className="relative hidden text-xs text-primary-foreground/60 lg:block">
          Private permit workspace · City of Tampa, Florida
        </p>
      </aside>
      <section className="flex items-center justify-center px-5 py-10 sm:px-8 sm:py-14">
        <div className="w-full max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-7 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7">
            {children}
            <div className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
              {footer}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
