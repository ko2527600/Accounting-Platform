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
 * Verifies and decodes a signed JWT token.
 * Throws an Error if token structure, signature, or expiration is invalid.
 */
export function verifyJwtToken(token: string): JwtPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }

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
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('JWT token has expired');
  }

  return payload;
}
