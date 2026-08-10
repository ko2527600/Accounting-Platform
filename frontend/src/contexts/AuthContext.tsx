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
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
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
          if (response.data.data.user.tenantId) {
            localStorage.setItem('accountgo-tenant-id', response.data.data.user.tenantId);
          }
        } else {
          throw new Error("Invalid token");
        }
      } catch (error) {
        console.error("Token verification failed:", error);
        logout();
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
    setToken(newToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('accountgo-token');
    localStorage.removeItem('accountgo-tenant-id');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
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
