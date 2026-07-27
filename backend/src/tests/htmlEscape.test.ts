import { escapeHtml } from '../utils/htmlEscape';

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands, quotes, and apostrophes', () => {
    expect(escapeHtml(`Tom & Jerry's "Shop"`)).toBe('Tom &amp; Jerry&#39;s &quot;Shop&quot;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Acme Consulting Ltd')).toBe('Acme Consulting Ltd');
  });

  it('handles null/undefined by returning an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
