import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as fundRepository from '../repository/fundRepository';
import { FundRecord, CreateFundData } from '../repository/fundRepository';

export class FundServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'FundServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * Confirms a fundId (referenced from a per-tenant-schema journal_entry_line
 * / ledger row, or from an Invoice/VendorBill) actually belongs to this
 * tenant and is active. Fund lives in the shared public schema (unlike
 * Account, which needed withCurrentTenantDb) so this is a plain lookup - no
 * tenant-schema switch required. Mirrors taxRateService's validateAccountIds
 * in spirit, in the opposite schema direction.
 */
export async function validateFundId(tenantId: string, fundId: string): Promise<void> {
  const fund = await fundRepository.getFundById(prisma, tenantId, fundId);
  if (!fund) {
    throw new FundServiceError(`Fund with ID "${fundId}" does not exist.`, 400);
  }
  if (!fund.isActive) {
    throw new FundServiceError(`Fund "${fund.name}" (${fund.code}) is deactivated and cannot be used.`, 400);
  }
}

/**
 * Counts journal_entry_lines referencing this fund - cross-schema (that
 * table lives in the tenant's own Postgres schema, not the shared schema
 * Fund lives in), so this needs withCurrentTenantDb + raw SQL rather than a
 * plain Prisma model count.
 */
async function countJournalLinesUsingFund(id: string): Promise<number> {
  return withCurrentTenantDb(prisma, async (client) => {
    const rows: any[] = await client.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM journal_entry_lines WHERE fund_id = $1::uuid`,
      id
    );
    return rows[0]?.count ?? 0;
  });
}

export async function listFunds(tenantId: string): Promise<FundRecord[]> {
  return fundRepository.listFunds(prisma, tenantId);
}

export async function getFundById(tenantId: string, id: string): Promise<FundRecord | null> {
  return fundRepository.getFundById(prisma, tenantId, id);
}

export async function createFund(tenantId: string, input: any): Promise<FundRecord> {
  const { name, code, description, isRestricted, isActive } = input;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new FundServiceError('Fund name is required.', 400);
  }
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new FundServiceError('Fund code is required.', 400);
  }

  const existingCode = await fundRepository.getFundByCode(prisma, tenantId, code.trim());
  if (existingCode) {
    throw new FundServiceError(`Fund code "${code.trim()}" already exists.`, 409);
  }

  const data: CreateFundData = {
    name,
    code,
    description,
    isRestricted: isRestricted !== undefined ? Boolean(isRestricted) : true,
    isActive,
  };

  return fundRepository.createFund(prisma, tenantId, data);
}

export async function updateFund(tenantId: string, id: string, input: any): Promise<FundRecord> {
  const existing = await fundRepository.getFundById(prisma, tenantId, id);
  if (!existing) {
    throw new FundServiceError(`Fund with ID "${id}" not found.`, 404);
  }

  const data: Partial<CreateFundData> = {};

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new FundServiceError('Fund name cannot be empty.', 400);
    data.name = input.name;
  }
  if (input.code !== undefined) {
    if (!input.code.trim()) throw new FundServiceError('Fund code cannot be empty.', 400);
    if (input.code.trim() !== existing.code) {
      const existingCode = await fundRepository.getFundByCode(prisma, tenantId, input.code.trim());
      if (existingCode) {
        throw new FundServiceError(`Fund code "${input.code.trim()}" already exists.`, 409);
      }
    }
    data.code = input.code;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.isRestricted !== undefined) data.isRestricted = Boolean(input.isRestricted);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  const updated = await fundRepository.updateFund(prisma, tenantId, id, data);
  if (!updated) {
    throw new FundServiceError(`Failed to update fund with ID "${id}".`, 500);
  }
  return updated;
}

export async function deleteFund(tenantId: string, id: string): Promise<void> {
  const existing = await fundRepository.getFundById(prisma, tenantId, id);
  if (!existing) {
    throw new FundServiceError(`Fund with ID "${id}" not found.`, 404);
  }

  const [invoiceCount, billCount, journalLineCount] = await Promise.all([
    fundRepository.countInvoicesUsingFund(prisma, tenantId, id),
    fundRepository.countBillsUsingFund(prisma, tenantId, id),
    countJournalLinesUsingFund(id),
  ]);
  const usageCount = invoiceCount + billCount + journalLineCount;
  if (usageCount > 0) {
    throw new FundServiceError(
      `Cannot delete fund "${existing.name}" (${existing.code}) because it is referenced by ${usageCount} transaction(s). Deactivate it instead.`,
      400
    );
  }

  await fundRepository.deleteFund(prisma, tenantId, id);
}
