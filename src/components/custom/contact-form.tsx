// @polsia:user-owned
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { contactResponseSchema } from '@/lib/contact/schema';

// Composes the template's base shadcn primitives (Button/Input/Label/Textarea)
// styled through the theme tokens. Restyle via the brand_tokens slot + cva
// variants, or pull more primitives with `npx shadcn add` and compose them.
export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    setSubmitError(null);
    try {
      await apiFetch('/api/contact', {
        method: 'POST',
        body: JSON.stringify({ name, email, message }),
        schema: contactResponseSchema,
      });
      setOk(true);
    } catch (err) {
      const cause = (
        err as {
          cause?: {
            errors?: { name?: string; email?: string; message?: string; form?: string };
          };
        }
      ).cause;
      setErrors({
        name: cause?.errors?.name,
        email: cause?.errors?.email,
        message: cause?.errors?.message,
      });
      setSubmitError(
        cause?.errors?.form ??
          (!cause?.errors
            ? 'We could not send your question just now. Please try again shortly.'
            : null),
      );
    } finally {
      setPending(false);
    }
  }

  if (ok) {
    return (
      <output
        className="block rounded-md border border-primary/25 bg-primary/[0.045] px-4 py-5 text-sm leading-6 text-foreground"
        aria-live="polite"
        tabIndex={-1}
      >
        <p className="font-semibold">Your question was sent.</p>
        <p className="mt-1 text-muted-foreground">
          Thanks for reaching out. The DocketKite team can reply to the email address you provided.
        </p>
      </output>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <Label htmlFor="contact-name">Name</Label>
      <Input
        id="contact-name"
        name="name"
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        aria-invalid={Boolean(errors.name)}
        aria-describedby={errors.name ? 'contact-name-error' : undefined}
      />
      {errors.name ? (
        <p id="contact-name-error" className="text-sm text-destructive">
          {errors.name}
        </p>
      ) : null}
      <Label htmlFor="contact-email">Email address</Label>
      <Input
        id="contact-email"
        name="email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        aria-invalid={Boolean(errors.email)}
        aria-describedby={errors.email ? 'contact-email-error' : undefined}
      />
      {errors.email ? (
        <p id="contact-email-error" className="text-sm text-destructive">
          {errors.email}
        </p>
      ) : null}
      <Label htmlFor="contact-message">Message</Label>
      <Textarea
        id="contact-message"
        name="message"
        placeholder="What would you like to know?"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        aria-invalid={Boolean(errors.message)}
        aria-describedby={errors.message ? 'contact-message-error' : undefined}
      />
      {errors.message ? (
        <p id="contact-message-error" className="text-sm text-destructive">
          {errors.message}
        </p>
      ) : null}
      {submitError ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {submitError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Send question'}
      </Button>
    </form>
  );
}
