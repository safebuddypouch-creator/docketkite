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
    <main className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[minmax(300px,0.9fr)_minmax(440px,1.1fr)]">
      <aside className="dk-field-board relative flex min-h-[280px] flex-col justify-between overflow-hidden px-6 py-7 sm:px-10 sm:py-9 lg:min-h-dvh lg:px-12 lg:py-12">
        <div className="dk-caution absolute inset-x-0 top-0" aria-hidden="true" />
        <Link href="/" className="relative mt-6 flex w-fit items-center gap-2.5 text-[#f7f3ea]">
          <BrandMark className="size-8 shrink-0 text-[#f0c14b]" />
          <span className="font-display text-2xl font-semibold uppercase tracking-[0.14em]">
            DocketKite
          </span>
        </Link>
        <div className="relative mt-10 max-w-lg lg:mb-14">
          <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-[#f0c14b]">
            City of Tampa permit desk
          </p>
          <h1 className="mt-4 max-w-md font-display text-4xl font-semibold uppercase leading-[0.92] tracking-wide text-[#f7f3ea] sm:text-5xl lg:text-6xl">
            Keep every permit detail within reach.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-[#d9cfc0] sm:text-base sm:leading-7">
            A private workspace for your team&apos;s City of Tampa permit records.
          </p>
        </div>
        <p className="relative hidden font-display text-sm uppercase tracking-[0.14em] text-[#f0c14b] lg:block">
          Private permit workspace · City of Tampa, Florida
        </p>
      </aside>
      <section className="dk-yard flex items-center justify-center px-5 py-10 sm:px-8 sm:py-14">
        <div className="w-full max-w-md">
          <p className="dk-kicker">{eyebrow}</p>
          <h2 className="mt-4 font-display text-4xl font-semibold uppercase leading-[0.95] tracking-wide text-foreground">
            {title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="dk-sheet mt-7 p-5 sm:p-7">
            {children}
            <div className="mt-5 border-t-2 border-foreground pt-4 text-sm text-muted-foreground">
              {footer}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
