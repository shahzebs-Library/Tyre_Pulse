/**
 * ConsoleAuthContext
 * Completely separate from the main app AuthContext.
 * Only users with is_super_admin = true can enter the console.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const ConsoleAuthContext = createContext(null)

export function ConsoleAuthProvider({ children }) {
  const [admin, setAdmin]         = useState(null)   // profile row
  const [loading, setLoading]     = useState(true)
  const [activeOrg, setActiveOrg] = useState(null)   // { id, name, countries[] } | null = all orgs
  const [orgs, setOrgs]           = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) await resolveAdmin(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (session?.user) await resolveAdmin(session.user.id)
      else { setAdmin(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function resolveAdmin(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*, email')
      .eq('id', userId)
      .maybeSingle()
    if (data?.is_super_admin) {
      setAdmin(data)
      await loadOrgs()
    } else {
      // Not a super admin — sign out silently
      await supabase.auth.signOut()
      setAdmin(null)
    }
    setLoading(false)
  }

  async function loadOrgs() {
    const { data } = await supabase
      .from('organisations')
      .select('id, name, slug, countries, country, plan, active, locked, contact_email')
      .order('name')
    setOrgs(data ?? [])
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error }
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin, full_name, role')
      .eq('id', data.user.id)
      .maybeSingle()
    if (!profile?.is_super_admin) {
      await supabase.auth.signOut()
      return { error: { message: 'Access denied. This login is reserved for system administrators only.' } }
    }
    // Log console session
    await supabase.from('console_sessions').insert({
      admin_id: data.user.id, action: 'login', target_type: 'system',
      details: { email, user_agent: navigator.userAgent }
    })
    return { error: null }
  }

  async function signOut() {
    if (admin) {
      await supabase.from('console_sessions').insert({
        admin_id: admin.id, action: 'logout', target_type: 'system', details: {}
      })
    }
    await supabase.auth.signOut()
    setAdmin(null); setActiveOrg(null)
  }

  async function logAction(action, targetId, targetType, details = {}) {
    if (!admin) return
    await supabase.from('console_sessions').insert({
      admin_id: admin.id, action, target_id: targetId, target_type: targetType, details
    })
  }

  return (
    <ConsoleAuthContext.Provider value={{
      admin, loading, activeOrg, setActiveOrg, orgs, loadOrgs,
      signIn, signOut, logAction,
    }}>
      {children}
    </ConsoleAuthContext.Provider>
  )
}

export function useConsoleAuth() {
  const ctx = useContext(ConsoleAuthContext)
  if (!ctx) throw new Error('useConsoleAuth must be used within ConsoleAuthProvider')
  return ctx
}
