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
  asOfDate?: string
): Promise<ProfitLossResult> {
  const effectiveEndDate = endDate || asOfDate;

  const conditions: string[] = [`a.type IN ('REVENUE', 'EXPENSE')`];
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
  const expenses: ProfitLossAccount[] = [];

  let totalRevenue = 0;
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
  totalExpenses = Math.round(totalExpenses * 100) / 100;
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    asOfDate: asOfDate || null,
    revenues,
    totalRevenue,
    expenses,
    totalExpenses,
    netProfit,
    isProfit: netProfit >= 0,
  };
}

export async function getBalanceSheet(
  prisma: PrismaClient,
  asOfDate?: string,
  endDate?: string
): Promise<BalanceSheetResult> {
  const effectiveAsOfDate = asOfDate || endDate;

  const joinWhere = effectiveAsOfDate ? `AND l.transaction_date <= $1::date` : '';
  const params: any[] = effectiveAsOfDate ? [effectiveAsOfDate] : [];

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
    } else if (r.type === 'EXPENSE') {
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
