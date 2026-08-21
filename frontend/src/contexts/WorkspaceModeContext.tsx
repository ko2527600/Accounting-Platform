import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type WorkspaceMode = 'operations' | 'business' | 'professional';

interface WorkspaceModeContextValue {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

const WorkspaceModeContext = createContext<WorkspaceModeContextValue>({
  mode: 'business',
  setMode: () => {},
});

function defaultModeForRole(role: string | undefined): WorkspaceMode {
  const r = (role || '').toLowerCase().trim();
  if (r === 'cashier' || r === 'shop manager') return 'operations';
  if (r === 'accountant' || r === 'auditor') return 'professional';
  return 'business';
}

const STORAGE_KEY = 'ledgio-workspace-mode';

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [mode, setModeState] = useState<WorkspaceMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as WorkspaceMode | null;
      if (stored === 'operations' || stored === 'business' || stored === 'professional') return stored;
    } catch {}
    return defaultModeForRole(user?.role);
  });

  // On login role change, adopt a sensible default if no explicit preference is stored
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) setModeState(defaultModeForRole(user?.role));
    } catch {}
  }, [user?.role]);

  const setMode = (newMode: WorkspaceMode) => {
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch {}
    setModeState(newMode);
  };

  const value = useMemo(() => ({ mode, setMode }), [mode]);

  return (
    <WorkspaceModeContext.Provider value={value}>
      {children}
    </WorkspaceModeContext.Provider>
  );
}

export function useWorkspaceMode() {
  return useContext(WorkspaceModeContext);
}
