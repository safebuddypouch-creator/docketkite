'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { useIsAdmin, useSession } from '@/lib/auth-client';
import { OwnerAccessEligibility } from '@/lib/contracts/owner-access';

export function OwnerAccessCode() {
  const isAdmin = useIsAdmin();
  const { data: session } = useSession();
  const [eligible, setEligible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const user = session?.user;

  useEffect(() => {
    let mounted = true;
    if (isAdmin || !user) {
      setEligible(false);
      setChecking(false);
      return;
    }

    setChecking(true);
    void apiFetch('/api/account/owner-access', { schema: OwnerAccessEligibility })
      .then((result) => {
        if (mounted) setEligible(result.eligible);
      })
      .catch(() => {
        if (mounted) setEligible(false);
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });

    return () => {
      mounted = false;
    };
  }, [isAdmin, user]);

  if (isAdmin || checking || !eligible) return null;

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
          your sign-in password. Invited teammates do not use this code.
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
