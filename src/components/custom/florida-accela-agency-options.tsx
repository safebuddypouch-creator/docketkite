// @polsia:user-owned — jurisdiction options for curated Florida Accela portals.
'use client';

import {
  floridaAccelaAgenciesByName,
  floridaAccelaPortalHomeUrl,
} from '@/lib/business/florida-accela-agencies';
import { cn } from '@/lib/utils';

const agencies = floridaAccelaAgenciesByName();

type FloridaAccelaAgencyOptionsProps = {
  className?: string;
  listClassName?: string;
  selectClassName?: string;
  labelClassName?: string;
  linkClassName?: string;
  /** Visual density for home vs compact form helpers. */
  variant?: 'page' | 'compact';
  id?: string;
  label?: string;
};

export function FloridaAccelaAgencyOptions({
  className,
  listClassName,
  selectClassName,
  labelClassName,
  linkClassName,
  variant = 'page',
  id = 'florida-accela-jurisdiction',
  label,
}: FloridaAccelaAgencyOptionsProps) {
  function openSelectedPortal(code: string) {
    const agency = agencies.find((item) => item.code === code);
    if (!agency) return;
    window.open(floridaAccelaPortalHomeUrl(agency.code), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={cn(variant === 'page' ? 'grid gap-5' : 'grid gap-2', className)}>
      <label className={cn('grid gap-1.5 text-sm font-medium', labelClassName)} htmlFor={id}>
        <span>
          {label ??
            (variant === 'page' ? 'Choose a supported county or city' : 'Supported jurisdiction')}
        </span>
        <select
          id={id}
          className={cn(
            'h-10 w-full max-w-xl rounded-md border border-border bg-background px-3 text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selectClassName,
          )}
          defaultValue=""
          onChange={(event) => {
            const code = event.target.value;
            if (!code) return;
            openSelectedPortal(code);
            event.target.value = '';
          }}
        >
          <option value="" disabled>
            Select a Florida Accela portal…
          </option>
          {agencies.map((agency) => (
            <option key={agency.code} value={agency.code}>
              {agency.name}
            </option>
          ))}
        </select>
      </label>

      <ul
        className={cn(
          'm-0 grid list-none gap-x-6 gap-y-2 p-0',
          variant === 'page'
            ? 'sm:grid-cols-2 lg:grid-cols-3'
            : 'max-h-40 overflow-y-auto sm:grid-cols-2',
          listClassName,
        )}
        aria-label="Supported Florida Accela counties and cities"
      >
        {agencies.map((agency) => (
          <li key={agency.code} className="min-w-0">
            <a
              className={cn(
                'text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                linkClassName,
              )}
              href={floridaAccelaPortalHomeUrl(agency.code)}
              target="_blank"
              rel="noreferrer"
            >
              {agency.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
