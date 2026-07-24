import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../utils/jwt';

export type UserRole = 'Admin' | 'Accountant' | 'Auditor' | 'Viewer';

export const USER_ROLES: Record<UserRole, UserRole> = {
  Admin: 'Admin',
  Accountant: 'Accountant',
  Auditor: 'Auditor',
  Viewer: 'Viewer',
};

// Role hierarchy rank mapping (higher index = higher privilege)
const ROLE_HIERARCHY: Record<UserRole, number> = {
  Viewer: 1,
  Auditor: 2,
  Accountant: 3,
  Admin: 4,
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
 * Checks if a user's role satisfies at least one of the required roles or hierarchy.
 * Fully supports custom user-typed worker job titles (e.g. Shop Manager, Store Clerk, Cashier).
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

  // 4. Viewer / Auditor read-only restrictions
  if (uRoleLower === 'viewer' || uRoleLower === 'auditor') {
    return allowedLower.includes(uRoleLower);
  }

  // 5. Custom worker job titles assigned by business owner (e.g. Shop Manager, Store Clerk, Cashier, Inventory Lead)
  // Have full operational access to business endpoints (Inventory, Invoices, Bills, Banking, Journals)
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
