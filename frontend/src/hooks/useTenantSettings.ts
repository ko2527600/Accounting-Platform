// Tenant settings are now fetched once per login and shared app-wide via
// TenantSettingsContext (mounted in App.tsx) instead of each page independently
// re-fetching on every mount - this re-export keeps every existing import site
// working unchanged.
export { useTenantSettings } from '../contexts/TenantSettingsContext';
