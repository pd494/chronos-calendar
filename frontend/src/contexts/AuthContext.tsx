import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { clearCryptoCache } from '../lib/crypto'
import type { User, AuthSession, AuthContextValue } from '../types/auth'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: supabaseSession } }) => {
      if (supabaseSession) {
        const userData: User = {
          id: supabaseSession.user.id,
          email: supabaseSession.user.email || '',
          name: supabaseSession.user.user_metadata?.name || null,
          avatar_url: supabaseSession.user.user_metadata?.avatar_url || null,
        }
        setUser(userData)
        setSession({
          user: userData,
          expires_at: supabaseSession.expires_at ? supabaseSession.expires_at * 1000 : Date.now() + 3600000,
        })
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, supabaseSession) => {
      if (supabaseSession) {
        const userData: User = {
          id: supabaseSession.user.id,
          email: supabaseSession.user.email || '',
          name: supabaseSession.user.user_metadata?.name || null,
          avatar_url: supabaseSession.user.user_metadata?.avatar_url || null,
        }
        setUser(userData)
        setSession({
          user: userData,
          expires_at: supabaseSession.expires_at ? supabaseSession.expires_at * 1000 : Date.now() + 3600000,
        })
      } else {
        setUser(null)
        setSession(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const loginWithGoogle = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
        },
      })
      if (error) throw error
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate login')
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch {
    } finally {
      clearCryptoCache()
      setSession(null)
      setUser(null)
    }
  }, [])

  const refreshSession = useCallback(async () => {
    try {
      const { data: { session: supabaseSession } } = await supabase.auth.getSession()
      if (supabaseSession) {
        const userData: User = {
          id: supabaseSession.user.id,
          email: supabaseSession.user.email || '',
          name: supabaseSession.user.user_metadata?.name || null,
          avatar_url: supabaseSession.user.user_metadata?.avatar_url || null,
        }
        setUser(userData)
        setSession({
          user: userData,
          expires_at: supabaseSession.expires_at ? supabaseSession.expires_at * 1000 : Date.now() + 3600000,
        })
        setError(null)
      }
    } catch {
      setSession(null)
      setUser(null)
    }
  }, [])

  const value: AuthContextValue = {
    user,
    session,
    loading,
    error,
    loginWithGoogle,
    logout,
    refreshSession,
    isAuthenticated: !!user,
    isLoading: loading,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
