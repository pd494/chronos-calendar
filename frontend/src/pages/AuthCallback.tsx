import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { api } from '../api/client'

export function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const processed = useRef(false)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const handleCallback = async () => {
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const providerToken = hashParams.get('provider_token')
      const providerRefreshToken = hashParams.get('provider_refresh_token')

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (sessionError) {
          console.error('Failed to set Supabase session:', sessionError)
          setError(sessionError.message)
          return
        }

        try {
          await api.post('/auth/set-session', { access_token: accessToken })
        } catch (err) {
          console.error('Failed to set backend session:', err)
        }

        if (providerToken) {
          try {
            await api.post('/auth/google/store-tokens', {
              access_token: accessToken,
              provider_token: providerToken,
              provider_refresh_token: providerRefreshToken,
            })
          } catch (err) {
            console.error('Failed to store Google tokens:', err)
          }
        }
      } else {
        const { data, error } = await supabase.auth.getSession()
        if (error) {
          setError(error.message)
          return
        }
        if (data.session?.access_token) {
          try {
            await api.post('/auth/set-session', { access_token: data.session.access_token })
          } catch (err) {
            console.error('Failed to set backend session:', err)
          }
        }
      }

      navigate('/', { replace: true })
    }

    handleCallback()
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="max-w-md w-full space-y-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Authentication Failed</h1>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
        <p className="mt-4 text-gray-600">Signing you in...</p>
      </div>
    </div>
  )
}
