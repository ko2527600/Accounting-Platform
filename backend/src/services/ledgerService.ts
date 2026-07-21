import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as ledgerRepository from '../repository/ledgerRepository';
import {
  ListLedgerFilter,
  ListLedgerResult,
  AccountLedgerStatement,
  LedgerSummaryResult,
} from '../repository/ledgerRepository';
import * as accountRepository from '../repository/accountRepository';

export class LedgerServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'LedgerServiceError';
    this.statusCode = statusCode;
  }
}

function validateDateFormat(dateStr: string, paramName: string) {
  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new LedgerServiceError(`Invalid ${paramName} format. Expected YYYY-MM-DD.`, 400);
  }
}

export async function listLedgers(filter: ListLedgerFilter = {}): Promise<ListLedgerResult> {
  if (filter.startDate) validateDateFormat(filter.startDate, 'startDate');
  if (filter.endDate) validateDateFormat(filter.endDate, 'endDate');

  return withCurrentTenantDb(prisma, async (client) => {
    if (filter.accountId) {
      const account = await accountRepository.getAccountById(client, filter.accountId);
      if (!account) {
        throw new LedgerServiceError(`Account with ID "${filter.accountId}" not found.`, 404);
      }
    }
    return ledgerRepository.listLedgerTransactions(client, filter);
  });
}

export async function getAccountStatement(
  accountId: string,
  startDate?: string,
  endDate?: string
): Promise<AccountLedgerStatement> {
  if (!accountId || typeof accountId !== 'string') {
    throw new LedgerServiceError('Account ID is required.', 400);
  }

  if (startDate) validateDateFormat(startDate, 'startDate');
  if (endDate) validateDateFormat(endDate, 'endDate');

  return withCurrentTenantDb(prisma, async (client) => {
    const account = await accountRepository.getAccountById(client, accountId);
    if (!account) {
      throw new LedgerServiceError(`Account with ID "${accountId}" not found.`, 404);
    }

    return ledgerRepository.getAccountLedgerStatement(client, account, startDate, endDate);
  });
}

export async function getLedgerSummary(
  startDate?: string,
  endDate?: string
): Promise<LedgerSummaryResult> {
  if (startDate) validateDateFormat(startDate, 'startDate');
  if (endDate) validateDateFormat(endDate, 'endDate');

  return withCurrentTenantDb(prisma, async (client) => {
    return ledgerRepository.getGeneralLedgerSummary(client, startDate, endDate);
  });
}
