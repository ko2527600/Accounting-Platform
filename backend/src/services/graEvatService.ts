import { generateQrCodeDataUrl } from '../utils/totp';

export class GraEvatServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 501) {
    super(message);
    this.name = 'GraEvatServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * True only if the tenant-independent GRA E-VAT connection details are
 * present. Unlike MoMo/TheTeller/Paystack, setting these env vars alone
 * does NOT make requestClearance() actually work - see that function's own
 * comment for why. This still exists (rather than always returning false)
 * so the day the real integration is built, the existing env-gate pattern
 * this whole codebase already uses is what flips it on.
 */
export function isGraEvatConfigured(): boolean {
  return Boolean(process.env.GRA_EVAT_API_BASE_URL && process.env.GRA_EVAT_API_KEY);
}

export interface GraClearanceResult {
  verificationEngineId: string;
  // The raw QR payload GRA's VSDC would return - not yet rendered as an
  // image. Pass this to renderClearanceQrCode() to get a displayable data URL.
  qrCodeData: string;
  signature: string;
  encryptedData: string;
  clearedAt: Date;
}

/**
 * Would submit an invoice to GRA's VSDC (Virtual Sales Data Controller) for
 * real-time clearance and return the certified invoice's QR code/signature/
 * verification engine ID - see GRA/AG/2024/005 ("Guidelines on Certified
 * Invoicing System (E-VAT)") S7(3) for the legally-required elements a
 * cleared invoice must carry, and S10 for the onboarding process.
 *
 * This throws unconditionally, by design, rather than guessing a wire
 * format: per GRA/AG/2024/005 S10(e), "GRA will provide API documentation
 * to the taxpayer" only as part of their own bespoke onboarding (assigned
 * Relationship Manager -> onboarding form -> GRA hands over API docs ->
 * joint testing -> GRA sign-off -> go-live, ~1 month). No public
 * specification exists to build the real request/response against, unlike
 * MoMo/TheTeller/Paystack which all have open developer documentation.
 * Fabricating field names here would violate this codebase's own
 * spec-driven-development rule and could actively mislead a real taxpayer
 * into shipping a broken integration. Wire the real HTTP call in this
 * function once GRA's actual API documentation is in hand - the schema
 * (Invoice.gra*), the route, and this call site are already in place so
 * that becomes an isolated, one-function change.
 *
 * A tenant becomes eligible to even start GRA's onboarding process by being
 * a VAT-registered taxpayer with a real TIN on file (Tenant.graTin /
 * vatRegistered, editable in Settings) - contact GRA directly
 * (support@evatgra.zendesk.com or the GRA Contact Centre) to begin.
 */
export async function requestClearance(): Promise<GraClearanceResult> {
  throw new GraEvatServiceError(
    'GRA E-VAT clearance is not yet available. GRA only issues the API specification directly to a taxpayer during their own onboarding process (Relationship Manager, onboarding form, joint testing) - contact GRA at support@evatgra.zendesk.com or the GRA Contact Centre to begin, then this integration can be wired up against the real API documentation they provide.',
    501
  );
}

/**
 * Renders a QR code image for a cleared invoice's verification data - a
 * thin, GRA-agnostic wrapper (the same reusable helper MFA setup already
 * uses in utils/totp.ts). Does not care what the payload format is, so it
 * needs no GRA-specific knowledge and is safe to use today even though
 * requestClearance() itself is not implemented yet.
 */
export async function renderClearanceQrCode(qrCodeData: string): Promise<string> {
  return generateQrCodeDataUrl(qrCodeData);
}
