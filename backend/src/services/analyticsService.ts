import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { getAccessibleWarehouseIds } from './warehouseAccessService';

export interface FastSeller {
  id: string;
  sku: string;
  name: string;
  totalStock: number;
  unitOfMeasure: string;
  status: 'FAST_SELLING';
}

export interface SlowMoving {
  id: string;
  sku: string;
  name: string;
  totalStock: number;
  unitOfMeasure: string;
  status: 'SLOW_MOVING';
}

export interface ReallocationSuggestion {
  itemId: string;
  itemName: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  suggestedQty: number;
  reason: string;
}

export interface StockIntelligenceResult {
  fastSellers: FastSeller[];
  slowMoving: SlowMoving[];
  suggestions: ReallocationSuggestion[];
  totalProducts: number;
}

/**
 * Analyzes inventory sales velocity to identify Fast-Selling items, Slow-Moving
 * (Dead) stock, and generates Smart Stock Balancing Suggestions. Extracted from
 * the inline logic that used to live directly in the GET /stock-intelligence
 * route handler, so the on-screen view, CSV export, PDF export, and DOCX
 * export can all call this single data source instead of re-deriving it.
 */
export async function getStockIntelligence(tenantId: string): Promise<StockIntelligenceResult> {
  return withCurrentTenantDb(prisma, async (client) => {
    const items = await (client as any).inventoryItem.findMany({
      where: { tenantId },
      include: { warehouseStocks: { include: { warehouse: true } } },
    });

    const fastSellers: FastSeller[] = [];
    const slowMoving: SlowMoving[] = [];
    const suggestions: ReallocationSuggestion[] = [];

    for (const item of items) {
      const totalQty = item.warehouseStocks?.reduce((acc: number, s: any) => acc + s.quantityOnHand, 0) || 0;

      if (totalQty > 20 || item.sellingPrice > 500) {
        fastSellers.push({
          id: item.id,
          sku: item.sku,
          name: item.name,
          totalStock: totalQty,
          unitOfMeasure: item.unitOfMeasure,
          status: 'FAST_SELLING',
        });
      } else {
        slowMoving.push({
          id: item.id,
          sku: item.sku,
          name: item.name,
          totalStock: totalQty,
          unitOfMeasure: item.unitOfMeasure,
          status: 'SLOW_MOVING',
        });
      }

      const stocks = item.warehouseStocks || [];
      if (stocks.length >= 2) {
        const highStock = stocks.reduce((prev: any, current: any) => (prev.quantityOnHand > current.quantityOnHand ? prev : current), stocks[0]);
        const lowStock = stocks.reduce((prev: any, current: any) => (prev.quantityOnHand < current.quantityOnHand ? prev : current), stocks[0]);

        if (highStock && lowStock && highStock.quantityOnHand > 15 && lowStock.quantityOnHand <= 5 && highStock.warehouseId !== lowStock.warehouseId) {
          const suggestQty = Math.floor((highStock.quantityOnHand - lowStock.quantityOnHand) / 2);
          if (suggestQty > 0) {
            suggestions.push({
              itemId: item.id,
              itemName: item.name,
              fromWarehouseName: highStock.warehouse?.name || 'Warehouse A',
              toWarehouseName: lowStock.warehouse?.name || 'Warehouse B',
              suggestedQty: suggestQty,
              reason: `Idle stock in ${highStock.warehouse?.name} can balance out demand in ${lowStock.warehouse?.name}.`,
            });
          }
        }
      }
    }

    return { fastSellers, slowMoving, suggestions, totalProducts: items.length };
  });
}

export interface ShopLeaderboardRow {
  id: string;
  name: string;
  code: string;
  location: string | null;
  totalRevenue: number;
}

export interface ExecutiveSummaryResult {
  dailyTotal: number;
  monthlyTotal: number;
  yearlyTotal: number;
  shopLeaderboard: ShopLeaderboardRow[];
  recentCloseouts: any[];
}

/**
 * Returns Daily, Monthly, and Yearly revenue breakdowns & shop leaderboards.
 * Extracted from the inline logic that used to live directly in the
 * GET /executive-summary route handler - see getStockIntelligence's docstring
 * for why.
 */
export async function getExecutiveSummary(tenantId: string): Promise<ExecutiveSummaryResult> {
  return withCurrentTenantDb(prisma, async (client) => {
    const closeouts = await (client as any).dailyCloseoutReport.findMany({
      where: { tenantId },
      include: { warehouse: true },
      orderBy: { closedAt: 'desc' },
    });

    const warehouses = await (client as any).warehouse.findMany({
      where: { tenantId },
      include: { closeouts: true },
    });

    let dailyTotal = 0;
    let monthlyTotal = 0;
    let yearlyTotal = 0;

    const now = new Date();
    closeouts.forEach((c: any) => {
      const amt = Number(c.cashSales);
      const closedDate = new Date(c.closedAt);

      if (closedDate.toDateString() === now.toDateString()) {
        dailyTotal += amt;
      }
      if (closedDate.getMonth() === now.getMonth() && closedDate.getFullYear() === now.getFullYear()) {
        monthlyTotal += amt;
      }
      if (closedDate.getFullYear() === now.getFullYear()) {
        yearlyTotal += amt;
      }
    });

    const shopLeaderboard = warehouses
      .map((w: any) => {
        const rev = w.closeouts?.reduce((sum: number, c: any) => sum + Number(c.cashSales), 0) || 0;
        return {
          id: w.id,
          name: w.name,
          code: w.code,
          location: w.location,
          totalRevenue: rev,
        };
      })
      .sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

    return {
      dailyTotal,
      monthlyTotal,
      yearlyTotal,
      shopLeaderboard,
      recentCloseouts: closeouts.slice(0, 10),
    };
  });
}

/**
 * Returns the tenant's full daily-closeout history (not sliced to a preview
 * count like ExecutiveSummaryResult.recentCloseouts), respecting the same
 * warehouse-access scoping GET /tills/closeouts already applies, so the
 * "End-of-Day Till Closeouts" tab can be exported (CSV/PDF/DOCX) with exactly
 * the rows a Shop Manager/Cashier would be allowed to see on screen.
 */
export async function getCloseoutsForExport(tenantId: string, userId: string, userRole: string | undefined): Promise<any[]> {
  return withCurrentTenantDb(prisma, async (client) => {
    const accessibleIds = await getAccessibleWarehouseIds(client, tenantId, userId, userRole);
    const where: any = { tenantId };
    if (accessibleIds !== null) where.warehouseId = { in: accessibleIds };

    return (client as any).dailyCloseoutReport.findMany({
      where,
      include: { warehouse: true, till: true },
      orderBy: { closedAt: 'desc' },
    });
  });
}
