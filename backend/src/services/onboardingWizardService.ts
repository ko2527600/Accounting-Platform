import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalEntryRepository from '../repository/journalEntryRepository';
import * as accountService from './accountService';
import * as journalEntryService from './journalEntryService';
import { AuditActor } from './auditLogService';
import { GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE, ChartOfAccountsTemplateEntry } from '../data/ghanaSmeChartOfAccountsTemplate';

export class OnboardingWizardServiceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'OnboardingWizardServiceError';
    this.statusCode = statusCode;
  }
}

export interface OnboardingChecklist {
  businessProfileComplete: boolean;
  chartOfAccountsReady: boolean;
  openingBalancesPosted: boolean;
  firstTransactionRecorded: boolean;
}

export interface OnboardingStatus {
  businessType: string | null;
  vatRegistered: boolean;
  graTin: string | null;
  baseCurrency: string;
  isLive: boolean;
  accountCount: number;
  checklist: OnboardingChecklist;
}

const OPENING_BALANCE_ENTRY_PREFIX = 'OB-';

export function getChartOfAccountsTemplate(): ChartOfAccountsTemplateEntry[] {
  return GHANA_SME_CHART_OF_ACCOUNTS_TEMPLATE;
}

export async function getOnboardingStatus(tenantId: string): Promise<OnboardingStatus> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    throw new OnboardingWizardServiceError('Tenant not found.', 404);
  }

  const { accounts, journalEntries } = await withCurrentTenantDb(prisma, async (client) => {
    const accounts = await accountRepository.listAccounts(client);
    const journalEntries = await journalEntryRepository.listJournalEntries(client, {});
    return { accounts, journalEntries };
  });

  const [invoiceCount, vendorBillCount, cashSaleCount] = await Promise.all([
    prisma.invoice.count({ where: { tenantId } }),
    prisma.vendorBill.count({ where: { tenantId } }),
    prisma.cashSale.count({ where: { tenantId } }),
  ]);

  const nonOpeningBalanceEntries = journalEntries.filter(
    (je) => !je.entryNumber?.startsWith(OPENING_BALANCE_ENTRY_PREFIX)
  );

  const checklist: OnboardingChecklist = {
    businessProfileComplete: Boolean(tenant.businessType),
    chartOfAccountsReady: accounts.length > 0,
    openingBalancesPosted: tenant.isLive,
    firstTransactionRecorded: nonOpeningBalanceEntries.length > 0 || invoiceCount > 0 || vendorBillCount > 0 || cashSaleCount > 0,
  };

  return {
    businessType: tenant.businessType,
    vatRegistered: tenant.vatRegistered,
    graTin: tenant.graTin,
    baseCurrency: tenant.baseCurrency,
    isLive: tenant.isLive,
    accountCount: accounts.length,
    checklist,
  };
}

export interface UpdateBusinessProfileInput {
  businessType: string;
  vatRegistered: boolean;
  graTin?: string | null;
  baseCurrency?: string;
}

export async function updateBusinessProfile(tenantId: string, data: UpdateBusinessProfileInput): Promise<void> {
  if (!data.businessType || !data.businessType.trim()) {
    throw new OnboardingWizardServiceError('Business type is required.', 400);
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      businessType: data.businessType.trim(),
      vatRegistered: Boolean(data.vatRegistered),
      graTin: data.graTin?.trim() || null,
      ...(data.baseCurrency ? { baseCurrency: data.baseCurrency } : {}),
    },
  });
}

export interface SeedChartOfAccountsResult {
  created: number;
  skippedExisting: string[];
}

/**
 * Bulk-creates the (possibly client-edited) chart of accounts list, skipping
 * any code that already exists rather than failing the whole batch - lets a
 * tenant re-run this after manually adding a couple of accounts first.
 */
export async function seedChartOfAccounts(
  entries: ChartOfAccountsTemplateEntry[],
  actor?: AuditActor
): Promise<SeedChartOfAccountsResult> {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new OnboardingWizardServiceError('At least one account is required.', 400);
  }

  const existing = await withCurrentTenantDb(prisma, async (client) => accountRepository.listAccounts(client));
  const existingCodes = new Set(existing.map((a) => a.code));

  let created = 0;
  const skippedExisting: string[] = [];

  for (const entry of entries) {
    if (!entry.code || !entry.name || !entry.type) continue;
    if (existingCodes.has(entry.code)) {
      skippedExisting.push(entry.code);
      continue;
    }
    await accountService.createAccount({ code: entry.code, name: entry.name, type: entry.type as any }, actor);
    existingCodes.add(entry.code);
    created += 1;
  }

  // Auto-designate the default Cash/Revenue/Expense posting targets so
  // invoices/bills/expense-claims post correctly from day one - see
  // accountRepository.resolveDefaultAccount's own comment for the bug this
  // closes (posting used to guess a hardcoded account CODE this template
  // doesn't actually use, e.g. Sales Revenue is coded 4000 here, not the
  // '4010' the old fallback looked for). Only fills in a role that's still
  // unset - never overrides a designation the tenant, or an earlier partial
  // wizard run, already made.
  if (created > 0) {
    const freshAccounts = await withCurrentTenantDb(prisma, async (client) => accountRepository.listAccounts(client));
    for (const role of [
      'CASH', 'REVENUE', 'EXPENSE', 'COGS', 'INVENTORY_ASSET',
      'SALARY_EXPENSE', 'EMPLOYER_SSNIT_EXPENSE', 'PAYE_PAYABLE', 'SSNIT_PAYABLE', 'NET_PAY_PAYABLE',
    ] as const) {
      if (freshAccounts.some((a) => a.defaultRole === role)) continue;
      const candidate = accountRepository.pickAutoDefaultCandidate(freshAccounts, role);
      if (candidate) {
        await accountService.setDefaultRole(candidate.id, role, actor);
      }
    }
  }

  return { created, skippedExisting };
}

export interface OpeningBalanceLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
}

export interface PostOpeningBalancesInput {
  asOfDate?: string;
  lines: OpeningBalanceLineInput[];
}

/**
 * The hard trial-balance gate: posts the opening balances as a real journal
 * entry, reusing journalEntryService.createJournalEntry's own double-entry
 * balance check rather than duplicating that logic - if debits don't equal
 * credits, that call throws with the exact totals and this rejects the same
 * way, in code, with no soft-warning path around it. Only on success does
 * `Tenant.isLive` flip true.
 */
export async function postOpeningBalances(
  tenantId: string,
  data: PostOpeningBalancesInput,
  actor?: AuditActor
): Promise<{ journalEntryId: string; entryNumber: string }> {
  if (!data.lines || !Array.isArray(data.lines) || data.lines.length === 0) {
    throw new OnboardingWizardServiceError('At least one account balance is required.', 400);
  }

  const lines = data.lines
    .filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
    .map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    }));

  if (lines.length < 2) {
    throw new OnboardingWizardServiceError(
      'At least two accounts with a non-zero opening balance are required (opening balances are entered as debits and credits, like any other journal entry).',
      400
    );
  }

  const entryNumber = `${OPENING_BALANCE_ENTRY_PREFIX}${Date.now()}`;

  let entry;
  try {
    entry = await journalEntryService.createJournalEntry(
      {
        entryNumber,
        entryDate: data.asOfDate,
        description: 'Opening Balances',
        status: 'POSTED',
        lines,
      },
      actor
    );
  } catch (error: any) {
    if (error instanceof journalEntryService.JournalEntryServiceError) {
      // Re-thrown as this service's own error type, same message (the
      // "Total Debits (X) must equal Total Credits (Y)" text already points
      // at exactly what's mismatched) and status code - callers only need to
      // handle one error type from this module.
      throw new OnboardingWizardServiceError(error.message, error.statusCode);
    }
    throw error;
  }

  await prisma.tenant.update({ where: { id: tenantId }, data: { isLive: true } });

  return { journalEntryId: entry.id, entryNumber: entry.entryNumber };
}
