// @polsia:user-owned
//
// Shared zod schema for a contact message. Safe to import from a 'use client'
// file: no server-only imports, so the client can reuse the input TYPE without
// pulling in the route handler or Prisma.

import { z } from 'zod';

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Please enter your name.')
    .max(120, 'Please keep your name under 120 characters.'),
  email: z
    .string()
    .trim()
    .min(1, 'Please enter your email address.')
    .max(254, 'Please enter a shorter email address.')
    .email('Please enter a valid email address.'),
  message: z
    .string()
    .trim()
    .min(1, 'Please enter a question.')
    .max(5000, 'Please keep your question under 5,000 characters.'),
});

export const contactResponseSchema = z.object({ ok: z.literal(true) });

export type ContactInput = z.infer<typeof contactSchema>;
