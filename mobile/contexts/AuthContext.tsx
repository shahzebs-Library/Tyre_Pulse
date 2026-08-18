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
import { clearPushToken, cancelDailyInspectionReminder, registerPushToken } from '../lib/notifications'
import { setSentryUser } from '../lib/sentry'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, AppStateStatus } from 'react-native'
import { storageReadFailureCount } from '../lib/secureStorage'
import {
  shouldRunAutoRefresh, classifyRestore, isCachedProfileUsable,
  shouldRevalidateOnForeground,
} from '../lib/authLifecycle'

/** How long we are willing to wait for the stored session to come back out of
 *  the Android Keystore before we stop blocking the UI. Generous enough that a
 *  merely slow device still restores silently, short enough that a stalled one
 *  never traps the user behind an endless spinner. */
const SESSION_RESTORE_TIMEOUT_MS = 8000

/** Reject if `p` has not settled within `ms`. The underlying work is left to
 *  finish on its own (we cannot cancel a native Keystore read) - we simply stop
 *  waiting on it, which is the whole point. */
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('session restore timed out')), ms)
    Promise.resolve(p).then(
      (v) => { clearTimeout(id); resolve(v) },
      (e) => { clearTimeout(id); reject(e) },
    )
  })
}

/** The last server-verified profile, so a cold start with no signal is not a
 *  lockout. How long it stays usable is bounded by PROFILE_CACHE_MAX_AGE_MS in
 *  lib/authLifecycle.ts, which also records why that bound is 90 days and why
 *  extending it grants no data access. */
const PROFILE_CACHE_KEY = 'tp_profile_cache_v1'

async function cacheProfile(userId: string, profile: Profile) {
  try {
    await AsyncStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ userId, at: Date.now(), profile }),
    )
  } catch { /* cache is best effort; never block sign-in on it */ }
}

/** The cached profile, but only for THIS user and only while still fresh. */
async function readCachedProfile(userId: string): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: string; at?: number; profile?: Profile }
    if (!parsed?.profile) return null
    const usable = isCachedProfileUsable({
      cachedForUserId: parsed.userId,
      wantUserId: userId,
      cachedAt: parsed.at,
      now: Date.now(),
      locked: parsed.profile.locked,
      approved: parsed.profile.approved,
    })
    return usable ? parsed.profile : null
  } catch {
    return null
  }
}

async function clearCachedProfile() {
  try { await AsyncStorage.removeItem(PROFILE_CACHE_KEY) } catch { /* best effort */ }
}

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
  /** True when the profile was served from the offline cache instead of the
   *  server (no signal). Access is unchanged; the UI may show a subtle hint. */
  profileStale: boolean
  /** Re-run the profile fetch for the current user (retry after profileError). */
  retryProfile: () => Promise<void>
  /** True when reading the stored session took too long (stalled Android
   *  Keystore). The entry screen must offer a retry rather than spin forever. */
  sessionTimedOut: boolean
  /** Re-attempt session restore after a timeout. */
  retrySession: () => Promise<void>
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
  /** True when `profile` came from the offline cache rather than the server, so
   *  the UI can show a quiet "working offline" hint. Cleared on a live fetch. */
  const [profileStale, setProfileStale]     = useState(false)
  /** True when restoring the stored session exceeded SESSION_RESTORE_TIMEOUT_MS
   *  (stalled Keystore). The entry screen shows a retry instead of spinning. */
  const [sessionTimedOut, setSessionTimedOut] = useState(false)
  const [permissionsError, setPermissionsError] = useState(false)
  const [grants, setGrants]   = useState<GrantMap>({})
  const [roleMatrix, setRoleMatrix] = useState<RoleMatrix>({})
  /** User id we have already registered a push token for this app session, so a
   *  repeated profile fetch does not re-run device registration. */
  const pushRegisteredForRef  = useRef<string | null>(null)
  /** When the account was last read from the server, so bringing the app
   *  forward re-checks it without turning app switching into a request storm. */
  const lastForegroundCheckRef = useRef<number | null>(null)
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
          // A DEFINITIVE SERVER ANSWER. This is one of the few things that may
          // still end a session outright, and it must: an admin has revoked this
          // account. Drop the offline profile cache with it so the device cannot
          // reopen on a snapshot taken before the lock.
          if (updated.locked === true || updated.approved === false) {
            clearCachedProfile().finally(() => { supabase.auth.signOut() })
            return
          }
          // MERGE rather than replace. A realtime payload can arrive without
          // every column (RLS filtering, replica identity), and overwriting the
          // whole profile with a partial row would blank fields the gate reads -
          // which is a lockout caused by an unrelated admin edit.
          setProfile(prev => {
            const merged = {
              ...(prev ?? {}),
              ...updated,
              role: normaliseRole(updated.role ?? prev?.role),
              country: normaliseCountry(updated.country ?? prev?.country),
            } as Profile
            // Keep the offline snapshot current, so a role change made today is
            // what the device sees the next time it opens with no signal.
            cacheProfile(userId, merged).catch(() => {})
            return merged
          })
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
    let settled = false          // whichever path resolves the session first wins

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

    // THE PERMANENT-SPINNER GUARD.
    //
    // getSession() reads the stored session out of expo-secure-store, i.e. the
    // Android Keystore, over binder IPC - and because a Supabase session is far
    // larger than one SecureStore slot it is split into chunks, so a single cold
    // start makes 3-5 separate Keystore round trips. On low-end hardware (the
    // reported Infinix devices) those calls are slow and can stall outright.
    // Google's own ANR for this build says exactly that: "Slow binder call - the
    // main thread was busy doing a binder call that was potentially slow".
    //
    // There was NO time limit on it: if the vault never answered, neither .then
    // nor .catch ran, `loading` stayed true, and app/index.tsx showed a spinner
    // with no exit - the reported "it just keeps rounding and never goes
    // forward", permanently. A bounded wait converts that dead end into an
    // honest, retryable state. It changes nothing about WHAT is stored or who
    // may sign in; it only refuses to wait forever.
    const timeoutId = setTimeout(() => {
      if (!mounted || settled) return
      settled = true
      setSessionTimedOut(true)     // index.tsx offers Retry / Sign in
      setProfileLoading(false)
      setLoading(false)
    }, SESSION_RESTORE_TIMEOUT_MS)

    // AN EMPTY SESSION IS NOT PROOF OF A SIGNED-OUT USER.
    //
    // getSession() reads through our chunked SecureStore adapter, whose only
    // possible answers are the value or null - so a Keystore call that refuses
    // arrives here as "no session" and would bounce a field worker onto a login
    // screen they cannot pass, while their session sat on the device untouched.
    // Snapshotting the adapter's failure counter across the read is what tells
    // the two apart: an empty session is only believed when nothing failed.
    const failuresBefore = storageReadFailureCount()

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!mounted || settled) return
        settled = true
        clearTimeout(timeoutId)

        const outcome = classifyRestore({
          hasSession: !!session?.user,
          storageReadFailed: storageReadFailureCount() > failuresBefore,
        })

        if (outcome === 'signed-in' && session?.user) {
          setUser(session.user)
          setLoading(false)          // auth session resolved
          await bootstrapSession(session.user.id)
          return
        }

        setUser(null)
        setProfileLoading(false)
        setLoading(false)
        // Could not READ the stored session. Offer a retry, never a login screen:
        // this grants nothing (no user is set, no protected route renders) and
        // only changes which screen the person is looking at.
        if (outcome === 'restore-failed') setSessionTimedOut(true)
      })
      .catch(() => {
        if (!mounted || settled) return
        settled = true
        clearTimeout(timeoutId)
        setProfileLoading(false)
        setLoading(false)
        // getSession itself threw. That is never evidence of a signed-out user,
        // so it lands on the same recoverable screen.
        setSessionTimedOut(true)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      // Run OUTSIDE the auth callback. supabase-js emits INITIAL_SESSION from
      // inside its own auth lock; doing async session work synchronously in here
      // is what deadlocked the WEB app into a blank screen until a second
      // refresh (see PROJECT_MEMORY). Deferring to a fresh macrotask keeps that
      // whole class of hang out of the field app. handleSession work below is
      // idempotent, so a late INITIAL_SESSION cannot undo a completed bootstrap.
      setTimeout(() => { void handleAuthStateChange(session) }, 0)
    })

    async function handleAuthStateChange(session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) {
      if (!mounted) return
      // A real auth event is authoritative: it clears any earlier timeout state.
      settled = true
      clearTimeout(timeoutId)
      setSessionTimedOut(false)
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
        // Next account on this device must register its own push token.
        pushRegisteredForRef.current = null
        unsubscribeFromProfile()
        unsubscribeFromGrants()
        unsubscribeFromRoleMatrix()
        setProfileStale(false)
        // On any sign-out (manual OR forced lockout) clear only SYNCED local
        // queue rows; unsynced field work is preserved (see clearLocalUserState).
        clearLocalUserState().catch(() => {})
        // Every sign-out path ends here, including a refresh token the server
        // definitively rejected, so this is the one place that reliably retires
        // the offline profile snapshot for the account that just left.
        clearCachedProfile().catch(() => {})
      }
    }

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
      unsubscribeFromProfile()
      unsubscribeFromGrants()
      unsubscribeFromRoleMatrix()
    }
  }, [])

  // KEEP THE ACCESS TOKEN ALIVE ACROSS BACKGROUND / FOREGROUND.
  //
  // supabase-js renews the access token from a `setInterval` ticker. React
  // Native suspends JS timers as soon as the OS backgrounds or freezes the
  // process, so a phone left in a pocket overnight wakes with a ticker that has
  // not run for hours and a token that expired long ago; until the next tick
  // happens to land, every request goes out with a dead JWT. For a queue
  // flushing at that moment, that is failed uploads; for the profile read, it is
  // an error the app then has to absorb. This is the documented React Native fix
  // and it is the single most likely cause of "it signed me out by itself".
  //
  // startAutoRefresh() also runs one tick IMMEDIATELY, so the token is renewed
  // as the app comes forward rather than up to a full tick period later.
  //
  // Coming forward is also the right moment to re-read the account, so a lock
  // applied while the phone slept takes effect promptly. That tightens security
  // at the same time as it keeps the session alive; the re-read is silent and,
  // by design, can never take away access on a failure to reach the server.
  const userIdForRefresh = user?.id ?? null
  useEffect(() => {
    let cancelled = false

    function apply(state: AppStateStatus) {
      if (cancelled) return
      if (shouldRunAutoRefresh(state)) {
        // Never allowed to reject into the app: a refresh we could not start is
        // a token that stays as it is, not a reason to disturb the user.
        supabase.auth.startAutoRefresh().catch(() => {})
        if (
          userIdForRefresh &&
          shouldRevalidateOnForeground({ lastCheckedAt: lastForegroundCheckRef.current, now: Date.now() })
        ) {
          lastForegroundCheckRef.current = Date.now()
          fetchProfile(userIdForRefresh, { silent: true }).catch(() => {})
        }
      } else {
        supabase.auth.stopAutoRefresh().catch(() => {})
      }
    }

    // Start from whatever state we are actually in, so the ticker is running
    // before the first AppState transition ever arrives.
    apply(AppState.currentState)
    const sub = AppState.addEventListener('change', apply)
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [userIdForRefresh])

  /** Re-attempt session restore after the bounded wait gave up. Used by the
   *  "taking longer than usual" screen so a slow Keystore is a retry, never a
   *  dead end. */
  async function retrySession() {
    setSessionTimedOut(false)
    setLoading(true)
    const failuresBefore = storageReadFailureCount()
    try {
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(), SESSION_RESTORE_TIMEOUT_MS,
      )
      const outcome = classifyRestore({
        hasSession: !!session?.user,
        storageReadFailed: storageReadFailureCount() > failuresBefore,
      })
      setLoading(false)
      if (outcome === 'signed-in' && session?.user) {
        setUser(session.user)
        setProfileLoading(true)
        subscribeToProfile(session.user.id)
        subscribeToGrants(session.user.id)
        subscribeToRoleMatrix()
        fetchGrants()
        fetchRoleMatrix()
        await fetchProfile(session.user.id)
      } else {
        setUser(null)
        setProfileLoading(false)
        // Still could not read it. Back to the recoverable screen, which also
        // offers Sign in, so the user is never trapped and never bounced.
        if (outcome === 'restore-failed') setSessionTimedOut(true)
      }
    } catch {
      // Still stalled: return to the recoverable screen rather than spin.
      setLoading(false)
      setProfileLoading(false)
      setSessionTimedOut(true)
    }
  }

  /**
   * @param opts.silent A background re-check (app brought forward) rather than a
   *   boot/gate fetch. It must be invisible and it must never TAKE AWAY access
   *   the user already has: it does not raise the loading gate, and a failure to
   *   reach the server leaves the current profile exactly where it was. Only a
   *   definitive server answer - locked, or not approved - still signs them out.
   */
  async function fetchProfile(userId: string, opts?: { silent?: boolean }) {
    const silent = opts?.silent === true
    // Any read of the profile counts as the account having just been checked, so
    // the foreground re-check does not immediately repeat a fetch that boot or a
    // retry has already done.
    lastForegroundCheckRef.current = Date.now()
    if (!silent) setProfileLoading(true)
    try {
      const { data, error } = await supabase.from('profiles').select('id,full_name,username,role,email,employee_id,site,country,approved,locked,is_super_admin,created_at').eq('id', userId).maybeSingle()
      if (error) throw error
      if (data) {
        // Enforce locked / unapproved accounts on the client immediately
        if (data.locked === true || data.approved === false) {
          await clearCachedProfile()
          await supabase.auth.signOut()
          return
        }
        const resolved = { ...data, role: normaliseRole(data.role), country: normaliseCountry(data.country) } as Profile
        setProfile(resolved)
        // Cache the AUTHORITATIVE profile so the next cold start works offline.
        await cacheProfile(userId, resolved)
        // Tag field crash reports with the operator behind them.
        setSentryUser({ id: data.id, username: data.username })
        setProfileError(false)
        setProfileStale(false)
        // REGISTER THIS DEVICE FOR PUSH, HERE - not only on the Profile screen.
        //
        // registerPushToken() used to be called from exactly one place: the
        // Profile tab. Field users scan, inspect, upload and close the app; they
        // rarely open Profile. Sign-out clears the token by design. The result,
        // measured on the live database, was 0 push tokens across 36 accounts -
        // so no server notification could reach anybody, which is exactly what
        // was reported. Registering once per signed-in session, right after the
        // profile is verified, is what makes notifications actually deliverable.
        // Best-effort by design: it must never block or fail sign-in.
        if (pushRegisteredForRef.current !== userId) {
          pushRegisteredForRef.current = userId
          registerPushToken(userId).catch(() => {
            // Permission denied or offline: leave it unregistered and let a
            // later sign-in retry. Never surface this as a sign-in failure.
            pushRegisteredForRef.current = null
          })
        }
      } else {
        // No profile row for an authenticated user is not a hard error (a fresh
        // signup may not be provisioned yet); leave profile null, no error.
        setProfile(null)
        setProfileError(false)
      }
      if (!silent) setProfileLoading(false)
    } catch (e) {
      // The fetch failed. This is normally a DEAD NETWORK, which is the everyday
      // case for this app: an inspector opens it in a yard with no bars. Failing
      // closed here locked them out of the app entirely - including the offline
      // inspections already queued on their own phone, which is the one thing
      // they most need to reach. So fall back to the last profile we ourselves
      // verified for THIS user id.
      //
      // Why this is safe: it unlocks only the LOCAL shell and their own queued
      // work. It grants no data access - every read still needs a live session
      // and passes RLS server-side. The cache is only ever written from a
      // successful server fetch (never from a locked or unapproved account), is
      // bound to one user id, and expires. The moment connectivity returns, the
      // realtime profile listener and the next fetch re-assert the truth and
      // sign out an account that has since been locked or unapproved.
      if (__DEV__) console.warn('fetchProfile failed', e)
      const cached = await readCachedProfile(userId)
      if (cached) {
        setProfile(cached)
        setSentryUser({ id: cached.id, username: cached.username })
        setProfileError(false)
        setProfileStale(true)
      } else if (silent) {
        // A background re-check that could not reach the server. The user was
        // already working; taking the app away from them now would be a
        // sign-out caused by nothing more than a lost signal. Keep what we have
        // and just mark it unverified.
        setProfileStale(true)
      } else {
        // No verified cache for this user: FAIL CLOSED exactly as before.
        setProfileError(true)
      }
      if (!silent) setProfileLoading(false)
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
    // Drop the offline profile cache so the next account on this device can never
    // inherit it. Pending FIELD WORK is deliberately NOT touched here.
    await clearCachedProfile()
    // Synced-only local cleanup happens in the SIGNED_OUT handler below; pending
    // (unsynced) field work is preserved for this user's next sign-in.
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading, profileError, profileStale, retryProfile,
      sessionTimedOut, retrySession,
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
