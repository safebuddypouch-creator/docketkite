// @polsia:user-owned — City of Tampa permit CSV row validation and identity keys.
import {
  PermitFields,
  PermitPortalUrlRequired,
  PermitStatus,
  PermitType,
} from '@/lib/contracts/permit';
import type { RowValidation } from '@/modules/csv-import/validation';

export type PermitImportRow = ReturnType<typeof PermitFields.parse>;
const permitFieldKeys: Record<string, string> = {
  projectName: 'project_name',
  address: 'job_address',
  permitNumber: 'permit_number',
  permitType: 'permit_type',
  status: 'status',
  notes: 'notes',
  portalUrl: 'portal_url',
};

function normalizedKeyPart(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .normalize('NFC');
}

export function permitImportKey(row: PermitImportRow): string {
  const permitNumber = normalizedKeyPart(row.permitNumber);
  if (permitNumber) return `number:${encodeURIComponent(permitNumber)}`;

  const fields = [row.projectName, row.address, row.permitType]
    .map((value) => encodeURIComponent(normalizedKeyPart(value)))
    .join('|');
  return `fields:${fields}`;
}

export type PermitImportKeyLookup =
  | { kind: 'number'; permitNumber: string }
  | { kind: 'fields'; projectName: string; address: string; permitType: string };

export function parsePermitImportKey(key: string): PermitImportKeyLookup | null {
  if (key.startsWith('number:')) {
    try {
      return { kind: 'number', permitNumber: decodeURIComponent(key.slice('number:'.length)) };
    } catch {
      return null;
    }
  }

  if (key.startsWith('fields:')) {
    const [projectName, address, permitType, ...extra] = key
      .slice('fields:'.length)
      .split('|')
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return null;
        }
      });
    if (!projectName || !address || !permitType || extra.length > 0) return null;
    return { kind: 'fields', projectName, address, permitType };
  }

  return null;
}

export function parsePermitImportRow(raw: Record<string, string>): RowValidation<PermitImportRow> {
  if (raw.permit_type?.trim() && !PermitType.safeParse(raw.permit_type.trim()).success) {
    return {
      ok: false,
      issues: [
        {
          field: 'permit_type',
          message: `Use one of these permit types: ${PermitType.options.join(', ')}.`,
        },
      ],
    };
  }
  if (raw.status?.trim() && !PermitStatus.safeParse(raw.status.trim()).success) {
    return {
      ok: false,
      issues: [
        {
          field: 'status',
          message: `Use one of these statuses: ${PermitStatus.options.join(', ')}.`,
        },
      ],
    };
  }

  const parsed = PermitFields.safeParse({
    projectName: raw.project_name ?? '',
    address: raw.job_address ?? '',
    permitNumber: raw.permit_number ?? '',
    permitType: raw.permit_type ?? '',
    status: raw.status ?? '',
    notes: raw.notes ?? '',
    portalUrl: raw.portal_url ?? '',
  });

  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        field: typeof issue.path[0] === 'string' ? (permitFieldKeys[issue.path[0]] ?? null) : null,
        message: issue.message,
      })),
    };
  }

  const portal = PermitPortalUrlRequired.safeParse(parsed.data.portalUrl);
  if (!portal.success) {
    return {
      ok: false,
      issues: [
        {
          field: 'portal_url',
          message: 'Every imported permit must include a direct City of Tampa Building record URL.',
        },
      ],
    };
  }

  return { ok: true, value: { ...parsed.data, portalUrl: portal.data } };
}
