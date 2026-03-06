import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import { persister, queryClient } from "../lib/queryClient";
import type { User, AuthSession, AuthContextValue } from "../types/auth";
import {
  getDesktopOAuthRedirectUrl,
  isDesktop,
  openExternal,
} from "../lib/platform";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

type SessionResponse = { user: User; expires_at: number };

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const oauthCompleted = useRef(false);

  const clearLocalSession = useCallback(async () => {
    setSession(null);
    setUser(null);
    setError(null);
    setLoading(false);
    queryClient.clear();
    await persister.removeClient();
  }, []);

  const applySession = useCallback((response: SessionResponse) => {
    setUser(response.user);
    setSession({ user: response.user, expires_at: response.expires_at });
    setError(null);
  }, []);

  const refreshWithCsrfBootstrap = useCallback(async () => {
    return api.post<SessionResponse>("/auth/refresh");
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      let resolvedSession: SessionResponse | null = null;
      try {
        resolvedSession = await api.get<SessionResponse>("/auth/session");
      } catch {
        try {
          resolvedSession = await refreshWithCsrfBootstrap();
        } catch {
          resolvedSession = null;
        }
      }
      if (!oauthCompleted.current) {
        if (resolvedSession) {
          applySession(resolvedSession);
        } else {
          setUser(null);
          setSession(null);
        }
      }
      setLoading(false);
    };
    checkSession();
  }, [applySession, refreshWithCsrfBootstrap]);

  const loginWithGoogle = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const redirectTo = isDesktop() ? getDesktopOAuthRedirectUrl() : undefined;
      const response = await api.get<{ redirectUrl: string }>(
        "/auth/google/login",
        redirectTo ? { redirectTo } : undefined,
      );
      if (isDesktop()) {
        await openExternal(response.redirectUrl);
        setLoading(false);
        return;
      }
      window.location.href = response.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate login");
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.error("Failed to sign out:", err);
    } finally {
      await clearLocalSession();
    }
  }, [clearLocalSession]);

  const refreshSession = useCallback(async (): Promise<User | null> => {
    try {
      const response = await refreshWithCsrfBootstrap();
      applySession(response);
      return response.user;
    } catch (err) {
      console.error("Failed to refresh session:", err);
      await clearLocalSession();
      return null;
    }
  }, [applySession, clearLocalSession, refreshWithCsrfBootstrap]);

  const completeOAuth = useCallback(
    async (code: string): Promise<User> => {
      try {
        oauthCompleted.current = true;
        setLoading(true);
        setError(null);
        const response = await api.post<{ user: User; expires_at: number }>(
          "/auth/web/callback",
          { code },
        );
        applySession(response);
        setLoading(false);
        return response.user;
      } catch (err) {
        oauthCompleted.current = false;
        setError(err instanceof Error ? err.message : "Authentication failed");
        setLoading(false);
        throw err;
      }
    },
    [applySession],
  );

  useEffect(() => {
    const onUnauthorized = () => {
      void clearLocalSession();
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => {
      window.removeEventListener("auth:unauthorized", onUnauthorized);
    };
  }, [clearLocalSession]);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    error,
    loginWithGoogle,
    logout,
    refreshSession,
    completeOAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
