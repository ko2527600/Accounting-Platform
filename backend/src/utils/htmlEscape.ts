/**
 * Escapes a string for safe interpolation into HTML markup (email templates,
 * broadcast messages) - narrow local helper rather than a new dependency,
 * since the need here is plain-text values in a handful of templates, not
 * general HTML sanitization.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
