import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { User, AuthError, RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Profile, normaliseRole, normaliseCountry } from '../lib/types'
import {
  ModuleKey, GrantMap, RoleMatrix, mobileGrantsFromRaw, mobileRoleMatrixFromRaw,
  resolveModuleAccess,
} from '../lib/permissions'
import {
  syncQueue, clearSynced, getPendingCount,
} from '../lib/offlineQueue'
import {
  syncRecordQueue, clearSyncedRecords, getPendingRecordCount,
} from '../lib/recordQueue'
import { clearPushToken, cancelDailyInspectionReminder } from '../lib/notifications'
import { setSentryUser } from '../lib/sentry'

/** Clear device-local, user-scoped state on sign-out WITHOUT destroying unsynced
 *  field work. We remove only SUCCESSFULLY SYNCED queue rows (clearSynced /
 *  clearSyncedRecords) and cancel local reminders. PENDING / failed inspections,
 *  photos and records are PRESERVED so a tyre man who logs out while offline (or
 *  when sync fails) does not lose captured work; those rows are picked up again
 *  the next time that user signs in. Pending work must survive logout: only an
 *  explicit admin/owner action or a successful sync may remove it. Local-only;
 *  safe to call unauthenticated. */
async function clearLocalUserState(): Promise<void> {
  await Promise.allSettled([
    clearSynced(),
    clearSyncedRecords(),
    cancelDailyInspectionReminder(),
  ])
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  /** True while the auth SESSION is still resolving (getSession bootstrap). */
  loading: boolean
  /** True while there is an authenticated user whose profile (role/approval/
   *  lock) has NOT yet been resolved. The gate must treat this as "not ready"
   *  and must NOT grant protected access until profile is loaded. */
  profileLoading: boolean
  /** True when the profile fetch threw / failed for the signed-in user. The gate
   *  must FAIL CLOSED on this: render a blocking retry screen, deny protected
   *  routes. `profile` stays null in this state. */
  profileError: boolean
  /** Re-run the profile fetch for the current user (retry after profileError). */
  retryProfile: () => Promise<void>
  /** True when the grants OR role-matrix RPC threw. The permission maps still
   *  fail-open to {} by design; this signal lets the gate choose to fail CLOSED
   *  for sensitive actions. */
  permissionsError: boolean
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
  /** Total pending (unsynced) queued work: offline queue + record queue. Callers
   *  (e.g. the profile screen) use it to warn before logging out. */
  hasUnsyncedWork: () => Promise<number>
  signIn: (identifier: string, password: string) => Promise<{ error: AuthError | Error | null }>
  /** `force` lets a caller express intent to sign out despite unsynced work;
   *  behavior is identical either way (pending work is preserved regardless). */
  signOut: (force?: boolean) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError]     = useState(false)
  const [permissionsError, setPermissionsError] = useState(false)
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
      const { data, error } = await supabase.rpc('get_my_access_grants')
      if (error) throw error
      setGrants(mobileGrantsFromRaw(data as Record<string, unknown> | null))
    } catch (e) {
      // Fail-OPEN default preserved (the engine owns that policy); we only
      // surface the error signal so the gate can fail closed for sensitive ops.
      if (__DEV__) console.warn('fetchGrants failed', e)
      setGrants({})
      setPermissionsError(true)
    }
  }

  // Load the ROLE-level mobile permission matrix for this user's role. The RPC
  // is role-scoped server-side and returns every module_permissions row for the
  // role; we keep only the `mobile:` prefixed ones. Fail-OPEN to {} on any error
  // so a transient failure can never lock the user out (role default applies).
  async function fetchRoleMatrix() {
    try {
      const { data, error } = await supabase.rpc('get_user_module_permissions')
      if (error) throw error
      setRoleMatrix(mobileRoleMatrixFromRaw(data as Record<string, unknown> | null))
    } catch (e) {
      // Fail-OPEN default preserved; surface the error signal for the gate.
      if (__DEV__) console.warn('fetchRoleMatrix failed', e)
      setRoleMatrix({})
      setPermissionsError(true)
    }
  }

  // Re-pull both overlays together (used on tab focus / after admin edits).
  // Clear the prior error signal first so a recovered fetch reports healthy.
  async function refreshAccess() {
    setPermissionsError(false)
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

    // Bring up all user-scoped state for a signed-in session. AWAITS profile
    // resolution so the gate is never told the user is "ready" before their
    // role/approval/lock has been validated (fail closed). Grants/matrix run in
    // parallel; the profile is the security-critical await.
    async function bootstrapSession(userId: string) {
      setProfileLoading(true)
      setProfileError(false)
      setPermissionsError(false)
      subscribeToProfile(userId)
      subscribeToGrants(userId)
      subscribeToRoleMatrix()
      fetchGrants()
      fetchRoleMatrix()
      await fetchProfile(userId)
    }

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!mounted) return
        setUser(session?.user ?? null)
        if (session?.user) {
          setLoading(false)          // auth session resolved
          await bootstrapSession(session.user.id)
        } else {
          setProfileLoading(false)
          setLoading(false)
        }
      })
      .catch(() => { if (mounted) { setProfileLoading(false); setLoading(false) } })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) {
        await bootstrapSession(session.user.id)
      } else {
        setProfile(null)
        setProfileLoading(false)
        setProfileError(false)
        setPermissionsError(false)
        setGrants({})
        setRoleMatrix({})
        setSentryUser(null)
        unsubscribeFromProfile()
        unsubscribeFromGrants()
        unsubscribeFromRoleMatrix()
        // On any sign-out (manual OR forced lockout) clear only SYNCED local
        // queue rows; unsynced field work is preserved (see clearLocalUserState).
        clearLocalUserState().catch(() => {})
      }
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
    setProfileLoading(true)
    try {
      const { data, error } = await supabase.from('profiles').select('id,full_name,username,role,email,employee_id,site,country,approved,locked,is_super_admin,created_at').eq('id', userId).maybeSingle()
      if (error) throw error
      if (data) {
        // Enforce locked / unapproved accounts on the client immediately
        if (data.locked === true || data.approved === false) {
          await supabase.auth.signOut()
          return
        }
        setProfile({ ...data, role: normaliseRole(data.role), country: normaliseCountry(data.country) } as Profile)
        // Tag field crash reports with the operator behind them.
        setSentryUser({ id: data.id, username: data.username })
        setProfileError(false)
      } else {
        // No profile row for an authenticated user is not a hard error (a fresh
        // signup may not be provisioned yet); leave profile null, no error.
        setProfile(null)
        setProfileError(false)
      }
      setProfileLoading(false)
    } catch (e) {
      // Hard failure resolving the profile: FAIL CLOSED. Do NOT set profile;
      // signal the gate to block protected routes and show a retry screen.
      if (__DEV__) console.warn('fetchProfile failed', e)
      setProfileError(true)
      setProfileLoading(false)
    }
  }

  // Retry the profile fetch for the current user (used by the blocking retry
  // screen when profileError is true).
  async function retryProfile() {
    const uid = user?.id
    if (!uid) { setProfileLoading(false); setProfileError(false); return }
    setProfileError(false)
    await fetchProfile(uid)
  }

  // Total pending (unsynced) queued work across both device queues. Callers warn
  // the user before logout so unsynced field work is never silently abandoned.
  async function hasUnsyncedWork(): Promise<number> {
    try {
      const [q, r] = await Promise.all([getPendingCount(), getPendingRecordCount()])
      return (q || 0) + (r || 0)
    } catch {
      return 0
    }
  }

  async function signIn(identifier: string, password: string) {
    let email = identifier.trim()

    // ONE identical generic error for identifier-not-found, RPC failure, AND
    // bad password so an attacker cannot enumerate which usernames / employee
    // IDs exist. The real reason is logged only under __DEV__.
    const genericError = new Error('Invalid username, employee ID, or password.')

    if (!email.includes('@')) {
      const { data: resolved, error: rpcErr } = await supabase
        .rpc('get_email_by_identifier', { identifier: email })
      if (rpcErr) {
        if (__DEV__) console.warn('identifier resolution RPC error', rpcErr)
        return { error: genericError }
      }
      if (!resolved) return { error: genericError }
      email = resolved
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (__DEV__) console.warn('signInWithPassword error', error)
      return { error: genericError }
    }
    return { error: null }
  }

  // `force` is accepted so callers can express intent to sign out despite
  // unsynced work. Behavior is identical either way: we attempt a sync, then the
  // SIGNED_OUT handler removes ONLY synced rows and preserves pending work.
  async function signOut(_force?: boolean) {
    const uid = user?.id
    // While still authenticated: best-effort flush of this user's pending work
    // under their OWN session (so nothing is lost when online), then clear their
    // push token so pushes aren't delivered to the next account on this device.
    try { await Promise.allSettled([syncQueue(), syncRecordQueue()]) } catch { /* best-effort */ }
    if (uid) { try { await clearPushToken(uid) } catch { /* best-effort */ } }
    // Synced-only local cleanup happens in the SIGNED_OUT handler below; pending
    // (unsynced) field work is preserved for this user's next sign-in.
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading, profileError, retryProfile,
      permissionsError, isSuperAdmin, grants, roleMatrix, canAccess,
      refreshGrants: refreshAccess, hasUnsyncedWork, signIn, signOut,
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
