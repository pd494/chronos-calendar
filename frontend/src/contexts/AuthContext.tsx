import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api, ApiError } from "../api/client";
import { persister, queryClient } from "../lib/queryClient";
import type { User, AuthSession, AuthContextValue } from "../types/auth";
import { AuthContext } from "./auth-context";
import {
  getDesktopOAuthRedirectUrl,
  isDesktop,
  openExternal,
} from "../lib/platform";

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
  const sessionCheckInProgress = useRef(false);

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

  const isCsrfError = useCallback((err: unknown): err is ApiError => {
    if (!(err instanceof ApiError) || err.status !== 403) {
      return false;
    }
    if (err.message.includes("CSRF")) {
      return true;
    }
    const details = err.details;
    if (typeof details !== "object" || !details || !("detail" in details)) {
      return false;
    }
    return String((details as { detail: unknown }).detail).includes("CSRF");
  }, []);

  const retryWithCsrfBootstrap = useCallback(
    async <T,>(requestFn: () => Promise<T>): Promise<T> => {
      try {
        return await requestFn();
      } catch (err) {
        if (isCsrfError(err)) {
          await api.get<{ ok: boolean }>("/auth/csrf");
          return requestFn();
        }
        throw err;
      }
    },
    [isCsrfError],
  );

  const refreshWithCsrfBootstrap = useCallback(async () => {
    return retryWithCsrfBootstrap(() =>
      api.post<SessionResponse>("/auth/refresh"),
    );
  }, [retryWithCsrfBootstrap]);

  useEffect(() => {
    if (
      window.location.pathname === "/auth/web/callback" &&
      new URLSearchParams(window.location.search).has("code")
    ) {
      return;
    }

    const checkSession = async () => {
      sessionCheckInProgress.current = true;
      let resolvedSession: SessionResponse | null = null;
      try {
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
      } finally {
        sessionCheckInProgress.current = false;
        setLoading(false);
      }
    };
    void checkSession();
  }, [applySession, refreshWithCsrfBootstrap]);

  const loginWithGoogle = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const desktop = isDesktop();
      const redirectTo = desktop ? getDesktopOAuthRedirectUrl() : undefined;
      const response = await api.get<{ redirectUrl: string }>(
        "/auth/google/login",
        redirectTo ? { redirectTo } : undefined,
      );
      await openExternal(response.redirectUrl);
      if (desktop) {
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate login");
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await retryWithCsrfBootstrap(() => api.post("/auth/logout"));
    } catch (err) {
      console.error("Failed to sign out:", err);
    } finally {
      await clearLocalSession();
    }
  }, [clearLocalSession, retryWithCsrfBootstrap]);

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
        const response = await retryWithCsrfBootstrap(() =>
          api.post<{ user: User; expires_at: number }>("/auth/web/callback", {
            code,
          }),
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
    [applySession, retryWithCsrfBootstrap],
  );

  useEffect(() => {
    const onUnauthorized = () => {
      if (sessionCheckInProgress.current) {
        return;
      }
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
