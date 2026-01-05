import { api } from './client'
import type { User, AuthSession } from '../types/auth'

interface GoogleLoginResponse {
  redirectUrl: string
}

interface CallbackResponse {
  user: User
  expires_at: number
}

export const authApi = {
  // Initiate Google OAuth - returns redirect URL
  initiateGoogleLogin: () =>
    api.get<GoogleLoginResponse>('/auth/google/login'),

  // Handle callback with code from Google
  handleCallback: (code: string) =>
    api.post<CallbackResponse>(`/auth/callback?code=${code}`),

  // Check current session validity
  getSession: () =>
    api.get<AuthSession>('/auth/session'),

  // Refresh access token
  refreshToken: () =>
    api.post<AuthSession>('/auth/refresh'),

  // Logout
  logout: () =>
    api.post<void>('/auth/logout'),

  // Get current user
  getCurrentUser: () =>
    api.get<User>('/auth/user'),
}
