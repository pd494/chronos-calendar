import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "../api/client";
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

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await api.get<{ user: User; expires_at: number }>(
          "/auth/session",
        );
        setUser(response.user);
        setSession({ user: response.user, expires_at: response.expires_at });
      } catch {
        try {
          const refreshResponse = await api.post<{
            user: User;
            expires_at: number;
          }>("/auth/refresh");
          setUser(refreshResponse.user);
          setSession({
            user: refreshResponse.user,
            expires_at: refreshResponse.expires_at,
          });
        } catch {
          setUser(null);
          setSession(null);
        }
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

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
      setSession(null);
      setUser(null);
    }
  }, []);

  const refreshSession = useCallback(async (): Promise<User | null> => {
    try {
      const response = await api.post<{ user: User; expires_at: number }>(
        "/auth/refresh",
      );
      setUser(response.user);
      setSession({ user: response.user, expires_at: response.expires_at });
      setError(null);
      return response.user;
    } catch (err) {
      console.error("Failed to refresh session:", err);
      setSession(null);
      setUser(null);
      return null;
    }
  }, []);

  const completeOAuth = useCallback(async (code: string): Promise<User> => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.post<{ user: User; expires_at: number }>(
        `/auth/callback?code=${encodeURIComponent(code)}`,
      );
      setUser(response.user);
      setSession({ user: response.user, expires_at: response.expires_at });
      setError(null);
      setLoading(false);
      return response.user;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
      setLoading(false);
      throw err;
    }
  }, []);

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
