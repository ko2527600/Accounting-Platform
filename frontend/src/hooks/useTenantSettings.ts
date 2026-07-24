import { useState, useCallback, useEffect } from 'react';
import type { TenantSettings, UpdateTenantSettingsDTO } from '../types/tenant';
import { api } from '../lib/api';

const DEFAULT_TENANT: TenantSettings = {
  id: '',
  companyName: 'My Workspace',
  slug: '',
  baseCurrency: 'USD',
  financialYearStart: '01-01',
  timezone: 'UTC',
  updatedAt: new Date().toISOString()
};

export function useTenantSettings() {
  const [settings, setSettings] = useState<TenantSettings>(DEFAULT_TENANT);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/tenants/current');
      if (res.data.success && res.data.data.tenant) {
        const t = res.data.data.tenant;
        setSettings({
          id: t.id,
          companyName: t.name || 'My Workspace',
          slug: t.slug || '',
          baseCurrency: 'USD',
          financialYearStart: '01-01',
          timezone: 'UTC',
          updatedAt: t.updatedAt || new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to fetch tenant settings', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (data: UpdateTenantSettingsDTO) => {
    setIsLoading(true);
    try {
      const res = await api.put('/tenants/current', data);
      if (res.data.success && res.data.data.tenant) {
        const t = res.data.data.tenant;
        const updated = {
          ...settings,
          companyName: t.name,
          slug: t.slug,
          ...data,
          updatedAt: new Date().toISOString()
        };
        setSettings(updated);
        return updated;
      }
    } catch (error) {
      console.error('Failed to update tenant settings', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    isLoading,
    fetchSettings,
    updateSettings
  };
}
