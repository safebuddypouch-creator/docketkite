// @polsia:user-owned — shared zod contract for permit records.
import { z } from 'zod';

export const CITY_OF_TAMPA_PERMIT_PORTAL_URL =
  'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?TabName=Building&module=Building';

/** Accela query names vary in casing across search results and shared links. */
function uniqueQueryValue(url: URL, name: string): string | null {
  const matches = [...url.searchParams.entries()].filter(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1) return null;
  const value = matches[0]?.[1]?.trim();
  return value ? value : null;
}

function isOfficialTampaPermitRecordUrl(value: string): boolean {
  const hasWhitespaceOrControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.charCodeAt(0);
    return character.trim() === '' || codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (hasWhitespaceOrControlCharacter || /%(?![0-9a-f]{2})/i.test(value)) return false;

  try {
    const url = new URL(value);
    const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1];
    if (!authority) return false;
    const hostname = url.hostname.toLowerCase();
    const authorityHost = authority.toLowerCase();
    const authorityOk =
      !authority.includes('@') &&
      !authority.includes('\\') &&
      (authorityHost === hostname || authorityHost === `${hostname}:443`);
    if (!authorityOk) return false;
    if (url.port && url.port !== '443') return false;
    const labels = hostname.split('.');
    if (
      hostname.length > 253 ||
      labels.some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
    ) {
      return false;
    }
    const hasRecordIds = ['capID1', 'capID2', 'capID3'].every(
      (name) => uniqueQueryValue(url, name) !== null,
    );
    const agencyCode = uniqueQueryValue(url, 'agencyCode');
    const module = uniqueQueryValue(url, 'Module');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      hostname === 'aca-prod.accela.com' &&
      url.pathname.toLowerCase() === '/tampa/cap/capdetail.aspx' &&
      agencyCode?.toUpperCase() === 'TAMPA' &&
      module?.toLowerCase() === 'building' &&
      hasRecordIds
    );
  } catch {
    return false;
  }
}

export const PermitPortalUrl = z
  .string()
  .trim()
  .max(2048, 'Use 2,048 characters or fewer')
  .refine(
    (value) => value === '' || isOfficialTampaPermitRecordUrl(value),
    'Enter a direct City of Tampa Building record URL from the official Accela portal.',
  );

export const PermitPortalUrlRequired = PermitPortalUrl.refine(
  (value) => value.length > 0,
  'A direct public City record URL is required for a public-record check.',
);

export const PermitPortalUrlUpdate = z.object({ portalUrl: PermitPortalUrlRequired });
export const PermitPortalUrlMutationResponse = z.object({
  id: z.string(),
  portalUrl: z.string(),
});

/** Returns the normalized supported URL, or null for an empty/unsupported saved value. */
export function getOfficialPermitPortalUrl(value: string): string | null {
  if (!value || value !== value.trim()) return null;
  const parsed = PermitPortalUrl.safeParse(value);
  return parsed.success && parsed.data === value ? parsed.data : null;
}

export const PermitType = z.enum(['Building', 'Electrical', 'Plumbing', 'Mechanical', 'Other']);
export const PermitStatus = z.enum([
  'Planning',
  'Ready to submit',
  'Submitted',
  'Under review',
  'Corrections requested',
  'Issued',
]);
export type PermitStatus = z.infer<typeof PermitStatus>;

export const PermitFields = z.object({
  projectName: z
    .string()
    .trim()
    .min(1, 'Enter a project name')
    .max(120, 'Use 120 characters or fewer'),
  address: z
    .string()
    .trim()
    .min(1, 'Enter the job address')
    .max(200, 'Use 200 characters or fewer'),
  permitNumber: z.string().trim().max(80, 'Use 80 characters or fewer'),
  permitType: PermitType,
  status: PermitStatus,
  notes: z.string().trim().max(1000, 'Use 1,000 characters or fewer'),
  portalUrl: PermitPortalUrl.default(''),
});

// Existing permits remain parseable/editable when their reference or portal URL is blank.
// New monitored records require both values so the on-demand public check has its inputs.
export const PermitCreateFields = PermitFields.extend({
  permitNumber: z
    .string()
    .trim()
    .min(1, 'Enter the permit reference shown on the City record')
    .max(80, 'Use 80 characters or fewer'),
  portalUrl: PermitPortalUrlRequired,
});

export const PermitCreate = PermitCreateFields.extend({ teamId: z.string().min(1) });
export type PermitCreateFields = z.infer<typeof PermitCreateFields>;
export type PermitCreateFieldsInput = z.input<typeof PermitCreateFields>;

export const PermitProjectManager = z.object({
  id: z.string(),
  name: z.string(),
});

export const PermitStatusEvent = z.object({
  id: z.string(),
  status: PermitStatus,
  falseAlarmReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const PermitItem = PermitFields.omit({ portalUrl: true }).extend({
  id: z.string(),
  teamId: z.string().min(1),
  // Persisted legacy values must remain loadable so a team can edit and repair them.
  portalUrl: z.string(),
  portalCurrentStatus: z.string().nullable(),
  portalStatusObservedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assignedProjectManager: PermitProjectManager.nullable(),
  statusEvents: z.array(PermitStatusEvent),
});

export const PermitDetailsPage = PermitItem.extend({
  canEditDetails: z.boolean(),
  projectManagers: z.array(PermitProjectManager),
});

export const PermitDetailsUpdate = z
  .object({
    teamId: z.string().min(1),
    permitNumber: z.string().trim().max(80, 'Use 80 characters or fewer'),
    address: z
      .string()
      .trim()
      .min(1, 'Enter the job address')
      .max(200, 'Use 200 characters or fewer'),
  })
  .strict();

export const PermitDetailsMutationResponse = z.object({
  id: z.string(),
  permitNumber: z.string(),
  address: z.string(),
});

export const PermitList = z.object({
  items: z.array(PermitItem),
  projectManagers: z.array(PermitProjectManager),
});

export const PermitListSort = z.enum(['reference', 'address', 'activity']);
export type PermitListSort = z.infer<typeof PermitListSort>;

export const PermitMonitoringOutcome = z.enum(['successful', 'failed', 'not_checked']);
export type PermitMonitoringOutcome = z.infer<typeof PermitMonitoringOutcome>;

export const PermitBulkArchiveResponse = z.object({ archivedCount: z.number().int().positive() });

const PermitBulkArchive = z.object({
  action: z.literal('archiveBulk'),
  teamId: z.string().min(1),
  permitIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .refine((permitIds) => new Set(permitIds).size === permitIds.length, {
      message: 'Select each permit only once.',
    }),
});

export const PermitMutation = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    teamId: z.string().min(1),
    data: PermitFields,
    falseAlarmReason: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('archive'), id: z.string().min(1), teamId: z.string().min(1) }),
  PermitBulkArchive,
  z.object({
    action: z.literal('assign'),
    id: z.string().min(1),
    teamId: z.string().min(1),
    projectManagerUserId: z.string().min(1).nullable(),
  }),
]);

export type PermitFields = z.infer<typeof PermitFields>;
export type PermitFieldsInput = z.input<typeof PermitFields>;
export type PermitItem = z.infer<typeof PermitItem>;
export type PermitDetailsPage = z.infer<typeof PermitDetailsPage>;
export type PermitList = z.infer<typeof PermitList>;
export type PermitMutation = z.infer<typeof PermitMutation>;
export type PermitBulkArchiveResponse = z.infer<typeof PermitBulkArchiveResponse>;
export type PermitPortalUrlMutationResponse = z.infer<typeof PermitPortalUrlMutationResponse>;
export type PermitProjectManager = z.infer<typeof PermitProjectManager>;
export type PermitStatusEvent = z.infer<typeof PermitStatusEvent>;
