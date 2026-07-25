import { generateQuickStartGuidePdf } from '../services/pdfGenerationService';

/**
 * Minimal extraction of literal text drawn via PDF Tj/TJ show-text operators.
 * pdfkit (with compress: false) writes each text() call as a TJ array of
 * hex-string glyph-code fragments with numeric kerning adjustments *between*
 * fragments, e.g. `[<50726570> 30 <617265642066> ...] TJ`. Concatenating every
 * hex fragment in document order reconstructs the original drawn text well
 * enough to search for known phrases.
 */
function extractDrawnText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const hexTokens = raw.match(/<[0-9a-fA-F]+>/g) || [];
  return hexTokens.map((token) => Buffer.from(token.slice(1, -1), 'hex').toString('latin1')).join('');
}

describe('generateQuickStartGuidePdf', () => {
  it('produces a real multi-section PDF, not the old one-line placeholder stub', async () => {
    const buffer = await generateQuickStartGuidePdf('Acme Retail Ltd', 'Jane Doe');

    // Valid PDF file signature
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // The old hardcoded stub was ~350 bytes containing a single line of text.
    // A real multi-section document renders to several KB.
    expect(buffer.length).toBeGreaterThan(2000);

    const text = extractDrawnText(buffer);
    expect(text).toContain('Acme Retail Ltd');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('Getting Started');
    expect(text).toContain('Chart of Accounts');
    expect(text).toContain('Bank reconciliation');
  });

  it('generates distinct content per tenant rather than a fixed static payload', async () => {
    const bufferA = await generateQuickStartGuidePdf('Tenant A Ltd', 'Alice');
    const bufferB = await generateQuickStartGuidePdf('Tenant B Ltd', 'Bob');

    expect(extractDrawnText(bufferA)).toContain('Tenant A Ltd');
    expect(extractDrawnText(bufferB)).toContain('Tenant B Ltd');
    expect(bufferA.equals(bufferB)).toBe(false);
  });
});
