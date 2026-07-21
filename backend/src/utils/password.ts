import crypto from 'node:crypto';

/**
 * Hashes a plain-text password using PBKDF2 with SHA-512 and a random salt.
 * Output format: $pbkdf2$iterations$saltHex$hashHex
 */
export function hashPassword(password: string): string {
  if (!password) {
    throw new Error('Password must be a non-empty string');
  }

  const iterations = 100000;
  const saltLength = 16;
  const keyLength = 64;
  const digest = 'sha512';

  const salt = crypto.randomBytes(saltLength).toString('hex');
  const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
  const hashHex = derivedKey.toString('hex');

  return `$pbkdf2$${iterations}$${salt}$${hashHex}`;
}

/**
 * Verifies a plain-text password against a hashed password string.
 */
export function verifyPassword(password: string, hashedPassword: string): boolean {
  if (!password || !hashedPassword) {
    return false;
  }

  const parts = hashedPassword.split('$');
  // Expected parts: ["", "pbkdf2", "100000", "<saltHex>", "<hashHex>"]
  if (parts.length !== 5 || parts[1] !== 'pbkdf2') {
    return false;
  }

  const iterations = parseInt(parts[2], 10);
  const salt = parts[3];
  const originalHashHex = parts[4];

  if (isNaN(iterations) || !salt || !originalHashHex) {
    return false;
  }

  const keyLength = Buffer.from(originalHashHex, 'hex').length;
  const digest = 'sha512';

  const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
  const derivedHashBuffer = derivedKey;
  const originalHashBuffer = Buffer.from(originalHashHex, 'hex');

  if (derivedHashBuffer.length !== originalHashBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedHashBuffer, originalHashBuffer);
}
