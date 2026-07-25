import { PrismaClient } from '@prisma/client';

export type PeriodStatus = 'OPEN' | 'CLOSED' | 'LOCKED';

export interface FiscalPeriodRecord {
  id: string;
  tenantId: string;
  name: string;
  fiscalYear: number;
  periodNumber: number;
  startDate: Date;
  endDate: Date;
  status: PeriodStatus;
  closedAt: Date | null;
  closedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFiscalPeriodData {
  name: string;
  fiscalYear: number;
  periodNumber: number;
  startDate: Date;
  endDate: Date;
}

export async function listFiscalPeriods(prisma: PrismaClient, tenantId: string): Promise<FiscalPeriodRecord[]> {
  return (prisma as any).fiscalPeriod.findMany({
    where: { tenantId },
    orderBy: [{ fiscalYear: 'desc' }, { periodNumber: 'desc' }],
  });
}

export async function getFiscalPeriodById(prisma: PrismaClient, tenantId: string, id: string): Promise<FiscalPeriodRecord | null> {
  return (prisma as any).fiscalPeriod.findFirst({ where: { id, tenantId } });
}

/**
 * Finds the fiscal period covering a given date, if the tenant has defined one.
 * Returns null if no period covers the date (callers decide whether that means
 * "allow" - no period configured yet - or "reject").
 */
export async function findFiscalPeriodForDate(
  prisma: PrismaClient,
  tenantId: string,
  date: Date
): Promise<FiscalPeriodRecord | null> {
  return (prisma as any).fiscalPeriod.findFirst({
    where: { tenantId, startDate: { lte: date }, endDate: { gte: date } },
  });
}

export async function createFiscalPeriod(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateFiscalPeriodData
): Promise<FiscalPeriodRecord> {
  return (prisma as any).fiscalPeriod.create({
    data: {
      tenantId,
      name: data.name.trim(),
      fiscalYear: data.fiscalYear,
      periodNumber: data.periodNumber,
      startDate: data.startDate,
      endDate: data.endDate,
      status: 'OPEN',
    },
  });
}

export async function setFiscalPeriodStatus(
  prisma: PrismaClient,
  id: string,
  status: PeriodStatus,
  closedBy?: string
): Promise<FiscalPeriodRecord> {
  return (prisma as any).fiscalPeriod.update({
    where: { id },
    data: {
      status,
      ...(status === 'CLOSED' ? { closedAt: new Date(), closedBy: closedBy || null } : {}),
    },
  });
}
