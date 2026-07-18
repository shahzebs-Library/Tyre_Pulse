import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { User, AuthError, RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Profile, normaliseRole, normaliseCountry } from '../lib/types'
import {
  ModuleKey, GrantMap, RoleMatrix, mobileGrantsFromRaw, mobileRoleMatrixFromRaw,
  resolveModuleAccess,
} from '../lib/permissions'
import { syncQueue, clearQueue } from '../lib/offlineQueue'
import { syncRecordQueue, clearRecordQueue } from '../lib/recordQueue'
import { clearPushToken, cancelDailyInspectionReminder } from '../lib/notifications'
import { setSentryUser } from '../lib/sentry'

/** Wipe all device-local, user-scoped state (offline queues + local reminders)
 *  so a different account on a shared device cannot inherit the prior user's
 *  pending records or notifications. Local-only; safe to call unauthenticated. */
async function clearLocalUserState(): Promise<void> {
  await Promise.allSettled([
    clearQueue(),
    clearRecordQueue(),
    cancelDailyInspectionReminder(),
  ])
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  /** True when this account is the platform super-admin. */
  isSuperAdmin: boolean
  /** Per-user mobile access overlay (mobile: grants, prefix stripped). */
  grants: GrantMap
  /** ROLE-level mobile permission matrix (mobile: module_permissions rows). */
  roleMatrix: RoleMatrix
  /** Effective access for a mobile module: role default + role matrix + grants. */
  canAccess: (key: ModuleKey) => boolean
  /** Re-pull this user's grants AND the role mobile matrix (after admin edits). */
  refreshGrants: () => Promise<void>
  signIn: (identifier: string, password: string) => Promise<{ error: AuthError | Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [grants, setGrants]   = useState<GrantMap>({})
  const [roleMatrix, setRoleMatrix] = useState<RoleMatrix>({})
  const profileChannelRef     = useRef<RealtimeChannel | null>(null)
  const grantsChannelRef      = useRef<RealtimeChannel | null>(null)
  const roleMatrixChannelRef  = useRef<RealtimeChannel | null>(null)

  const isSuperAdmin = profile?.is_super_admin === true

  // Load this user's mobile access overlay. Fail-open to {} (never blocks the
  // app); web grants are ignored (mobileGrantsFromRaw keeps only mobile: keys).
  async function fetchGrants() {
    try {
      const { data } = await supabase.rpc('get_my_access_grants')
      setGrants(mobileGrantsFromRaw(data as Record<string, unknown> | null))
    } catch {
      setGrants({})
    }
  }

  // Load the ROLE-level mobile permission matrix for this user's role. The RPC
  // is role-scoped server-side and returns every module_permissions row for the
  // role; we keep only the `mobile:` prefixed ones. Fail-OPEN to {} on any error
  // so a transient failure can never lock the user out (role default applies).
  async function fetchRoleMatrix() {
    try {
      const { data } = await supabase.rpc('get_user_module_permissions')
      setRoleMatrix(mobileRoleMatrixFromRaw(data as Record<string, unknown> | null))
    } catch {
      setRoleMatrix({})
    }
  }

  // Re-pull both overlays together (used on tab focus / after admin edits).
  async function refreshAccess() {
    await Promise.all([fetchGrants(), fetchRoleMatrix()])
  }

  // Realtime: when a super-admin changes THIS user's grants, re-pull so their
  // navigation auto-adjusts without a re-login.
  function subscribeToGrants(userId: string) {
    if (grantsChannelRef.current) supabase.removeChannel(grantsChannelRef.current)
    grantsChannelRef.current = supabase
      .channel(`grants:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_access_grants', filter: `user_id=eq.${userId}` },
        () => { fetchGrants() },
      )
      .subscribe()
  }
  function unsubscribeFromGrants() {
    if (grantsChannelRef.current) {
      supabase.removeChannel(grantsChannelRef.current)
      grantsChannelRef.current = null
    }
  }

  // Realtime: when an admin edits the role -> module matrix (module_permissions),
  // re-pull the mobile matrix so the whole role's navigation auto-adjusts live.
  function subscribeToRoleMatrix() {
    if (roleMatrixChannelRef.current) supabase.removeChannel(roleMatrixChannelRef.current)
    roleMatrixChannelRef.current = supabase
      .channel('role-mobile-matrix')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'module_permissions' },
        () => { fetchRoleMatrix() },
      )
      .subscribe()
  }
  function unsubscribeFromRoleMatrix() {
    if (roleMatrixChannelRef.current) {
      supabase.removeChannel(roleMatrixChannelRef.current)
      roleMatrixChannelRef.current = null
    }
  }

  function canAccess(key: ModuleKey): boolean {
    return resolveModuleAccess(key, profile?.role ?? null, grants, isSuperAdmin, roleMatrix)
  }

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
          setProfile({ ...updated, role: normaliseRole(updated.role), country: normaliseCountry(updated.country) } as Profile)
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
          fetchGrants()
          subscribeToGrants(session.user.id)
          fetchRoleMatrix()
          subscribeToRoleMatrix()
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
        fetchGrants()
        subscribeToGrants(session.user.id)
        fetchRoleMatrix()
        subscribeToRoleMatrix()
      } else {
        setProfile(null)
        setGrants({})
        setRoleMatrix({})
        setSentryUser(null)
        unsubscribeFromProfile()
        unsubscribeFromGrants()
        unsubscribeFromRoleMatrix()
        // On any sign-out (manual OR forced lockout) purge device-local queues.
        clearLocalUserState().catch(() => {})
      }
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
      unsubscribeFromProfile()
      unsubscribeFromGrants()
      unsubscribeFromRoleMatrix()
    }
  }, [])

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase.from('profiles').select('id,full_name,username,role,email,employee_id,site,country,approved,locked,is_super_admin,created_at').eq('id', userId).maybeSingle()
      if (data) {
        // Enforce locked / unapproved accounts on the client immediately
        if (data.locked === true || data.approved === false) {
          await supabase.auth.signOut()
          return
        }
        setProfile({ ...data, role: normaliseRole(data.role), country: normaliseCountry(data.country) } as Profile)
        // Tag field crash reports with the operator behind them.
        setSentryUser({ id: data.id, username: data.username })
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
      // user enumeration - the specific reason is logged server-side by GoTrue.
      return { error: new Error('Invalid credentials. Please try again.') }
    }
    return { error: null }
  }

  async function signOut() {
    const uid = user?.id
    // While still authenticated: best-effort flush of this user's pending work
    // under their OWN session (so nothing is lost when online), then clear their
    // push token so pushes aren't delivered to the next account on this device.
    try { await Promise.allSettled([syncQueue(), syncRecordQueue()]) } catch { /* best-effort */ }
    if (uid) { try { await clearPushToken(uid) } catch { /* best-effort */ } }
    // Local queues are wiped centrally by the SIGNED_OUT handler below.
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isSuperAdmin, grants, roleMatrix, canAccess,
      refreshGrants: refreshAccess, signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
