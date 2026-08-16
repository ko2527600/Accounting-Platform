import axios from 'axios';
import { generateQrCodeDataUrl } from '../utils/totp';
import { decryptCredential } from '../utils/credentialEncryption';

export class GraEvatServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 503) {
    super(message);
    this.name = 'GraEvatServiceError';
    this.statusCode = statusCode;
  }
}

// The only host GRA's own Postman API documentation (supplied by the user,
// "GRA E-VAT API - VER 8.2") names anywhere - their staging VSDC. No separate
// production host is documented; if/when GRA confirms a different production
// URL for a live taxpayer, set GRA_EVAT_API_BASE_URL rather than editing this.
const DEFAULT_BASE_URL = 'https://vsdcstaging.vat-gh.com';

// GRA's own official sample requests (both the plain INVOICE and FLATRATE
// INVOICE examples) use this exact literal as businessPartnerTin for a
// walk-in/cash customer with no TIN on file - not invented here, copied
// directly from their documented example payloads.
const CASH_CUSTOMER_TIN_PLACEHOLDER = 'C0000000000';

export interface GraEvatTenantCredentials {
  tin: string | null;
  deviceNumber: string | null;
  securityKeyEncrypted: string | null;
}

/** True only if this tenant has entered their own GRA-assigned credentials. */
export function isGraEvatConfigured(tenant: GraEvatTenantCredentials): boolean {
  return Boolean(tenant.tin && tenant.deviceNumber && tenant.securityKeyEncrypted);
}

export interface GraEvatLineItemInput {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number; // quantity * unitPrice, pre-tax
  sku: string | null;
}

export interface GraEvatInvoiceInput {
  invoiceNumber: string;
  issueDate: Date;
  currency: string;
  exchangeRate: number;
  subtotal: number;
  tax: number; // Invoice.tax - the combined VAT + levies total this system computed
  total: number;
  // Snapshotted per-component breakdown from Invoice.taxBreakdown (see the
  // layered-tax-rate feature) - null when the invoice used a flat, unlayered
  // tax rate (or no tax rate at all).
  taxBreakdown: { name: string; rate: number; amount: number }[] | null;
  customerName: string;
  customerTin: string | null;
  userName: string;
  items: GraEvatLineItemInput[];
}

export interface GraClearanceResult {
  verificationEngineId: string;
  // The raw QR payload (a verification URL, per GRA's response) - not yet
  // rendered as an image. Pass to renderClearanceQrCode() for a display data URL.
  qrCodeData: string;
  signature: string;
  encryptedData: string;
  clearedAt: Date;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Finds the amount of the taxBreakdown component whose name matches, or 0 if
 * no layered breakdown exists / no component matches. Matching is by name
 * substring against the two component names this codebase's own Ghana VAT
 * preset actually uses ("VAT", "NHIL", "GETFund Levy") - see
 * taxRates.test.ts / the "Use Ghana VAT Preset" button in Settings.
 */
function componentAmount(taxBreakdown: GraEvatInvoiceInput['taxBreakdown'], matches: (upperName: string) => boolean): number {
  if (!taxBreakdown) return 0;
  const found = taxBreakdown.find((c) => matches(c.name.toUpperCase()));
  return found ? Number(found.amount) : 0;
}

/**
 * Maps this system's Invoice/InvoiceItem/Customer data onto GRA's exact
 * documented request schema (field names/types/mandatory-ness per the
 * "GRA E-VAT API - VER 8.2" Postman documentation). Two mapping decisions
 * that are NOT guesses, but real facts about how this codebase computes tax:
 *
 * - calculationType is always "EXCLUSIVE": routes/invoices.ts always computes
 *   `total = subtotal + tax` (tax is added on top, never baked into unitPrice).
 * - levyAmountA/B (NHIL/GETFund) are read from Invoice.taxBreakdown, this
 *   system's own snapshotted per-component amounts, then allocated across
 *   line items proportionally to each line's share of the subtotal (this
 *   system has no per-line tax composition - proportional allocation by
 *   amount is a disclosed, defensible approximation, not GRA's own rule).
 *   levyAmountC/D/E (COVID/CST/Tourism) are always 0: no tax preset in this
 *   codebase computes those levies today, so there's nothing honest to send
 *   but 0 - this is a real scope gap, not a bug, and is documented in
 *   STATUS.md rather than silently guessed at.
 * - `taxType` (FLAT vs STANDARD) is optional per GRA's own schema and this
 *   codebase has no concept mapping cleanly to either, so it's omitted
 *   entirely rather than guessed.
 */
function buildInvoicePayload(input: GraEvatInvoiceInput) {
  const vatAmount = input.taxBreakdown
    ? componentAmount(input.taxBreakdown, (n) => n.includes('VAT') && !n.includes('NHIL') && !n.includes('GETF'))
    : input.tax;
  const nhilAmount = componentAmount(input.taxBreakdown, (n) => n.includes('NHIL'));
  const getfundAmount = componentAmount(input.taxBreakdown, (n) => n.includes('GETF'));
  const totalLevy = nhilAmount + getfundAmount;

  return {
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    invoiceNumber: input.invoiceNumber,
    totalLevy: round2(totalLevy),
    userName: input.userName,
    flag: 'INVOICE',
    calculationType: 'EXCLUSIVE',
    totalVat: round2(vatAmount),
    transactionDate: input.issueDate.toISOString(),
    totalAmount: round2(input.total),
    totalExciseAmount: 0,
    voucherAmount: 0,
    businessPartnerName: input.customerName,
    businessPartnerTin: input.customerTin || CASH_CUSTOMER_TIN_PLACEHOLDER,
    saleType: 'NORMAL',
    discountType: '',
    discountAmount: 0,
    reference: '',
    groupReferenceId: '',
    purchaseOrderReference: '',
    items: input.items.map((item) => {
      const share = input.subtotal > 0 ? item.amount / input.subtotal : 0;
      return {
        itemCode: item.sku || `LEDGIO-${item.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
        itemCategory: '',
        expireDate: null,
        description: item.description,
        quantity: item.quantity,
        levyAmountA: round2(nhilAmount * share),
        levyAmountB: round2(getfundAmount * share),
        levyAmountC: 0,
        levyAmountD: 0,
        levyAmountE: 0,
        discountAmount: 0,
        exciseAmount: 0,
        batchCode: '',
        unitPrice: item.unitPrice,
      };
    }),
  };
}

/**
 * Submits an invoice to GRA's VSDC (Virtual Sales Data Controller) for
 * real-time clearance, per the "GRA E-VAT API - VER 8.2" documentation GRA
 * issued directly to this taxpayer during their own onboarding (there is no
 * public self-serve spec - see GRA/AG/2024/005 S10(e)). Scoped to new-sale
 * clearance only (`flag: "INVOICE"`) - GRA's schema also documents PURCHASE/
 * REFUND/PARTIAL_REFUND/PURCHASE_RETURN/REFUND_CANCELLATION flows for
 * purchases and credit-note-driven reversals, deliberately not built in this
 * pass (a real, separate follow-up once Credit Notes need GRA clearance too,
 * not silently assumed to work today).
 */
export async function requestClearance(
  tenant: GraEvatTenantCredentials,
  input: GraEvatInvoiceInput
): Promise<GraClearanceResult> {
  if (!isGraEvatConfigured(tenant)) {
    throw new GraEvatServiceError(
      'GRA E-VAT is not configured for this business yet. Enter the TIN, Device Number, and Security Key GRA assigned you during your Certified Invoicing System onboarding in Settings > GRA E-VAT. Haven\'t onboarded with GRA yet? Contact support@evatgra.zendesk.com or the GRA Contact Centre to begin.',
      503
    );
  }

  const baseUrl = process.env.GRA_EVAT_API_BASE_URL || DEFAULT_BASE_URL;
  const url = `${baseUrl}/vsdc/api/v1/taxpayer/${tenant.tin}-${tenant.deviceNumber}/invoice`;
  const securityKey = decryptCredential(tenant.securityKeyEncrypted as string);
  const payload = buildInvoicePayload(input);

  try {
    const response = await axios.post(url, payload, {
      headers: { security_key: securityKey, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    const body = response.data?.response;
    const message = body?.mesaage; // sic - matches GRA's own documented (misspelled) response field name
    if (!body || !message || String(body.status).toUpperCase() !== 'SUCCESS') {
      throw new GraEvatServiceError(
        `GRA did not confirm clearance${body?.status ? ` (status: ${body.status})` : ''}.`,
        502
      );
    }
    return {
      verificationEngineId: String(message.ysdcid || ''),
      qrCodeData: String(body.qr_code || ''),
      signature: String(message.ysdcregsig || ''),
      encryptedData: String(message.ysdcintdata || ''),
      clearedAt: new Date(),
    };
  } catch (error: any) {
    if (error instanceof GraEvatServiceError) throw error;
    const respData = error.response?.data;
    const graMessage = respData?.response?.status || respData?.message || respData?.error;
    throw new GraEvatServiceError(
      graMessage ? `GRA E-VAT clearance failed: ${graMessage}` : `Failed to reach GRA E-VAT (${error.message || 'network error'}).`,
      error.response?.status || 502
    );
  }
}

/**
 * Renders a QR code image for a cleared invoice's verification URL - a thin,
 * GRA-agnostic wrapper around the same reusable helper MFA setup already
 * uses in utils/totp.ts.
 */
export async function renderClearanceQrCode(qrCodeData: string): Promise<string> {
  return generateQrCodeDataUrl(qrCodeData);
}
