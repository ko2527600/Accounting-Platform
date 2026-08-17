import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { requireTenantContext } from '../context/tenantContext';
import { EmailService } from './EmailService';
import { recordAuditLogTx, AuditActor } from './auditLogService';
import { recordChange, notifyChange, invoiceToSyncPayload } from './syncChangeLogService';

export class InvoiceEmailServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'InvoiceEmailServiceError';
    this.statusCode = statusCode;
  }
}

function formatDateLabel(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Emails an invoice to its customer (PDF attached, key figures inline) and
 * stamps `emailedAt` - distinct from `status`, which is already set to
 * "SENT" at creation time regardless of whether an email was ever sent (see
 * invoices.ts's POST / handler), so this is the only real signal of whether
 * the customer actually received the document.
 */
export async function sendInvoiceEmail(invoiceId: string, actor: AuditActor) {
  const { tenantId, tenantName } = requireTenantContext();

  const invoice = await withCurrentTenantDb(prisma, async (client) => {
    return (client as any).invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { customer: true, items: true },
    });
  });

  if (!invoice) {
    throw new InvoiceEmailServiceError('Invoice not found.', 404);
  }

  if (!EmailService.isConfigured()) {
    throw new InvoiceEmailServiceError('Email sending is not configured for this platform yet.', 503);
  }

  const sent = await EmailService.sendInvoiceEmail(invoice.customer.email, invoice.customer.name, tenantName || 'Ledgio', {
    invoiceNumber: invoice.invoiceNumber,
    issueDateLabel: formatDateLabel(invoice.issueDate),
    dueDateLabel: formatDateLabel(invoice.dueDate),
    currency: invoice.currency,
    customerAddress: invoice.customer.address,
    items: invoice.items.map((item: any) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
    })),
    subtotal: Number(invoice.subtotal),
    tax: Number(invoice.tax),
    taxBreakdown: Array.isArray(invoice.taxBreakdown) ? invoice.taxBreakdown : null,
    total: Number(invoice.total),
  });

  if (!sent) {
    throw new InvoiceEmailServiceError('Failed to send the invoice email. Please try again shortly.', 502);
  }

  let syncSeq: bigint | null = null;
  const updated = await withCurrentTenantDb(prisma, async (client) => {
    const invoiceUpdated = await (client as any).invoice.update({
      where: { id: invoiceId },
      data: { emailedAt: new Date() },
      include: { customer: true },
    });

    syncSeq = await recordChange(client, {
      tenantId,
      entityType: 'Invoice',
      entityId: invoiceUpdated.id,
      operation: 'UPDATE',
      payload: invoiceToSyncPayload(invoiceUpdated),
    });

    await recordAuditLogTx(client, {
      action: 'INVOICE.EMAILED',
      entity: 'Invoice',
      entityId: invoiceUpdated.id,
      actor,
      details: `Invoice ${invoice.invoiceNumber} emailed to ${invoice.customer.email}.`,
    });

    return invoiceUpdated;
  });

  if (syncSeq !== null) {
    notifyChange({
      tenantId,
      entityType: 'Invoice',
      entityId: updated.id,
      operation: 'UPDATE',
      payload: invoiceToSyncPayload(updated),
      sequence: syncSeq,
    });
  }

  return updated;
}
