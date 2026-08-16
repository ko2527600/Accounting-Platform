import crypto from 'node:crypto';

/**
 * AES-256-GCM at-rest encryption for third-party API credentials a tenant
 * enters (currently: the GRA VSDC security_key - see graEvatService.ts).
 * Unlike a password, these need to be recoverable in plaintext to actually
 * call the third-party API, so hashing isn't an option - but they should
 * never sit in the database as plain text either.
 *
 * Key is derived via scrypt from CREDENTIAL_ENCRYPTION_KEY (a long random
 * string, not itself a raw AES key) with a fixed application-level salt -
 * fine for a single symmetric application key, unlike per-user password
 * hashing which needs a per-user salt.
 */
const SALT = 'ledgio-credential-encryption-v1';

function getKey(): Buffer {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY environment variable is not set. Refusing to store or read third-party credentials without it.'
    );
  }
  return crypto.scryptSync(secret, SALT, 32);
}

/** Returns `${ivHex}:${authTagHex}:${ciphertextHex}`. */
export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptCredential(encrypted: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted credential.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
