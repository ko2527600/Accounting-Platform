import PDFDocument from 'pdfkit';

const BRAND_GREEN = '#059669';
const BRAND_BLUE = '#2563eb';
const INK = '#0f172a';
const MUTED = '#475569';

function addSectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  doc.moveDown(1);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(text);
  doc
    .moveTo(doc.x, doc.y + 4)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
    .strokeColor(BRAND_GREEN)
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(0.8);
}

function addBullet(doc: PDFKit.PDFDocument, title: string, body: string): void {
  const startX = doc.x;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`•  ${title}`, startX);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(10.5)
    .text(body, startX + 16, doc.y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 16 });
  doc.moveDown(0.6);
}

/**
 * Generates the real "Quick Start Guide" PDF sent after a tenant's account is fully
 * verified. Content mirrors the platform's actual onboarding steps and current module
 * set (see STATUS.md/TASKS.md for what's live) rather than being a static placeholder.
 */
export function generateQuickStartGuidePdf(businessName: string, recipientName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

    // --- Cover ---
    doc.rect(0, 0, doc.page.width, 150).fill(INK);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('AccountGo', 56, 50);
    doc
      .fillColor('#a7f3d0')
      .font('Helvetica')
      .fontSize(12)
      .text('Multi-Tenant ERP & Accounting Platform', 56, 80);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(26)
      .text('Quick Start Guide', 56, 105);

    doc.y = 180;
    doc.x = 56;
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(11)
      .text(`Prepared for ${businessName}`, { continued: false });
    doc.text(`Welcome, ${recipientName} — your account is fully verified and active.`);

    // --- Getting Started ---
    addSectionHeading(doc, 'Getting Started');
    addBullet(
      doc,
      '1. Set up your Chart of Accounts',
      'Use the default standard template to get a working set of accounts immediately, or customize it under Accounting > Chart of Accounts to match how your business categorizes income and expenses.'
    );
    addBullet(
      doc,
      '2. Add your shop branches and cash tills',
      'Register each physical location as a warehouse and open a cash till for each point-of-sale counter under Inventory > Warehouses and Cash Till. Each till tracks its own opening balance and daily closeout.'
    );
    addBullet(
      doc,
      '3. Invite your team',
      'Add teammates under Settings > Team with role-based permissions (Admin, Accountant, Cashier, Viewer) so staff only see what their role requires.'
    );

    // --- Feature Overview ---
    addSectionHeading(doc, 'What You Can Do Today');
    addBullet(
      doc,
      'Double-entry bookkeeping',
      'Journal entries, a full general ledger, and live Trial Balance / Profit & Loss / Balance Sheet reports.'
    );
    addBullet(
      doc,
      'Invoicing & vendor bills',
      'Multi-line invoices and bills with automatic tax/total calculation; marking one paid posts a real journal entry to your ledger.'
    );
    addBullet(
      doc,
      'Multi-warehouse inventory',
      'Track stock per location, transfer between warehouses, and see fast-moving vs. dead stock.'
    );
    addBullet(
      doc,
      'Cash till & point of sale',
      'Daily closeouts compare expected vs. counted cash and send an instant SMS alert to your registered phone the moment a till comes up short.'
    );
    addBullet(
      doc,
      'Bank reconciliation',
      'Link a real bank account via Mono Connect to pull statement transactions automatically once your Mono API credentials are configured.'
    );
    addBullet(
      doc,
      'Automated executive reports',
      'Enable a schedule under Settings > Reports to receive weekly Profit & Loss summaries by email automatically.'
    );

    // --- Next steps / links ---
    addSectionHeading(doc, 'Need Help?');
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10.5)
      .text('Sign in any time to continue setup:');
    doc.fillColor(BRAND_BLUE).font('Helvetica-Bold').text(`${appUrl}/login`, { link: `${appUrl}/login`, underline: true });

    doc.moveDown(2);
    doc
      .fillColor('#94a3b8')
      .font('Helvetica')
      .fontSize(8.5)
      .text('Generated automatically by AccountGo ERP for your account activation.', { align: 'left' });

    doc.end();
  });
}
