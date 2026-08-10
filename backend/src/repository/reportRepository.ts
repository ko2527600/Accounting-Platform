import { PrismaClient } from '@prisma/client';

export interface TrialBalanceAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

export interface TrialBalanceResult {
  asOfDate: string | null;
  startDate: string | null;
  endDate: string | null;
  accounts: TrialBalanceAccount[];
  totals: {
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
  };
}

export interface ProfitLossAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  amount: number;
}

export interface ProfitLossResult {
  startDate: string | null;
  endDate: string | null;
  asOfDate: string | null;
  revenues: ProfitLossAccount[];
  totalRevenue: number;
  costOfSales: ProfitLossAccount[];
  totalCostOfSales: number;
  grossProfit: number;
  expenses: ProfitLossAccount[];
  totalExpenses: number;
  netProfit: number;
  isProfit: boolean;
}

export interface BalanceSheetAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
}

export interface BalanceSheetResult {
  asOfDate: string | null;
  assets: BalanceSheetAccount[];
  totalAssets: number;
  liabilities: BalanceSheetAccount[];
  totalLiabilities: number;
  equity: BalanceSheetAccount[];
  totalEquityAccounts: number;
  retainedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

export async function getTrialBalance(
  prisma: PrismaClient,
  startDate?: string,
  endDate?: string,
  asOfDate?: string
): Promise<TrialBalanceResult> {
  const effectiveEndDate = endDate || asOfDate;

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (startDate) {
    conditions.push(`l.transaction_date >= $${paramIdx++}::date`);
    params.push(startDate);
  }

  if (effectiveEndDate) {
    conditions.push(`l.transaction_date <= $${paramIdx++}::date`);
    params.push(effectiveEndDate);
  }

  const joinWhere = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      a.id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(l.debit), 0) as total_debit,
      COALESCE(SUM(l.credit), 0) as total_credit
    FROM accounts a
    LEFT JOIN ledgers l ON a.id = l.account_id ${joinWhere}
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

  let grandTotalDebit = 0;
  let grandTotalCredit = 0;

  const accounts: TrialBalanceAccount[] = rows.map((r) => {
    const rawDebit = parseFloat(r.total_debit);
    const rawCredit = parseFloat(r.total_credit);
    const net = rawDebit - rawCredit;

    let debit = 0;
    let credit = 0;

    if (net > 0) {
      debit = Math.round(net * 100) / 100;
    } else if (net < 0) {
      credit = Math.round(Math.abs(net) * 100) / 100;
    }

    grandTotalDebit += debit;
    grandTotalCredit += credit;

    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      debit,
      credit,
    };
  });

  const roundedTotalDebit = Math.round(grandTotalDebit * 100) / 100;
  const roundedTotalCredit = Math.round(grandTotalCredit * 100) / 100;
  const isBalanced = Math.abs(roundedTotalDebit - roundedTotalCredit) < 0.01;

  return {
    asOfDate: asOfDate || null,
    startDate: startDate || null,
    endDate: endDate || null,
    accounts,
    totals: {
      totalDebit: roundedTotalDebit,
      totalCredit: roundedTotalCredit,
      isBalanced,
    },
  };
}

export async function getProfitAndLoss(
  prisma: PrismaClient,
  startDate?: string,
  endDate?: string,
  asOfDate?: string,
  fundId?: string
): Promise<ProfitLossResult> {
  const effectiveEndDate = endDate || asOfDate;

  const conditions: string[] = [`a.type IN ('REVENUE', 'EXPENSE', 'COST_OF_SALES')`];
  const params: any[] = [];
  let paramIdx = 1;

  const ledgerConditions: string[] = [];

  if (startDate) {
    ledgerConditions.push(`l.transaction_date >= $${paramIdx++}::date`);
    params.push(startDate);
  }

  if (effectiveEndDate) {
    ledgerConditions.push(`l.transaction_date <= $${paramIdx++}::date`);
    params.push(effectiveEndDate);
  }

  if (fundId) {
    ledgerConditions.push(`l.fund_id = $${paramIdx++}::uuid`);
    params.push(fundId);
  }

  const joinWhere = ledgerConditions.length > 0 ? `AND ${ledgerConditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      a.id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(l.debit), 0) as total_debit,
      COALESCE(SUM(l.credit), 0) as total_credit
    FROM accounts a
    LEFT JOIN ledgers l ON a.id = l.account_id ${joinWhere}
    WHERE ${conditions.join(' AND ')}
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

  const revenues: ProfitLossAccount[] = [];
  const costOfSales: ProfitLossAccount[] = [];
  const expenses: ProfitLossAccount[] = [];

  let totalRevenue = 0;
  let totalCostOfSales = 0;
  let totalExpenses = 0;

  for (const r of rows) {
    const debit = parseFloat(r.total_debit);
    const credit = parseFloat(r.total_credit);

    if (r.type === 'REVENUE') {
      const amount = Math.round((credit - debit) * 100) / 100;
      totalRevenue += amount;
      revenues.push({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        amount,
      });
    } else if (r.type === 'COST_OF_SALES') {
      const amount = Math.round((debit - credit) * 100) / 100;
      totalCostOfSales += amount;
      costOfSales.push({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        amount,
      });
    } else if (r.type === 'EXPENSE') {
      const amount = Math.round((debit - credit) * 100) / 100;
      totalExpenses += amount;
      expenses.push({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        amount,
      });
    }
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCostOfSales = Math.round(totalCostOfSales * 100) / 100;
  totalExpenses = Math.round(totalExpenses * 100) / 100;
  const grossProfit = Math.round((totalRevenue - totalCostOfSales) * 100) / 100;
  const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    asOfDate: asOfDate || null,
    revenues,
    totalRevenue,
    costOfSales,
    totalCostOfSales,
    grossProfit,
    expenses,
    totalExpenses,
    netProfit,
    isProfit: netProfit >= 0,
  };
}

export interface CashFlowLineItem {
  id: string;
  code: string;
  name: string;
  change: number; // signed impact on cash: positive = source of cash, negative = use of cash
}

export interface CashFlowResult {
  startDate: string | null;
  endDate: string | null;
  netIncome: number;
  operatingAdjustments: CashFlowLineItem[];
  netCashFromOperating: number;
  financingAdjustments: CashFlowLineItem[];
  netCashFromFinancing: number;
  netChangeInCash: number;
  beginningCash: number;
  endingCash: number;
  cashTies: boolean;
  cashAccounts: { id: string; code: string; name: string; balance: number }[];
}

/**
 * Indirect-method Cash Flow Statement, computed straight from ledger balances
 * (no separate cash-flow ledger). Accounts are grouped into three buckets:
 *  - ASSET accounts flagged is_cash_equivalent are "cash itself" (excluded
 *    from the adjustments and used only for the beginning/ending cash lines).
 *  - All other non-cash ASSET/LIABILITY accounts feed "Operating Activities"
 *    (their balance changes are standard indirect-method working-capital
 *    adjustments to Net Income).
 *  - EQUITY account changes (owner contributions/drawings) feed "Financing
 *    Activities".
 * There is no Investing section: this schema has no fixed-asset/loan account
 * classification to separate capex or long-term debt from ordinary working
 * capital, so - consistent with what small-business bookkeeping realistically
 * supports today - those changes are treated as operating. This is a known,
 * documented simplification (see STATUS.md), not an omission.
 * Because double-entry bookkeeping guarantees Assets = Liabilities + Equity
 * at every point in time, netCashFromOperating + netCashFromFinancing must
 * always equal the actual change in the cash-equivalent accounts - `cashTies`
 * surfaces that as a trust signal, mirroring `isBalanced` on the Balance Sheet.
 */
export async function getCashFlowStatement(
  prisma: PrismaClient,
  startDate?: string,
  endDate?: string
): Promise<CashFlowResult> {
  const params: any[] = [];
  let startParamIdx: number | null = null;
  let endParamIdx: number | null = null;

  if (startDate) {
    params.push(startDate);
    startParamIdx = params.length;
  }
  if (endDate) {
    params.push(endDate);
    endParamIdx = params.length;
  }

  // No startDate means "since inception" - beginning balances are definitionally zero.
  const beginExpr = startParamIdx ? `l.transaction_date < $${startParamIdx}::date` : 'FALSE';
  const endExpr = endParamIdx ? `l.transaction_date <= $${endParamIdx}::date` : 'TRUE';
  const periodExpr = [
    startParamIdx ? `l.transaction_date >= $${startParamIdx}::date` : null,
    endParamIdx ? `l.transaction_date <= $${endParamIdx}::date` : null,
  ]
    .filter(Boolean)
    .join(' AND ') || 'TRUE';

  const sql = `
    SELECT
      a.id,
      a.code,
      a.name,
      a.type,
      a.is_cash_equivalent,
      COALESCE(SUM(CASE WHEN ${beginExpr} THEN l.debit ELSE 0 END), 0) as begin_debit,
      COALESCE(SUM(CASE WHEN ${beginExpr} THEN l.credit ELSE 0 END), 0) as begin_credit,
      COALESCE(SUM(CASE WHEN ${endExpr} THEN l.debit ELSE 0 END), 0) as end_debit,
      COALESCE(SUM(CASE WHEN ${endExpr} THEN l.credit ELSE 0 END), 0) as end_credit,
      COALESCE(SUM(CASE WHEN ${periodExpr} THEN l.debit ELSE 0 END), 0) as period_debit,
      COALESCE(SUM(CASE WHEN ${periodExpr} THEN l.credit ELSE 0 END), 0) as period_credit
    FROM accounts a
    LEFT JOIN ledgers l ON a.id = l.account_id
    GROUP BY a.id, a.code, a.name, a.type, a.is_cash_equivalent
    ORDER BY a.code ASC
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  let beginningCash = 0;
  let endingCash = 0;
  const cashAccounts: { id: string; code: string; name: string; balance: number }[] = [];

  const operatingAdjustments: CashFlowLineItem[] = [];
  let netCashFromOperating = 0;

  const financingAdjustments: CashFlowLineItem[] = [];
  let netCashFromFinancing = 0;

  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const r of rows) {
    const beginDebit = parseFloat(r.begin_debit);
    const beginCredit = parseFloat(r.begin_credit);
    const endDebit = parseFloat(r.end_debit);
    const endCredit = parseFloat(r.end_credit);
    const periodDebit = parseFloat(r.period_debit);
    const periodCredit = parseFloat(r.period_credit);
    const isCashEquivalent = Boolean(r.is_cash_equivalent);

    if (r.type === 'ASSET' && isCashEquivalent) {
      const begin = beginDebit - beginCredit;
      const end = endDebit - endCredit;
      beginningCash += begin;
      endingCash += end;
      cashAccounts.push({ id: r.id, code: r.code, name: r.name, balance: round2(end) });
    } else if (r.type === 'ASSET') {
      // Asset increase uses cash, so its cash impact is the negative of its change.
      const change = (endDebit - endCredit) - (beginDebit - beginCredit);
      const cashImpact = round2(-change);
      if (cashImpact !== 0) {
        operatingAdjustments.push({ id: r.id, code: r.code, name: r.name, change: cashImpact });
      }
      netCashFromOperating += cashImpact;
    } else if (r.type === 'LIABILITY') {
      // Liability increase provides cash.
      const change = (endCredit - endDebit) - (beginCredit - beginDebit);
      const cashImpact = round2(change);
      if (cashImpact !== 0) {
        operatingAdjustments.push({ id: r.id, code: r.code, name: r.name, change: cashImpact });
      }
      netCashFromOperating += cashImpact;
    } else if (r.type === 'EQUITY') {
      // Equity increase (owner contribution) provides cash; decrease (drawings) uses it.
      const change = (endCredit - endDebit) - (beginCredit - beginDebit);
      const cashImpact = round2(change);
      if (cashImpact !== 0) {
        financingAdjustments.push({ id: r.id, code: r.code, name: r.name, change: cashImpact });
      }
      netCashFromFinancing += cashImpact;
    } else if (r.type === 'REVENUE') {
      totalRevenue += periodCredit - periodDebit;
    } else if (r.type === 'EXPENSE' || r.type === 'COST_OF_SALES') {
      // Cost of Sales is debit-normal like an Operating Expense and reduces
      // net income the same way - no separate Cash Flow line needed for it.
      totalExpenses += periodDebit - periodCredit;
    }
  }

  const netIncome = round2(totalRevenue - totalExpenses);
  netCashFromOperating = round2(netIncome + netCashFromOperating);
  netCashFromFinancing = round2(netCashFromFinancing);
  const netChangeInCash = round2(netCashFromOperating + netCashFromFinancing);

  beginningCash = round2(beginningCash);
  endingCash = round2(endingCash); // actual, straight from the cash-equivalent accounts - the ground truth
  const cashTies = Math.abs(round2(beginningCash + netChangeInCash) - endingCash) < 0.01;

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    netIncome,
    operatingAdjustments,
    netCashFromOperating,
    financingAdjustments,
    netCashFromFinancing,
    netChangeInCash,
    beginningCash,
    endingCash,
    cashTies,
    cashAccounts,
  };
}

export interface KpiDashboardResult {
  startDate: string | null;
  endDate: string | null;
  netIncome: number;
  totalRevenue: number;
  totalExpenses: number;
  totalCostOfSales: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalCashEquivalents: number;
  netProfitMarginPct: number | null;
  grossProfitMarginPct: number | null;
  returnOnAssetsPct: number | null;
  debtToEquityRatio: number | null;
  cashRatio: number | null;
  equityRatioPct: number | null;
}

/**
 * A lightweight set of financial ratios computed entirely from Balance Sheet
 * + Profit & Loss totals - no new data entry required. Deliberately limited
 * to ratios this schema can compute honestly:
 *  - Gross Margin is only real for tenants that actually post to a Cost of
 *    Sales account - POS sales (cashTill.ts) still never auto-post a COGS
 *    entry (that needs real inventory costing, a separate, larger project),
 *    so `grossProfitMarginPct` is `null` until a tenant posts real Cost of
 *    Sales entries themselves, exactly like every other ratio's existing
 *    null-when-not-computable convention below.
 *  - No Current Ratio / Quick Ratio: accounts have no current-vs-non-current
 *    classification (same gap the Cash Flow Statement's missing Investing
 *    section documents), so "current assets" isn't a real, distinct number.
 * Uses totalEquity + retainedEarnings the same way getBalanceSheet does
 * (cumulative revenue/expense since inception, independent of startDate),
 * while netIncome/margins use the requested period - mirroring how the
 * Balance Sheet and Profit & Loss reports already split "point in time" from
 * "over a period" today.
 */
export async function getKpiDashboard(
  prisma: PrismaClient,
  startDate?: string,
  endDate?: string
): Promise<KpiDashboardResult> {
  const params: any[] = [];
  let startParamIdx: number | null = null;
  let endParamIdx: number | null = null;

  if (startDate) {
    params.push(startDate);
    startParamIdx = params.length;
  }
  if (endDate) {
    params.push(endDate);
    endParamIdx = params.length;
  }

  const endExpr = endParamIdx ? `l.transaction_date <= $${endParamIdx}::date` : 'TRUE';
  const periodExpr = [
    startParamIdx ? `l.transaction_date >= $${startParamIdx}::date` : null,
    endParamIdx ? `l.transaction_date <= $${endParamIdx}::date` : null,
  ]
    .filter(Boolean)
    .join(' AND ') || 'TRUE';

  const sql = `
    SELECT
      a.type,
      a.is_cash_equivalent,
      COALESCE(SUM(CASE WHEN ${endExpr} THEN l.debit ELSE 0 END), 0) as end_debit,
      COALESCE(SUM(CASE WHEN ${endExpr} THEN l.credit ELSE 0 END), 0) as end_credit,
      COALESCE(SUM(CASE WHEN ${periodExpr} THEN l.debit ELSE 0 END), 0) as period_debit,
      COALESCE(SUM(CASE WHEN ${periodExpr} THEN l.credit ELSE 0 END), 0) as period_credit
    FROM accounts a
    LEFT JOIN ledgers l ON a.id = l.account_id
    GROUP BY a.type, a.is_cash_equivalent
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  let totalAssets = 0;
  let totalCashEquivalents = 0;
  let totalLiabilities = 0;
  let equityAccountsTotal = 0;
  let cumulativeRevenue = 0;
  let cumulativeExpenses = 0;
  let periodRevenue = 0;
  let periodExpenses = 0;
  let periodCostOfSales = 0;

  for (const r of rows) {
    const endDebit = parseFloat(r.end_debit);
    const endCredit = parseFloat(r.end_credit);
    const periodDebit = parseFloat(r.period_debit);
    const periodCredit = parseFloat(r.period_credit);

    if (r.type === 'ASSET') {
      const balance = endDebit - endCredit;
      totalAssets += balance;
      if (r.is_cash_equivalent) totalCashEquivalents += balance;
    } else if (r.type === 'LIABILITY') {
      totalLiabilities += endCredit - endDebit;
    } else if (r.type === 'EQUITY') {
      equityAccountsTotal += endCredit - endDebit;
    } else if (r.type === 'REVENUE') {
      cumulativeRevenue += endCredit - endDebit;
      periodRevenue += periodCredit - periodDebit;
    } else if (r.type === 'COST_OF_SALES') {
      // Debit-normal like Expense for retainedEarnings/netIncome purposes,
      // but tracked separately so Gross Margin can be computed for real.
      cumulativeExpenses += endDebit - endCredit;
      periodCostOfSales += periodDebit - periodCredit;
    } else if (r.type === 'EXPENSE') {
      cumulativeExpenses += endDebit - endCredit;
      periodExpenses += periodDebit - periodCredit;
    }
  }

  const retainedEarnings = cumulativeRevenue - cumulativeExpenses;
  const totalEquity = round2(equityAccountsTotal + retainedEarnings);
  totalAssets = round2(totalAssets);
  totalCashEquivalents = round2(totalCashEquivalents);
  totalLiabilities = round2(totalLiabilities);
  const totalRevenue = round2(periodRevenue);
  const totalCostOfSales = round2(periodCostOfSales);
  const totalExpenses = round2(periodExpenses);
  const netIncome = round2(totalRevenue - totalCostOfSales - totalExpenses);

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    netIncome,
    totalRevenue,
    totalExpenses,
    totalCostOfSales,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalCashEquivalents,
    netProfitMarginPct: totalRevenue > 0 ? round2((netIncome / totalRevenue) * 100) : null,
    grossProfitMarginPct: totalRevenue > 0 ? round2(((totalRevenue - totalCostOfSales) / totalRevenue) * 100) : null,
    returnOnAssetsPct: totalAssets > 0 ? round2((netIncome / totalAssets) * 100) : null,
    debtToEquityRatio: totalEquity !== 0 ? round2(totalLiabilities / totalEquity) : null,
    cashRatio: totalLiabilities > 0 ? round2(totalCashEquivalents / totalLiabilities) : null,
    equityRatioPct: totalAssets > 0 ? round2((totalEquity / totalAssets) * 100) : null,
  };
}

export async function getBalanceSheet(
  prisma: PrismaClient,
  asOfDate?: string,
  endDate?: string,
  fundId?: string
): Promise<BalanceSheetResult> {
  const effectiveAsOfDate = asOfDate || endDate;

  const ledgerConditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (effectiveAsOfDate) {
    ledgerConditions.push(`l.transaction_date <= $${paramIdx++}::date`);
    params.push(effectiveAsOfDate);
  }

  if (fundId) {
    ledgerConditions.push(`l.fund_id = $${paramIdx++}::uuid`);
    params.push(fundId);
  }

  const joinWhere = ledgerConditions.length > 0 ? `AND ${ledgerConditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      a.id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(l.debit), 0) as total_debit,
      COALESCE(SUM(l.credit), 0) as total_credit
    FROM accounts a
    LEFT JOIN ledgers l ON a.id = l.account_id ${joinWhere}
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC
  `;

  const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

  const assets: BalanceSheetAccount[] = [];
  const liabilities: BalanceSheetAccount[] = [];
  const equity: BalanceSheetAccount[] = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquityAccounts = 0;
  let cumulativeRevenue = 0;
  let cumulativeExpenses = 0;

  for (const r of rows) {
    const debit = parseFloat(r.total_debit);
    const credit = parseFloat(r.total_credit);

    if (r.type === 'ASSET') {
      const balance = Math.round((debit - credit) * 100) / 100;
      totalAssets += balance;
      assets.push({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        balance,
      });
    } else if (r.type === 'LIABILITY') {
      const balance = Math.round((credit - debit) * 100) / 100;
      totalLiabilities += balance;
      liabilities.push({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        balance,
      });
    } else if (r.type === 'EQUITY') {
      const balance = Math.round((credit - debit) * 100) / 100;
      totalEquityAccounts += balance;
      equity.push({
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        balance,
      });
    } else if (r.type === 'REVENUE') {
      cumulativeRevenue += (credit - debit);
    } else if (r.type === 'EXPENSE' || r.type === 'COST_OF_SALES') {
      cumulativeExpenses += (debit - credit);
    }
  }

  const retainedEarnings = Math.round((cumulativeRevenue - cumulativeExpenses) * 100) / 100;

  totalAssets = Math.round(totalAssets * 100) / 100;
  totalLiabilities = Math.round(totalLiabilities * 100) / 100;
  totalEquityAccounts = Math.round(totalEquityAccounts * 100) / 100;

  const totalEquity = Math.round((totalEquityAccounts + retainedEarnings) * 100) / 100;
  const totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;

  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

  return {
    asOfDate: effectiveAsOfDate || null,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquityAccounts,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
  };
}
