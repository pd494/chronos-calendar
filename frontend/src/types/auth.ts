export interface User {
  id: string
  email: string
  name?: string | null
  avatar_url?: string | null
  created_at?: string
}

export interface AuthSession {
  user: User
  expires_at: number
}

export interface AuthState {
  user: User | null
  session: AuthSession | null
  loading: boolean
  error: string | null
}

export interface AuthContextValue {
  user: User | null
  session: AuthSession | null
  loading: boolean
  error: string | null

  // Actions
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>

  // State checks
  isAuthenticated: boolean
  isLoading: boolean
}
