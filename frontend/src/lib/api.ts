import axios from 'axios';

// In production (e.g. Vercel), set VITE_API_BASE_URL to the deployed backend's
// URL (e.g. https://ledgio-backend.onrender.com/api/v1). Falls back to the
// local dev backend when unset.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercept requests to inject the Auth Token and Tenant ID
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accountgo-token');
    const tenantId = localStorage.getItem('accountgo-tenant-id');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    if (tenantId) {
      config.headers['X-Tenant-Id'] = tenantId;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Intercept responses to handle global authentication errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('accountgo-token');
      localStorage.removeItem('accountgo-tenant-id');

      // A 401 from /auth/login itself just means "wrong credentials" - Login.tsx
      // already renders that inline from the response body, and there's no real
      // session to tear down yet. Every other 401 means the current session went
      // stale (expired/invalid token) - dispatch a DOM event so AuthContext (a React
      // context this plain module can't call into directly) can force a clean
      // logout + redirect instead of leaving the app stuck silently re-401ing.
      const isLoginRequest = typeof error.config?.url === 'string' && error.config.url.includes('/auth/login');
      if (!isLoginRequest) {
        window.dispatchEvent(new Event('ledgio:session-expired'));
      }
    }
    return Promise.reject(error);
  }
);
