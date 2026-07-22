import crypto from 'node:crypto';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  tenantId?: string;
  name?: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

const DEFAULT_JWT_SECRET = 'super-secret-jwt-key-for-accounting-platform-dev';

// In-memory LRU cache for validated JWT tokens
// Prevents repeated HMAC signature verification for the same token
interface CachedToken {
  payload: JwtPayload;
  expiresAt: number;
}

class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Delete if exists (to move to end)
    this.cache.delete(key);
    
    // Add to end
    this.cache.set(key, value);
    
    // Evict oldest if over capacity
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Token cache: SHA256 hash -> validated payload
// Max 1000 tokens cached (approx 100KB memory)
const tokenCache = new LRUCache<string, CachedToken>(1000);

// Periodic cleanup of expired tokens (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  // Note: Can't iterate and delete from Map efficiently, so we rebuild
  // This is fine since it only runs every 5 minutes
  const entries = Array.from(tokenCache['cache'].entries());
  tokenCache.clear();
  
  for (const [hash, cached] of entries) {
    if (cached.expiresAt > now) {
      tokenCache.set(hash, cached);
    } else {
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`[JWTCache] Cleaned up ${expiredCount} expired tokens, ${tokenCache.size()} remaining`);
  }
}, 5 * 60 * 1000);

function getJwtSecret(): string {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

/**
 * Base64URL encode string or Buffer
 */
function base64urlEncode(strOrBuffer: string | Buffer): string {
  const buf = typeof strOrBuffer === 'string' ? Buffer.from(strOrBuffer) : strOrBuffer;
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64URL decode string
 */
function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generates a signed JWT token for the given payload.
 * @param payload Object containing user payload claims
 * @param expiresInSeconds Time to live in seconds (default 86400 = 24 hours)
 */
export function generateJwtToken(payload: JwtPayload, expiresInSeconds = 86400): string {
  const secret = getJwtSecret();
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest();
  const encodedSignature = base64urlEncode(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verifies and decodes a signed JWT token with LRU caching.
 * Throws an Error if token structure, signature, or expiration is invalid.
 */
export function verifyJwtToken(token: string): JwtPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }

  // Generate cache key from token hash
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
  
  // Check cache first
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(tokenHash);
  
  if (cached && cached.expiresAt > now) {
    // Cache hit - return without verification
    return cached.payload;
  }

  // Cache miss or expired - perform full verification
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const secret = getJwtSecret();

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest();
  
  const providedSignature = Buffer.from(
    encodedSignature.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  );

  if (providedSignature.length !== expectedSignature.length) {
    throw new Error('Invalid JWT signature');
  }

  if (!crypto.timingSafeEqual(providedSignature, expectedSignature)) {
    throw new Error('Invalid JWT signature');
  }

  // Parse payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload));
  } catch {
    throw new Error('Failed to parse JWT payload');
  }

  // Verify expiration
  if (payload.exp && payload.exp < now) {
    throw new Error('JWT token has expired');
  }

  // Store in cache (TTL = until token expiry)
  const expiresAt = payload.exp || (now + 86400);
  tokenCache.set(tokenHash, { payload, expiresAt });

  return payload;
}

/**
 * Clear the JWT token cache (useful for testing or security events)
 */
export function clearJwtCache(): void {
  tokenCache.clear();
  console.log('[JWTCache] Cache cleared');
}

/**
 * Get JWT cache statistics
 */
export function getJwtCacheStats(): { size: number; maxSize: number } {
  return {
    size: tokenCache.size(),
    maxSize: 1000,
  };
}
