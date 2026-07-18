/**
 * ConsoleAuthContext
 * Completely separate from the main app AuthContext.
 * Only users with is_super_admin = true can enter the console.
 * Supports TOTP MFA (Supabase built-in AAL2).
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hasUnmetMfa } from '../lib/authAssurance'

const ConsoleAuthContext = createContext(null)

export function ConsoleAuthProvider({ children }) {
  const [admin, setAdmin]         = useState(null)   // profile row
  const [loading, setLoading]     = useState(true)
  const [activeOrg, setActiveOrg] = useState(null)
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
      // A super admin with MFA enrolled must have COMPLETED it. A password-only
      // (AAL1) session is a half login and must not enter the console. Do NOT
      // sign out here - the ConsoleLogin MFA step is finishing that same session
      // and would be aborted; just withhold `admin` so the guard shows the login
      // (and its MFA prompt). The verified AAL2 session admits on the next event.
      if (await hasUnmetMfa()) { setAdmin(null); setLoading(false); return }
      setAdmin(data)
      await loadOrgs()
    } else {
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

  /**
   * signIn - step 1 of login.
   * Returns:
   *   { error }                          - credentials wrong / not super admin
   *   { mfaRequired: true, factorId, challengeId } - TOTP enrolled, step 2 needed
   *   { error: null }                    - fully logged in (no MFA enrolled)
   */
  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error }

    // Check super admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin, full_name, role')
      .eq('id', data.user.id)
      .maybeSingle()
    if (!profile?.is_super_admin) {
      await supabase.auth.signOut()
      return { error: { message: 'Access denied. This login is reserved for system administrators only.' } }
    }

    // Check MFA assurance level
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
      // User has TOTP enrolled - need to verify
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totpFactor = factors?.totp?.find(f => f.status === 'verified')
      if (totpFactor) {
        const { data: challenge, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
        if (chalErr) return { error: chalErr }
        return {
          error: null,
          mfaRequired: true,
          factorId: totpFactor.id,
          challengeId: challenge.id,
        }
      }
    }

    // No MFA or already at aal2 - log the session and proceed
    await supabase.from('console_sessions').insert({
      admin_id: data.user.id, action: 'login', target_type: 'system',
      details: { email, user_agent: navigator.userAgent }
    })
    return { error: null }
  }

  /**
   * verifyMfa - step 2. Call after signIn returns mfaRequired:true.
   */
  async function verifyMfa(factorId, challengeId, code) {
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code })
    if (error) return { error }
    // Log session after successful MFA
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('console_sessions').insert({
        admin_id: user.id, action: 'login', target_type: 'system',
        details: { mfa: true, user_agent: navigator.userAgent }
      })
    }
    return { error: null }
  }

  /**
   * enrollMfa - start TOTP setup. Returns { qrCode, secret, factorId } or { error }.
   */
  async function enrollMfa() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'TyrePulse Console' })
    if (error) return { error }
    return {
      error: null,
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    }
  }

  /**
   * confirmMfaEnrollment - verify the first TOTP code to activate the factor.
   */
  async function confirmMfaEnrollment(factorId, code) {
    const { data: challenge, error: chalErr } = await supabase.auth.mfa.challenge({ factorId })
    if (chalErr) return { error: chalErr }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code })
    if (error) return { error }
    await logAction('enable_2fa', null, 'system', { factorId })
    return { error: null }
  }

  /**
   * unenrollMfa - remove a TOTP factor.
   */
  async function unenrollMfa(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) return { error }
    await logAction('disable_2fa', null, 'system', { factorId })
    return { error: null }
  }

  /**
   * listMfaFactors - get current TOTP factors.
   */
  async function listMfaFactors() {
    const { data } = await supabase.auth.mfa.listFactors()
    return data?.totp ?? []
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
      signIn, verifyMfa, enrollMfa, confirmMfaEnrollment, unenrollMfa, listMfaFactors,
      signOut, logAction,
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
