import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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
  const [modulePerms, setModulePerms] = useState(null) // null = not yet fetched

  // Idle timeout — sign out after 30 minutes of inactivity
  const IDLE_MS = 30 * 60 * 1000
  useEffect(() => {
    function resetTimer() {
      localStorage.setItem('tp_last_activity', Date.now().toString())
    }
    function checkIdle() {
      const last = parseInt(localStorage.getItem('tp_last_activity') || '0', 10)
      if (last && Date.now() - last > IDLE_MS) {
        supabase.auth.signOut()
        localStorage.setItem('tp_session_expired', '1')
      }
    }
    window.addEventListener('mousemove', resetTimer)
    window.addEventListener('keydown', resetTimer)
    window.addEventListener('click', resetTimer)
    window.addEventListener('touchstart', resetTimer)
    resetTimer()
    const interval = setInterval(checkIdle, 30_000) // check every 30 seconds
    return () => {
      window.removeEventListener('mousemove', resetTimer)
      window.removeEventListener('keydown', resetTimer)
      window.removeEventListener('click', resetTimer)
      window.removeEventListener('touchstart', resetTimer)
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        setLoading(true) // prevent stale render with user=set but profile=null
        await fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const [profileRes, permsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.rpc('get_user_module_permissions'),
    ])
    setProfile(profileRes.data)
    setModulePerms(permsRes.data ?? {})
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

    // Username / Employee ID — resolve to email via SECURITY DEFINER RPC (bypasses RLS)
    if (!email.includes('@')) {
      const { data: resolved, error: rpcErr } = await supabase
        .rpc('get_email_by_identifier', { identifier: email })
      if (rpcErr) return rpcErr
      if (!resolved) return { message: 'No account found with that username or Employee ID.' }
      email = resolved
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, modulePerms, hasPermission, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
