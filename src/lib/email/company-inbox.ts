// @polsia:user-owned — company notification recipient.
// The retired Polsia inbox is never a destination. No replacement address is invented.

const RETIRED_INBOX = 'docketkite-8vdtwl@polsia.app';

/** Inbox for a company notification, or undefined when there is nowhere to send. */
export function companyNotificationInbox(address: string | undefined): string | undefined {
  const to = address?.trim();
  if (!to) return undefined;
  if (to.toLowerCase() === RETIRED_INBOX) return undefined;
  return to;
}
