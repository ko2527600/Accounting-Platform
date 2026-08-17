import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as taxRateService from './taxRateService';
import * as fxRateService from './fxRateService';
import { recordChange, notifyChange, invoiceToSyncPayload } from './syncChangeLogService';
import { advanceDate } from './recurringTransactionService';
import { RecurrenceFrequency } from '@prisma/client';

export class RecurringInvoiceServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'RecurringInvoiceServiceError';
    this.statusCode = statusCode;
  }
}

export interface RecurringInvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateRecurringInvoiceInput {
  customerId: string;
  name: string;
  frequency: RecurrenceFrequency;
  startDate: string | Date;
  endDate?: string | Date;
  currency?: string;
  dueInDays?: number;
  taxRateId?: string;
  items: RecurringInvoiceItemInput[];
}

const VALID_FREQUENCIES: RecurrenceFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

function validateItems(items: RecurringInvoiceItemInput[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RecurringInvoiceServiceError('At least one line item is required.', 400);
  }
  for (const item of items) {
    if (!item.description || typeof item.description !== 'string') {
      throw new RecurringInvoiceServiceError('Every line requires a description.', 400);
    }
    if (typeof item.quantity !== 'number' || item.quantity <= 0) {
      throw new RecurringInvoiceServiceError('Every line requires a positive quantity.', 400);
    }
    if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
      throw new RecurringInvoiceServiceError('Every line requires a non-negative unit price.', 400);
    }
  }
}

export async function createRecurringInvoice(tenantId: string, input: CreateRecurringInvoiceInput) {
  if (!input.customerId) {
    throw new RecurringInvoiceServiceError('A customer is required.', 400);
  }
  if (!input.name || !input.name.trim()) {
    throw new RecurringInvoiceServiceError('A name is required.', 400);
  }
  if (!VALID_FREQUENCIES.includes(input.frequency)) {
    throw new RecurringInvoiceServiceError(`Invalid frequency "${input.frequency}". Allowed: ${VALID_FREQUENCIES.join(', ')}`, 400);
  }
  if (!input.startDate) {
    throw new RecurringInvoiceServiceError('startDate is required.', 400);
  }
  const start = new Date(input.startDate);
  if (isNaN(start.getTime())) {
    throw new RecurringInvoiceServiceError('startDate must be a valid date.', 400);
  }
  validateItems(input.items);

  return withCurrentTenantDb(prisma, async (client) => {
    const customer = await (client as any).customer.findFirst({ where: { id: input.customerId, tenantId } });
    if (!customer) {
      throw new RecurringInvoiceServiceError('Customer not found.', 404);
    }
    if (input.taxRateId) {
      const rate = await taxRateService.getTaxRateById(tenantId, input.taxRateId);
      if (!rate) {
        throw new RecurringInvoiceServiceError(`Tax rate with ID "${input.taxRateId}" not found.`, 400);
      }
    }

    return (client as any).recurringInvoice.create({
      data: {
        tenantId,
        customerId: input.customerId,
        name: input.name.trim(),
        frequency: input.frequency,
        startDate: start,
        endDate: input.endDate ? new Date(input.endDate) : null,
        nextRun: start,
        currency: input.currency || 'USD',
        dueInDays: input.dueInDays ?? 14,
        taxRateId: input.taxRateId || null,
        items: input.items,
        isActive: true,
      },
      include: { customer: true },
    });
  });
}

export async function listRecurringInvoices(tenantId: string) {
  return withCurrentTenantDb(prisma, async (client) => {
    return (client as any).recurringInvoice.findMany({ where: { tenantId }, include: { customer: true }, orderBy: { createdAt: 'desc' } });
  });
}

export async function setRecurringInvoiceActive(tenantId: string, id: string, isActive: boolean) {
  return withCurrentTenantDb(prisma, async (client) => {
    const existing = await (client as any).recurringInvoice.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new RecurringInvoiceServiceError('Recurring invoice not found.', 404);
    }
    return (client as any).recurringInvoice.update({ where: { id }, data: { isActive } });
  });
}

function buildTaxBreakdown(rateRecord: { components: any }, base: number) {
  if (!rateRecord.components || !Array.isArray(rateRecord.components)) return null;
  return rateRecord.components.map((c: { name: string; rate: number; accountId?: string }) => ({
    name: c.name,
    rate: c.rate,
    amount: Math.round(base * c.rate * 100) / 100,
    ...(c.accountId ? { accountId: c.accountId } : {}),
  }));
}

/**
 * Generates a real Invoice + InvoiceItems from one due RecurringInvoice, and
 * advances nextRun. Simple-Invoice-only (no warehouse/stock deduction) -
 * see the model's own doc comment for why. Requires an active tenant
 * context (called from within runWithTenantContext by the cron, same as
 * every other tenant-scoped cron job in this codebase).
 */
export async function generateInvoiceFromRecurring(tenantId: string, recurringInvoiceId: string): Promise<void> {
  const recurring = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).recurringInvoice.findFirst({ where: { id: recurringInvoiceId, tenantId } });
  });
  if (!recurring) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const items: RecurringInvoiceItemInput[] = recurring.items;

  let subtotal = 0;
  const itemData = items.map((it) => {
    const amt = it.quantity * it.unitPrice;
    subtotal += amt;
    return { tenantId, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: amt };
  });

  let resolvedTaxRateId: string | null = null;
  let tax = 0;
  let taxBreakdown: any = null;
  if (recurring.taxRateId) {
    const rate = await taxRateService.getTaxRateById(tenantId, recurring.taxRateId);
    if (rate) {
      resolvedTaxRateId = rate.id;
      tax = subtotal * Number(rate.rate);
      taxBreakdown = buildTaxBreakdown(rate, subtotal);
    }
  }
  const total = subtotal + tax;

  let baseCurrencyAmount: number | null = null;
  try {
    baseCurrencyAmount = await fxRateService.convertAmount(total, recurring.currency, tenant?.baseCurrency || 'USD');
  } catch (err) {
    // Same-currency invoices never need this; a cross-currency recurring
    // invoice with no FX_RATE_API_KEY configured just skips the
    // base-currency snapshot rather than blocking generation entirely -
    // matches this app's established "clear 503 at the point of use,
    // never fake a rate" env-gating convention.
    baseCurrencyAmount = null;
  }

  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + recurring.dueInDays * 24 * 60 * 60 * 1000);
  const invoiceNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  let syncSeq: bigint | null = null;
  const created = await withCurrentTenantDb(prisma, async (client) => {
    const invoice = await (client as any).invoice.create({
      data: {
        tenantId,
        invoiceNumber,
        customerId: recurring.customerId,
        issueDate,
        dueDate,
        currency: recurring.currency,
        subtotal,
        tax,
        taxRateId: resolvedTaxRateId,
        taxBreakdown,
        total,
        baseCurrencyAmount,
        amountPaid: 0,
        status: 'SENT',
        items: { create: itemData },
      },
      include: { customer: true, items: true },
    });

    syncSeq = await recordChange(client, {
      tenantId,
      entityType: 'Invoice',
      entityId: invoice.id,
      operation: 'CREATE',
      payload: invoiceToSyncPayload(invoice),
    });

    await (client as any).recurringInvoice.update({
      where: { id: recurring.id },
      data: { lastRun: issueDate, nextRun: advanceDate(recurring.nextRun, recurring.frequency) },
    });

    return invoice;
  });

  if (syncSeq !== null) {
    notifyChange({ tenantId, entityType: 'Invoice', entityId: created.id, operation: 'CREATE', payload: invoiceToSyncPayload(created), sequence: syncSeq });
  }
}
