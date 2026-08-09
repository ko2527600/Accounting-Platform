import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { requireTenantContext } from '../context/tenantContext';
import * as reportingService from './reportingService';
import * as accountRepository from '../repository/accountRepository';
import * as recurringTransactionRepository from '../repository/recurringTransactionRepository';
import { advanceDate } from './recurringTransactionService';

export class CashFlowForecastServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'CashFlowForecastServiceError';
    this.statusCode = statusCode;
  }
}

export interface ForecastEvent {
  date: string;
  source: 'RECURRING_TRANSACTION' | 'INVOICE_DUE' | 'BILL_DUE';
  description: string;
  amount: number;
}

export interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  inflows: number;
  outflows: number;
  netChange: number;
  projectedBalance: number;
}

export interface CashFlowForecastResult {
  asOfDate: string;
  days: number;
  startingCashBalance: number;
  endingProjectedBalance: number;
  totalProjectedInflow: number;
  totalProjectedOutflow: number;
  weeks: ForecastWeek[];
  events: ForecastEvent[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A recurring-transaction-aware, event-grounded forecast - deliberately NOT
 * a trend-based extrapolation of past cash flow, since projecting forward
 * from historical averages would be a guess this codebase's "No Mock Data
 * Ever" discipline doesn't allow presenting as if it were real. Instead,
 * every dollar in the forecast traces back to a real, already-scheduled or
 * already-owed event:
 *   - RecurringTransaction occurrences due within the window (their real
 *     next-run dates, advanced via the same advanceDate() the cron uses -
 *     these are genuinely predictable, not guessed).
 *   - Outstanding (non-PAID) Invoices due within the window - assumed
 *     collected on their real due date.
 *   - Outstanding (non-PAID) VendorBills due within the window - assumed
 *     paid on their real due date.
 * Deliberately excludes approved-but-unreimbursed ExpenseClaims: unlike
 * invoices/bills, a claim has no due date, so any assumed payment date
 * would be fabricated rather than grounded - excluded rather than guessed,
 * matching this session's established pattern (e.g. the KPI dashboard
 * excluding Gross Margin/Current Ratio rather than approximating them).
 */
export async function getCashFlowForecast(days: number = 180): Promise<CashFlowForecastResult> {
  if (!Number.isInteger(days) || days < 7 || days > 365) {
    throw new CashFlowForecastServiceError('days must be an integer between 7 and 365.', 400);
  }

  const { tenantId } = requireTenantContext();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + days);

  const [kpis, accounts, recurringTxns, invoices, bills] = await Promise.all([
    reportingService.getKpiDashboard(),
    withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client)),
    recurringTransactionRepository.listRecurringTransactions(prisma, tenantId),
    withCurrentTenantDb(prisma, (client): Promise<any[]> =>
      (client as any).invoice.findMany({
        where: { tenantId, status: { not: 'PAID' }, dueDate: { gte: today, lte: windowEnd } },
      })
    ),
    withCurrentTenantDb(prisma, (client): Promise<any[]> =>
      (client as any).vendorBill.findMany({
        where: { tenantId, status: { not: 'PAID' }, dueDate: { gte: today, lte: windowEnd } },
      })
    ),
  ]);

  const cashAccountIds = new Set(accounts.filter((a: any) => a.isCashEquivalent).map((a: any) => a.id));
  const startingCashBalance = kpis.totalCashEquivalents;

  const events: ForecastEvent[] = [];

  for (const rt of recurringTxns) {
    if (!rt.isActive) continue;
    const lines: any[] = rt.templateData?.lines || [];
    let netCashImpact = 0;
    for (const line of lines) {
      if (cashAccountIds.has(line.accountId)) {
        netCashImpact += Number(line.debit || 0) - Number(line.credit || 0);
      }
    }
    if (netCashImpact === 0) continue;

    let occurrence = new Date(rt.nextRun);
    let guard = 0;
    while (occurrence <= windowEnd && guard < 1000) {
      guard++;
      if (occurrence >= today && (!rt.endDate || occurrence <= rt.endDate)) {
        events.push({
          date: occurrence.toISOString().split('T')[0],
          source: 'RECURRING_TRANSACTION',
          description: rt.name,
          amount: round2(netCashImpact),
        });
      }
      if (rt.endDate && occurrence > rt.endDate) break;
      occurrence = advanceDate(occurrence, rt.frequency);
    }
  }

  for (const inv of invoices) {
    const amount = inv.baseCurrencyAmount != null ? Number(inv.baseCurrencyAmount) : Number(inv.total);
    events.push({
      date: new Date(inv.dueDate).toISOString().split('T')[0],
      source: 'INVOICE_DUE',
      description: `Invoice ${inv.invoiceNumber} due`,
      amount: round2(amount),
    });
  }

  for (const bill of bills) {
    const amount = bill.baseCurrencyAmount != null ? Number(bill.baseCurrencyAmount) : Number(bill.amount);
    events.push({
      date: new Date(bill.dueDate).toISOString().split('T')[0],
      source: 'BILL_DUE',
      description: `Bill ${bill.billNumber} due`,
      amount: -round2(amount),
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  const weeks: ForecastWeek[] = [];
  let runningBalance = startingCashBalance;
  let totalInflow = 0;
  let totalOutflow = 0;
  const numWeeks = Math.ceil(days / 7);

  for (let w = 0; w < numWeeks; w++) {
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() + w * 7);
    const weekEnd = new Date(today);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + Math.min((w + 1) * 7 - 1, days - 1));

    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    let inflows = 0;
    let outflows = 0;
    for (const e of events) {
      if (e.date >= weekStartStr && e.date <= weekEndStr) {
        if (e.amount > 0) inflows += e.amount;
        else outflows += -e.amount;
      }
    }
    const netChange = round2(inflows - outflows);
    runningBalance = round2(runningBalance + netChange);
    totalInflow += inflows;
    totalOutflow += outflows;

    weeks.push({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      inflows: round2(inflows),
      outflows: round2(outflows),
      netChange,
      projectedBalance: runningBalance,
    });
  }

  return {
    asOfDate: today.toISOString().split('T')[0],
    days,
    startingCashBalance: round2(startingCashBalance),
    endingProjectedBalance: runningBalance,
    totalProjectedInflow: round2(totalInflow),
    totalProjectedOutflow: round2(totalOutflow),
    weeks,
    events,
  };
}
