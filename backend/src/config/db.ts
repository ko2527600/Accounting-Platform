import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// Configure Prisma with production-ready connection pool settings and query logging
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
  // Note: Connection pool settings are configured via DATABASE_URL query parameters:
  // ?connection_limit=50&pool_timeout=10&connect_timeout=5&statement_timeout=30000
});

// Track slow queries (>100ms) for performance monitoring
prisma.$on('query' as any, (e: any) => {
  const duration = e.duration;
  
  if (duration > 100) {
    logger.warn('Slow Query Detected', {
      query: e.query,
      duration,
      params: e.params,
      target: e.target,
    });
  }
  
  // Log all queries in development for debugging
  if (process.env.NODE_ENV === 'development' && duration > 10) {
    logger.debug('Database Query', {
      query: e.query,
      duration,
      params: e.params,
    });
  }
});

// Log database errors
prisma.$on('error' as any, (e: any) => {
  logger.error('Database Error', {
    message: e.message,
    target: e.target,
  });
});

// Log database warnings
prisma.$on('warn' as any, (e: any) => {
  logger.warn('Database Warning', {
    message: e.message,
  });
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully', {
      provider: 'postgresql',
      nodeEnv: process.env.NODE_ENV || 'development',
    });
  } catch (error: any) {
    logger.error('Database connection failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error: any) {
    logger.error('Database disconnect failed', {
      error: error.message,
    });
  }
};
