import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./ToastContext";

type User = {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: string;
  tenantId?: string;
  orgType?: string;
  isMfaEnabled?: boolean;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readCachedUser(): User | null {
  const raw = localStorage.getItem('accountgo-user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function cacheUser(userData: User): void {
  localStorage.setItem('accountgo-user', JSON.stringify(userData));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  // Seeded from the last-known cached profile (not null) so a returning
  // offline user has a usable `user` (incl. tenantId, which
  // useSyncEngineLifecycle keys off of) before /auth/me ever resolves.
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [token, setToken] = useState<string | null>(localStorage.getItem('accountgo-token'));
  const [isLoading, setIsLoading] = useState(true);
  // Guards against a burst of parallel requests (e.g. the dashboard's several
  // simultaneous calls) that all 401 in the same tick from showing more than
  // one "session expired" toast for a single expiry event.
  const sessionExpiredNoticeShown = useRef(false);

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        // Ping the /me endpoint to verify token validity and get user profile
        const response = await api.get('/auth/me');
        if (response.data.success) {
          setUser(response.data.data.user);
          cacheUser(response.data.data.user);
          if (response.data.data.user.tenantId) {
            localStorage.setItem('accountgo-tenant-id', response.data.data.user.tenantId);
          }
        } else {
          throw new Error("Invalid token");
        }
      } catch (error: any) {
        console.error("Token verification failed:", error);
        // A plain network failure (no HTTP response at all - offline, DNS,
        // server unreachable) is not proof the token is invalid. Only a
        // genuine HTTP rejection (e.g. an actual 401) means the session is
        // really dead. Logging out on a connectivity blip would clear
        // `token`, which cascades into useSyncEngineLifecycle wiping the
        // entire local-first offline cache purely because the network hiccuped.
        if (error?.response) {
          logout();
        }
      } finally {
        setIsLoading(false);
      }
    };

    verifyToken();
  }, [token]);

  // api.ts's response interceptor dispatches this whenever a request 401s
  // outside of a plain login-form rejection - meaning the current session went
  // stale (expired/invalid token). It can't call useAuth()/useToast() directly
  // since it's a plain module, so it signals via a DOM event instead.
  useEffect(() => {
    const handleSessionExpired = () => {
      if (sessionExpiredNoticeShown.current) return;
      sessionExpiredNoticeShown.current = true;
      logout();
      showToast("Your session has expired. Please log in again.", "info");
    };
    window.addEventListener('ledgio:session-expired', handleSessionExpired);
    return () => window.removeEventListener('ledgio:session-expired', handleSessionExpired);
  }, [showToast]);

  const login = (newToken: string, userData: User) => {
    sessionExpiredNoticeShown.current = false;
    localStorage.setItem('accountgo-token', newToken);
    if (userData.tenantId) {
      localStorage.setItem('accountgo-tenant-id', userData.tenantId);
    }
    cacheUser(userData);
    setToken(newToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('accountgo-token');
    localStorage.removeItem('accountgo-tenant-id');
    localStorage.removeItem('accountgo-user');
    setToken(null);
    setUser(null);
  };

  // Re-fetches the current user profile without a full login round trip -
  // for settings that change something on `user` itself (e.g. MFA
  // enable/disable) but don't need a new token, so the rest of the app
  // (Header, role-gated nav) reflects the change immediately.
  const refreshUser = async () => {
    if (!token) return;
    const response = await api.get('/auth/me');
    if (response.data.success) {
      setUser(response.data.data.user);
      cacheUser(response.data.data.user);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
