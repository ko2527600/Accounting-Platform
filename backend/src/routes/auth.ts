import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateJwtToken } from '../utils/jwt';
import { createUser, findUserByEmail, findUserById } from '../repository/userRepository';
import { authenticateJwt } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';

const router = Router();

const VALID_ROLES = ['Admin', 'Accountant', 'Auditor', 'Viewer'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/v1/auth/register
 * Registers a new platform/tenant user.
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, role, tenantId } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'A valid email address is required.',
      });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Password is required and must be at least 6 characters long.',
      });
      return;
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'User full name is required.',
      });
      return;
    }

    const assignedRole = role || 'Viewer';
    if (!VALID_ROLES.includes(assignedRole)) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Invalid role "${role}". Allowed roles are: ${VALID_ROLES.join(', ')}`,
      });
      return;
    }

    // Check if user already exists
    const existingUser = await findUserByEmail(prisma, email);
    if (existingUser) {
      res.status(409).json({
        error: 'Conflict Error',
        message: `User with email "${email}" already exists.`,
      });
      return;
    }

    // Check if tenant exists (by ID or Slug) to satisfy foreign key constraints
    let associatedTenantId: string | null = null;
    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { id: tenantId },
            { slug: tenantId },
          ],
        },
      });
      if (tenant) {
        associatedTenantId = tenant.id;
      }
    }

    // Hash password and store user
    const hashedPassword = hashPassword(password);
    const user = await createUser(prisma, {
      email,
      password: hashedPassword,
      name,
      role: assignedRole,
      tenantId: associatedTenantId,
    });

    // Generate JWT token
    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId || undefined,
    };
    const token = generateJwtToken(tokenPayload);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          createdAt: user.createdAt,
        },
        token,
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Registration error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to complete user registration.',
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials and returns JWT token.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Email and password are required.',
      });
      return;
    }

    const user = await findUserByEmail(prisma, email);
    if (!user || !user.password) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User account has been deactivated.',
      });
      return;
    }

    const isPasswordValid = verifyPassword(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
      return;
    }

    // Generate JWT token
    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId || undefined,
    };
    const token = generateJwtToken(tokenPayload);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          createdAt: user.createdAt,
        },
        token,
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Login error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to authenticate user.',
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user profile.
 */
router.get('/me', authenticateJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const user = await findUserById(prisma, req.user.id);
    if (!user) {
      res.status(404).json({ error: 'Not Found', message: 'User record not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error: any) {
    console.error('[Auth Service] Me profile error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch user profile.',
    });
  }
});

/**
 * POST /api/v1/auth/verify
 * Verifies JWT token validity and returns claims.
 */
router.post('/verify', (req: Request, res: Response): void => {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string) || req.body.token;

  if (!authHeader) {
    res.status(400).json({
      success: false,
      valid: false,
      message: 'No token provided for verification.',
    });
    return;
  }

  let token = authHeader;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  try {
    const { verifyJwtToken } = require('../utils/jwt');
    const payload = verifyJwtToken(token);
    res.status(200).json({
      success: true,
      valid: true,
      data: {
        user: payload,
      },
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      valid: false,
      message: error.message || 'Token verification failed.',
    });
  }
});

/**
 * RBAC Protected Test Routes
 */
router.get('/admin-only', authenticateJwt, requireRole('Admin'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Admin-only route',
    user: req.user,
  });
});

router.get('/accountant-only', authenticateJwt, requireRole('Accountant'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Accountant route',
    user: req.user,
  });
});

router.get('/auditor-only', authenticateJwt, requireRole('Auditor'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Auditor route',
    user: req.user,
  });
});

router.get('/viewer-only', authenticateJwt, requireRole('Viewer'), (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Access granted to Viewer route',
    user: req.user,
  });
});

export default router;
