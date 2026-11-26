// @polsia:user-owned — your email templates. Edit, add, or delete freely.
// Each template returns { subject, html, text }; send it via the framework transport:
//   import { sendEmail } from '@/lib/email/send';
//   import { welcomeEmail } from '@/lib/email/templates';
//   await sendEmail({ to: user.email, ...welcomeEmail({ name: user.name }) });
// renderEmail() is a plain inline-styled shell — email clients drop <style>/<link>, so style inline.
// renderEmail() auto-escapes its heading/body/cta/footer, so pass RAW values (don't escapeHtml() them
// first — that double-escapes). escapeHtml() is only for when you hand-build an html string yourself.

/** Subject + rendered bodies — spread into sendEmail({ to, ... }). */
export interface EmailContent {
  subject: string;
  html: string;
  text?: string;
}

export interface RenderEmailOptions {
  heading: string;
  /** Body paragraphs (plain text; escaped for you). */
  body: string[];
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional footer line under the divider. */
  footer?: string;
}

/** Escape a value for safe interpolation into an HTML attribute or text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap content in a minimal, inline-styled email shell. Restyle to match the brand. */
export function renderEmail(options: RenderEmailOptions): { html: string; text: string } {
  const paragraphs = options.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;color:#333333;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`,
    )
    .join('');
  const button = options.cta
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(options.cta.url)}" style="display:inline-block;padding:10px 20px;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;">${escapeHtml(options.cta.label)}</a></p>`
    : '';
  const footer = options.footer
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;color:#999999;font-size:12px;">${escapeHtml(options.footer)}</div>`
    : '';
  const html = [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;">',
    `<h1 style="margin:0 0 16px;color:#111111;font-size:22px;">${escapeHtml(options.heading)}</h1>`,
    paragraphs,
    button,
    footer,
    '</div>',
  ].join('');
  const text = [
    options.heading,
    '',
    ...options.body,
    ...(options.cta ? ['', `${options.cta.label}: ${options.cta.url}`] : []),
    ...(options.footer ? ['', options.footer] : []),
  ].join('\n');
  return { html, text };
}

// ─── Example templates — edit / add / remove to fit the app ───

/** Welcome email for a new signup. */
export function welcomeEmail(input: { name: string; ctaUrl?: string }): EmailContent {
  const { html, text } = renderEmail({
    heading: `Welcome, ${input.name}!`,
    body: ["Thanks for signing up — we're glad you're here."],
    cta: input.ctaUrl ? { label: 'Get started', url: input.ctaUrl } : undefined,
    footer: 'You received this because you created an account.',
  });
  return { subject: 'Welcome aboard', html, text };
}

/** Generic notification email. */
export function notificationEmail(input: {
  subject: string;
  title: string;
  lines: string[];
  cta?: { label: string; url: string };
}): EmailContent {
  const { html, text } = renderEmail({ heading: input.title, body: input.lines, cta: input.cta });
  return { subject: input.subject, html, text };
}

/** Email invitation for a project manager to join one DocketKite team. */
export function teamManagerInvitationEmail(input: {
  teamName: string;
  inviterName: string;
  inviteUrl: string;
}): EmailContent {
  const { html, text } = renderEmail({
    heading: `Join ${input.teamName} on DocketKite`,
    body: [
      `${input.inviterName} invited you to join this private team workspace as a project manager.`,
      'Create an account or sign in with the email address that received this invitation. The link expires in 7 days.',
      'Project manager access is limited to this team and does not include owner or admin controls.',
    ],
    cta: { label: 'Review team invitation', url: input.inviteUrl },
    footer: 'If you were not expecting this invitation, you can ignore this email.',
  });
  return { subject: `Project manager invitation for ${input.teamName}`, html, text };
}

/** Email invitation for a separately verified test owner of the one test workspace. */
export function teamTestingOwnerInvitationEmail(input: {
  teamName: string;
  inviterName: string;
  inviteUrl: string;
}): EmailContent {
  const { html, text } = renderEmail({
    heading: `Join ${input.teamName} as its test owner`,
    body: [
      `${input.inviterName} invited you to own this private DocketKite testing workspace.`,
      'Create or sign in to your account with the email address that received this invitation, then verify that email before accepting. The link expires in 7 days.',
      'This grants owner access to this testing workspace only. It does not make your account an app admin or unlock other teams.',
    ],
    cta: { label: 'Review testing workspace invitation', url: input.inviteUrl },
    footer: 'If you were not expecting this invitation, you can ignore this email.',
  });
  return { subject: `Test workspace invitation for ${input.teamName}`, html, text };
}

/** Notify a team's project managers after a permit status has been saved. */
export function permitStatusChangedEmail(input: {
  teamName: string;
  projectName: string;
  address: string;
  previousStatus: string;
  status: string;
  permitUrl: string;
}): EmailContent {
  return notificationEmail({
    subject: `Permit status changed: ${input.projectName}`,
    title: 'Permit status updated',
    lines: [
      `${input.teamName}: ${input.projectName}`,
      `Status changed from ${input.previousStatus} to ${input.status}.`,
      `Job address: ${input.address}`,
    ],
    cta: { label: 'View permit in DocketKite', url: input.permitUrl },
  });
}

/** Notify only the assigned project manager about a newly observed public portal status. */
export function permitPortalStatusDetectedEmail(input: {
  projectName: string;
  permitNumber: string;
  previousStatus: string;
  status: string;
  checkedAt: Date;
  sourceUrl: string;
  correctionChecklist: string[];
}): EmailContent {
  return notificationEmail({
    subject: `Public permit status changed: ${input.projectName}`,
    title: 'A public permit status changed',
    lines: [
      `${input.projectName}${input.permitNumber ? ` · Permit ${input.permitNumber}` : ''}`,
      `Detected public status: ${input.status}`,
      `Record Status changed from ${input.previousStatus} to ${input.status}.`,
      `Checked at (UTC): ${input.checkedAt.toISOString()}`,
      ...(input.correctionChecklist.length > 0
        ? [
            'Correction checklist from the confirmed letter:',
            ...input.correctionChecklist.map((item, index) => `${index + 1}. ${item}`),
          ]
        : ['No confirmed correction-letter checklist is saved for this permit.']),
      `Official Florida Accela record: ${input.sourceUrl}`,
    ],
    cta: { label: 'Open official City of Tampa record', url: input.sourceUrl },
  });
}

/** Notify each team owner when a saved public permit check interrupts monitoring. */
export function permitMonitoringInterruptedEmail(input: {
  projectName: string;
  permitNumber: string;
  result: 'unavailable' | 'unverified';
  reason: string;
  checkedAt: Date;
  permitUrl: string;
}): EmailContent {
  const reference = input.permitNumber.trim()
    ? `Permit ${input.permitNumber.trim()}`
    : input.projectName;
  return notificationEmail({
    subject: `Permit monitoring interrupted: ${input.permitNumber.trim() || input.projectName}`,
    title: 'Permit monitoring interrupted',
    lines: [
      reference,
      `Saved outcome: ${input.result}`,
      `Reason: ${input.reason}`,
      `Checked at (UTC): ${input.checkedAt.toISOString()}`,
    ],
    cta: { label: 'Open private permit', url: input.permitUrl },
  });
}

/** Notify the assigned same-team project manager when a correction checklist is created. */
export function permitCorrectionChecklistCreatedEmail(input: {
  permitReference: string;
  projectName: string;
  permitNumber: string;
  checklistUrl: string;
}): EmailContent {
  return notificationEmail({
    subject: `Correction checklist created: ${input.permitReference}`,
    title: 'A correction checklist is ready',
    lines: [
      input.permitNumber
        ? `A correction checklist was created for permit ${input.permitNumber}.`
        : `A correction checklist was created for ${input.projectName}.`,
      ...(input.permitNumber ? [`Project: ${input.projectName}`] : []),
    ],
    cta: { label: 'Open correction checklist', url: input.checklistUrl },
  });
}
