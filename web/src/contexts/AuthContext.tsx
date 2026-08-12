import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { persister, queryClient } from "../lib/queryClient";
import {
  api,
  getApiUrl,
  refreshAuthSession,
  resetAuthRequests,
} from "../api/client";
import { getDesktopOAuthRedirectUrl, openExternal } from "../lib/platform";

interface User {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

interface AuthResponse {
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  completeOAuth: (code: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const oauthRequests = new Map<string, Promise<User>>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearLocalSession = useCallback(async () => {
    setUser(null);
    setError(null);
    setLoading(false);
    queryClient.clear();
    await persister.removeClient();
  }, []);

  const applySession = useCallback((response: AuthResponse) => {
    setUser(response.user);
    setError(null);
  }, []);

  const fetchSession = useCallback(async (): Promise<AuthResponse | null> => {
    const response = await fetch(`${getApiUrl()}/auth/session`, {
      method: "GET",
      credentials: "include",
    });

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      throw new Error("Failed to fetch session");
    }

    return response.json();
  }, []);

  const restoreSession = useCallback(async (): Promise<AuthResponse | null> => {
    try {
      const refreshed = await refreshAuthSession();
      if (!refreshed) {
        await clearLocalSession();
        return null;
      }

      const response = await fetchSession();
      if (!response) {
        await clearLocalSession();
        return null;
      }

      applySession(response);
      return response;
    } catch {
      await clearLocalSession();
      return null;
    }
  }, [applySession, clearLocalSession, fetchSession]);

  useEffect(() => {
    const checkSession = async () => {
      if (window.location.pathname === "/auth/web/callback") {
        setLoading(false);
        return;
      }

      let resolvedSession: AuthResponse | null = null;
      try {
        resolvedSession = await fetchSession();
        if (!resolvedSession) {
          resolvedSession = await restoreSession();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch session",
        );
        resolvedSession = await restoreSession();
      }
      if (resolvedSession) {
        applySession(resolvedSession);
      } else {
        setUser(null);
      }
      setLoading(false);
    };
    checkSession();
  }, [applySession, fetchSession, restoreSession]);

  const loginWithGoogle = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const redirectTo = getDesktopOAuthRedirectUrl();
      const response = await api.get<{ redirectUrl: string }>(
        "/auth/google/login",
        redirectTo ? { redirectTo } : undefined,
      );
      await openExternal(response.redirectUrl);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate login");
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    resetAuthRequests();
    try {
      await api.post("/auth/logout");
    } catch {
      return clearLocalSession();
    }
    await clearLocalSession();
  }, [clearLocalSession]);

  const completeOAuth = useCallback(
    async (code: string): Promise<User> => {
      const inFlight = oauthRequests.get(code);
      if (inFlight) return inFlight;

      const request = (async () => {
        try {
          resetAuthRequests();
          setLoading(true);
          setError(null);
          const response = await api.post<AuthResponse>("/auth/web/callback", {
            code,
          });
          applySession(response);
          setLoading(false);
          return response.user;
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Authentication failed",
          );
          setLoading(false);
          throw err;
        } finally {
          oauthRequests.delete(code);
        }
      })();

      oauthRequests.set(code, request);
      return request;
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
    loading,
    error,
    loginWithGoogle,
    logout,
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
