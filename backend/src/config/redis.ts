import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

// Redis connection configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Parse Redis URL to extract connection details
function parseRedisUrl(url: string): RedisOptions {
  try {
    const urlObj = new URL(url);
    
    return {
      host: urlObj.hostname || 'localhost',
      port: parseInt(urlObj.port) || 6379,
      password: urlObj.password || undefined,
      db: parseInt(urlObj.pathname.slice(1)) || 0,
      
      // Connection pool settings
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false, // Fail fast instead of queuing commands
      
      // Reconnection strategy with exponential backoff
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn('Redis reconnection attempt', { attempt: times, delayMs: delay });
        return delay;
      },
      
      // Connection timeout
      connectTimeout: 10000, // 10 seconds
      
      // Keep-alive to detect broken connections
      keepAlive: 30000, // 30 seconds
      
      // Command timeout
      commandTimeout: 5000, // 5 seconds
      
      // Lazy connect - connect only when first command is issued
      lazyConnect: true,
    };
  } catch (error) {
    logger.error('Failed to parse REDIS_URL', { error: String(error), url });
    throw new Error('Invalid REDIS_URL format');
  }
}

// Create Redis client with production-ready configuration
const redisConfig = parseRedisUrl(REDIS_URL);
export const redis = new Redis(redisConfig);

// Redis event handlers for monitoring and logging
redis.on('connect', () => {
  logger.info('Redis connection established', {
    host: redisConfig.host,
    port: redisConfig.port,
    db: redisConfig.db,
  });
});

redis.on('ready', () => {
  logger.info('Redis client ready', {
    host: redisConfig.host,
    port: redisConfig.port,
  });
});

redis.on('error', (error: Error) => {
  logger.error('Redis error', {
    error: error.message,
    stack: error.stack,
    host: redisConfig.host,
    port: redisConfig.port,
  });
});

redis.on('close', () => {
  logger.warn('Redis connection closed', {
    host: redisConfig.host,
    port: redisConfig.port,
  });
});

redis.on('reconnecting', (delay: number) => {
  logger.info('Redis reconnecting', {
    delayMs: delay,
    host: redisConfig.host,
    port: redisConfig.port,
  });
});

redis.on('end', () => {
  logger.warn('Redis connection ended', {
    host: redisConfig.host,
    port: redisConfig.port,
  });
});

// Connect to Redis on module load
export const connectRedis = async (): Promise<void> => {
  try {
    await redis.connect();
    
    // Test the connection
    const pingResult = await redis.ping();
    if (pingResult !== 'PONG') {
      throw new Error('Redis PING test failed');
    }
    
    logger.info('Redis connected and tested successfully', {
      version: await redis.info('server').then(info => {
        const match = info.match(/redis_version:([^\r\n]+)/);
        return match ? match[1] : 'unknown';
      }),
    });
  } catch (error: any) {
    logger.error('Redis connection failed', {
      error: error.message,
      stack: error.stack,
      url: REDIS_URL.replace(/:[^:@]+@/, ':***@'), // Mask password in logs
    });
    
    // In production, fail startup if Redis is unavailable
    // In development, allow graceful degradation
    if (NODE_ENV === 'production') {
      throw error;
    } else {
      logger.warn('Running without Redis in development mode');
    }
  }
};

// Gracefully disconnect Redis
export const disconnectRedis = async (): Promise<void> => {
  try {
    await redis.quit();
    logger.info('Redis disconnected gracefully');
  } catch (error: any) {
    logger.error('Redis disconnect failed', {
      error: error.message,
    });
  }
};

// Redis health check for readiness probes
export const isRedisHealthy = async (): Promise<boolean> => {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    return false;
  }
};

// Cache helper utilities with automatic serialization
export const cacheUtils = {
  /**
   * Get value from cache with automatic JSON deserialization
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error: any) {
      logger.error('Redis GET failed', {
        key,
        error: error.message,
      });
      return null;
    }
  },

  /**
   * Set value in cache with automatic JSON serialization and TTL
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, serialized);
      } else {
        await redis.set(key, serialized);
      }
      return true;
    } catch (error: any) {
      logger.error('Redis SET failed', {
        key,
        ttlSeconds,
        error: error.message,
      });
      return false;
    }
  },

  /**
   * Delete key from cache
   */
  async del(key: string): Promise<boolean> {
    try {
      const result = await redis.del(key);
      return result > 0;
    } catch (error: any) {
      logger.error('Redis DEL failed', {
        key,
        error: error.message,
      });
      return false;
    }
  },

  /**
   * Delete keys matching a pattern
   */
  async delPattern(pattern: string): Promise<number> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) return 0;
      
      const result = await redis.del(...keys);
      return result;
    } catch (error: any) {
      logger.error('Redis DEL pattern failed', {
        pattern,
        error: error.message,
      });
      return 0;
    }
  },

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error: any) {
      logger.error('Redis EXISTS failed', {
        key,
        error: error.message,
      });
      return false;
    }
  },

  /**
   * Set TTL on existing key
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await redis.expire(key, ttlSeconds);
      return result === 1;
    } catch (error: any) {
      logger.error('Redis EXPIRE failed', {
        key,
        ttlSeconds,
        error: error.message,
      });
      return false;
    }
  },

  /**
   * Atomic increment with optional TTL
   */
  async incr(key: string, ttlSeconds?: number): Promise<number> {
    try {
      const value = await redis.incr(key);
      if (ttlSeconds && value === 1) {
        // Set TTL only on first increment
        await redis.expire(key, ttlSeconds);
      }
      return value;
    } catch (error: any) {
      logger.error('Redis INCR failed', {
        key,
        error: error.message,
      });
      throw error;
    }
  },
};

export default redis;
