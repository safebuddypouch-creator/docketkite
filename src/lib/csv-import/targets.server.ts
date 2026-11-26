// @polsia:user-owned — owner-only, paid, team-scoped permit CSV destination.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { auth } from '@/lib/auth';
import {
  type PermitImportRow,
  parsePermitImportKey,
  parsePermitImportRow,
  permitImportKey,
} from '@/lib/business/permit-csv-import';
import { prisma } from '@/lib/db';
import { getTeamAccessState } from '@/lib/team-access';
import { CsvAccessError, defineCsvTarget } from '@/modules/csv-import/server';

const selectedTeamHeader = 'x-docketkite-csv-team-id';
const importBatchSize = 500;

const fields = [
  {
    key: 'project_name',
    label: 'Project name',
    required: true,
    aliases: ['project name', 'project'],
    example: 'Sample kitchen remodel',
  },
  {
    key: 'job_address',
    label: 'Job address',
    required: true,
    aliases: ['job address', 'address'],
    example: '100 Sample Street, Tampa, FL (sample)',
  },
  {
    key: 'permit_number',
    label: 'Permit number',
    required: false,
    aliases: ['permit number', 'permit no'],
    example: 'SAMPLE-001',
  },
  {
    key: 'permit_type',
    label: 'Permit type',
    required: true,
    aliases: ['permit type', 'type'],
    example: 'Building',
  },
  {
    key: 'status',
    label: 'Status',
    required: true,
    example: 'Planning',
  },
  {
    key: 'notes',
    label: 'Notes',
    required: false,
    example: 'Sample record only.',
  },
  {
    key: 'portal_url',
    label: 'Florida Accela Building record URL',
    // A column is optional to map so preview can report each missing row URL.
    // parsePermitImportRow still rejects every row without a valid direct record link.
    required: false,
    aliases: ['portal url', 'permit portal url', 'record url'],
    example: '',
  },
];

type PermitImportDb = Pick<typeof prisma, 'permit' | 'permitImportIdentity'>;

function whereForImportKeys(teamId: string, keys: readonly string[]) {
  const lookups = keys.flatMap((key) => {
    const parsed = parsePermitImportKey(key);
    return parsed ? [parsed] : [];
  });
  const permitNumbers = lookups.flatMap((lookup) =>
    lookup.kind === 'number' ? [lookup.permitNumber] : [],
  );
  const fallbackMatches = lookups.flatMap((lookup) =>
    lookup.kind === 'fields'
      ? [
          {
            projectName: { equals: lookup.projectName, mode: 'insensitive' as const },
            permitType: { equals: lookup.permitType, mode: 'insensitive' as const },
          },
        ]
      : [],
  );
  const OR = [
    ...(permitNumbers.length > 0
      ? [{ permitNumber: { in: permitNumbers, mode: 'insensitive' as const } }]
      : []),
    ...fallbackMatches,
  ];
  return OR.length > 0 ? { teamId, OR } : null;
}

async function findExistingKeys(
  db: PermitImportDb,
  keys: readonly string[],
  teamId: string,
): Promise<string[]> {
  if (keys.length === 0) return [];

  const existing = new Set(
    (
      await db.permitImportIdentity.findMany({
        where: { teamId, sourceKey: { in: [...keys] } },
        select: { sourceKey: true },
      })
    ).map((identity) => identity.sourceKey),
  );
  const permitWhere = whereForImportKeys(teamId, keys);
  if (permitWhere) {
    const permits = await db.permit.findMany({
      where: permitWhere,
      select: { projectName: true, address: true, permitNumber: true, permitType: true },
    });
    for (const permit of permits) {
      const key = permitImportKey({
        projectName: permit.projectName,
        address: permit.address,
        permitNumber: permit.permitNumber,
        permitType: permit.permitType as PermitImportRow['permitType'],
        status: 'Planning',
        notes: '',
        portalUrl: '',
      });
      if (keys.includes(key)) existing.add(key);
    }
  }
  return [...existing];
}

export const csvImportTargets = [
  defineCsvTarget<PermitImportRow>({
    id: 'tampa-city-permits',
    label: 'State of Florida Accela permits',
    fields,
    parseRow: parsePermitImportRow,
    keyOf: permitImportKey,
    findExistingKeys: async (keys, context) => findExistingKeys(prisma, keys, context.scopeId),
    insertNewRows: async (rows, context) => {
      let created = 0;
      await prisma.$transaction(
        async (transaction) => {
          for (let offset = 0; offset < rows.length; offset += importBatchSize) {
            const batch = rows.slice(offset, offset + importBatchSize);
            const keys = batch.map(permitImportKey);
            const existing = new Set(await findExistingKeys(transaction, keys, context.scopeId));
            const candidates = batch.flatMap((row, index) => {
              const key = keys[index];
              return key === undefined || existing.has(key) ? [] : [{ row, key, id: randomUUID() }];
            });
            if (candidates.length === 0) continue;

            await transaction.permit.createMany({
              data: candidates.map(({ row, id }) => ({
                id,
                userId: context.actorId,
                teamId: context.scopeId,
                projectName: row.projectName,
                address: row.address,
                permitNumber: row.permitNumber,
                permitType: row.permitType,
                status: row.status,
                notes: row.notes,
                portalUrl: row.portalUrl || null,
              })),
            });
            await transaction.permitImportIdentity.createMany({
              data: candidates.map(({ id, key }) => ({
                teamId: context.scopeId,
                sourceKey: key,
                permitId: id,
              })),
              skipDuplicates: true,
            });

            const identities = await transaction.permitImportIdentity.findMany({
              where: {
                teamId: context.scopeId,
                sourceKey: { in: candidates.map(({ key }) => key) },
              },
              select: { sourceKey: true, permitId: true },
            });
            const identityByKey = new Map(
              identities.map((identity) => [identity.sourceKey, identity.permitId]),
            );
            const winners = candidates.filter(({ id, key }) => identityByKey.get(key) === id);
            const losingPermitIds = candidates
              .filter(({ id, key }) => identityByKey.get(key) !== id)
              .map(({ id }) => id);
            if (losingPermitIds.length > 0) {
              await transaction.permit.deleteMany({
                where: { id: { in: losingPermitIds }, teamId: context.scopeId },
              });
            }
            created += winners.length;
          }
        },
        { timeout: 60_000 },
      );
      return { created, skipped: rows.length - created };
    },
  }),
];

export async function authorizeCsvImport(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new CsvAccessError(401, 'Sign in to import permits.');

  const teamId = request.headers.get(selectedTeamHeader)?.trim();
  if (!teamId) throw new CsvAccessError(403, 'Select a team before importing permits.');

  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: session.user.id } },
    select: { role: true },
  });
  if (!membership || membership.role !== 'owner') {
    throw new CsvAccessError(403, 'Only a team owner can import permits.');
  }

  const access = await getTeamAccessState(teamId, session.user.id);
  if (!access.accessActive) {
    throw new CsvAccessError(403, 'An active team subscription is required to import permits.');
  }

  return { actorId: session.user.id, scopeId: teamId };
}
