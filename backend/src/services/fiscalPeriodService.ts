import { prisma } from '../config/db';
import * as fiscalPeriodRepository from '../repository/fiscalPeriodRepository';
import { FiscalPeriodRecord, CreateFiscalPeriodData } from '../repository/fiscalPeriodRepository';
import { recordAuditLog, diffFields, AuditActor } from './auditLogService';

export class FiscalPeriodServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'FiscalPeriodServiceError';
    this.statusCode = statusCode;
  }
}

export async function listFiscalPeriods(tenantId: string): Promise<FiscalPeriodRecord[]> {
  return fiscalPeriodRepository.listFiscalPeriods(prisma, tenantId);
}

export async function getFiscalPeriodById(tenantId: string, id: string): Promise<FiscalPeriodRecord | null> {
  return fiscalPeriodRepository.getFiscalPeriodById(prisma, tenantId, id);
}

export async function createFiscalPeriod(tenantId: string, input: any, actor?: AuditActor): Promise<FiscalPeriodRecord> {
  const { name, fiscalYear, periodNumber, startDate, endDate } = input;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new FiscalPeriodServiceError('Fiscal period name is required.', 400);
  }
  const year = Number(fiscalYear);
  const period = Number(periodNumber);
  if (!Number.isInteger(year) || year < 1900) {
    throw new FiscalPeriodServiceError('fiscalYear must be a valid year.', 400);
  }
  if (!Number.isInteger(period) || period < 1) {
    throw new FiscalPeriodServiceError('periodNumber must be a positive integer.', 400);
  }
  if (!startDate || !endDate) {
    throw new FiscalPeriodServiceError('startDate and endDate are required.', 400);
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new FiscalPeriodServiceError('startDate/endDate must be valid dates.', 400);
  }
  if (end <= start) {
    throw new FiscalPeriodServiceError('endDate must be after startDate.', 400);
  }

  const data: CreateFiscalPeriodData = { name, fiscalYear: year, periodNumber: period, startDate: start, endDate: end };

  let created: FiscalPeriodRecord;
  try {
    created = await fiscalPeriodRepository.createFiscalPeriod(prisma, tenantId, data);
  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new FiscalPeriodServiceError(
        `Fiscal period ${period} of fiscal year ${year} already exists for this tenant.`,
        409
      );
    }
    throw error;
  }

  await recordAuditLog({
    action: 'FISCAL_PERIOD.CREATED',
    entity: 'FiscalPeriod',
    entityId: created.id,
    tenantId,
    actor,
    details: `Fiscal period ${created.name} (FY${created.fiscalYear} P${created.periodNumber}) created.`,
  });

  return created;
}

export async function closeFiscalPeriod(tenantId: string, id: string, closedBy?: string, actor?: AuditActor): Promise<FiscalPeriodRecord> {
  const existing = await fiscalPeriodRepository.getFiscalPeriodById(prisma, tenantId, id);
  if (!existing) {
    throw new FiscalPeriodServiceError(`Fiscal period with ID "${id}" not found.`, 404);
  }
  if (existing.status !== 'OPEN') {
    throw new FiscalPeriodServiceError(`Only an OPEN period can be closed (current status: ${existing.status}).`, 400);
  }
  const updated = await fiscalPeriodRepository.setFiscalPeriodStatus(prisma, id, 'CLOSED', closedBy);

  await recordAuditLog({
    action: 'FISCAL_PERIOD.CLOSED',
    entity: 'FiscalPeriod',
    entityId: id,
    tenantId,
    actor,
    changes: diffFields(existing, updated, ['status']),
  });

  return updated;
}

export async function lockFiscalPeriod(tenantId: string, id: string, actor?: AuditActor): Promise<FiscalPeriodRecord> {
  const existing = await fiscalPeriodRepository.getFiscalPeriodById(prisma, tenantId, id);
  if (!existing) {
    throw new FiscalPeriodServiceError(`Fiscal period with ID "${id}" not found.`, 404);
  }
  if (existing.status !== 'CLOSED') {
    throw new FiscalPeriodServiceError(`Only a CLOSED period can be locked (current status: ${existing.status}).`, 400);
  }
  const updated = await fiscalPeriodRepository.setFiscalPeriodStatus(prisma, id, 'LOCKED');

  await recordAuditLog({
    action: 'FISCAL_PERIOD.LOCKED',
    entity: 'FiscalPeriod',
    entityId: id,
    tenantId,
    actor,
    changes: diffFields(existing, updated, ['status']),
  });

  return updated;
}

/**
 * Throws if the tenant has a fiscal period covering `date` that is not OPEN.
 * If no period has been configured at all for that date, posting is allowed -
 * period locking is opt-in per tenant, not a forced migration of past behavior.
 */
export async function assertPeriodOpenForDate(tenantId: string, date: Date): Promise<void> {
  const period = await fiscalPeriodRepository.findFiscalPeriodForDate(prisma, tenantId, date);
  if (period && period.status !== 'OPEN') {
    throw new FiscalPeriodServiceError(
      `The fiscal period "${period.name}" covering ${date.toISOString().split('T')[0]} is ${period.status} - postings are not allowed.`,
      400
    );
  }
}
