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
 * Checks if a user's role satisfies at least one of the required roles or higher privilege in hierarchy.
 */
export function hasRequiredRole(userRole: string, allowedRoles: string[]): boolean {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) {
    return false;
  }

  const normalizedUserRole = (userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase()) as UserRole;
  const userRank = ROLE_HIERARCHY[normalizedUserRole] || 0;

  return allowedRoles.some((allowedRole) => {
    const normalizedAllowed = (allowedRole.charAt(0).toUpperCase() + allowedRole.slice(1).toLowerCase()) as UserRole;
    const allowedRank = ROLE_HIERARCHY[normalizedAllowed] || 0;
    // Exact role match OR user possesses higher hierarchy rank than required
    return userRole.toLowerCase() === allowedRole.toLowerCase() || userRank >= allowedRank;
  });
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
