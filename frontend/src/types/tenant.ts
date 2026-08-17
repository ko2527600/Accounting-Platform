// 1=Shop, 2=Business, 3=Enterprise - see backend/src/middleware/tierEnforcementMiddleware.ts.
// Not editable via PUT /tenants/current - set only by a platform admin
// through the Admin Core Engine console until self-serve billing exists.
export type TenantTier = 1 | 2 | 3;

export const TIER_NAMES: Record<TenantTier, string> = {
  1: 'Shop',
  2: 'Business',
  3: 'Enterprise',
};

export interface TenantSettings {
  id: string;
  companyName: string;
  slug: string;
  baseCurrency: string;
  financialYearStart: string; // e.g., '01-01'
  timezone: string;
  // Owner/manager phone number automated till-close and cash-shortage SMS
  // alerts go to. Null/empty when this tenant hasn't configured one - alerts
  // are skipped rather than falling back to a shared number.
  bossPhone: string | null;
  // GRA E-VAT / VAT registration details - a VAT-registered business needs
  // its real TIN on file before it's even eligible to start GRA's own
  // Certified Invoicing System onboarding process (see graEvatService.ts).
  graTin: string | null;
  vatRegistered: boolean;
  // GRA VSDC credentials (device/branch number + security_key GRA assigns
  // during onboarding). graSecurityKeyConfigured reflects whether one is on
  // file - the actual key is write-only, never returned by the API once saved.
  graDeviceNumber: string | null;
  graSecurityKeyConfigured: boolean;
  // Per-tenant payment-collector credentials (MTN MoMo Collections, TheTeller/
  // PaySwitch, Paystack) - each tenant enters their own merchant credentials
  // so customer payments settle to their own account, not a shared Ledgio
  // one. apiUser/apiUsername/merchantId are account identifiers (not
  // secrets) so they're returned as-is; the actual keys are write-only,
  // never returned by the API once saved - only a *Configured boolean is.
  momoApiUser: string | null;
  momoConfigured: boolean;
  tellerApiUsername: string | null;
  tellerMerchantId: string | null;
  tellerConfigured: boolean;
  paystackConfigured: boolean;
  tier: TenantTier;
  updatedAt: string;
}

export type UpdateTenantSettingsDTO = Partial<
  Omit<TenantSettings, 'id' | 'updatedAt' | 'tier' | 'graSecurityKeyConfigured' | 'momoConfigured' | 'tellerConfigured' | 'paystackConfigured'>
> & {
  // Write-only plaintext secrets - encrypted server-side before storage,
  // never echoed back in any response. Omit to leave the currently stored
  // value untouched; send '' to clear it.
  graSecurityKey?: string;
  momoSubscriptionKey?: string;
  momoApiKey?: string;
  tellerApiKey?: string;
  paystackSecretKey?: string;
};
