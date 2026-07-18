import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { setMonitoringUser, clearMonitoringUser } from '../lib/monitoring'
import { identifyUser, resetAnalyticsUser } from '../lib/analytics'
import { audit } from '../lib/auditLogger'
import { resolveCapability } from '../lib/permissionMatrix'
import { hasUnmetMfa } from '../lib/authAssurance'
import { listModuleStatuses } from '../lib/api/modulesRegistry'

// Exported so the isolated System Console can supply its own Provider value via
// ConsoleAuthBridge, letting main-app admin pages render verbatim inside /console.
export const AuthContext = createContext(null)

/**
 * Pure permission-merge resolver — the single source of truth for how a role's
 * base access combines with a Super Admin's per-user grant overrides.
 *
 * Precedence (highest first):
 *   1. Admin role or Super Admin      -> always true (cannot be revoked here)
 *   2. explicit 'revoke' override      -> false (beats the role)
 *   3. role/DB logic already allows it -> true
 *   4. explicit 'grant' override       -> true (adds on top of the role)
 *   5. otherwise                       -> false
 *
 * @param {object}  p
 * @param {string}  p.role          the user's role
 * @param {boolean} p.isSuperAdmin  profiles.is_super_admin === true
 * @param {boolean} p.roleAllows    whether the existing role/DB logic grants it
 * @param {('grant'|'revoke'|undefined)} p.override  per-user grant override
 * @returns {boolean}
 */
export function resolvePermission({ role, isSuperAdmin, roleAllows, override }) {
  if (role === 'Admin' || isSuperAdmin === true) return true
  if (override === 'revoke') return false
  if (roleAllows === true) return true
  if (override === 'grant') return true
  return false
}

// Role-based defaults used when no DB permissions have been configured yet
const ROLE_DEFAULTS = {
  Admin:    () => true,
  Manager:  k => !['user_management','erp_sync','data_cleaning','audit_trail'].includes(k),
  Director: k => !['user_management','erp_sync','data_cleaning','audit_trail'].includes(k),
  Inspector: k => ['dashboard','tyre_records','inspections','alerts','fleet_master','gate_pass','daily_ops'].includes(k),
  'Tyre Man': k => ['dashboard','tyre_records','inspections','alerts','stock','work_orders','gate_pass'].includes(k),
  Reporter: k => ['dashboard','analytics','kpi_scorecard','reports','executive_report','tyre_records'].includes(k),
  Driver:   k => ['dashboard','inspections','alerts'].includes(k),
  // Data & integration roles — ERP Sync Hub owners, no user administration.
  'Integration Admin': k => ['dashboard','alerts','erp_sync','data_cleaning','upload_data','custom_data','audit_trail'].includes(k),
  'Data Engineer':     k => ['dashboard','alerts','erp_sync','data_cleaning','upload_data','custom_data','tyre_records','fleet_master','analytics'].includes(k),
  Automation:          k => ['dashboard','alerts','erp_sync','upload_data','custom_data'].includes(k),
  // Data Monitor Officer (DMO) — scoped to accident monitoring only. Settings is
  // a universally-accessible route (not a permissioned module), surfaced for DMO
  // via the sidebar rule in Layout.jsx.
  'Data Monitor Officer': k => ['accidents'].includes(k),
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const profileChannelRef  = useRef(null)
  const currentUserIdRef   = useRef(null)
  const lastActivityRef    = useRef(Date.now())
  // True while signIn() is running its own approval/lock check, so the auth
  // state-change handler defers the sign-out + messaging to signIn (which
  // returns a specific reason to the login form).
  const manualSignInRef    = useRef(false)
  const [modulePerms, setModulePerms] = useState(null)
  const [mfaEnabled, setMfaEnabled] = useState(false)
  // Per-user access grants (Super Admin can give one user more/less than their
  // role). Shape: { module_key: 'grant' | 'revoke' }. Fail-closed to {}.
  const [grantOverrides, setGrantOverrides] = useState({})
  // Per-user, per-capability overrides beyond module reach (create/edit/delete/
  // export/approve). Shape: { module_key: { capability: 'grant' | 'revoke' } }.
  // Fail-closed to {}. UI-gating only — the server (app_user_can / RLS) is the
  // real boundary; only `view` is server-enforced today.
  const [capabilities, setCapabilities] = useState({})
  // Module lifecycle status map { module_id: 'live'|'maintenance'|'disabled'|'beta' }
  // from Module Control (V258). Best-effort: unreadable / pre-migration -> {} so
  // status enforcement fails OPEN (an unknown key is treated as 'live').
  const [moduleStatuses, setModuleStatuses] = useState({})

  // Idle timeout - sign out after 30 minutes of inactivity.
  // Uses an in-memory ref instead of localStorage so the timer cannot be
  // bypassed by a user opening DevTools and modifying localStorage values.
  const IDLE_MS = 30 * 60 * 1000
  useEffect(() => {
    function resetTimer() {
      lastActivityRef.current = Date.now()
    }
    function checkIdle() {
      if (Date.now() - lastActivityRef.current > IDLE_MS) {
        audit.logout().finally(() => supabase.auth.signOut())
        localStorage.setItem('tp_session_expired', '1')
      }
    }
    window.addEventListener('mousemove', resetTimer)
    window.addEventListener('keydown', resetTimer)
    window.addEventListener('click', resetTimer)
    window.addEventListener('touchstart', resetTimer)
    resetTimer()
    const interval = setInterval(checkIdle, 30_000)
    return () => {
      window.removeEventListener('mousemove', resetTimer)
      window.removeEventListener('keydown', resetTimer)
      window.removeEventListener('click', resetTimer)
      window.removeEventListener('touchstart', resetTimer)
      clearInterval(interval)
    }
  }, [])

  // Subscribe to realtime updates on this user's profile row so any role/field
  // change made by an admin is applied immediately without requiring re-login.
  function subscribeToProfile(userId) {
    if (profileChannelRef.current) {
      supabase.removeChannel(profileChannelRef.current)
    }
    profileChannelRef.current = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const np = payload.new
          // Enforce a mid-session lock / approval revocation immediately: an
          // admin locking or un-approving an active user must end the session
          // now (with the correct login message), not on the next reload.
          if (np && (np.locked === true || np.approved === false)) {
            localStorage.setItem(np.locked === true ? 'tp_access_revoked' : 'tp_pending_approval', '1')
            audit.logout().finally(() => supabase.auth.signOut())
            return
          }
          setProfile(np)
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

  // Reacts to a single auth session change. Guarded by currentUserIdRef so that
  // token refreshes, tab re-focus (visibilitychange), and INITIAL_SESSION for
  // the SAME already-loaded user do NOT toggle `loading` - toggling it would
  // unmount the whole routed tree (ProtectedRoute renders a spinner while
  // loading) and wipe every page's in-progress state (e.g. the Data Intake
  // wizard). We only do a full (re)load when the user IDENTITY actually changes.
  // Tear down all user-scoped state. Shared by the signed-out branch and the
  // assurance-refusal branch (a half-authenticated session is not a user).
  function clearUserScopedState() {
    currentUserIdRef.current = null
    setProfile(null)
    setModulePerms(null)
    setGrantOverrides({})
    setCapabilities({})
    setModuleStatuses({})
    unsubscribeFromProfile()
    setMfaEnabled(false)
    clearMonitoringUser()
    resetAnalyticsUser()
  }

  async function handleSession(session) {
    const newUserId = session?.user?.id ?? null

    if (!newUserId) {
      // Signed out.
      setUser(null)
      if (currentUserIdRef.current === null) { setLoading(false); return }
      clearUserScopedState()
      setLoading(false)
      return
    }

    // Same user - token refresh / tab refocus / duplicate INITIAL_SESSION.
    // Keep the fresh session but do not remount the app (and skip the assurance
    // re-check: assurance never downgrades without a sign-out).
    if (newUserId === currentUserIdRef.current) { setUser(session.user); return }

    // SECURITY GATE. A brand-new session identity must have reached its required
    // authentication assurance level. A password-only (AAL1) session for a user
    // who has MFA enrolled is a HALF login - it must not expose the app or any
    // data, on ANY tab. This closes the hole where entering only a password (in
    // the main login form OR the Console tab, which shares one Supabase session)
    // instantly showed all data before the 2FA step, and stops a Console login
    // from silently authenticating a main-app tab across the browser.
    //
    // We refuse LOCALLY (user stays null, the login page + its MFA modal show)
    // but never sign out here: the same session is shared with the tab that is
    // completing MFA. Once the second factor is verified the session upgrades to
    // AAL2 and the next auth event admits it.
    if (await hasUnmetMfa()) {
      setUser(null)
      if (currentUserIdRef.current !== null) clearUserScopedState()
      setLoading(false)
      return
    }

    // A genuinely different (or first) fully-authenticated user → full load.
    setUser(session.user)
    currentUserIdRef.current = newUserId
    setLoading(true)
    fetchProfile(newUserId)
    subscribeToProfile(newUserId)
  }

  useEffect(() => {
    // Belt-and-suspenders initial read (in case INITIAL_SESSION is delayed);
    // handleSession is idempotent via the ref, so this never double-loads.
    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => handleSession(session),
    )

    return () => {
      subscription.unsubscribe()
      unsubscribeFromProfile()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProfile(userId) {
    const [profileRes, permsRes, factorsRes, grantsRes, capsRes] = await Promise.all([
      supabase.from('profiles').select('id,full_name,username,role,email,employee_id,site,country,approved,locked,is_super_admin,created_at').eq('id', userId).single(),
      supabase.rpc('get_user_module_permissions'),
      supabase.auth.mfa.listFactors(),
      // Per-user access grants. Fail-closed: on any error keep {} — never throw
      // and never block login on this optional overlay.
      supabase.rpc('get_my_access_grants').then(r => r, () => ({ data: null, error: true })),
      // Per-user capability overrides. Same fail-closed contract: any error keeps
      // {} and never blocks login. UI-gating only (server is the real boundary).
      supabase.rpc('get_my_capabilities').then(r => r, () => ({ data: null, error: true })),
    ])

    const p = profileRes.data
    // Enforce locked / unapproved accounts immediately on the client
    if (p && (p.locked === true || p.approved === false)) {
      // During a manual sign-in, signIn() owns the sign-out and returns the
      // specific reason to the login form. Just clear state here so an
      // unapproved profile is never exposed, and let signIn do the rest.
      if (manualSignInRef.current) {
        setProfile(null)
        setModulePerms({})
        setGrantOverrides({})
        setCapabilities({})
        setLoading(false)
        return
      }
      // Mid-session change (e.g. an admin revokes approval while active):
      // sign out and flag the correct banner for the next page load.
      await supabase.auth.signOut()
      localStorage.setItem(p.locked === true ? 'tp_access_revoked' : 'tp_pending_approval', '1')
      setProfile(null)
      setModulePerms({})
      setGrantOverrides({})
      setCapabilities({})
      setLoading(false)
      return
    }

    // Clear stale flags from previous sessions or lockouts
    localStorage.removeItem('tp_session_expired')
    localStorage.removeItem('tp_access_revoked')

    setProfile(p)
    // Monitoring context: id + role + site only — never email or name.
    if (p) {
      setMonitoringUser({ id: p.id, role: p.role, site: p.site })
      identifyUser({ id: p.id, role: p.role, site: p.site })
    }
    setModulePerms(permsRes.data ?? {})
    // Grant overrides overlay — plain object { module_key: 'grant' | 'revoke' }.
    // Any non-object (error, null) collapses to {} (fail-closed, no overrides).
    const g = grantsRes?.data
    setGrantOverrides(g && typeof g === 'object' && !Array.isArray(g) ? g : {})
    // Per-capability overrides overlay — { module_key: { capability: 'grant'|'revoke' } }.
    // Any non-object (error, null, array) collapses to {} (fail-closed).
    const caps = capsRes?.data
    setCapabilities(caps && typeof caps === 'object' && !Array.isArray(caps) ? caps : {})
    setMfaEnabled((factorsRes.data?.totp?.length ?? 0) > 0)
    setLoading(false)
    // Module lifecycle statuses - best-effort, never blocks login, always {}-safe.
    listModuleStatuses().then(setModuleStatuses)
  }

  // ── Live access refresh (no re-login) ──────────────────────────────────────
  // Re-pull the enforced module map + per-user grant overlay. Both RPCs are
  // SECURITY DEFINER and fail-safe, so a transient error never wipes access.
  const refreshAccess = useCallback(async () => {
    try {
      const [permsRes, grantsRes, capsRes] = await Promise.all([
        supabase.rpc('get_user_module_permissions'),
        supabase.rpc('get_my_access_grants').then(r => r, () => ({ data: null, error: true })),
        supabase.rpc('get_my_capabilities').then(r => r, () => ({ data: null, error: true })),
      ])
      if (!permsRes.error) setModulePerms(permsRes.data ?? {})
      if (!grantsRes?.error) {
        const g = grantsRes?.data
        setGrantOverrides(g && typeof g === 'object' && !Array.isArray(g) ? g : {})
      }
      if (!capsRes?.error) {
        const caps = capsRes?.data
        setCapabilities(caps && typeof caps === 'object' && !Array.isArray(caps) ? caps : {})
      }
      // Refresh module lifecycle statuses too (best-effort, {}-safe).
      listModuleStatuses().then(setModuleStatuses)
    } catch { /* keep current access on a transient failure */ }
  }, [])

  // A change an admin makes in Master Access Control should reach an affected
  // user's OPEN session without a re-login: refresh on tab refocus, and live via
  // realtime on this user's own grant rows (uag_select already scopes to self)
  // and on the role permission matrix.
  useEffect(() => {
    if (!user?.id) return undefined
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAccess() }
    document.addEventListener('visibilitychange', onVisible)
    const ch = supabase
      .channel(`access-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_access_grants', filter: `user_id=eq.${user.id}` }, () => refreshAccess())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'module_permissions' }, () => refreshAccess())
      .subscribe()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(ch)
    }
  }, [user?.id, refreshAccess])

  const isSuperAdmin = profile?.is_super_admin === true

  // Lifecycle status of a module from Module Control. Returns 'live' whenever the
  // key is unknown or the registry is unreadable (fail-open) so route enforcement
  // never locks users out of a module that simply has no status row.
  const moduleStatus = useCallback((moduleKey) => {
    if (!moduleKey) return 'live'
    const s = moduleStatuses?.[moduleKey]
    return typeof s === 'string' && s ? s : 'live'
  }, [moduleStatuses])

  // Set of module keys the user was explicitly GRANTED beyond their role.
  const grantedModules = useMemo(
    () => new Set(Object.keys(grantOverrides).filter(k => grantOverrides[k] === 'grant')),
    [grantOverrides],
  )

  const hasPermission = useCallback((moduleKey) => {
    if (!profile) return false
    // Base (role/DB) verdict — the middle branch fed into resolvePermission.
    // PER-KEY precedence: if THIS module is explicitly configured in the DB matrix
    // (present in modulePerms) use that value — so an admin toggling a module OFF
    // for a role (enabled=false) actually hides/blocks it. A module NOT configured
    // for the role falls back to the hardcoded ROLE_DEFAULTS, so a sparse matrix
    // never mass-hides modules the role should keep.
    let roleAllows
    if (modulePerms && Object.prototype.hasOwnProperty.call(modulePerms, moduleKey)) {
      roleAllows = modulePerms[moduleKey] === true
    } else {
      roleAllows = (ROLE_DEFAULTS[profile.role] ?? (() => false))(moduleKey)
    }
    return resolvePermission({
      role: profile.role,
      isSuperAdmin,
      roleAllows,
      override: grantOverrides[moduleKey],
    })
  }, [profile, modulePerms, isSuperAdmin, grantOverrides])

  // Per-capability UI gate. For `view` (or no cap given) this delegates to the
  // server-enforced hasPermission (module reach). For create/edit/delete/export/
  // approve it is a CLIENT-SIDE gate ONLY, used to disable/hide action buttons —
  // the authoritative boundary is the server (app_user_can / RLS). There is no
  // client role-default source for non-view capabilities today, so roleAllows is
  // false: a non-view capability is allowed only when the module is reachable AND
  // it is explicitly granted (override 'grant'), and is blocked on 'revoke'.
  // Admin / Super Admin always pass. Callers must NOT treat a true result for a
  // non-view capability as a security guarantee.
  const hasCapability = useCallback((moduleKey, cap) => {
    if (!profile) return false
    if (!cap || cap === 'view') return hasPermission(moduleKey)
    // A non-view action is meaningless if the module itself is not reachable.
    if (!hasPermission(moduleKey)) return false
    const override = capabilities?.[moduleKey]?.[cap]
    return resolveCapability({
      role: profile.role,
      isSuperAdmin,
      roleAllows: false,
      override,
    })
  }, [profile, hasPermission, capabilities, isSuperAdmin])

  const signIn = useCallback(async (identifier, password) => {
    let email = identifier.trim()

    if (!email.includes('@')) {
      const { data: resolved, error: rpcErr } = await supabase
        .rpc('get_email_by_identifier', { identifier: email })
      if (rpcErr) return rpcErr
      if (!resolved) return { message: 'No account found with that username or Employee ID.' }
      email = resolved
    }

    manualSignInRef.current = true
    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return error

      // The password was valid — but the account may be pending approval or
      // locked. Without this gate the app signs in then silently signs back
      // out, leaving the login button stuck on "Signing in…" with no message.
      // Detect it here and return a specific, actionable reason.
      const uid = authData?.user?.id
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles').select('approved,locked').eq('id', uid).single()
        if (prof?.locked === true) {
          await supabase.auth.signOut()
          return { code: 'account_locked' }
        }
        if (prof && prof.approved === false) {
          await supabase.auth.signOut()
          return { code: 'pending_approval' }
        }
      }

      audit.login() // fire-and-forget LOGIN row in audit_log_v2 (never throws)

      // Check whether MFA challenge is still required for this session
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel !== 'aal2') {
        return { mfaRequired: true }
      }
      return null
    } finally {
      // Small defer so the concurrent auth state-change handler observes the
      // flag before it flips back; prevents a wrong-banner flag being set.
      setTimeout(() => { manualSignInRef.current = false }, 1500)
    }
  }, [])

  const signOut = useCallback(async () => {
    await audit.logout() // record before the session is destroyed (never throws)
    await supabase.auth.signOut()
    // Clear user-scoped client caches so a different account on this device
    // cannot see the previous user's data after switching (account-switch
    // isolation). Supabase already dropped its session above; here we drop the
    // in-memory query cache, any service-worker runtime caches that could hold
    // user data, and session storage.
    try { queryClient.clear() } catch { /* no-op */ }
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter(k => /supabase|rest|storage|auth|data/i.test(k))
            .map(k => caches.delete(k)),
        )
      }
    } catch { /* no-op */ }
    try { sessionStorage.clear() } catch { /* no-op */ }
  }, [])

  const value = useMemo(
    () => ({ user, profile, loading, modulePerms, hasPermission, signIn, signOut, mfaEnabled, setMfaEnabled, isSuperAdmin, grantOverrides, grantedModules, refreshAccess, capabilities, hasCapability, moduleStatus }),
    [user, profile, loading, modulePerms, mfaEnabled, hasPermission, signIn, signOut, setMfaEnabled, isSuperAdmin, grantOverrides, grantedModules, refreshAccess, capabilities, hasCapability, moduleStatus],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
