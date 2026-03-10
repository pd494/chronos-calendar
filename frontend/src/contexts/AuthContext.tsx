import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { persister, queryClient } from "../lib/queryClient";
import { api, getApiUrl, resetAuthRequests } from "../api/client";
import { getDesktopOAuthRedirectUrl, openExternal } from "../lib/platform";

interface User {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

interface AuthSession {
  user: User;
  expires_at: number;
}

interface AuthContextValue {
  user: User | null;
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthSession | null>;
  completeOAuth: (code: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const oauthRequests = new Map<string, Promise<User>>();

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

  const applySession = useCallback((response: AuthSession) => {
    setUser(response.user);
    setSession({ user: response.user, expires_at: response.expires_at });
    setError(null);
  }, []);

  const fetchSession =
    useCallback(async (): Promise<AuthSession | null> => {
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

  const refreshSession = useCallback(async (): Promise<AuthSession | null> => {
    try {
      const response = await api.post<AuthSession>("/auth/refresh");
      applySession(response);
      return response;
    } catch {
      await clearLocalSession();
      return null;
    }
  }, [applySession, clearLocalSession]);

  useEffect(() => {
    const checkSession = async () => {
      if (window.location.pathname === "/auth/web/callback") {
        setLoading(false);
        return;
      }

      let resolvedSession: AuthSession | null = null;
      try {
        resolvedSession = await fetchSession();
        if (!resolvedSession) {
          resolvedSession = await refreshSession();
        }
      } catch {
        resolvedSession = await refreshSession();
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
  }, [applySession, fetchSession, refreshSession]);

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
          oauthCompleted.current = true;
          setLoading(true);
          setError(null);
          const response = await api.post<AuthSession>("/auth/web/callback", {
            code,
          });
          applySession(response);
          setLoading(false);
          return response.user;
        } catch (err) {
          oauthCompleted.current = false;
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
