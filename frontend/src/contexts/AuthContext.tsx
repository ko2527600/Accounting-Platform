import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId?: string;
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
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('accountgo-token'));
  const [isLoading, setIsLoading] = useState(true);

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

  const login = (newToken: string, userData: User) => {
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
