// @polsia:user-owned
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type WaitlistFormClassNames = {
  form?: string;
  label?: string;
  input?: string;
  button?: string;
  error?: string;
  status?: string;
};

// Composes the template's base shadcn primitives (Button/Input/Label) styled
// through the theme tokens. Restyle via the brand_tokens slot + cva variants,
// or pull more primitives with `npx shadcn add` and compose them.
export function WaitlistForm({ classNames }: { classNames?: WaitlistFormClassNames }) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    // apiFetch resolves on 2xx and throws on non-2xx with the parsed body on
    // `error.cause` — so the route's { errors: { email } } (400/409) is readable.
    try {
      await apiFetch('/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setOk(true);
    } catch (err) {
      const cause = (err as { cause?: { errors?: { email?: string } } }).cause;
      setError(cause?.errors?.email ?? 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (ok) {
    return (
      <output
        className={cn('py-4 text-center text-sm font-medium text-foreground', classNames?.status)}
        aria-live="polite"
      >
        You&apos;re on the early-access list.
      </output>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col gap-3', classNames?.form)}
      aria-label="Early-access waitlist"
      noValidate
    >
      <Label htmlFor="waitlist-email" className={classNames?.label}>
        Email address
      </Label>
      <Input
        id="waitlist-email"
        name="email"
        type="email"
        className={classNames?.input}
        placeholder="name@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'waitlist-email-error' : undefined}
      />
      {error ? (
        <p
          id="waitlist-email-error"
          className={cn('text-sm text-destructive', classNames?.error)}
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className={cn('w-full', classNames?.button)}>
        {pending ? 'Joining…' : 'Request early access'}
      </Button>
    </form>
  );
}
