import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTenantContext } from '../context/tenantContext';
import { withCurrentTenantDb } from '../database/tenantClient';

const router = Router();
router.use(authenticateJwt);
router.use(tenantContextMiddleware);

const MAX_PER_TYPE = 5;

/**
 * GET /api/v1/search?q=<keyword>
 * Real cross-entity keyword search across customers, invoices, vendors,
 * inventory items, accounts, and journal entries.
 * Minimum 2 chars to fire; returns up to 5 results per entity type.
 */
router.get('/', requireRole('Viewer'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = requireTenantContext();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (q.length < 2) {
      res.json({ success: true, data: { results: [] } });
      return;
    }

    const contains = q;
    const mode = 'insensitive' as const;
    const textSearch = { contains, mode };

    // Main-schema models filtered by tenantId
    const [customers, invoices, vendors, items] = await Promise.all([
      prisma.customer.findMany({
        where: {
          tenantId,
          OR: [{ name: textSearch }, { email: textSearch }, { phone: textSearch }],
        },
        select: { id: true, name: true, email: true, customerType: true },
        take: MAX_PER_TYPE,
      }),

      prisma.invoice.findMany({
        where: {
          tenantId,
          OR: [
            { invoiceNumber: textSearch },
            { customer: { name: textSearch } },
          ],
        },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          customer: { select: { name: true } },
        },
        orderBy: { issueDate: 'desc' },
        take: MAX_PER_TYPE,
      }),

      prisma.vendor.findMany({
        where: {
          tenantId,
          OR: [{ name: textSearch }, { email: textSearch }],
        },
        select: { id: true, name: true, email: true },
        take: MAX_PER_TYPE,
      }),

      prisma.inventoryItem.findMany({
        where: {
          tenantId,
          OR: [{ name: textSearch }, { sku: textSearch }, { category: textSearch }],
        },
        select: { id: true, name: true, sku: true, category: true },
        take: MAX_PER_TYPE,
      }),
    ]);

    // Per-tenant-schema models (Account, JournalEntry live in tenant schemas)
    const [accounts, journalEntries] = await withCurrentTenantDb(prisma, (client: any) =>
      Promise.all([
        client.account.findMany({
          where: { OR: [{ name: textSearch }, { code: textSearch }] },
          select: { id: true, name: true, code: true, type: true },
          take: MAX_PER_TYPE,
        }),
        client.journalEntry.findMany({
          where: { OR: [{ description: textSearch }, { entryNumber: textSearch }] },
          select: { id: true, entryNumber: true, description: true, status: true },
          orderBy: { entryDate: 'desc' },
          take: MAX_PER_TYPE,
        }),
      ])
    );

    const results = [
      ...customers.map((c: any) => ({
        type: 'customer' as const,
        id: c.id,
        title: c.name,
        subtitle: [c.email, c.customerType].filter(Boolean).join(' · '),
        href: '/customers',
      })),
      ...invoices.map((inv: any) => ({
        type: 'invoice' as const,
        id: inv.id,
        title: `Invoice ${inv.invoiceNumber}`,
        subtitle: `${inv.customer?.name ?? ''} · ${inv.status}`,
        href: '/invoices',
      })),
      ...vendors.map((v: any) => ({
        type: 'vendor' as const,
        id: v.id,
        title: v.name,
        subtitle: v.email,
        href: '/bills',
      })),
      ...items.map((item: any) => ({
        type: 'item' as const,
        id: item.id,
        title: item.name,
        subtitle: `SKU: ${item.sku} · ${item.category}`,
        href: '/inventory',
      })),
      ...accounts.map((a: any) => ({
        type: 'account' as const,
        id: a.id,
        title: a.name,
        subtitle: `${a.code} · ${a.type}`,
        href: '/accounts',
      })),
      ...journalEntries.map((j: any) => ({
        type: 'journal' as const,
        id: j.id,
        title: `JV ${j.entryNumber}`,
        subtitle: j.description || j.status || '',
        href: '/journals',
      })),
    ];

    res.json({ success: true, data: { results } });
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({ success: false, error: 'Search failed.' });
  }
});

export default router;
