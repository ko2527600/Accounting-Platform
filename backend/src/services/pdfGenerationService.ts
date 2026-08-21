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
 * Truncates `text` (in the doc's currently-set font/size) to fit within
 * `maxWidth`, appending an ellipsis if it doesn't already fit. pdfkit's own
 * `ellipsis: true` text() option only truncates when line-wrapping is active,
 * which fights with fixed-height table rows - measuring/truncating manually
 * up front and drawing with `lineBreak: false` guarantees a single line that
 * never overflows into the next column or wraps the row taller than expected.
 */
function truncateToWidth(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  const ellipsis = '…';
  if (doc.widthOfString(ellipsis) > maxWidth) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (doc.widthOfString(candidate) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low) + ellipsis;
}

/**
 * Draws a ruled table with a header row, handling page breaks by redrawing
 * the header on each new page. Cells are single-line (truncated with an
 * ellipsis if too long for their column) - callers must size columns for
 * their expected content.
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
      const cellWidth = col.width - 12;
      doc.text(truncateToWidth(doc, col.header, cellWidth), x + 6, headerY + rowHeight / 2 - 5, { width: cellWidth, lineBreak: false });
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
      const cellWidth = columns[i].width - 12;
      doc.text(truncateToWidth(doc, row[i] ?? '', cellWidth), x + 6, rowY + rowHeight / 2 - 5, { width: cellWidth, lineBreak: false });
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

interface ReportAccountRow {
  code: string;
  name: string;
  balance: number;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function drawReportCover(doc: PDFKit.PDFDocument, tenantName: string, title: string, subtitle: string): void {
  doc.rect(0, 0, doc.page.width, 110).fill(INK);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(tenantName, 56, 40);
  doc.fillColor('#a7f3d0').font('Helvetica').fontSize(11).text(title, 56, 66);
  doc.y = 130;
  doc.x = 56;
  doc.fillColor(MUTED).font('Helvetica').fontSize(10.5).text(subtitle, 56);
  doc.moveDown(0.8);
}

function drawTotalRow(doc: PDFKit.PDFDocument, label: string, value: string, opts: { color?: string } = {}): void {
  const leftX = doc.page.margins.left;
  const rightX = doc.page.width - doc.page.margins.right;
  doc.moveDown(0.4);
  doc.x = leftX;
  doc
    .moveTo(leftX, doc.y)
    .lineTo(rightX, doc.y)
    .strokeColor('#0f172a')
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.3);
  doc.x = leftX;
  doc
    .fillColor(opts.color || INK)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(label, leftX, doc.y, { continued: true, width: (rightX - leftX) * 0.6 });
  doc.text(value, { align: 'right' });
}

/**
 * Generates a real Balance Sheet PDF (Assets/Liabilities/Equity + the
 * balance-check row), mirroring exactly what BalanceSheet.tsx renders
 * on-screen, using reportingService.getBalanceSheet()'s real result -
 * replaces the previous window.print()-based fake "Export PDF" button.
 */
export function generateBalanceSheetPdf(
  tenantName: string,
  currency: string,
  asOfDateLabel: string,
  data: {
    assets: ReportAccountRow[];
    totalAssets: number;
    liabilities: ReportAccountRow[];
    totalLiabilities: number;
    equity: ReportAccountRow[];
    retainedEarnings: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    isBalanced: boolean;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawReportCover(doc, tenantName, 'Balance Sheet', `As of ${asOfDateLabel} — all figures in ${currency}`);

    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columns: TableColumn[] = [
      { header: 'Code', width: tableWidth * 0.15 },
      { header: 'Account', width: tableWidth * 0.55 },
      { header: 'Balance', width: tableWidth * 0.3 },
    ];

    addSectionHeading(doc, 'Assets');
    drawSimpleTable(doc, columns, data.assets.map(a => [a.code, a.name, formatMoney(a.balance, currency)]));
    drawTotalRow(doc, 'Total Assets', formatMoney(data.totalAssets, currency));

    addSectionHeading(doc, 'Liabilities');
    drawSimpleTable(doc, columns, data.liabilities.map(l => [l.code, l.name, formatMoney(l.balance, currency)]));
    drawTotalRow(doc, 'Total Liabilities', formatMoney(data.totalLiabilities, currency));

    addSectionHeading(doc, 'Equity');
    const equityRows = data.equity.map(e => [e.code, e.name, formatMoney(e.balance, currency)]);
    equityRows.push(['', 'Retained Earnings', formatMoney(data.retainedEarnings, currency)]);
    drawSimpleTable(doc, columns, equityRows);
    drawTotalRow(doc, 'Total Equity', formatMoney(data.totalEquity, currency));

    drawTotalRow(
      doc,
      'Total Liabilities & Equity',
      formatMoney(data.totalLiabilitiesAndEquity, currency),
      { color: data.isBalanced ? BRAND_GREEN : '#dc2626' }
    );
    doc.moveDown(0.3);
    doc.x = doc.page.margins.left;
    doc
      .fillColor(data.isBalanced ? BRAND_GREEN : '#dc2626')
      .font('Helvetica')
      .fontSize(9.5)
      .text(data.isBalanced ? 'Assets = Liabilities + Equity (balanced)' : 'Assets do not equal Liabilities + Equity - check ledger entries', doc.page.margins.left);

    doc.end();
  });
}

export interface InvoicePdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/**
 * Generates a customer-facing Invoice PDF - the itemized document attached
 * to the "email this invoice" send (see EmailService.sendInvoiceEmail /
 * invoiceEmailService.ts), not an internal report like the other generators
 * in this file.
 */
export function generateInvoicePdf(
  tenantName: string,
  data: {
    invoiceNumber: string;
    issueDateLabel: string;
    dueDateLabel: string;
    currency: string;
    customerName: string;
    customerEmail: string;
    customerAddress?: string | null;
    items: InvoicePdfItem[];
    subtotal: number;
    tax: number;
    taxBreakdown: { name: string; rate: number; amount: number }[] | null;
    total: number;
    graClearanceStatus?: string | null;
    graQrCodeDataUrl?: string | null;
    graVerificationEngineId?: string | null;
    graClearedAt?: string | null;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawReportCover(doc, tenantName, `Invoice ${data.invoiceNumber}`, `Issued ${data.issueDateLabel} — due ${data.dueDateLabel}`);

    doc.x = doc.page.margins.left;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(10).text('Bill To', doc.x);
    doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(data.customerName);
    doc.fillColor(MUTED).fontSize(9.5).text(data.customerEmail);
    if (data.customerAddress) {
      doc.text(data.customerAddress);
    }
    doc.moveDown(0.5);

    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columns: TableColumn[] = [
      { header: 'Description', width: tableWidth * 0.46 },
      { header: 'Qty', width: tableWidth * 0.14 },
      { header: 'Unit Price', width: tableWidth * 0.2 },
      { header: 'Amount', width: tableWidth * 0.2 },
    ];

    addSectionHeading(doc, 'Items');
    drawSimpleTable(
      doc,
      columns,
      data.items.map((i) => [i.description, String(i.quantity), formatMoney(i.unitPrice, data.currency), formatMoney(i.amount, data.currency)])
    );

    drawTotalRow(doc, 'Subtotal', formatMoney(data.subtotal, data.currency));
    if (data.taxBreakdown && data.taxBreakdown.length > 0) {
      for (const line of data.taxBreakdown) {
        doc.moveDown(0.2);
        doc.x = doc.page.margins.left;
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(`${line.name} (${line.rate}%)`, doc.x, doc.y, { continued: true, width: tableWidth * 0.6 });
        doc.text(formatMoney(line.amount, data.currency), { align: 'right' });
      }
    } else if (data.tax > 0) {
      doc.moveDown(0.2);
      doc.x = doc.page.margins.left;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('Tax', doc.x, doc.y, { continued: true, width: tableWidth * 0.6 });
      doc.text(formatMoney(data.tax, data.currency), { align: 'right' });
    }
    drawTotalRow(doc, 'Total Due', formatMoney(data.total, data.currency), { color: BRAND_GREEN });

    // GRA E-VAT clearance section
    if (data.graClearanceStatus === 'CLEARED') {
      doc.moveDown(1.2);
      const leftX = doc.page.margins.left;
      const rightX = doc.page.width - doc.page.margins.right;
      const sectionWidth = rightX - leftX;

      // Green clearance banner
      doc.rect(leftX, doc.y, sectionWidth, 28).fillColor('#dcfce7').fill();
      doc.fillColor('#15803d').font('Helvetica-Bold').fontSize(10)
         .text('✓  GRA E-VAT CLEARED', leftX + 8, doc.y - 22, { width: sectionWidth - 16 });
      if (data.graVerificationEngineId) {
        doc.fillColor('#166534').font('Helvetica').fontSize(8)
           .text(`Verification Engine ID: ${data.graVerificationEngineId}`, leftX + 8, doc.y - 8, { width: sectionWidth - 16 });
      }
      if (data.graClearedAt) {
        const clearedLabel = new Date(data.graClearedAt).toLocaleString('en-GH', { timeZone: 'Africa/Accra' });
        doc.fillColor('#166534').font('Helvetica').fontSize(8)
           .text(`Cleared: ${clearedLabel}`, leftX + 8, doc.y, { width: sectionWidth - 120 });
      }

      // QR code (right-aligned in the clearance block)
      if (data.graQrCodeDataUrl) {
        try {
          const base64 = data.graQrCodeDataUrl.replace(/^data:image\/\w+;base64,/, '');
          const imgBuf = Buffer.from(base64, 'base64');
          doc.image(imgBuf, rightX - 80, doc.y - 48, { width: 72, height: 72 });
          doc.moveDown(2.4);
        } catch {
          doc.moveDown(0.5);
        }
      } else {
        doc.moveDown(0.5);
      }
    }

    doc.end();
  });
}

/**
 * Generates a real Profit & Loss PDF (Income/Expenses + Net Profit/Loss),
 * mirroring ProfitAndLoss.tsx's on-screen layout.
 */
export function generateProfitAndLossPdf(
  tenantName: string,
  currency: string,
  asOfDateLabel: string,
  data: {
    revenues: ReportAccountRow[];
    totalRevenue: number;
    expenses: ReportAccountRow[];
    totalExpenses: number;
    netProfit: number;
    isProfit: boolean;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawReportCover(doc, tenantName, 'Profit and Loss Statement', `As of ${asOfDateLabel} — all figures in ${currency}`);

    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columns: TableColumn[] = [
      { header: 'Code', width: tableWidth * 0.15 },
      { header: 'Account', width: tableWidth * 0.55 },
      { header: 'Balance', width: tableWidth * 0.3 },
    ];

    addSectionHeading(doc, 'Income');
    drawSimpleTable(doc, columns, data.revenues.map(r => [r.code, r.name, formatMoney(r.balance, currency)]));
    drawTotalRow(doc, 'Total Income', formatMoney(data.totalRevenue, currency));

    addSectionHeading(doc, 'Expenses');
    drawSimpleTable(doc, columns, data.expenses.map(e => [e.code, e.name, formatMoney(e.balance, currency)]));
    drawTotalRow(doc, 'Total Expenses', formatMoney(data.totalExpenses, currency));

    drawTotalRow(
      doc,
      data.isProfit ? 'Net Profit' : 'Net Loss',
      formatMoney(data.netProfit, currency),
      { color: data.isProfit ? BRAND_GREEN : '#dc2626' }
    );

    doc.end();
  });
}

export interface CashFlowLineItem {
  code: string;
  name: string;
  change: number;
}

/**
 * Generates a real Cash Flow Statement PDF (indirect method), mirroring
 * CashFlowStatement.tsx's on-screen layout.
 */
export function generateCashFlowPdf(
  tenantName: string,
  currency: string,
  periodLabel: string,
  data: {
    netIncome: number;
    operatingAdjustments: CashFlowLineItem[];
    netCashFromOperating: number;
    investingAdjustments: CashFlowLineItem[];
    netCashFromInvesting: number;
    financingAdjustments: CashFlowLineItem[];
    netCashFromFinancing: number;
    netChangeInCash: number;
    beginningCash: number;
    endingCash: number;
    cashTies: boolean;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawReportCover(doc, tenantName, 'Cash Flow Statement', `${periodLabel} — all figures in ${currency}`);

    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columns: TableColumn[] = [
      { header: 'Code', width: tableWidth * 0.15 },
      { header: 'Account', width: tableWidth * 0.55 },
      { header: 'Change in Cash', width: tableWidth * 0.3 },
    ];

    addSectionHeading(doc, 'Operating Activities');
    doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(`Net Income: ${formatMoney(data.netIncome, currency)}`, doc.page.margins.left);
    doc.moveDown(0.5);
    drawSimpleTable(doc, columns, data.operatingAdjustments.map(a => [a.code, a.name, formatMoney(a.change, currency)]));
    drawTotalRow(doc, 'Net Cash from Operating Activities', formatMoney(data.netCashFromOperating, currency));

    addSectionHeading(doc, 'Investing Activities');
    drawSimpleTable(doc, columns, data.investingAdjustments.map(a => [a.code, a.name, formatMoney(a.change, currency)]));
    drawTotalRow(doc, 'Net Cash from Investing Activities', formatMoney(data.netCashFromInvesting, currency));

    addSectionHeading(doc, 'Financing Activities');
    drawSimpleTable(doc, columns, data.financingAdjustments.map(a => [a.code, a.name, formatMoney(a.change, currency)]));
    drawTotalRow(doc, 'Net Cash from Financing Activities', formatMoney(data.netCashFromFinancing, currency));

    drawTotalRow(doc, 'Net Change in Cash', formatMoney(data.netChangeInCash, currency));
    drawTotalRow(doc, 'Cash at Beginning of Period', formatMoney(data.beginningCash, currency));
    drawTotalRow(doc, 'Cash at End of Period', formatMoney(data.endingCash, currency), { color: BRAND_GREEN });

    doc.moveDown(0.3);
    doc.x = doc.page.margins.left;
    doc
      .fillColor(data.cashTies ? BRAND_GREEN : '#dc2626')
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        data.cashTies
          ? 'Reconciles with actual cash account balances.'
          : 'Does not reconcile with actual cash account balances - check ledger entries.',
        doc.page.margins.left
      );

    doc.end();
  });
}

export interface ExecutiveReportCloseoutRow {
  closedAt: string;
  warehouseName: string;
  closedBy: string;
  openingCash: number;
  cashSales: number;
  expectedCash: number;
  actualCash: number;
  discrepancy: number;
}

/**
 * Generates a real PDF for the Executive Performance & Till Closeout report -
 * the daily/monthly/yearly revenue summary plus the shop leaderboard, or (for
 * reportType 'closeouts') the full end-of-day till closeout ledger.
 */
export function generateExecutiveReportPdf(
  tenantName: string,
  currency: string,
  reportType: 'daily' | 'monthly' | 'yearly' | 'closeouts',
  data: {
    periodTotal?: number;
    shopLeaderboard?: { name: string; code: string; location: string | null; totalRevenue: number }[];
    closeouts?: ExecutiveReportCloseoutRow[];
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const titleMap = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly', closeouts: 'Till Closeout' } as const;
    drawReportCover(
      doc,
      tenantName,
      'Executive Performance Report',
      `${titleMap[reportType]} report — all figures in ${currency}`
    );

    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    if (reportType === 'closeouts') {
      addSectionHeading(doc, 'End-of-Day Till Closeouts');
      const columns: TableColumn[] = [
        { header: 'Date/Time', width: tableWidth * 0.2 },
        { header: 'Shop', width: tableWidth * 0.2 },
        { header: 'Closed By', width: tableWidth * 0.16 },
        { header: 'Expected', width: tableWidth * 0.15 },
        { header: 'Actual', width: tableWidth * 0.15 },
        { header: 'Discrepancy', width: tableWidth * 0.14 },
      ];
      const rows = (data.closeouts || []).map(c => [
        new Date(c.closedAt).toLocaleString(),
        c.warehouseName,
        c.closedBy,
        formatMoney(c.expectedCash, currency),
        formatMoney(c.actualCash, currency),
        formatMoney(c.discrepancy, currency),
      ]);
      drawSimpleTable(doc, columns, rows);
    } else {
      addSectionHeading(doc, `Total ${titleMap[reportType]} Sales Revenue`);
      doc.x = doc.page.margins.left;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(formatMoney(data.periodTotal || 0, currency));

      addSectionHeading(doc, 'Top-Selling Shops Leaderboard');
      const columns: TableColumn[] = [
        { header: 'Shop', width: tableWidth * 0.3 },
        { header: 'Code', width: tableWidth * 0.15 },
        { header: 'Location', width: tableWidth * 0.3 },
        { header: 'Total Revenue', width: tableWidth * 0.25 },
      ];
      const rows = (data.shopLeaderboard || []).map(s => [s.name, s.code, s.location || '-', formatMoney(s.totalRevenue, currency)]);
      drawSimpleTable(doc, columns, rows);
    }

    doc.end();
  });
}

/**
 * Generates a real PDF for the Inventory Decision Intelligence Tower -
 * Fast-Selling items, Slow-Moving (dead) stock, and smart re-allocation
 * suggestions.
 */
export function generateStockIntelligencePdf(
  tenantName: string,
  data: {
    fastSellers: { sku: string; name: string; totalStock: number; unitOfMeasure: string }[];
    slowMoving: { sku: string; name: string; totalStock: number; unitOfMeasure: string }[];
    suggestions: { itemName: string; fromWarehouseName: string; toWarehouseName: string; suggestedQty: number }[];
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    drawReportCover(doc, tenantName, 'Inventory Decision Intelligence', 'Fast-moving items, dead stock, and smart re-allocation suggestions');

    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const itemColumns: TableColumn[] = [
      { header: 'SKU', width: tableWidth * 0.2 },
      { header: 'Item Name', width: tableWidth * 0.45 },
      { header: 'Unit', width: tableWidth * 0.15 },
      { header: 'Total Stock', width: tableWidth * 0.2 },
    ];

    addSectionHeading(doc, `Fast-Selling Items (${data.fastSellers.length})`);
    drawSimpleTable(doc, itemColumns, data.fastSellers.map(i => [i.sku, i.name, i.unitOfMeasure, String(i.totalStock)]));

    addSectionHeading(doc, `Slow-Moving / Dead Stock (${data.slowMoving.length})`);
    drawSimpleTable(doc, itemColumns, data.slowMoving.map(i => [i.sku, i.name, i.unitOfMeasure, String(i.totalStock)]));

    addSectionHeading(doc, `Smart Re-Allocation Suggestions (${data.suggestions.length})`);
    const suggestionColumns: TableColumn[] = [
      { header: 'Item', width: tableWidth * 0.34 },
      { header: 'From', width: tableWidth * 0.24 },
      { header: 'To', width: tableWidth * 0.24 },
      { header: 'Suggested Qty', width: tableWidth * 0.18 },
    ];
    drawSimpleTable(doc, suggestionColumns, data.suggestions.map(s => [s.itemName, s.fromWarehouseName, s.toWarehouseName, String(s.suggestedQty)]));

    doc.end();
  });
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
      { header: 'SKU', width: tableWidth * 0.28 },
      { header: 'Item Name', width: tableWidth * 0.32 },
      { header: 'Unit', width: tableWidth * 0.12 },
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
