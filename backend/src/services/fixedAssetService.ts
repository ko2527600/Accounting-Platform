import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalEntryService from './journalEntryService';
import { AuditActor } from './auditLogService';
import { DepreciationMethod, FixedAssetStatus } from '@prisma/client';

export class FixedAssetServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'FixedAssetServiceError';
    this.statusCode = statusCode;
  }
}

export interface CreateFixedAssetInput {
  name: string;
  category?: string;
  serialNumber?: string;
  acquisitionDate: string | Date;
  cost: number;
  residualValue?: number;
  depreciationMethod: DepreciationMethod;
  usefulLifeMonths?: number;
  depreciationRatePercent?: number;
  assetAccountId: string;
  paymentAccountId: string;
  notes?: string;
}

/**
 * Creates a fixed asset register entry and immediately posts its
 * acquisition journal entry (Debit assetAccountId, Credit paymentAccountId
 * for the full cost) - see the schema model's own doc comment for why this
 * is scoped to "paid for immediately" rather than integrating with vendor
 * credit terms. Auto-flips Account.isFixedAsset on the chosen asset account
 * if it isn't already set, since a tenant shouldn't have to separately
 * remember to toggle that in Chart of Accounts for the Cash Flow
 * Statement's Investing section to pick it up correctly.
 */
export async function createFixedAsset(tenantId: string, input: CreateFixedAssetInput, actor?: AuditActor) {
  if (!input.name || !input.name.trim()) {
    throw new FixedAssetServiceError('A name is required.', 400);
  }
  const cost = Number(input.cost);
  if (isNaN(cost) || cost <= 0) {
    throw new FixedAssetServiceError('Cost must be a positive number.', 400);
  }
  const residualValue = input.residualValue !== undefined ? Number(input.residualValue) : 0;
  if (isNaN(residualValue) || residualValue < 0) {
    throw new FixedAssetServiceError('Residual value must be a non-negative number.', 400);
  }
  if (residualValue >= cost) {
    throw new FixedAssetServiceError('Residual value must be less than cost.', 400);
  }
  if (!input.acquisitionDate) {
    throw new FixedAssetServiceError('An acquisition date is required.', 400);
  }
  const acquisitionDate = new Date(input.acquisitionDate);
  if (isNaN(acquisitionDate.getTime())) {
    throw new FixedAssetServiceError('acquisitionDate must be a valid date.', 400);
  }

  if (input.depreciationMethod !== 'STRAIGHT_LINE' && input.depreciationMethod !== 'REDUCING_BALANCE') {
    throw new FixedAssetServiceError('depreciationMethod must be "STRAIGHT_LINE" or "REDUCING_BALANCE".', 400);
  }
  if (input.depreciationMethod === 'STRAIGHT_LINE') {
    if (!input.usefulLifeMonths || input.usefulLifeMonths <= 0) {
      throw new FixedAssetServiceError('usefulLifeMonths must be a positive number for the straight-line method.', 400);
    }
  } else {
    if (!input.depreciationRatePercent || input.depreciationRatePercent <= 0 || input.depreciationRatePercent > 100) {
      throw new FixedAssetServiceError('depreciationRatePercent must be between 0 and 100 for the reducing-balance method.', 400);
    }
  }

  if (!input.assetAccountId || !input.paymentAccountId) {
    throw new FixedAssetServiceError('Both an asset account and a payment account are required.', 400);
  }
  if (input.assetAccountId === input.paymentAccountId) {
    throw new FixedAssetServiceError('The asset account and payment account must be different.', 400);
  }

  const { assetAccount, paymentAccount } = await withCurrentTenantDb(prisma, async (client) => {
    const accounts = await accountRepository.listAccounts(client);
    const assetAccount = accounts.find((a) => a.id === input.assetAccountId);
    const paymentAccount = accounts.find((a) => a.id === input.paymentAccountId);
    if (!assetAccount) throw new FixedAssetServiceError('Asset account not found.', 400);
    if (!paymentAccount) throw new FixedAssetServiceError('Payment account not found.', 400);
    if (assetAccount.type !== 'ASSET') {
      throw new FixedAssetServiceError(`"${assetAccount.name}" is a ${assetAccount.type} account - the asset account must be an ASSET account.`, 400);
    }
    return { assetAccount, paymentAccount };
  });

  const name = input.name.trim();
  const entryNumber = `FA-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const journal = await journalEntryService.createJournalEntry(
    {
      entryNumber,
      entryDate: acquisitionDate,
      description: `Fixed Asset Acquisition: ${name}`,
      status: 'POSTED',
      lines: [
        { accountId: input.assetAccountId, debit: cost, credit: 0, description: name },
        { accountId: input.paymentAccountId, debit: 0, credit: cost, description: name },
      ],
    },
    actor
  );

  if (!assetAccount.isFixedAsset) {
    await withCurrentTenantDb(prisma, async (client) => {
      await accountRepository.updateAccount(client, input.assetAccountId, { isFixedAsset: true });
    });
  }

  const asset = await prisma.fixedAsset.create({
    data: {
      tenantId,
      name,
      category: input.category?.trim() || null,
      serialNumber: input.serialNumber?.trim() || null,
      acquisitionDate,
      cost,
      residualValue,
      depreciationMethod: input.depreciationMethod,
      usefulLifeMonths: input.depreciationMethod === 'STRAIGHT_LINE' ? input.usefulLifeMonths : null,
      depreciationRatePercent: input.depreciationMethod === 'REDUCING_BALANCE' ? input.depreciationRatePercent : null,
      assetAccountId: input.assetAccountId,
      paymentAccountId: input.paymentAccountId,
      acquisitionJournalId: journal.id,
      notes: input.notes?.trim() || null,
    },
  });

  return { asset, journal, assetAccountName: assetAccount.name, paymentAccountName: paymentAccount.name };
}

export async function listFixedAssets(tenantId: string) {
  return prisma.fixedAsset.findMany({ where: { tenantId }, orderBy: { acquisitionDate: 'desc' } });
}

export async function getFixedAssetById(tenantId: string, id: string) {
  const asset = await prisma.fixedAsset.findFirst({
    where: { id, tenantId },
    include: { depreciationEntries: { orderBy: { period: 'asc' } } },
  });
  if (!asset) {
    throw new FixedAssetServiceError('Fixed asset not found.', 404);
  }
  return asset;
}

/**
 * Marks a fixed asset disposed, stopping all further depreciation. No
 * write-off/gain-or-loss-on-disposal journal entry in this pass - a
 * documented scope simplification (same category as Credit Notes being
 * "financial correction only, no inventory effect") rather than an
 * oversight; the asset's historical depreciation entries and journal trail
 * remain fully intact either way.
 */
export async function disposeFixedAsset(
  tenantId: string,
  id: string,
  disposalDate: string | Date,
  notes?: string
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  if (!asset) {
    throw new FixedAssetServiceError('Fixed asset not found.', 404);
  }
  if (asset.status === 'DISPOSED') {
    throw new FixedAssetServiceError('This asset is already marked disposed.', 400);
  }
  const parsedDate = disposalDate ? new Date(disposalDate) : new Date();
  if (isNaN(parsedDate.getTime())) {
    throw new FixedAssetServiceError('disposalDate must be a valid date.', 400);
  }

  return prisma.fixedAsset.update({
    where: { id },
    data: {
      status: 'DISPOSED' as FixedAssetStatus,
      disposalDate: parsedDate,
      disposalNotes: notes?.trim() || null,
    },
  });
}

function currentPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Every ACTIVE fixed asset in this tenant that's due for a depreciation
 * posting this period (not already depreciated through the current month,
 * and acquired before this period - depreciation starts the month AFTER
 * acquisition, a documented simplification avoiding partial-month
 * proration).
 */
export async function listAssetsDueForDepreciation(tenantId: string, now: Date = new Date()) {
  const period = currentPeriod(now);
  const assets = await prisma.fixedAsset.findMany({ where: { tenantId, status: 'ACTIVE' } });
  return assets.filter((asset) => {
    if (asset.lastDepreciatedThrough && currentPeriod(asset.lastDepreciatedThrough) >= period) return false;
    if (currentPeriod(asset.acquisitionDate) >= period) return false;
    return true;
  });
}

/**
 * Posts one period's depreciation for a single fixed asset - called per
 * due asset by the cron's own loop (see FixedAssetDepreciationCronService),
 * which catches per-asset so one misconfigured asset (e.g. no default
 * DEPRECIATION_EXPENSE/ACCUMULATED_DEPRECIATION account) never blocks the
 * rest of the sweep, same resilience pattern as every other per-tenant cron
 * in this codebase. Capped so accumulatedDepreciation never exceeds
 * (cost - residualValue); once it reaches that cap the asset flips to
 * FULLY_DEPRECIATED.
 */
export async function depreciateOneAsset(tenantId: string, assetId: string, now: Date = new Date()): Promise<void> {
  const period = currentPeriod(now);
  const asset = await prisma.fixedAsset.findFirst({ where: { id: assetId, tenantId, status: 'ACTIVE' } });
  if (!asset) return;
  if (asset.lastDepreciatedThrough && currentPeriod(asset.lastDepreciatedThrough) >= period) return;

  const cost = Number(asset.cost);
  const residualValue = Number(asset.residualValue);
  const depreciableBase = cost - residualValue;
  const alreadyDepreciated = Number(asset.accumulatedDepreciation);
  const remaining = Math.round((depreciableBase - alreadyDepreciated) * 100) / 100;
  if (remaining <= 0.005) {
    await prisma.fixedAsset.update({ where: { id: asset.id }, data: { status: 'FULLY_DEPRECIATED' } });
    return;
  }

  let rawAmount: number;
  if (asset.depreciationMethod === 'STRAIGHT_LINE') {
    rawAmount = depreciableBase / (asset.usefulLifeMonths || 1);
  } else {
    const netBookValue = cost - alreadyDepreciated;
    rawAmount = (netBookValue * (Number(asset.depreciationRatePercent) / 100)) / 12;
  }
  const amount = Math.min(Math.round(rawAmount * 100) / 100, remaining);
  if (amount <= 0) return;

  const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));
  const expenseAccount = accountRepository.resolveDefaultAccount(accounts, 'DEPRECIATION_EXPENSE');
  const accumulatedDepAccount = accountRepository.resolveDefaultAccount(accounts, 'ACCUMULATED_DEPRECIATION');
  if (!expenseAccount || !accumulatedDepAccount) {
    throw new FixedAssetServiceError(
      `Cannot post depreciation for "${asset.name}": no default Depreciation Expense / Accumulated Depreciation account is configured for this tenant. Designate both in Chart of Accounts.`,
      400
    );
  }

  const journal = await journalEntryService.createJournalEntry({
    entryNumber: `DEP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    entryDate: now,
    description: `Depreciation - ${asset.name} (${period})`,
    status: 'POSTED',
    lines: [
      { accountId: expenseAccount.id, debit: amount, credit: 0, description: asset.name },
      { accountId: accumulatedDepAccount.id, debit: 0, credit: amount, description: asset.name },
    ],
  });

  const newAccumulated = Math.round((alreadyDepreciated + amount) * 100) / 100;
  const newStatus: FixedAssetStatus = newAccumulated >= depreciableBase - 0.005 ? 'FULLY_DEPRECIATED' : 'ACTIVE';

  await prisma.fixedAsset.update({
    where: { id: asset.id },
    data: {
      accumulatedDepreciation: newAccumulated,
      lastDepreciatedThrough: now,
      status: newStatus,
    },
  });

  await prisma.depreciationEntry.create({
    data: {
      tenantId,
      fixedAssetId: asset.id,
      period,
      amount,
      netBookValueAfter: Math.round((cost - newAccumulated) * 100) / 100,
      journalId: journal.id,
    },
  });
}
