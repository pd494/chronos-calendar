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
import type { User, AuthSession, AuthContextValue } from "../types/auth";
import {
  getDesktopOAuthRedirectUrl,
  isDesktop,
  openExternal,
} from "../lib/platform";
import {
  setAccessToken,
  setRefreshToken,
  getRefreshToken,
  deleteAccessToken,
  deleteRefreshToken,
} from "../lib/tokenStorage";

const SESSION_CACHE_KEY = "chronos_session_cache";

function getCachedSession(): { user: User; session: AuthSession } | null {
  if (!isDesktop()) return null;
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCachedSession(user: User, session: AuthSession) {
  if (!isDesktop()) return;
  localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ user, session }));
}

function clearCachedSession() {
  localStorage.removeItem(SESSION_CACHE_KEY);
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const cached = getCachedSession();
  const [user, setUser] = useState<User | null>(cached?.user ?? null);
  const [session, setSession] = useState<AuthSession | null>(
    cached?.session ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const oauthCompleted = useRef(false);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await api.get<{ user: User; expires_at: number }>(
          "/auth/session",
        );
        if (!oauthCompleted.current) {
          setUser(response.user);
          const sess = { user: response.user, expires_at: response.expires_at };
          setSession(sess);
          setCachedSession(response.user, sess);
        }
      } catch {
        try {
          let refreshResponse;
          if (isDesktop()) {
            const refreshToken = await getRefreshToken();
            if (!refreshToken) {
              throw new Error("No refresh token available");
            }
            refreshResponse = await api.post<{
              user: User;
              expires_at: number;
              access_token: string;
              refresh_token: string;
            }>("/auth/refresh", { refresh_token: refreshToken });
            await setAccessToken(refreshResponse.access_token);
            await setRefreshToken(refreshResponse.refresh_token);
          } else {
            refreshResponse = await api.post<{
              user: User;
              expires_at: number;
            }>("/auth/refresh");
          }
          if (!oauthCompleted.current) {
            setUser(refreshResponse.user);
            const sess = {
              user: refreshResponse.user,
              expires_at: refreshResponse.expires_at,
            };
            setSession(sess);
            setCachedSession(refreshResponse.user, sess);
          }
        } catch {
          if (!oauthCompleted.current) {
            setUser(null);
            setSession(null);
            clearCachedSession();
          }
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
      if (isDesktop()) {
        await deleteAccessToken();
        await deleteRefreshToken();
      }
      setSession(null);
      setUser(null);
      clearCachedSession();
    }
  }, []);

  const refreshSession = useCallback(async (): Promise<User | null> => {
    try {
      let response;
      if (isDesktop()) {
        const refreshToken = await getRefreshToken();
        response = await api.post<{
          user: User;
          expires_at: number;
          access_token: string;
          refresh_token: string;
        }>("/auth/refresh", { refresh_token: refreshToken });
        await setAccessToken(response.access_token);
        await setRefreshToken(response.refresh_token);
      } else {
        response = await api.post<{ user: User; expires_at: number }>(
          "/auth/refresh",
        );
      }
      const sess = { user: response.user, expires_at: response.expires_at };
      setUser(response.user);
      setSession(sess);
      setCachedSession(response.user, sess);
      setError(null);
      return response.user;
    } catch (err) {
      console.error("Failed to refresh session:", err);
      setSession(null);
      setUser(null);
      clearCachedSession();
      return null;
    }
  }, []);

  const completeOAuth = useCallback(async (code: string): Promise<User> => {
    try {
      oauthCompleted.current = true;
      setLoading(true);
      setError(null);
      let response;
      if (isDesktop()) {
        response = await api.post<{
          user: User;
          expires_at: number;
          access_token: string;
          refresh_token: string;
        }>("/auth/desktop/callback", { code });
        await setAccessToken(response.access_token);
        await setRefreshToken(response.refresh_token);
      } else {
        response = await api.post<{ user: User; expires_at: number }>(
          "/auth/web/callback",
          { code },
        );
      }
      const sess = { user: response.user, expires_at: response.expires_at };
      setUser(response.user);
      setSession(sess);
      setCachedSession(response.user, sess);
      setError(null);
      setLoading(false);
      return response.user;
    } catch (err) {
      oauthCompleted.current = false;
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
