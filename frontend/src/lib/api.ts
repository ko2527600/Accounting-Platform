import axios from 'axios';

// Ensure we have a base URL pointing to our local backend service
const API_BASE_URL = 'http://localhost:4000/api/v1';

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
      // Clear invalid token
      localStorage.removeItem('accountgo-token');
      // If we aren't already on the login page, we could redirect,
      // but let the React Router ProtectedRoute handle this gracefully based on AuthContext state.
    }
    return Promise.reject(error);
  }
);
