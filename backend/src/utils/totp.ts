import crypto from 'node:crypto';
import * as QRCode from 'qrcode';
import { hashPassword, verifyPassword } from './password';

// Hand-rolled RFC 6238 (TOTP) / RFC 4226 (HOTP) on top of Node's built-in
// crypto, matching this codebase's existing precedent of hand-rolling JWT
// (utils/jwt.ts) rather than pulling in a library. otplib v13's dependency
// chain (@noble/@scure) ships ESM-only and breaks this project's
// Jest/CommonJS test setup; the algorithm itself is small, well-specified,
// and built on the same HMAC primitive already used for JWT signing.

const ISSUER = 'Ledgio';
const BACKUP_CODE_COUNT = 10;
const SECRET_BYTES = 20; // 160 bits - RFC 4226's recommended HOTP secret length
const STEP_SECONDS = 30; // standard TOTP time step, matches every authenticator app
const DIGITS = 6;
// Tolerate one step of clock drift on either side of the current step -
// without this, a user whose phone clock is a few seconds off a step
// boundary would get spuriously rejected codes.
const DRIFT_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue; // skip any stray non-alphabet characters defensively
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * RFC 4226 HOTP: HMAC-SHA1 of an 8-byte big-endian counter, truncated to a
 * DIGITS-length decimal code. SHA1 (not SHA256/512) is used deliberately -
 * it's what virtually every authenticator app (Google/Microsoft/Authy)
 * assumes by default for TOTP, regardless of the algorithm's general
 * cryptographic reputation elsewhere; this is a HMAC keyed-hash use, not a
 * collision-resistance use, so SHA1's known weaknesses don't apply here.
 */
function hotp(secretBytes: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = crypto.createHmac('sha1', secretBytes).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (truncated % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function currentStep(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

export function buildOtpAuthUrl(secret: string, accountEmail: string): string {
  const label = encodeURIComponent(`${ISSUER}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export async function generateQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;

  const secretBytes = base32Decode(secret);
  if (secretBytes.length === 0) return false;

  const step = currentStep();
  for (let drift = -DRIFT_WINDOW_STEPS; drift <= DRIFT_WINDOW_STEPS; drift++) {
    const expected = hotp(secretBytes, step + drift);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(trimmed))) {
      return true;
    }
  }
  return false;
}

/**
 * Generates human-typeable one-time backup codes (e.g. "A1B2-C3D4") for
 * recovery if the user loses their authenticator device. Returned in plain
 * text ONCE at generation time - callers must hash each one via
 * hashBackupCode() before persisting, mirroring how passwords are never
 * stored in plain text either.
 */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return hashPassword(normalizeBackupCode(code));
}

/**
 * Checks a submitted backup code against a user's stored hashed codes and
 * returns the index of the first match, or -1 if none match. Callers are
 * responsible for removing the matched index from the stored array (each
 * backup code is single-use) so replay is impossible.
 */
export function matchBackupCode(submittedCode: string, hashedCodes: string[]): number {
  const normalized = normalizeBackupCode(submittedCode);
  if (!normalized) return -1;
  return hashedCodes.findIndex((hashed) => verifyPassword(normalized, hashed));
}

function normalizeBackupCode(code: string): string {
  return (code || '').trim().toUpperCase();
}
