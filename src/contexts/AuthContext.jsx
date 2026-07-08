import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { setMonitoringUser, clearMonitoringUser } from '../lib/monitoring'
import { identifyUser, resetAnalyticsUser } from '../lib/analytics'
import { audit } from '../lib/auditLogger'

const AuthContext = createContext(null)

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
          setProfile(payload.new)
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
  function handleSession(session) {
    const newUserId = session?.user?.id ?? null
    setUser(session?.user ?? null)

    if (!newUserId) {
      // Signed out.
      if (currentUserIdRef.current === null) { setLoading(false); return }
      currentUserIdRef.current = null
      setProfile(null)
      setModulePerms(null)
      unsubscribeFromProfile()
      setMfaEnabled(false)
      clearMonitoringUser()
      resetAnalyticsUser()
      setLoading(false)
      return
    }

    // Same user - token refresh / tab refocus / duplicate INITIAL_SESSION.
    // Keep the fresh session but do not remount the app.
    if (newUserId === currentUserIdRef.current) return

    // A genuinely different (or first) user signed in → full load.
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
    const [profileRes, permsRes, factorsRes] = await Promise.all([
      supabase.from('profiles').select('id,full_name,username,role,email,employee_id,site,country,approved,locked,created_at').eq('id', userId).single(),
      supabase.rpc('get_user_module_permissions'),
      supabase.auth.mfa.listFactors(),
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
        setLoading(false)
        return
      }
      // Mid-session change (e.g. an admin revokes approval while active):
      // sign out and flag the correct banner for the next page load.
      await supabase.auth.signOut()
      localStorage.setItem(p.locked === true ? 'tp_access_revoked' : 'tp_pending_approval', '1')
      setProfile(null)
      setModulePerms({})
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
    setMfaEnabled((factorsRes.data?.totp?.length ?? 0) > 0)
    setLoading(false)
  }

  const hasPermission = useCallback((moduleKey) => {
    if (!profile) return false
    if (profile.role === 'Admin') return true
    // If DB permissions loaded and non-empty, use them
    if (modulePerms && Object.keys(modulePerms).length > 0) {
      return modulePerms[moduleKey] === true
    }
    // Fall back to hardcoded role defaults
    return (ROLE_DEFAULTS[profile.role] ?? (() => false))(moduleKey)
  }, [profile, modulePerms])

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
    () => ({ user, profile, loading, modulePerms, hasPermission, signIn, signOut, mfaEnabled, setMfaEnabled }),
    [user, profile, loading, modulePerms, mfaEnabled, hasPermission, signIn, signOut, setMfaEnabled],
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
