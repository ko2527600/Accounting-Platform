/**
 * Escapes a single CSV field per RFC 4180: wraps in quotes and doubles any
 * embedded quotes whenever the value contains a comma, quote, or newline.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a CSV document (with a header row) from an array of header names
 * and an array of same-length-ordered row arrays.
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Renders an AuditLog `changes` diff ({field: {from, to}}) as the same
 * "field: from → to" text the in-app Changes column already shows, instead
 * of a raw JSON blob - one line per field, semicolon-separated.
 */
export function formatAuditChanges(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return '';
  const entries = Object.entries(changes as Record<string, { from: unknown; to: unknown }>);
  if (entries.length === 0) return '';
  return entries
    .map(([field, diff]) => `${field}: ${diff?.from ?? '—'} → ${diff?.to ?? '—'}`)
    .join('; ');
}
