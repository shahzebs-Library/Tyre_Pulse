import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'

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
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const profileChannelRef  = useRef(null)
  const lastActivityRef    = useRef(Date.now())
  const [modulePerms, setModulePerms] = useState(null)
  const [mfaEnabled, setMfaEnabled] = useState(false)

  // Idle timeout — sign out after 30 minutes of inactivity.
  // Uses an in-memory ref instead of localStorage so the timer cannot be
  // bypassed by a user opening DevTools and modifying localStorage values.
  const IDLE_MS = 30 * 60 * 1000
  useEffect(() => {
    function resetTimer() {
      lastActivityRef.current = Date.now()
    }
    function checkIdle() {
      if (Date.now() - lastActivityRef.current > IDLE_MS) {
        supabase.auth.signOut()
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        subscribeToProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        setLoading(true)
        await fetchProfile(session.user.id)
        subscribeToProfile(session.user.id)
      } else {
        setProfile(null)
        unsubscribeFromProfile()
        setMfaEnabled(false)
        setLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
      unsubscribeFromProfile()
    }
  }, [])

  async function fetchProfile(userId) {
    const [profileRes, permsRes, factorsRes] = await Promise.all([
      supabase.from('profiles').select('id,full_name,username,role,email,employee_id,site,country,approved,locked,created_at').eq('id', userId).single(),
      supabase.rpc('get_user_module_permissions'),
      supabase.auth.mfa.listFactors(),
    ])

    const p = profileRes.data
    // Enforce locked / unapproved accounts immediately on the client
    if (p && (p.locked === true || p.approved === false)) {
      await supabase.auth.signOut()
      localStorage.setItem('tp_access_revoked', '1')
      setProfile(null)
      setModulePerms({})
      setLoading(false)
      return
    }

    // Clear stale flags from previous sessions or lockouts
    localStorage.removeItem('tp_session_expired')
    localStorage.removeItem('tp_access_revoked')

    setProfile(p)
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

  async function signIn(identifier, password) {
    let email = identifier.trim()

    if (!email.includes('@')) {
      const { data: resolved, error: rpcErr } = await supabase
        .rpc('get_email_by_identifier', { identifier: email })
      if (rpcErr) return rpcErr
      if (!resolved) return { message: 'No account found with that username or Employee ID.' }
      email = resolved
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return error

    // Check whether MFA challenge is still required for this session
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel !== 'aal2') {
      return { mfaRequired: true }
    }
    return null
  }

  async function signOut() {
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
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, modulePerms, hasPermission, signIn, signOut, mfaEnabled, setMfaEnabled }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
