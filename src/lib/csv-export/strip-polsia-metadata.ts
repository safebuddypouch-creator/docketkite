// @polsia:user-owned — remove framework Polsia metadata columns from permit CSV downloads.

const POLSIA_METADATA_HEADERS = [
  '__polsia_format',
  '__polsia_source',
  '__polsia_schema',
  '__polsia_scope',
  '__polsia_key',
  '__polsia_version',
] as const;

/**
 * Drops the leading `__polsia_*` metadata columns (and their `polsia-csv-v2`
 * values) so the downloaded file only has human permit fields.
 */
export function stripPolsiaCsvMetadata(csv: string): string {
  const hasBom = csv.startsWith('\uFEFF');
  const body = hasBom ? csv.slice(1) : csv;
  if (!body) return csv;

  const lines = body.split('\r\n');
  const headerLine = lines[0] ?? '';
  const headers = parseCsvLine(headerLine);
  const hasPolsiaMetadata =
    headers.length >= POLSIA_METADATA_HEADERS.length &&
    POLSIA_METADATA_HEADERS.every((name, index) => headers[index] === name);
  if (!hasPolsiaMetadata) return csv;

  const rewritten = lines.map((line, index) => {
    if (line === '' && index === lines.length - 1) return '';
    return parseCsvLine(line).slice(POLSIA_METADATA_HEADERS.length).map(quoteCsvCell).join(',');
  });

  return `${hasBom ? '\uFEFF' : ''}${rewritten.join('\r\n')}`;
}

function parseCsvLine(line: string): string[] {
  if (!line) return [];
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
  return cells;
}

function quoteCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
