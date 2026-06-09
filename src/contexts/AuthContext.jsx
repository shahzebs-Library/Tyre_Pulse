import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
      if (session?.user) await fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
    setLoading(false)
  }

  async function signIn(identifier, password) {
    let email = identifier.trim()

    // If not an email format, look up by username or employee_id
    if (!email.includes('@')) {
      const { data: profiles, error: lookupErr } = await supabase
        .from('profiles')
        .select('id, username, employee_id')
        .or(`username.eq.${email},employee_id.eq.${email}`)
        .limit(1)

      if (lookupErr) return lookupErr
      if (!profiles?.length) return { message: 'No account found with that username or Employee ID.' }

      // Fetch email from auth.users via the profile id
      const { data: userData, error: userErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', profiles[0].id)
        .single()
      if (userErr) return userErr

      // Use RPC to get email by user id (safe server-side lookup)
      const { data: emailRow, error: emailErr } = await supabase
        .rpc('get_user_email_by_id', { user_id: profiles[0].id })
      if (emailErr || !emailRow) return { message: 'Unable to resolve account. Please use your email address.' }
      email = emailRow
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
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
  return useContext(AuthContext)
}
