export interface User {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

export interface AuthSession {
  user: User;
  expires_at: number;
}

export interface AuthContextValue {
  user: User | null;
  session: AuthSession | null;
  loading: boolean;
  error: string | null;

  // Actions
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<User | null>;
  completeOAuth: (code: string) => Promise<User>;
}
