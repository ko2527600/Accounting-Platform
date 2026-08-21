import { PrismaClient } from '@prisma/client';

export interface AgingBucketTotals {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

export interface ArAgingRow {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  dueDate: Date;
  daysOverdue: number;
  balanceDue: number;
  bucket: keyof Omit<AgingBucketTotals, 'total'>;
  currency: string;
  nativeBalanceDue: number;
}

export interface ApAgingRow {
  billId: string;
  billNumber: string;
  vendorName: string;
  dueDate: Date;
  daysOverdue: number;
  balanceDue: number;
  bucket: keyof Omit<AgingBucketTotals, 'total'>;
  currency: string;
  nativeBalanceDue: number;
}

function emptyTotals(): AgingBucketTotals {
  return { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, total: 0 };
}

function bucketFor(daysOverdue: number): keyof Omit<AgingBucketTotals, 'total'> {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days1to30';
  if (daysOverdue <= 60) return 'days31to60';
  if (daysOverdue <= 90) return 'days61to90';
  return 'days90plus';
}

function daysOverdueFrom(dueDate: Date, now: Date): number {
  return Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Accounts Receivable aging - every invoice with a real outstanding balance
 * (total - amountPaid > 0, not DRAFT/CANCELLED), bucketed by days past its
 * dueDate. `balanceDue` (not the original `total`) is what's bucketed, so a
 * partially-paid invoice only ages on what's genuinely still owed.
 */
export async function getArAging(prisma: PrismaClient, tenantId: string, now: Date = new Date()): Promise<{ rows: ArAgingRow[]; totals: AgingBucketTotals }> {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
    include: { customer: true },
    orderBy: { dueDate: 'asc' },
  });

  const totals = emptyTotals();
  const rows: ArAgingRow[] = [];

  for (const invoice of invoices) {
    const invoiceTotal = Number(invoice.total);
    const nativeBalanceDue = Math.round((invoiceTotal - Number(invoice.amountPaid)) * 100) / 100;
    if (nativeBalanceDue <= 0) continue;

    // Convert outstanding balance to base currency using the original FX rate
    const fxScale = invoiceTotal > 0 && invoice.baseCurrencyAmount != null
      ? Number(invoice.baseCurrencyAmount) / invoiceTotal
      : 1;
    const balanceDue = Math.round(nativeBalanceDue * fxScale * 100) / 100;

    const daysOverdue = daysOverdueFrom(invoice.dueDate, now);
    const bucket = bucketFor(daysOverdue);

    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer.name,
      dueDate: invoice.dueDate,
      daysOverdue,
      balanceDue,
      bucket,
      currency: invoice.currency || 'USD',
      nativeBalanceDue,
    });

    totals[bucket] += balanceDue;
    totals.total += balanceDue;
  }

  return { rows, totals };
}

/**
 * Accounts Payable aging - every UNPAID vendor bill (this schema has no
 * partial-payment support for bills, unlike invoices - see routes/bills.ts,
 * so balanceDue is always the bill's full amount), bucketed the same way as
 * AR.
 */
export async function getApAging(prisma: PrismaClient, tenantId: string, now: Date = new Date()): Promise<{ rows: ApAgingRow[]; totals: AgingBucketTotals }> {
  const bills = await prisma.vendorBill.findMany({
    where: { tenantId, status: 'UNPAID', billType: { not: 'LANDED_COST' } },
    include: { vendor: true },
    orderBy: { dueDate: 'asc' },
  });

  const totals = emptyTotals();
  const rows: ApAgingRow[] = [];

  for (const bill of bills) {
    const nativeBalanceDue = Number(bill.amount);
    if (nativeBalanceDue <= 0) continue;

    // Use base currency amount if available, else native amount
    const balanceDue = bill.baseCurrencyAmount != null
      ? Number(bill.baseCurrencyAmount)
      : nativeBalanceDue;

    const daysOverdue = daysOverdueFrom(bill.dueDate, now);
    const bucket = bucketFor(daysOverdue);

    rows.push({
      billId: bill.id,
      billNumber: bill.billNumber,
      vendorName: bill.vendor.name,
      dueDate: bill.dueDate,
      daysOverdue,
      balanceDue,
      bucket,
      currency: bill.currency || 'USD',
      nativeBalanceDue,
    });

    totals[bucket] += balanceDue;
    totals.total += balanceDue;
  }

  return { rows, totals };
}
