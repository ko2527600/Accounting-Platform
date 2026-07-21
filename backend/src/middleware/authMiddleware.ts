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
  return (req: Request, res: Response, next: NextFunction): void => {
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
      const payload: JwtPayload = verifyJwtToken(token);
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
