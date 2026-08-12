import { Request, Response, NextFunction } from 'express';
import { verifyJwtToken, JwtPayload } from '../utils/jwt';

export interface AuthMiddlewareOptions {
  optional?: boolean;
}

/**
 * Express Middleware to authenticate incoming requests via JWT token.
 * Token can be passed in `Authorization: Bearer <token>` header or `X-Auth-Token` header.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);

    if (!authHeader) {
      if (options.optional) {
        return next();
      }
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authorization header. Bearer token required.',
      });
      return;
    }

    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    try {
      const payload: JwtPayload = await verifyJwtToken(token);
      // A pending-MFA token (issued after password verification, before the
      // TOTP/backup-code step) proves the password was correct but not that
      // MFA was completed - it must never be accepted as a real session by
      // any protected route, only by POST /auth/login/verify-mfa itself.
      if (payload.mfaPending) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'MFA verification required before this token can be used.',
        });
        return;
      }
      req.user = payload;
      next();
    } catch (error: any) {
      if (options.optional) {
        return next();
      }
      res.status(401).json({
        error: 'Unauthorized',
        message: error.message || 'Invalid authentication token.',
      });
    }
  };
}

export const authenticateJwt = createAuthMiddleware({ optional: false });
export const optionalAuthenticateJwt = createAuthMiddleware({ optional: true });
