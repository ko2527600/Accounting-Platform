import { PrismaClient } from '@prisma/client';

export interface TaxRateComponent {
  name: string;
  rate: number;
}

export interface TaxRateRecord {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  rate: string;
  description: string | null;
  accountId: string | null;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  components: TaxRateComponent[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaxRateData {
  name: string;
  code: string;
  rate: number;
  description?: string | null;
  accountId?: string | null;
  isActive?: boolean;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  components?: TaxRateComponent[] | null;
}

export async function listTaxRates(prisma: PrismaClient, tenantId: string): Promise<TaxRateRecord[]> {
  return (prisma as any).taxRate.findMany({
    where: { tenantId },
    orderBy: { effectiveFrom: 'desc' },
  });
}

export async function getTaxRateById(prisma: PrismaClient, tenantId: string, id: string): Promise<TaxRateRecord | null> {
  return (prisma as any).taxRate.findFirst({ where: { id, tenantId } });
}

export async function getTaxRateByCode(prisma: PrismaClient, tenantId: string, code: string): Promise<TaxRateRecord | null> {
  return (prisma as any).taxRate.findFirst({ where: { tenantId, code } });
}

/**
 * Finds the single active TaxRate covering a given date - i.e. the tenant's
 * real, current tax rate to apply, rather than a hardcoded percentage.
 */
export async function findActiveTaxRateForDate(
  prisma: PrismaClient,
  tenantId: string,
  date: Date
): Promise<TaxRateRecord[]> {
  return (prisma as any).taxRate.findMany({
    where: {
      tenantId,
      isActive: true,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
  });
}

export async function createTaxRate(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateTaxRateData
): Promise<TaxRateRecord> {
  return (prisma as any).taxRate.create({
    data: {
      tenantId,
      name: data.name.trim(),
      code: data.code.trim(),
      rate: data.rate,
      description: data.description ?? null,
      accountId: data.accountId ?? null,
      isActive: data.isActive !== undefined ? data.isActive : true,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo ?? null,
      components: data.components ?? null,
    },
  });
}

export async function updateTaxRate(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  data: Partial<CreateTaxRateData>
): Promise<TaxRateRecord | null> {
  const existing = await getTaxRateById(prisma, tenantId, id);
  if (!existing) return null;

  return (prisma as any).taxRate.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.code !== undefined ? { code: data.code.trim() } : {}),
      ...(data.rate !== undefined ? { rate: data.rate } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.effectiveFrom !== undefined ? { effectiveFrom: data.effectiveFrom } : {}),
      ...(data.effectiveTo !== undefined ? { effectiveTo: data.effectiveTo } : {}),
      ...(data.components !== undefined ? { components: data.components } : {}),
    },
  });
}

export async function countInvoicesUsingTaxRate(prisma: PrismaClient, tenantId: string, id: string): Promise<number> {
  return (prisma as any).invoice.count({ where: { tenantId, taxRateId: id } });
}

export async function deleteTaxRate(prisma: PrismaClient, tenantId: string, id: string): Promise<boolean> {
  const existing = await getTaxRateById(prisma, tenantId, id);
  if (!existing) return false;

  await (prisma as any).taxRate.delete({ where: { id } });
  return true;
}
