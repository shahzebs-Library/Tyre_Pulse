import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { User, AuthError, RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Profile, normaliseRole } from '../lib/types'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (identifier: string, password: string) => Promise<{ error: AuthError | Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const profileChannelRef     = useRef<RealtimeChannel | null>(null)

  // Subscribe to realtime updates on this user's profile row so any role/field
  // change made by an admin is applied immediately without requiring re-login.
  function subscribeToProfile(userId: string) {
    if (profileChannelRef.current) {
      supabase.removeChannel(profileChannelRef.current)
    }
    profileChannelRef.current = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as Record<string, any>
          // Enforce lockout/approval changes applied by admins in real time
          if (updated.locked === true || updated.approved === false) {
            supabase.auth.signOut()
            return
          }
          setProfile({ ...updated, role: normaliseRole(updated.role) } as Profile)
        }
      )
      .subscribe()
  }

  function unsubscribeFromProfile() {
    if (profileChannelRef.current) {
      supabase.removeChannel(profileChannelRef.current)
      profileChannelRef.current = null
    }
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchProfile(session.user.id)
          subscribeToProfile(session.user.id)
        }
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false) })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        subscribeToProfile(session.user.id)
      } else {
        setProfile(null)
        unsubscribeFromProfile()
      }
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
      unsubscribeFromProfile()
    }
  }, [])

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      if (data) {
        // Enforce locked / unapproved accounts on the client immediately
        if (data.locked === true || data.approved === false) {
          await supabase.auth.signOut()
          return
        }
        setProfile({ ...data, role: normaliseRole(data.role) } as Profile)
      } else {
        setProfile(null)
      }
    } catch {
      // Profile is non-blocking; screens fall back gracefully when it is null.
    }
  }

  async function signIn(identifier: string, password: string) {
    let email = identifier.trim()

    if (!email.includes('@')) {
      const { data: resolved, error: rpcErr } = await supabase
        .rpc('get_email_by_identifier', { identifier: email })
      if (rpcErr) return { error: rpcErr }
      if (!resolved) return { error: new Error('No account found with that username or Employee ID.') }
      email = resolved
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Return a generic message for all Supabase auth failures to prevent
      // user enumeration — the specific reason is logged server-side by GoTrue.
      return { error: new Error('Invalid credentials. Please try again.') }
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
