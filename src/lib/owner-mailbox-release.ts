// @polsia:user-owned — drop an unverified signup that is sitting on the owner address.
import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

function isMissingRecord(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  );
}

/**
 * Deletes the unverified user for POLSIA_OWNER_EMAIL so the real mailbox can sign up.
 * A verified owner is never removed. Other addresses are ignored.
 * Sessions and accounts cascade; verification rows for that mailbox are removed too.
 * A second concurrent delete is ignored.
 */
export async function releaseUnverifiedOwnerMailbox(rawEmail: string): Promise<void> {
  const ownerEmail = env.POLSIA_OWNER_EMAIL?.trim().toLowerCase();
  const email = rawEmail.trim().toLowerCase();
  if (!ownerEmail || email !== ownerEmail) return;

  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; email: string }>>`
        SELECT id, email
        FROM "user"
        WHERE lower(email) = ${ownerEmail}
          AND "emailVerified" = false
        FOR UPDATE
      `;

      for (const row of rows) {
        const stored = await tx.user.findUnique({
          where: { id: row.id },
          select: { id: true, email: true, emailVerified: true },
        });
        if (!stored || stored.emailVerified) continue;
        if (stored.email.trim().toLowerCase() !== ownerEmail) continue;

        await tx.session.deleteMany({ where: { userId: stored.id } });
        await tx.account.deleteMany({ where: { userId: stored.id } });
        await tx.verification.deleteMany({
          where: {
            OR: [
              { identifier: { equals: stored.email, mode: 'insensitive' } },
              { identifier: { endsWith: `:${stored.email}`, mode: 'insensitive' } },
              { identifier: { endsWith: `-${stored.email}`, mode: 'insensitive' } },
              { value: stored.id },
            ],
          },
        });
        await tx.user.delete({ where: { id: stored.id } });
      }
    });
  } catch (error) {
    // The other signup already removed this unverified row. Roll back with it.
    if (!isMissingRecord(error)) throw error;
  }
}
