// @polsia:user-owned — strip Polsia CSV metadata columns from downloads.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { stripPolsiaCsvMetadata } from '@/lib/csv-export/strip-polsia-metadata';

describe('stripPolsiaCsvMetadata', () => {
  it('removes leading Polsia metadata columns from header and rows', () => {
    const csv =
      '\uFEFF"__polsia_format","__polsia_source","__polsia_schema","__polsia_scope","__polsia_key","__polsia_version","permit_number","status"\r\n' +
      `"'polsia-csv-v2","'permits","'1","'team_1","'permit_1","'2026-01-01","'BLD-1","'In Process"\r\n`;

    const cleaned = stripPolsiaCsvMetadata(csv);

    expect(cleaned.startsWith('\uFEFF')).toBe(true);
    expect(cleaned).not.toContain('polsia');
    expect(cleaned).toContain('"permit_number","status"');
    expect(cleaned).toContain(`"'BLD-1","'In Process"`);
  });

  it('leaves already-clean CSVs unchanged aside from line joining', () => {
    const csv = '"permit_number","status"\r\n"\'BLD-1","\'Open"\r\n';
    expect(stripPolsiaCsvMetadata(csv)).toBe(csv);
  });
});
