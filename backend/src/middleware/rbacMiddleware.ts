import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../utils/jwt';

export type UserRole =
  | 'Admin'
  | 'Finance Controller'
  | 'Accountant'
  | 'Accounts Payable Clerk'
  | 'Accounts Receivable Clerk'
  | 'Payroll Officer'
  | 'Payroll Approver'
  | 'HR'
  | 'Auditor'
  | 'Warehouse Manager'
  | 'Shop Manager'
  | 'Cashier'
  | 'Viewer'
  | 'External Accountant';

export const USER_ROLES: Record<UserRole, UserRole> = {
  Admin: 'Admin',
  'Finance Controller': 'Finance Controller',
  Accountant: 'Accountant',
  'Accounts Payable Clerk': 'Accounts Payable Clerk',
  'Accounts Receivable Clerk': 'Accounts Receivable Clerk',
  'Payroll Officer': 'Payroll Officer',
  'Payroll Approver': 'Payroll Approver',
  HR: 'HR',
  Auditor: 'Auditor',
  'Warehouse Manager': 'Warehouse Manager',
  'Shop Manager': 'Shop Manager',
  Cashier: 'Cashier',
  Viewer: 'Viewer',
  'External Accountant': 'External Accountant',
};

// Every recognized role. Anything outside this set is denied by default —
// "Store Clerk", "Intern", or a typo no longer inherits operational access.
const ALL_KNOWN_ROLES = new Set(
  Object.keys(USER_ROLES).map((r) => r.toLowerCase())
);

// Roles with blanket operational access to all non-Admin-only routes when
// not restricted by a requireRole() call. Other roles are default-deny:
// they must be named explicitly in requireRole() or covered by ROLE_IMPLIES.
const OPERATIONAL_ROLES = new Set(['admin', 'owner', 'accountant', 'finance controller']);

// Role implication: a user with role X also satisfies a requireRole check for
// role Y. This lets us keep route definitions stable while new roles inherit
// access from existing ones.
//
// Segregation-of-duties notes encoded here:
//  - Payroll Officer can prepare but NOT approve/post (Accountant is on the
//    post route; Payroll Officer only implies HR for read/create-draft paths).
//  - Payroll Approver implies Payroll Officer (can also prepare), plus HR.
//  - Warehouse Manager implies Shop Manager for location-scoped inventory routes.
//  - External Accountant is read-only (implies Viewer and Auditor only).
//  - Finance Controller implies Accountant, giving full operational access.
const ROLE_IMPLIES: Record<string, string[]> = {
  'finance controller': ['accountant', 'viewer', 'auditor'],
  'external accountant': ['viewer', 'auditor'],
  'payroll officer': ['hr'],
  'payroll approver': ['hr', 'payroll officer'],
  'warehouse manager': ['shop manager', 'viewer'],
  'accounts payable clerk': ['viewer'],
  'accounts receivable clerk': ['viewer'],
};

// Extend Express Request interface to include user payload
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Returns true when userRole satisfies at least one of the required roles.
 *
 * Authorization order:
 *  1. Admin / Owner → full access (unless the check is Admin-only, then
 *     Owner is also included but nothing else is).
 *  2. Exact role match → allowed.
 *  3. Operational roles (Accountant, Finance Controller) → allowed on any
 *     non-Admin-only route, matching current Accountant behavior.
 *  4. Role implication: X implies Y → allowed when Y is in allowedRoles.
 *  5. Recognized non-operational role not covered above → denied.
 *  6. Unrecognized role (free-text title, typo) → DENIED (default-deny).
 */
export function hasRequiredRole(userRole: string, allowedRoles: string[]): boolean {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) return false;

  const uLower = userRole.toLowerCase().trim();
  const allowedLower = allowedRoles.map((r) => r.toLowerCase());

  // 1. Admin-only check — Owner is the real-world equivalent of Admin
  if (allowedLower.includes('admin')) {
    return uLower === 'admin' || uLower === 'owner';
  }

  // 2. Exact match
  if (allowedLower.includes(uLower)) return true;

  // 3. Admin / Owner always pass non-Admin-only routes
  if (uLower === 'admin' || uLower === 'owner') return true;

  // 4. Operational roles pass all non-Admin-only routes
  if (OPERATIONAL_ROLES.has(uLower)) return true;

  // 5. Role implication
  const implied = ROLE_IMPLIES[uLower];
  if (implied && implied.some((imp) => allowedLower.includes(imp))) return true;

  // 6. Recognized scoped role not covered above → deny
  if (ALL_KNOWN_ROLES.has(uLower)) return false;

  // 7. Unrecognized free-text role → default-deny (finance-grade security)
  return false;
}

/**
 * Express middleware enforcing role-based access control.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication token required before evaluating role authorization.',
      });
      return;
    }

    const userRole = req.user.role;
    if (!userRole || !hasRequiredRole(userRole, allowedRoles)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Role "${userRole}" is not authorized for this resource. Required role(s): ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Segregation-of-duties guard: rejects a request where the acting user is
 * the same person who created the record being approved. Call this inside a
 * route handler after loading the target record:
 *
 *   if (noSelfApproval(req, record.createdByUserId, res)) return;
 *
 * Returns true (and sends 403) if the check fails, false if it passes.
 */
export function noSelfApproval(req: Request, creatorUserId: string | null | undefined, res: Response): boolean {
  const actorId = req.user?.id;
  if (actorId && creatorUserId && actorId === creatorUserId) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Segregation of duties: you cannot approve or post a record you created.',
    });
    return true;
  }
  return false;
}
