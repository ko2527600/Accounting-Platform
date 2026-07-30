import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
} from 'docx';

interface ReportAccountRow {
  code: string;
  name: string;
  balance: number;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function headingParagraph(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
}

function titleParagraph(tenantName: string, title: string, subtitle: string): Paragraph[] {
  return [
    new Paragraph({ text: tenantName, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: subtitle, italics: true, color: '475569' })], spacing: { after: 200 } }),
  ];
}

function cell(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): TableCell {
  return new TableCell({
    children: [new Paragraph({ alignment: opts.align, children: [new TextRun({ text, bold: opts.bold })] })],
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
  });
}

/** Builds a bordered table with a bold header row from headers + string rows. */
function buildSimpleDocxTable(headers: string[], rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ children: headers.map(h => cell(h, { bold: true })) }),
      ...rows.map(row => new TableRow({ children: row.map(v => cell(v)) })),
    ],
  });
}

async function buildDocument(children: (Paragraph | Table)[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export interface BalanceSheetDocxData {
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

export function generateBalanceSheetDocx(
  tenantName: string,
  currency: string,
  asOfDateLabel: string,
  data: BalanceSheetDocxData
): Promise<Buffer> {
  const equityRows = data.equity.map(e => [e.code, e.name, formatMoney(e.balance, currency)]);
  equityRows.push(['', 'Retained Earnings', formatMoney(data.retainedEarnings, currency)]);

  return buildDocument([
    ...titleParagraph(tenantName, 'Balance Sheet', `As of ${asOfDateLabel} — all figures in ${currency}`),
    headingParagraph('Assets'),
    buildSimpleDocxTable(['Code', 'Account', 'Balance'], data.assets.map(a => [a.code, a.name, formatMoney(a.balance, currency)])),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `Total Assets: ${formatMoney(data.totalAssets, currency)}`, bold: true })] }),
    headingParagraph('Liabilities'),
    buildSimpleDocxTable(['Code', 'Account', 'Balance'], data.liabilities.map(l => [l.code, l.name, formatMoney(l.balance, currency)])),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `Total Liabilities: ${formatMoney(data.totalLiabilities, currency)}`, bold: true })] }),
    headingParagraph('Equity'),
    buildSimpleDocxTable(['Code', 'Account', 'Balance'], equityRows),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `Total Equity: ${formatMoney(data.totalEquity, currency)}`, bold: true })] }),
    new Paragraph({
      spacing: { before: 240 },
      children: [new TextRun({ text: `Total Liabilities & Equity: ${formatMoney(data.totalLiabilitiesAndEquity, currency)}`, bold: true, size: 26 })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: data.isBalanced ? 'Assets = Liabilities + Equity (balanced)' : 'Assets do not equal Liabilities + Equity - check ledger entries',
          color: data.isBalanced ? '059669' : 'DC2626',
        }),
      ],
    }),
  ]);
}

export interface ProfitAndLossDocxData {
  revenues: ReportAccountRow[];
  totalRevenue: number;
  expenses: ReportAccountRow[];
  totalExpenses: number;
  netProfit: number;
  isProfit: boolean;
}

export function generateProfitAndLossDocx(
  tenantName: string,
  currency: string,
  asOfDateLabel: string,
  data: ProfitAndLossDocxData
): Promise<Buffer> {
  return buildDocument([
    ...titleParagraph(tenantName, 'Profit and Loss Statement', `As of ${asOfDateLabel} — all figures in ${currency}`),
    headingParagraph('Income'),
    buildSimpleDocxTable(['Code', 'Account', 'Balance'], data.revenues.map(r => [r.code, r.name, formatMoney(r.balance, currency)])),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `Total Income: ${formatMoney(data.totalRevenue, currency)}`, bold: true })] }),
    headingParagraph('Expenses'),
    buildSimpleDocxTable(['Code', 'Account', 'Balance'], data.expenses.map(e => [e.code, e.name, formatMoney(e.balance, currency)])),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `Total Expenses: ${formatMoney(data.totalExpenses, currency)}`, bold: true })] }),
    new Paragraph({
      spacing: { before: 240 },
      children: [
        new TextRun({
          text: `${data.isProfit ? 'Net Profit' : 'Net Loss'}: ${formatMoney(data.netProfit, currency)}`,
          bold: true,
          size: 26,
          color: data.isProfit ? '059669' : 'DC2626',
        }),
      ],
    }),
  ]);
}

export interface ExecutiveReportCloseoutRow {
  closedAt: string;
  warehouseName: string;
  closedBy: string;
  expectedCash: number;
  actualCash: number;
  discrepancy: number;
}

export function generateExecutiveReportDocx(
  tenantName: string,
  currency: string,
  reportType: 'daily' | 'monthly' | 'yearly' | 'closeouts',
  data: {
    periodTotal?: number;
    shopLeaderboard?: { name: string; code: string; location: string | null; totalRevenue: number }[];
    closeouts?: ExecutiveReportCloseoutRow[];
  }
): Promise<Buffer> {
  const titleMap = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly', closeouts: 'Till Closeout' } as const;
  const body: (Paragraph | Table)[] = [
    ...titleParagraph(tenantName, 'Executive Performance Report', `${titleMap[reportType]} report — all figures in ${currency}`),
  ];

  if (reportType === 'closeouts') {
    body.push(headingParagraph('End-of-Day Till Closeouts'));
    body.push(
      buildSimpleDocxTable(
        ['Date/Time', 'Shop', 'Closed By', 'Expected', 'Actual', 'Discrepancy'],
        (data.closeouts || []).map(c => [
          new Date(c.closedAt).toLocaleString(),
          c.warehouseName,
          c.closedBy,
          formatMoney(c.expectedCash, currency),
          formatMoney(c.actualCash, currency),
          formatMoney(c.discrepancy, currency),
        ])
      )
    );
  } else {
    body.push(headingParagraph(`Total ${titleMap[reportType]} Sales Revenue`));
    body.push(new Paragraph({ children: [new TextRun({ text: formatMoney(data.periodTotal || 0, currency), bold: true, size: 32 })] }));
    body.push(headingParagraph('Top-Selling Shops Leaderboard'));
    body.push(
      buildSimpleDocxTable(
        ['Shop', 'Code', 'Location', 'Total Revenue'],
        (data.shopLeaderboard || []).map(s => [s.name, s.code, s.location || '-', formatMoney(s.totalRevenue, currency)])
      )
    );
  }

  return buildDocument(body);
}

export function generateStockIntelligenceDocx(
  tenantName: string,
  data: {
    fastSellers: { sku: string; name: string; totalStock: number; unitOfMeasure: string }[];
    slowMoving: { sku: string; name: string; totalStock: number; unitOfMeasure: string }[];
    suggestions: { itemName: string; fromWarehouseName: string; toWarehouseName: string; suggestedQty: number }[];
  }
): Promise<Buffer> {
  return buildDocument([
    ...titleParagraph(tenantName, 'Inventory Decision Intelligence', 'Fast-moving items, dead stock, and smart re-allocation suggestions'),
    headingParagraph(`Fast-Selling Items (${data.fastSellers.length})`),
    buildSimpleDocxTable(
      ['SKU', 'Item Name', 'Unit', 'Total Stock'],
      data.fastSellers.map(i => [i.sku, i.name, i.unitOfMeasure, String(i.totalStock)])
    ),
    headingParagraph(`Slow-Moving / Dead Stock (${data.slowMoving.length})`),
    buildSimpleDocxTable(
      ['SKU', 'Item Name', 'Unit', 'Total Stock'],
      data.slowMoving.map(i => [i.sku, i.name, i.unitOfMeasure, String(i.totalStock)])
    ),
    headingParagraph(`Smart Re-Allocation Suggestions (${data.suggestions.length})`),
    buildSimpleDocxTable(
      ['Item', 'From', 'To', 'Suggested Qty'],
      data.suggestions.map(s => [s.itemName, s.fromWarehouseName, s.toWarehouseName, String(s.suggestedQty)])
    ),
  ]);
}
