import { describe, expect, it } from 'vitest';
import { CSV_EXPORT_LIMITS } from '@/modules/csv-export/contracts';
import {
  CsvAccessError,
  defineCsvSource,
} from '@/modules/csv-export/server';

interface SampleRow {
  id: string;
  value: string;
}

function createSource(rows: readonly SampleRow[]) {
  let requestedLimit = 0;
  const source = defineCsvSource<SampleRow, { teamId: string }>({
    id: 'sample',
    label: 'Sample export',
    schemaVersion: '1',
    columns: [
      {
        key: 'value',
        label: 'Value',
        kind: 'text',
        access: 'readonly',
        nullable: false,
        serialize: (row) => row.value,
      },
    ],
    parseFilters: (raw) =>
      raw && typeof raw === 'object' && 'teamId' in raw && typeof raw.teamId === 'string'
        ? { ok: true, value: { teamId: raw.teamId } }
        : { ok: false },
    authorizeColumns: async () => ['value'],
    keyOf: (row) => row.id,
    versionOf: () => 'v1',
    readRows: async ({ limit }) => {
      requestedLimit = limit;
      return rows;
    },
  });
  return { source, getRequestedLimit: () => requestedLimit };
}

const context = { actorId: 'user-a', scopeId: 'team-a' };

describe('CSV export module contract', () => {
  it('requests one extra scoped row and rejects exports above 10,000 records', async () => {
    const { source, getRequestedLimit } = createSource(
      Array.from({ length: CSV_EXPORT_LIMITS.records + 1 }, (_, index) => ({
        id: `permit-${index}`,
        value: `record-${index}`,
      })),
    );

    await expect(
      source.export({ filters: { teamId: 'team-a' } }, context),
    ).rejects.toMatchObject({ code: 'ROW_LIMIT' });
    expect(getRequestedLimit()).toBe(10_001);
    expect(CSV_EXPORT_LIMITS.records).toBe(10_000);
  });

  it('rejects generated CSV above 10 MiB without truncating it', async () => {
    const rows = Array.from({ length: 700 }, (_, index) => ({
      id: `permit-${index}`,
      value: 'x'.repeat(15_000),
    }));
    const { source } = createSource(rows);

    await expect(source.export({ filters: { teamId: 'team-a' } }, context)).rejects.toMatchObject({
      code: 'BYTE_LIMIT',
    });
    expect(CSV_EXPORT_LIMITS.bytes).toBe(10 * 1024 * 1024);
  });

  it('rejects fields outside the source column permissions', async () => {
    const { source } = createSource([{ id: 'permit-a', value: 'visible' }]);

    await expect(
      source.export({ filters: { teamId: 'team-a' }, columns: ['other_field'] }, context),
    ).rejects.toBeInstanceOf(CsvAccessError);
  });
});
