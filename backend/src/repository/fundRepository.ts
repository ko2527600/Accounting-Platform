import { PrismaClient } from '@prisma/client';

export interface FundRecord {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  isRestricted: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFundData {
  name: string;
  code: string;
  description?: string | null;
  isRestricted?: boolean;
  isActive?: boolean;
}

export async function listFunds(prisma: PrismaClient, tenantId: string): Promise<FundRecord[]> {
  return (prisma as any).fund.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  });
}

export async function getFundById(prisma: PrismaClient, tenantId: string, id: string): Promise<FundRecord | null> {
  return (prisma as any).fund.findFirst({ where: { id, tenantId } });
}

export async function getFundByCode(prisma: PrismaClient, tenantId: string, code: string): Promise<FundRecord | null> {
  return (prisma as any).fund.findFirst({ where: { tenantId, code } });
}

export async function createFund(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateFundData
): Promise<FundRecord> {
  return (prisma as any).fund.create({
    data: {
      tenantId,
      name: data.name.trim(),
      code: data.code.trim(),
      description: data.description ?? null,
      isRestricted: data.isRestricted !== undefined ? data.isRestricted : true,
      isActive: data.isActive !== undefined ? data.isActive : true,
    },
  });
}

export async function updateFund(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  data: Partial<CreateFundData>
): Promise<FundRecord | null> {
  const existing = await getFundById(prisma, tenantId, id);
  if (!existing) return null;

  return (prisma as any).fund.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.code !== undefined ? { code: data.code.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.isRestricted !== undefined ? { isRestricted: data.isRestricted } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

export async function countInvoicesUsingFund(prisma: PrismaClient, tenantId: string, id: string): Promise<number> {
  return (prisma as any).invoice.count({ where: { tenantId, fundId: id } });
}

export async function countBillsUsingFund(prisma: PrismaClient, tenantId: string, id: string): Promise<number> {
  return (prisma as any).vendorBill.count({ where: { tenantId, fundId: id } });
}

export async function deleteFund(prisma: PrismaClient, tenantId: string, id: string): Promise<boolean> {
  const existing = await getFundById(prisma, tenantId, id);
  if (!existing) return false;

  await (prisma as any).fund.delete({ where: { id } });
  return true;
}
