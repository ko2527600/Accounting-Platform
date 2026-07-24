export interface TenantSettings {
  id: string;
  companyName: string;
  slug: string;
  baseCurrency: string;
  financialYearStart: string; // e.g., '01-01'
  timezone: string;
  updatedAt: string;
}

export type UpdateTenantSettingsDTO = Partial<Omit<TenantSettings, 'id' | 'updatedAt'>>;
