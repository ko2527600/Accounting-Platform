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
  updatedAt: string;
}

export type UpdateTenantSettingsDTO = Partial<Omit<TenantSettings, 'id' | 'updatedAt'>>;
