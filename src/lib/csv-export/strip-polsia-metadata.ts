// @polsia:user-owned — remove framework Polsia metadata columns from permit CSV downloads.

const POLSIA_METADATA_COLUMN_COUNT = 6;

/**
 * Drops the leading `__polsia_*` metadata columns (and their `polsia-csv-v2`
 * values) so the downloaded file only has human permit fields.
 */
export function stripPolsiaCsvMetadata(csv: string): string {
  const hasBom = csv.startsWith('\uFEFF');
  const body = hasBom ? csv.slice(1) : csv;
  if (!body) return csv;

  const lines = body.split('\r\n');
  // Trailing empty segment from a final CRLF should be preserved as an empty line.
  const rewritten = lines.map((line, index) => {
    if (line === '' && index === lines.length - 1) return '';
    return dropLeadingColumns(line, POLSIA_METADATA_COLUMN_COUNT);
  });

  return `${hasBom ? '\uFEFF' : ''}${rewritten.join('\r\n')}`;
}

function dropLeadingColumns(line: string, count: number): string {
  if (!line || count <= 0) return line;
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.slice(count).join(',');
}
