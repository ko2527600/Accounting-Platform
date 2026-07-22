import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { isRedisHealthy } from '../config/redis';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'backend-api',
    uptime: process.uptime(),
    database: 'unknown',
    redis: 'unknown',
    memory: process.memoryUsage(),
  };

  let isHealthy = true;

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
  } catch (error: any) {
    health.database = 'disconnected';
    health.status = 'degraded';
    isHealthy = false;
  }

  // Check Redis connectivity
  try {
    const redisHealthy = await isRedisHealthy();
    health.redis = redisHealthy ? 'connected' : 'disconnected';
    if (!redisHealthy && process.env.NODE_ENV === 'production') {
      health.status = 'degraded';
    }
  } catch (error) {
    health.redis = 'disconnected';
  }

  // Return appropriate status code
  if (!isHealthy) {
    return res.status(503).json(health);
  }

  res.status(200).json(health);
});

// Liveness probe (simple check)
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

// Readiness probe (full health check)
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisHealthy = await isRedisHealthy();
    
    if (!redisHealthy && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ status: 'not ready', reason: 'redis unavailable' });
    }
    
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});

export default router;
