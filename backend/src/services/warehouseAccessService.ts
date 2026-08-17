import { PrismaClient } from '@prisma/client';

/**
 * The full, closed set of roles the invite flow accepts going forward.
 * Any pre-existing free-text role in the database (e.g. a legacy custom
 * title typed before this feature existed) keeps working exactly as it
 * did before - it is NOT retroactively restricted. Only these two exact
 * role strings trigger location scoping, so this change is purely
 * additive and carries zero regression risk for every other role.
 */
export const CLOSED_ROLES = ['Admin', 'Accountant', 'Auditor', 'Viewer', 'Shop Manager', 'Cashier', 'HR'] as const;

const LOCATION_SCOPED_ROLES = new Set(['shop manager', 'cashier']);

export function isLocationScopedRole(role: string | undefined | null): boolean {
  if (!role) return false;
  return LOCATION_SCOPED_ROLES.has(role.toLowerCase().trim());
}

export class WarehouseAccessError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = 'WarehouseAccessError';
    this.statusCode = statusCode;
  }
}

/**
 * Throws if the user's role is location-scoped ('Shop Manager'/'Cashier')
 * and they have no WarehouseAccess row for the given warehouse. A no-op
 * for every other role (Admin, Accountant, Auditor, Viewer, or any legacy
 * free-text title), which keep today's unrestricted, all-warehouse access.
 */
export async function assertWarehouseAccess(
  client: PrismaClient,
  tenantId: string,
  userId: string,
  userRole: string | undefined,
  warehouseId: string
): Promise<void> {
  if (!isLocationScopedRole(userRole)) return;

  const access = await (client as any).warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId, warehouseId } },
  });

  if (!access) {
    throw new WarehouseAccessError('You do not have access to this warehouse/shop. Ask an admin to grant you access.');
  }
}

/**
 * Returns the set of warehouse IDs a user is allowed to see, or `null` if
 * they have unrestricted (all-warehouse) access - callers should treat
 * `null` as "don't filter" rather than "filter to an empty set".
 */
export async function getAccessibleWarehouseIds(
  client: PrismaClient,
  tenantId: string,
  userId: string,
  userRole: string | undefined
): Promise<string[] | null> {
  if (!isLocationScopedRole(userRole)) return null;

  const rows = await (client as any).warehouseAccess.findMany({
    where: { tenantId, userId },
    select: { warehouseId: true },
  });
  return rows.map((r: { warehouseId: string }) => r.warehouseId);
}
