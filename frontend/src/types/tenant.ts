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
  tier: TenantTier;
  updatedAt: string;
}

export type UpdateTenantSettingsDTO = Partial<Omit<TenantSettings, 'id' | 'updatedAt' | 'tier'>>;
