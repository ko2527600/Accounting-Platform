import PDFDocument from 'pdfkit';

const BRAND_GREEN = '#059669';
const BRAND_BLUE = '#2563eb';
const INK = '#0f172a';
const MUTED = '#475569';

function addSectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  // Always anchor to the page's left margin rather than the carried-over `doc.x`
  // cursor - addBullet() below moves `doc.x` around while drawing wrapped text,
  // and reading a drifted `doc.x` here previously caused the underline (and every
  // bullet drawn after it) to creep progressively further right down the page.
  const leftX = doc.page.margins.left;
  doc.x = leftX;
  doc.moveDown(1);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(text, leftX);
  doc
    .moveTo(leftX, doc.y + 4)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
    .strokeColor(BRAND_GREEN)
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(0.8);
}

function addBullet(doc: PDFKit.PDFDocument, title: string, body: string): void {
  // Same fix as addSectionHeading: use the page's fixed left margin instead of
  // `doc.x`, which drifts after each wrapped-text call and previously caused
  // both a "staircase" indentation bug and text being clipped past the right
  // page edge (the wrap width was computed from the true margin while the text
  // was actually being drawn starting from the drifted, further-right x).
  const leftX = doc.page.margins.left;
  const rightMargin = doc.page.margins.right;
  doc.x = leftX;
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(`•  ${title}`, leftX, doc.y, { width: doc.page.width - leftX - rightMargin });
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(10.5)
    .text(body, leftX + 16, doc.y, { width: doc.page.width - leftX - rightMargin - 16 });
  doc.moveDown(0.6);
  doc.x = leftX;
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
      .text('Ledgio', 56, 50);
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

    // --- Core Day-to-Day Features ---
    addSectionHeading(doc, 'Core Day-to-Day Features');
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

    // --- Automation & Compliance Features ---
    addSectionHeading(doc, 'Automation & Compliance Features');
    addBullet(
      doc,
      'Tax rates',
      'Configure your own tax rates under Settings > Tax Rates; invoices automatically apply the correct active rate for the sale date.'
    );
    addBullet(
      doc,
      'Fiscal periods & budgets',
      'Open, close, and lock accounting periods under Settings > Fiscal Periods, and track budget vs. actual spend per account under Reports > Budgets.'
    );
    addBullet(
      doc,
      'Recurring transactions',
      'Set up recurring journal entries for rent, subscriptions, or payroll accruals under Settings > Recurring Transactions and they post automatically on schedule.'
    );
    addBullet(
      doc,
      'Approval workflows',
      'Require sign-off before a journal entry, invoice, or bill posts by requesting an approval under Approvals in the sidebar.'
    );
    addBullet(
      doc,
      'Multi-currency support',
      'Set your business\'s base currency at signup; transactions entered in other currencies convert automatically once live exchange rates are configured.'
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
    addBullet(
      doc,
      'AI-assisted categorization',
      'Get smart category suggestions while building journal entries to speed up everyday bookkeeping.'
    );
    addBullet(
      doc,
      'Custom fields',
      'Extend Ledgers, Invoices, and other records with your own custom fields under Settings (availability depends on your subscription tier).'
    );

    // --- Next steps / links ---
    addSectionHeading(doc, 'Need Help?');
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10.5)
      .text('Sign in any time to continue setup:');
    doc.fillColor(BRAND_BLUE).font('Helvetica-Bold').text(`${appUrl}/login`, { link: `${appUrl}/login`, underline: true });
    doc.moveDown(0.6);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10.5)
      .text('Tip: install Ledgio to your phone or desktop home screen for one-tap access — look for the Install App section on our homepage.');

    doc.moveDown(2);
    doc
      .fillColor('#94a3b8')
      .font('Helvetica')
      .fontSize(8.5)
      .text('Generated automatically by Ledgio ERP for your account activation.', { align: 'left' });

    doc.end();
  });
}

interface TableColumn {
  header: string;
  width: number;
}

/**
 * Draws a ruled table with a header row, handling page breaks by redrawing
 * the header on each new page. Cells are single-line (ellipsized if too long
 * for their column) - callers must size columns for their expected content.
 */
function drawSimpleTable(
  doc: PDFKit.PDFDocument,
  columns: TableColumn[],
  rows: string[][],
  opts: { rowHeight?: number } = {}
): void {
  const rowHeight = opts.rowHeight || 26;
  const leftX = doc.page.margins.left;
  const rightX = doc.page.width - doc.page.margins.right;
  const bottomY = doc.page.height - doc.page.margins.bottom;

  function drawHeaderRow(): void {
    const headerY = doc.y;
    doc.rect(leftX, headerY, rightX - leftX, rowHeight).fill(INK);
    let x = leftX;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
    for (const col of columns) {
      doc.text(col.header, x + 6, headerY + rowHeight / 2 - 5, { width: col.width - 12, ellipsis: true });
      x += col.width;
    }
    doc.y = headerY + rowHeight;
    doc.x = leftX;
  }

  drawHeaderRow();

  for (const row of rows) {
    if (doc.y + rowHeight > bottomY) {
      doc.addPage();
      doc.x = leftX;
      doc.y = doc.page.margins.top;
      drawHeaderRow();
    }

    const rowY = doc.y;
    let x = leftX;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    for (let i = 0; i < columns.length; i++) {
      doc.text(row[i] ?? '', x + 6, rowY + rowHeight / 2 - 5, { width: columns[i].width - 12, ellipsis: true });
      x += columns[i].width;
    }
    doc
      .moveTo(leftX, rowY + rowHeight)
      .lineTo(rightX, rowY + rowHeight)
      .strokeColor('#e2e8f0')
      .lineWidth(0.5)
      .stroke();
    doc.y = rowY + rowHeight;
    doc.x = leftX;
  }
}

export interface StockSheetItem {
  sku: string;
  name: string;
  unitOfMeasure: string;
}

/**
 * Generates a blind physical stock-count sheet for a single warehouse - lists
 * every item's SKU/name/unit with a blank "Counted Qty" column to write into
 * by hand. Deliberately never includes the system's current quantity on hand,
 * so a paper count isn't unconsciously biased toward matching what the app
 * already expects.
 */
export function generateStockTakeSheetPdf(
  tenantName: string,
  warehouseName: string,
  items: StockSheetItem[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const leftX = doc.page.margins.left;
    const rightMargin = doc.page.margins.right;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('Blind Stock Count Sheet', leftX, doc.y);
    doc.moveDown(0.3);
    doc.x = leftX;
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(tenantName, leftX);
    doc.x = leftX;
    doc.text(`Warehouse: ${warehouseName}`, leftX);
    doc.x = leftX;
    doc.text(
      `Date: ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      leftX
    );
    doc.moveDown(0.5);
    doc.x = leftX;
    doc
      .fillColor(MUTED)
      .font('Helvetica-Oblique')
      .fontSize(9.5)
      .text(
        'Count every item physically on the shelf and write the counted quantity in the "Counted Qty" column below. Do not refer to any system records while counting.',
        leftX,
        doc.y,
        { width: doc.page.width - leftX - rightMargin }
      );
    doc.moveDown(1);
    doc.x = leftX;

    const tableWidth = doc.page.width - leftX - rightMargin;
    const columns: TableColumn[] = [
      { header: 'SKU', width: tableWidth * 0.2 },
      { header: 'Item Name', width: tableWidth * 0.38 },
      { header: 'Unit', width: tableWidth * 0.14 },
      { header: 'Counted Qty', width: tableWidth * 0.28 },
    ];
    const rows = items.map((item) => [item.sku, item.name, item.unitOfMeasure, '']);

    drawSimpleTable(doc, columns, rows, { rowHeight: 28 });

    doc.moveDown(1);
    doc.x = leftX;
    doc
      .fillColor('#94a3b8')
      .font('Helvetica')
      .fontSize(8.5)
      .text(`${items.length} item(s) listed. Generated by Ledgio ERP.`, leftX);

    doc.end();
  });
}
