"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

interface AuthUser {
  email: string;
  name: string;
  role: string;
  modules: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasModule: (mod: string) => boolean;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  hasModule: () => false,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        setUser(await res.json());
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  }, []);

  const hasModule = useCallback(
    (mod: string) => {
      if (!user) return false;
      if (user.role === "super_admin") return true;
      if (user.modules.includes("*")) return true;
      return user.modules.includes(mod);
    },
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, hasModule }}>
      {children}
    </AuthContext.Provider>
  );
}
