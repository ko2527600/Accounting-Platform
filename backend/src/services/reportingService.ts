import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as reportRepository from '../repository/reportRepository';
import {
  TrialBalanceResult,
  ProfitLossResult,
  BalanceSheetResult,
} from '../repository/reportRepository';

export class ReportingServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'ReportingServiceError';
    this.statusCode = statusCode;
  }
}

function validateDateFormat(dateStr: string, paramName: string) {
  if (!dateStr) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ReportingServiceError(`Invalid ${paramName} format. Expected YYYY-MM-DD.`, 400);
  }
  // Also validate the date is semantically valid (e.g. not 2026-13-45)
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime()) || parsed.toISOString().split('T')[0] !== dateStr) {
    throw new ReportingServiceError(`Invalid ${paramName} format. Expected YYYY-MM-DD.`, 400);
  }
}

export async function getTrialBalance(
  startDate?: string,
  endDate?: string,
  asOfDate?: string
): Promise<TrialBalanceResult> {
  if (startDate) validateDateFormat(startDate, 'startDate');
  if (endDate) validateDateFormat(endDate, 'endDate');
  if (asOfDate) validateDateFormat(asOfDate, 'asOfDate');

  return withCurrentTenantDb(prisma, async (client) => {
    return reportRepository.getTrialBalance(client, startDate, endDate, asOfDate);
  });
}

export async function getProfitAndLoss(
  startDate?: string,
  endDate?: string,
  asOfDate?: string
): Promise<ProfitLossResult> {
  if (startDate) validateDateFormat(startDate, 'startDate');
  if (endDate) validateDateFormat(endDate, 'endDate');
  if (asOfDate) validateDateFormat(asOfDate, 'asOfDate');

  return withCurrentTenantDb(prisma, async (client) => {
    return reportRepository.getProfitAndLoss(client, startDate, endDate, asOfDate);
  });
}

export async function getBalanceSheet(
  asOfDate?: string,
  endDate?: string
): Promise<BalanceSheetResult> {
  if (asOfDate) validateDateFormat(asOfDate, 'asOfDate');
  if (endDate) validateDateFormat(endDate, 'endDate');

  return withCurrentTenantDb(prisma, async (client) => {
    return reportRepository.getBalanceSheet(client, asOfDate, endDate);
  });
}
