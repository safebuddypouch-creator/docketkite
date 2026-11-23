'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { useIsAdmin } from '@/lib/auth-client';

export function OwnerAccessCode() {
  const isAdmin = useIsAdmin();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (isAdmin) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await apiFetch('/api/account/owner-access', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      window.location.reload();
    } catch (caught) {
      const status = caught instanceof Error ? caught.message : '';
      setError(
        status.includes('(429)')
          ? 'Too many attempts. Wait a few minutes and try again.'
          : status.includes('(503)')
            ? 'Owner access is not ready yet. Save the access code, then try again after the site updates.'
            : 'That code does not match this account.',
      );
      setPending(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Owner access</CardTitle>
        <CardDescription>
          Enter the owner access code to turn on admin and paid access for this account. It is not
          your sign-in password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          <label htmlFor="owner-access-code" className="text-sm font-medium">
            Owner access code
          </label>
          <Input
            id="owner-access-code"
            name="code"
            type="password"
            autoComplete="off"
            value={code}
            minLength={12}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending || code.length < 12}>
            {pending ? 'Checking…' : 'Turn on admin access'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
