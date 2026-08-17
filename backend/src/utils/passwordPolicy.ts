/**
 * Server-side password strength floor. Deliberately modest (not full
 * complexity-class rules with special characters) - hashPassword() already
 * uses PBKDF2-SHA512/100k iterations, which provides strong offline
 * brute-force resistance; this only closes the "password is `a`" gap.
 */
export function validatePasswordStrength(password: string): string | null {
  if (!password || typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[a-zA-Z]/.test(password)) {
    return 'Password must contain at least one letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number.';
  }
  return null;
}
