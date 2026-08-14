import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { TenantSettings, UpdateTenantSettingsDTO } from "../types/tenant";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

const DEFAULT_TENANT: TenantSettings = {
  id: '',
  companyName: 'My Workspace',
  slug: '',
  baseCurrency: 'USD',
  financialYearStart: '01-01',
  timezone: 'UTC',
  bossPhone: null,
  updatedAt: new Date().toISOString()
};

type TenantSettingsContextType = {
  settings: TenantSettings;
  isLoading: boolean;
  fetchSettings: () => Promise<void>;
  updateSettings: (data: UpdateTenantSettingsDTO) => Promise<TenantSettings | undefined>;
};

const TenantSettingsContext = createContext<TenantSettingsContextType | undefined>(undefined);

// Fetched once per login and shared by every page, instead of each page's own
// hook instance independently re-fetching (and re-rendering from the hardcoded
// USD default) on every mount - that was the cause of the "$ then flips to the
// real currency" flash on every navigation.
export function TenantSettingsProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [settings, setSettings] = useState<TenantSettings>(DEFAULT_TENANT);
  // Starts true (mirrors AuthContext's own isLoading) so ProtectedRoute can
  // gate initial render on it and never paint the USD default at all.
  const [isLoading, setIsLoading] = useState(true);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
          baseCurrency: t.baseCurrency || 'USD',
          financialYearStart: '01-01',
          timezone: 'UTC',
          bossPhone: t.bossPhone ?? null,
          updatedAt: t.updatedAt || new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to fetch tenant settings', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Deliberately does not touch `isLoading` - that flag gates initial-load
  // rendering (ProtectedRoute holds every page on a spinner until it's
  // false, and this page's own body does the same). Toggling it here too
  // was found to unmount/remount the whole page around every save - on
  // Settings.tsx specifically, that resets `activeTab` state back to the
  // first tab immediately after saving, so a save on any tab but the first
  // looked like it silently failed (the tenant *was* saved - the success
  // banner just rendered on a tab the user had already been bounced off of).
  const updateSettings = useCallback(async (data: UpdateTenantSettingsDTO) => {
    try {
      const res = await api.put('/tenants/current', data);
      if (res.data.success && res.data.data.tenant) {
        const t = res.data.data.tenant;
        const updated = {
          ...settingsRef.current,
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
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchSettings();
    } else {
      // Logged out - reset to the default rather than leaving a previous
      // tenant's currency/settings visible to whoever logs in next on a
      // shared browser.
      setSettings(DEFAULT_TENANT);
      setIsLoading(false);
    }
  }, [token, fetchSettings]);

  return (
    <TenantSettingsContext.Provider value={{ settings, isLoading, fetchSettings, updateSettings }}>
      {children}
    </TenantSettingsContext.Provider>
  );
}

export function useTenantSettings(): TenantSettingsContextType {
  const context = useContext(TenantSettingsContext);
  if (context === undefined) {
    throw new Error("useTenantSettings must be used within a TenantSettingsProvider");
  }
  return context;
}
