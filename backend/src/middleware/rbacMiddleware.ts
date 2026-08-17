import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../utils/jwt';

export type UserRole = 'Admin' | 'Accountant' | 'Auditor' | 'Viewer' | 'HR';

export const USER_ROLES: Record<UserRole, UserRole> = {
  Admin: 'Admin',
  Accountant: 'Accountant',
  Auditor: 'Auditor',
  Viewer: 'Viewer',
  HR: 'HR',
};

// Role hierarchy rank mapping (higher index = higher privilege)
const ROLE_HIERARCHY: Record<UserRole, number> = {
  Viewer: 1,
  Auditor: 2,
  HR: 2,
  Accountant: 3,
  Admin: 4,
};

// Roles that are explicitly scoped to their own screen(s) - denied by
// default on any requireRole()-gated route unless that role is listed
// there explicitly. Unlike an unrecognized free-text worker title, these
// are NOT given blanket operational access as a fallback (rule 5 below) -
// Auditor/Viewer are read-only reviewers, HR only manages the team roster,
// and Shop Manager/Cashier are location-scoped to Inventory/POS/Expense
// Claims, plus creating invoices/vendor bills for their own warehouse (see
// warehouseAccessService.ts's LOCATION_SCOPED_ROLES and navigation.ts's
// RESTRICTED_ROLE_NAV, which this list must stay in sync with) - none of
// them should incidentally gain write access to Journal Entries, Banking,
// etc. just by having a role string the fallback rule doesn't recognize as
// scoped.
const SCOPED_ROLES = new Set(['viewer', 'auditor', 'hr', 'shop manager', 'cashier']);

// Extend Express Request interface to include user payload
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Checks if a user's role satisfies at least one of the required roles or hierarchy.
 * Fully supports arbitrary legacy free-text worker job titles predating the
 * closed role list (e.g. "Store Clerk", "Inventory Lead") - "Shop Manager"
 * and "Cashier" are no longer examples of this since they became real
 * scoped roles (see SCOPED_ROLES above).
 */
export function hasRequiredRole(userRole: string, allowedRoles: string[]): boolean {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) {
    return false;
  }

  const uRoleLower = userRole.toLowerCase().trim();
  const allowedLower = allowedRoles.map(r => r.toLowerCase());

  // 1. If Admin role is explicitly required (Admin-only actions like inviting staff, settings, workspace purge)
  if (allowedLower.includes('admin')) {
    return uRoleLower === 'admin' || uRoleLower === 'owner';
  }

  // 2. Exact match check
  if (allowedLower.includes(uRoleLower)) {
    return true;
  }

  // 3. Admin / Owner has full access to all operational routes
  if (uRoleLower === 'admin' || uRoleLower === 'owner') {
    return true;
  }

  // 4. Viewer / Auditor / HR / Shop Manager / Cashier - scoped roles, only allowed where explicitly listed
  if (SCOPED_ROLES.has(uRoleLower)) {
    return allowedLower.includes(uRoleLower);
  }

  // 5. Legacy free-text worker job titles predating the closed role list
  // (e.g. "Store Clerk", "Inventory Lead") - have full operational access
  // to business endpoints (Inventory, Invoices, Bills, Banking, Journals),
  // matching the behavior every role had before scoped roles existed.
  return true;
}

/**
 * Express Middleware to enforce Role-Based Access Control (RBAC).
 * Requires authenticated user (`req.user`) set by authMiddleware.
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
