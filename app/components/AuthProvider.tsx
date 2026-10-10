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
  /** Live Owner (super_admin). UI convenience only — the server enforces access. */
  isOwner: boolean;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  hasModule: () => false,
  isOwner: false,
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
    // End the Owner audit-passphrase session too, so it cannot outlive the
    // sign-in on a shared browser (the server also requires the live Owner).
    await fetch("/api/audit/auth/logout", { method: "POST" }).catch(() => undefined);
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  }, []);

  const hasModule = useCallback(
    (mod: string) => {
      if (!user) return false;
      if (user.role === "super_admin") return true;
      if (user.role === "admin" && user.modules.includes("*")) return true;
      // Grants are "module" or "module:fn,fn" (DB store), e.g. "dashboard:view".
      return user.modules.some((m) => m === mod || m.startsWith(mod + ":"));
    },
    [user]
  );
  const isOwner = user?.role === "super_admin";

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, hasModule, isOwner }}>
      {children}
    </AuthContext.Provider>
  );
}
