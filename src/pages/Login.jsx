import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, ArrowRight, Mail, Phone, KeyRound, AlertCircle,
  Loader2, Clock, WifiOff,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import { getPublicConfig } from '../lib/api/systemConfig'
import { getLoginShowcase, signInOptions, signInWithProvider } from '../lib/api/loginShowcase'
import { loginAttemptStatus, recordLoginFailure, resetLoginAttempts, lockMinutes } from '../lib/api/loginGuard'
import TpLogo from '../assets/logo.svg'
import { readCachedLogo } from '../lib/brand/library'
import TwoFactorChallenge from '../components/TwoFactorChallenge'
import ThemeToggle from '../components/ui/ThemeToggle'
import TurnstileWidget, { captchaEnabled } from '../components/auth/TurnstileWidget'
import LoginHero from '../components/auth/login/LoginHero'
import QrLoginPanel from '../components/auth/login/QrLoginPanel'
import { LOGIN_PAGE_CSS } from '../components/auth/login/loginStyles'
import { MARKETING_URL, readRememberedId, writeRememberedId } from '../components/auth/login/loginContent'
import {
  RECOVERY_GENERIC_MESSAGE,
  RECOVERY_SMS_ENABLED,
  recoveryDestinationIsValid,
  requestPasswordRecovery,
  verifyPasswordRecovery,
} from '../lib/accountRecovery'

// Login renders before the org is known, so it uses the logo cached on this
// device after the last successful sign-in (V120), falling back to the mark.
// Read at render time (not module load) so it reflects the latest cached value
// even after a client-side navigation from an authenticated session to /login.

/** Google "G" and Microsoft squares, drawn inline (no external asset). */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  )
}
function MicrosoftMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/>
      <path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/>
    </svg>
  )
}

export default function Login() {
  const loginLogo = readCachedLogo('login') || TpLogo
  const customLogo = loginLogo !== TpLogo
  const { signIn, user, loading: authLoading } = useAuth()
  const { t }               = useLanguage()
  const p = (k, v) => t(`auth.login.page.${k}`, v)
  const navigate            = useNavigate()

  // Navigate to dashboard once auth state resolves - avoids race with async fetchProfile
  useEffect(() => {
    if (!authLoading && user) navigate('/', { replace: true })
  }, [user, authLoading, navigate])

  const [tab, setTab]                 = useState('login')
  const [identifier, setIdentifier]   = useState(() => readRememberedId())
  const [rememberMe, setRememberMe]   = useState(() => !!readRememberedId())
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [fullName, setFullName]       = useState('')
  const [signupUsername, setSignupUsername] = useState('')
  const [employeeId, setEmployeeId]   = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  // Cloudflare Turnstile token (single use). Null until the widget is solved;
  // the widget renders nothing when VITE_TURNSTILE_SITE_KEY is not set.
  const [captchaToken, setCaptchaToken] = useState(null)
  const captchaRef = useRef(null)
  const needsCaptcha = captchaEnabled()
  const [signupDone, setSignupDone]   = useState(false)
  const [pendingApproval, setPendingApproval] = useState(false)
  const [showLoginPw, setShowLoginPw] = useState(false)
  const [showSignupPw, setShowSignupPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  // /login?forgot=1 (linked from the console sign-in) opens the reset view directly.
  const [forgotMode, setForgotMode]   = useState(() => {
    try { return new URLSearchParams(window.location.search).get('forgot') === '1' } catch { return false }
  })
  const [forgotChannel, setForgotChannel] = useState('email')
  const [forgotDestination, setForgotDestination] = useState('')
  const [forgotChallengeId, setForgotChallengeId] = useState('')
  const [forgotCode, setForgotCode] = useState('')
  const [forgotSent, setForgotSent]   = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  const [isOnline, setIsOnline]       = useState(navigator.onLine)
  const [mfaState, setMfaState]       = useState(null) // { factorId } when MFA challenge needed
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [ssoLoading, setSsoLoading]   = useState(false)
  const [providerLoading, setProviderLoading] = useState('')
  // Registration switch (registration_open / legacy allow_signups). When OFF,
  // self-service signup is blocked. Read via the anon-safe get_public_config RPC
  // before any session exists. Defaults to OPEN so a transient read never blocks.
  const [signupClosed, setSignupClosed] = useState(false)
  // Optional sign-in methods (Google / Microsoft / QR): hidden until an admin
  // switches them on, so the page never shows a button that cannot work.
  const [signInOpts, setSignInOpts] = useState({ google: false, microsoft: false, qr: false })
  const [appVersion, setAppVersion] = useState('')
  // Real platform figures for the hero (counts only). null = show N/A.
  const [showcase, setShowcase] = useState(null)

  // Pre-auth read of the registration switch on mount. getPublicConfig never
  // throws (returns {} on failure), so a read miss leaves signup permissively open.
  useEffect(() => {
    let alive = true
    getPublicConfig().then((cfg) => {
      if (!alive) return
      if (cfg?.registration_open === 'false' || cfg?.allow_signups === 'false') setSignupClosed(true)
      setSignInOpts(signInOptions(cfg))
      const v = typeof cfg?.app_version === 'string' ? cfg.app_version.replace(/^"|"$/g, '').trim() : ''
      if (v) setAppVersion(v)
    })
    getLoginShowcase().then((s) => { if (alive) setShowcase(s) })
    return () => { alive = false }
  }, [])

  // Track network status
  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const sessionExpired = localStorage.getItem('tp_session_expired') === '1'
  const accessRevoked  = localStorage.getItem('tp_access_revoked')  === '1'
  useEffect(() => {
    if (sessionExpired) localStorage.removeItem('tp_session_expired')
    if (accessRevoked)  localStorage.removeItem('tp_access_revoked')
    // If approval was pending/revoked mid-session, land straight on the clear
    // "awaiting approval" state instead of a bare form.
    if (localStorage.getItem('tp_pending_approval') === '1') {
      localStorage.removeItem('tp_pending_approval')
      setPendingApproval(true)
    }
  }, [sessionExpired, accessRevoked])

  async function handleLogin(e) {
    e.preventDefault()
    if (!isOnline) { setError(t('auth.login.errNoInternet')); return }
    const now = Date.now()
    if (cooldownUntil > now) {
      const secs = Math.ceil((cooldownUntil - now) / 1000)
      setError(t('auth.login.errTooManyAttempts', { secs }))
      return
    }
    if (needsCaptcha && !captchaToken) { setError(t('auth.login.errCaptcha')); return }
    setError(''); setLoading(true)
    // Server-enforced lockout (System Configuration -> Max Login Attempts, V287).
    // Fail-safe: a not-locked / errored probe never blocks a real sign-in.
    const gate = await loginAttemptStatus(identifier)
    if (gate?.locked) {
      setError(t('auth.login.errAccountLocked', { mins: lockMinutes(gate) }))
      setLoading(false)
      return
    }
    let result
    try {
      result = await signIn(identifier, password, captchaToken)
    } catch (err) {
      // Any unexpected failure (network drop, RPC crash) must surface a message
      // and release the button — never leave it stuck on "Signing in…".
      captchaRef.current?.reset()
      setError(err?.message || t('auth.login.errUnexpected'))
      setLoading(false)
      return
    }
    // A Turnstile token works once; get a fresh one for any next attempt.
    captchaRef.current?.reset()
    // A refused security check is not a wrong password: never count it
    // towards the lockout.
    if (result?.code === 'captcha_failed' || /captcha/i.test(result?.message || '')) {
      setError(t('auth.login.errCaptcha'))
      setLoading(false)
      return
    }
    if (result?.mfaRequired) {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const factor = factors?.totp?.[0]
      if (factor) {
        setMfaState({ factorId: factor.id })
      } else {
        setError(t('auth.login.errNoMfaFactor'))
      }
      setLoading(false)
      return
    }
    // Valid credentials but the account isn't usable yet — show a clear reason,
    // and do NOT count these as failed password attempts (no lockout cooldown).
    if (result?.code === 'pending_approval') {
      setPendingApproval(true)
      setLoading(false)
      return
    }
    // Access Policies: this organisation requires single sign-on, so the
    // password session was signed straight back out. Not a failed password.
    if (result?.code === 'sso_required') {
      setError(t('auth.login.errSsoRequired'))
      setLoading(false)
      return
    }
    if (result?.code === 'account_locked') {
      setError(t('auth.login.accessRevokedBanner'))
      setLoading(false)
      return
    }
    if (result) {
      const next = loginAttempts + 1
      setLoginAttempts(next)
      // Exponential backoff: 5s after 3 fails, 15s after 5, 60s after 7+
      if (next >= 7)      setCooldownUntil(Date.now() + 60_000)
      else if (next >= 5) setCooldownUntil(Date.now() + 15_000)
      else if (next >= 3) setCooldownUntil(Date.now() +  5_000)
      // Record against the server-side lockout; if it just locked, say so clearly.
      const locked = await recordLoginFailure(identifier)
      if (locked?.locked) {
        setError(t('auth.login.errAccountLocked', { mins: lockMinutes(locked) }))
      } else {
        setError(result.message || t('auth.login.errLoginFailed'))
      }
      setLoading(false)
      return
    }
    // Success - reset local + server counters
    setLoginAttempts(0)
    setCooldownUntil(0)
    resetLoginAttempts()
    // "Remember me" keeps only the typed identifier on this device (never the
    // password, never the session lifetime).
    writeRememberedId(rememberMe ? identifier.trim() : '')
    // on success: useEffect above handles navigation once AuthContext resolves user + profile
  }

  // Enterprise SSO: resolve the work-email domain to a Supabase-registered SAML/
  // OIDC provider and hand off to the IdP. The provider is registered in Supabase
  // Auth (Management API) per the domain configured in SSO Configuration; this
  // does no app-table read (unauthenticated), it asks GoTrue directly.
  async function handleSso() {
    if (!isOnline) { setError(t('auth.login.errNoInternet')); return }
    const email = identifier.trim()
    const domain = email.includes('@') ? email.split('@')[1]?.toLowerCase() : ''
    if (!domain) { setError('Enter your work email above to sign in with SSO.'); return }
    setError(''); setSsoLoading(true)
    try {
      const { data, error: ssoErr } = await supabase.auth.signInWithSSO({ domain, ...(captchaToken ? { options: { captchaToken } } : {}) })
      captchaRef.current?.reset()
      if (ssoErr) {
        setError(/no sso provider|not found/i.test(ssoErr.message || '')
          ? 'Single sign-on is not enabled for this email domain.'
          : (ssoErr.message || 'Single sign-on is unavailable right now.'))
        setSsoLoading(false)
        return
      }
      if (data?.url) { window.location.href = data.url; return } // IdP redirect
      setError('Single sign-on is not enabled for this email domain.')
      setSsoLoading(false)
    } catch (err) {
      setError(err?.message || t('auth.login.errUnexpected'))
      setSsoLoading(false)
    }
  }

  async function handleSignup(e) {
    e.preventDefault(); setError('')
    // Re-check the live registration switch right before creating the account so a
    // switch flipped off after page load still blocks the signup.
    const cfg = await getPublicConfig()
    if (cfg?.registration_open === 'false' || cfg?.allow_signups === 'false') {
      setSignupClosed(true)
      setError('New account sign-up is currently closed. Please contact your administrator.')
      return
    }
    const uname = signupUsername.trim()
    const empId = employeeId.trim()
    // Enforce the configured minimum password length (system_config.password_min_length,
    // default 8). Never weaken the existing 6-char floor: use the stronger of the two.
    const minLen = Math.max(6, parseInt(cfg?.password_min_length, 10) || 8)
    if (password !== confirm)   { setError(t('auth.login.errPasswordMismatch')); return }
    if (password.length < minLen) { setError(t('auth.login.errPasswordMin', { min: minLen })); return }
    if (uname.length < 3)       { setError(t('auth.login.errUsernameRequired')); return }
    if (!/^[a-zA-Z0-9._-]+$/.test(uname)) { setError('Username may only contain letters, numbers, and . _ -'); return }
    if (!empId)                 { setError('Employee ID is required.'); return }
    if (needsCaptcha && !captchaToken) { setError(t('auth.login.errCaptcha')); return }
    setLoading(true)
    try {
      // Supabase Auth needs an email, but users sign up with just a username +
      // Employee ID. We mint a synthetic, non-routable address from the username
      // that the user never sees; a DB trigger (V82) auto-confirms it and creates
      // the profile (username, employee_id, role, approved=false). Login by
      // username / Employee ID resolves back to this address.
      const slug = uname.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.+|\.+$)/g, '') || 'user'
      const syntheticEmail = `${slug}@users.tyrepulse.app`
      const { error: authErr } = await supabase.auth.signUp({
        email: syntheticEmail,
        password,
        options: {
          data: { username: uname, full_name: fullName.trim() || null, employee_id: empId, region: 'KSA' },
          ...(captchaToken ? { captchaToken } : {}),
        },
      })
      captchaRef.current?.reset()
      if (authErr) {
        const taken = /already registered|already been registered|duplicate|already exists|database error/i.test(authErr.message || '')
        setError(taken ? 'That username or Employee ID is already taken. Please choose another.' : authErr.message)
        return
      }
      setSignupDone(true)
    } catch (err) {
      setError(err?.message || t('auth.login.errUnexpected'))
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault(); setError(''); setForgotLoading(true)
    try {
      if (!recoveryDestinationIsValid(forgotChannel, forgotDestination)) {
        setError(forgotChannel === 'email'
          ? 'Enter a valid recovery email address.'
          : 'Enter a mobile number in international format, for example +966501234567.')
        return
      }
      const result = await requestPasswordRecovery({ channel: forgotChannel, destination: forgotDestination })
      setForgotChallengeId(result.challengeId || '')
      setForgotSent(true)
    } catch (err) {
      setError(err?.message || t('auth.login.errUnexpected'))
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleRecoveryCode(e) {
    e.preventDefault(); setError(''); setForgotLoading(true)
    try {
      if (!/^\d{6}$/.test(forgotCode)) { setError('Enter the 6-digit code.'); return }
      const actionLink = await verifyPasswordRecovery({
        channel: forgotChannel,
        destination: forgotDestination,
        challengeId: forgotChallengeId,
        code: forgotCode,
      })
      window.location.assign(actionLink)
    } catch (err) {
      setError(err?.message || 'The code is invalid or expired.')
    } finally {
      setForgotLoading(false)
    }
  }

  function switchTab(val) { setTab(val); setError(''); setSignupDone(false); setForgotMode(false); setForgotSent(false); setForgotCode(''); setForgotChallengeId(''); setPendingApproval(false) }

  const inputStyle = (field) => ({
    width: '100%',
    padding: '11px 14px',
    minHeight: 48,
    background: 'var(--login-input-bg)',
    border: `1.5px solid ${focusedField === field ? 'var(--login-input-border-focus)' : 'var(--login-input-border)'}`,
    borderRadius: 12,
    color: 'var(--login-text)',
    fontSize: 15,
    fontWeight: 500,
    transition: 'border-color 160ms ease, box-shadow 160ms ease',
    boxShadow: focusedField === field ? '0 0 0 4px rgba(22,163,74,0.14)' : 'none',
    outline: 'none',
  })

  const labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 600,
    color: 'var(--login-text)', marginBottom: 7,
  }

  // Google / Microsoft OAuth. Only reachable when the admin switched the
  // provider on (auth_google_enabled / auth_microsoft_enabled).
  async function handleProvider(provider) {
    if (!isOnline) { setError(t('auth.login.errNoInternet')); return }
    setError(''); setProviderLoading(provider)
    try {
      await signInWithProvider(provider)
    } catch (err) {
      setError(err?.message || t('auth.login.errUnexpected'))
      setProviderLoading('')
    }
  }

  const showWelcome = tab === 'login' && !forgotMode && !pendingApproval
  const footerLinks = [
    [t('auth.login.footerPrivacy'), '/privacy'],
    [t('auth.login.footerTerms'), '/terms'],
    [t('auth.login.footerSupport'), '/support'],
    ['Status', '/status'],
  ]

  return (
    <>
      <style>{LOGIN_PAGE_CSS}</style>

      {/* Brand panel (fixed palette) + the sign-in panel, which follows the
          light/dark theme through the tokens in loginStyles.js. */}
      <div className="tpl-shell tp-login-shell">
        <LoginHero logoSrc={loginLogo} customLogo={customLogo} showcase={showcase} />

        <main id="main-content" className="tpl-side">
          <motion.div
            initial={{ opacity:1, y:12 }}
            animate={{ opacity:1, y:0 }}
            transition={{ duration:0.4, ease:[0.22,1,0.36,1] }}
            className="tpl-card"
          >
            <div className="tpl-card-top">
              {!isOnline && (
                <span className="tpl-net off" role="status">
                  <WifiOff size={12} aria-hidden="true"/>{t('auth.login.offline')}
                </span>
              )}
              <span className="tpl-theme"><ThemeToggle size={16} includeSystem={false} /></span>
            </div>

            {showWelcome && (
              <>
                <h2 className="tpl-welcome">{p('welcome')}</h2>
                <p className="tpl-welcome-sub">{p('welcomeSub')}</p>
              </>
            )}

            {tab === 'signup' && (
              <div style={{ marginBottom:16 }}>
                <button type="button" className="tpl-link-btn" onClick={() => switchTab('login')}>
                  {t('auth.login.backToSignIn')}
                </button>
                <h2 className="tpl-welcome" style={{ fontSize:22 }}>{p('requestTitle')}</h2>
                <p className="tpl-welcome-sub" style={{ marginBottom:0 }}>{p('requestSub')}</p>
              </div>
            )}

            {/* Session expired banner */}
            {sessionExpired && (
              <div className="tpl-banner warn" role="status">
                <AlertCircle size={14} style={{flexShrink:0, marginTop:2}} aria-hidden="true"/>
                {t('auth.login.sessionExpiredBanner')}
              </div>
            )}

            {/* Access revoked banner */}
            {accessRevoked && (
              <div className="tpl-banner danger" role="alert">
                <AlertCircle size={14} style={{flexShrink:0, marginTop:2}} aria-hidden="true"/>
                {t('auth.login.accessRevokedBanner')}
              </div>
            )}

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    id="login-error" role="alert"
                    initial={{ opacity:0, height:0, marginBottom:0 }}
                    animate={{ opacity:1, height:'auto', marginBottom:16 }}
                    exit={{ opacity:0, height:0, marginBottom:0 }}
                    style={{
                      display:'flex', alignItems:'flex-start', gap:9,
                      padding:'11px 14px', borderRadius:12, fontSize:13,
                      color:'var(--login-danger-text)', background:'rgba(239,68,68,0.1)',
                      border:'1.5px solid rgba(239,68,68,0.25)', lineHeight:1.5,
                    }}
                  >
                    <AlertCircle size={15} style={{flexShrink:0, marginTop:1}}/>
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── PENDING APPROVAL (valid password, account not yet approved) ── */}
              {pendingApproval && (
                <motion.div key="pending" initial={{ opacity:0, scale:0.96 }} animate={{ opacity:1, scale:1 }}
                  style={{ textAlign:'center', padding:'8px 0' }}>
                  <div style={{
                    width:64, height:64, borderRadius:20, margin:'0 auto 18px',
                    background:'rgba(234,179,8,0.1)', border:'1.5px solid rgba(234,179,8,0.28)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:'0 0 40px rgba(234,179,8,0.2)',
                  }}>
                    <Clock size={30} style={{ color:'var(--login-warn-icon)' }}/>
                  </div>
                  <div style={{fontSize:18, fontWeight:800, color:'var(--login-text)', marginBottom:8, letterSpacing:'-0.02em'}}>
                    {t('auth.awaitingApprovalTitle')}
                  </div>
                  <div style={{fontSize:13, color:'var(--login-text-dim)', lineHeight:1.6, maxWidth:300, margin:'0 auto'}}>
                    {t('auth.awaitingApprovalBody')}
                  </div>
                  <div style={{fontSize:12, color:'var(--login-text-faint)', lineHeight:1.5, maxWidth:300, margin:'10px auto 0'}}>
                    {t('auth.awaitingApprovalContact')}
                  </div>
                  <button onClick={() => { setPendingApproval(false); setPassword('') }} style={{
                    marginTop:22, width:'100%', padding:'12px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
                    boxShadow:'0 4px 24px rgba(22,163,74,0.3)',
                  }}>{t('auth.login.backToSignInBtn')}</button>
                </motion.div>
              )}

              {/* ── LOGIN FORM ───────────────────────────────────────────── */}
              {tab === 'login' && !forgotMode && !pendingApproval && (
                <motion.form key="login"
                  initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleLogin}
                  style={{ display:'flex', flexDirection:'column', gap:14 }}
                >
                  {/* Unified identifier input - accepts email, username, or employee ID */}
                  <div>
                    <label htmlFor="login-identifier" style={labelStyle}>{p('idLabel')}</label>
                    <div style={{ position:'relative' }}>
                      <input
                        id="login-identifier"
                        name="identifier"
                        type="text"
                        style={inputStyle('id')}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? 'login-error' : undefined}
                        placeholder={p('idPlaceholder')}
                        value={identifier}
                        onChange={e => setIdentifier(e.target.value)}
                        onFocus={() => setFocusedField('id')}
                        onBlur={() => setFocusedField(null)}
                        required autoFocus autoComplete="username"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label htmlFor="login-password" style={labelStyle}>{t('auth.passwordLabel')}</label>
                    <div style={{ position:'relative' }}>
                      <input
                        id="login-password"
                        name="password"
                        type={showLoginPw ? 'text' : 'password'}
                        style={{ ...inputStyle('pw'), paddingInlineEnd:48 }}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? 'login-error' : undefined}
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onFocus={() => setFocusedField('pw')}
                        onBlur={() => setFocusedField(null)}
                        required autoComplete="current-password"
                      />
                      <button type="button" className="tp-login-eye" aria-label={showLoginPw ? 'Hide password' : 'Show password'} aria-pressed={showLoginPw} onClick={() => setShowLoginPw(v => !v)} style={{
                        position:'absolute', insetInlineEnd:2, top:'50%', transform:'translateY(-50%)',
                        color:'var(--login-icon)', background:'none', border:'none', minWidth:44, minHeight:44,
                        cursor:'pointer', padding:0, display:'flex', alignItems:'center', justifyContent:'center',
                      }}>
                        {showLoginPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                      </button>
                    </div>
                  </div>

                  <div className="tpl-row">
                    <label className="tpl-check">
                      <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                      {p('rememberMe')}
                    </label>
                    <button type="button" className="tpl-link-btn"
                      onClick={() => {
                        const typed = identifier.trim()
                        const looksLikePhone = /^(?:\+|00)[\d\s().-]+$/.test(typed)
                        setForgotChannel(looksLikePhone ? 'sms' : 'email')
                        setForgotDestination(typed.includes('@') || looksLikePhone ? typed : '')
                        setForgotMode(true); setError('')
                      }}
                    >
                      {t('auth.forgotPassword')}
                    </button>
                  </div>

                  <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} onError={setError}
                    className="flex justify-center" />

                  {/* Submit */}
                  <button type="submit" className="tpl-primary" disabled={loading || !isOnline || (needsCaptcha && !captchaToken)}>
                    {loading && <Loader2 size={17} className="animate-spin" aria-hidden="true"/>}
                    {loading ? t('auth.login.signingIn') : !isOnline ? t('auth.login.noConnection') : p('signIn')}
                  </button>

                  <div className="tpl-divider">{p('orContinue')}</div>
                  <div className="tpl-providers">
                    {signInOpts.google && (
                      <button type="button" className="tpl-provider" onClick={() => handleProvider('google')} disabled={!!providerLoading || !isOnline}>
                        {providerLoading === 'google' ? <Loader2 size={15} className="animate-spin" aria-hidden="true"/> : <GoogleMark/>}{p('google')}
                      </button>
                    )}
                    {signInOpts.microsoft && (
                      <button type="button" className="tpl-provider" onClick={() => handleProvider('azure')} disabled={!!providerLoading || !isOnline}>
                        {providerLoading === 'azure' ? <Loader2 size={15} className="animate-spin" aria-hidden="true"/> : <MicrosoftMark/>}{p('microsoft')}
                      </button>
                    )}
                    {/* Enterprise SSO (existing flow: resolves the work-email domain). */}
                    <button type="button" className="tpl-provider" onClick={handleSso} disabled={ssoLoading || !isOnline} aria-label={p('ssoAria')}>
                      {ssoLoading && <Loader2 size={15} className="animate-spin" aria-hidden="true"/>}
                      {ssoLoading ? t('auth.login.redirecting') : p('sso')}
                    </button>
                  </div>
                </motion.form>
              )}

              {tab === 'login' && !forgotMode && !pendingApproval && signInOpts.qr && (
                <QrLoginPanel onError={(m) => setError(m || t('auth.login.errUnexpected'))} />
              )}

              {tab === 'login' && !forgotMode && !pendingApproval && (
                <div className="tpl-request">
                  {p('newTo')}
                  <button type="button" onClick={() => switchTab('signup')}>
                    {p('requestAccess')}
                  </button>
                </div>
              )}

              {/* ── FORGOT PASSWORD ───────────────────────────────────────── */}
              {forgotMode && !forgotSent && (
                <motion.form key="forgot"
                  initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleForgot}
                  style={{ display:'flex', flexDirection:'column', gap:16 }}
                >
                  <div>
                    <button type="button" className="tp-login-link" onClick={() => { setForgotMode(false); setError('') }}
                      style={{ fontSize:12, color:'var(--brand-on-tint)', background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:14, fontWeight:600 }}>
                      {t('auth.login.backToSignIn')}
                    </button>
                    <div style={{ fontSize:20, fontWeight:800, color:'var(--login-text)', marginBottom:5, letterSpacing:'-0.02em' }}>{t('auth.login.resetPasswordTitle')}</div>
                    <div style={{ fontSize:13, color:'var(--login-text-dim)', lineHeight:1.5 }}>
                      {RECOVERY_SMS_ENABLED
                        ? 'Use a recovery email or mobile number that you previously verified in Account Settings.'
                        : 'Use the recovery email that you previously verified in Account Settings.'}
                    </div>
                  </div>
                  <div role="group" aria-label="Recovery method" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {[
                      ['email', Mail, 'Email'],
                      ...(RECOVERY_SMS_ENABLED ? [['sms', Phone, 'Mobile SMS']] : []),
                    ].map(([value, Icon, label]) => (
                      <button key={value} type="button" aria-pressed={forgotChannel === value}
                        onClick={() => { setForgotChannel(value); setForgotDestination(''); setError('') }}
                        style={{
                          padding:'10px', minHeight:44, borderRadius:12, cursor:'pointer', fontSize:13, fontWeight:700,
                          display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                          color:forgotChannel === value ? 'var(--brand-on-tint)' : 'var(--login-text-dim)',
                          background:forgotChannel === value ? 'rgba(22,163,74,0.12)' : 'var(--login-input-bg)',
                          border:`1.5px solid ${forgotChannel === value ? 'rgba(74,222,128,0.45)' : 'var(--login-input-border)'}`,
                        }}>
                        <Icon size={15}/>{label}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label htmlFor="recovery-destination" style={labelStyle}>{forgotChannel === 'email' ? 'Verified recovery email' : 'Verified mobile number'}</label>
                    <input id="recovery-destination" type={forgotChannel === 'email' ? 'email' : 'tel'} style={inputStyle('forgot')}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? 'login-error' : undefined}
                      autoComplete={forgotChannel === 'email' ? 'email' : 'tel'}
                      inputMode={forgotChannel === 'email' ? 'email' : 'tel'}
                      placeholder={forgotChannel === 'email' ? 'you@company.com' : '+966501234567'}
                      value={forgotDestination} onChange={e => setForgotDestination(e.target.value)}
                      onFocus={() => setFocusedField('forgot')} onBlur={() => setFocusedField(null)}
                      required autoFocus/>
                  </div>
                  <button type="submit" disabled={forgotLoading} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:forgotLoading?'not-allowed':'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow:'0 4px 24px rgba(22,163,74,0.35)',
                  }}>
                    {forgotLoading ? <Loader2 size={16} className="animate-spin"/> : forgotChannel === 'email' ? <Mail size={16}/> : <Phone size={16}/>}
                    {forgotLoading ? t('auth.login.sending') : 'Send verification code'}
                  </button>
                  <p style={{ margin:0, fontSize:11, color:'var(--login-text-faint)', lineHeight:1.5 }}>
                    For security, TyrePulse gives the same response whether or not an account exists. Codes expire after 10 minutes.
                  </p>
                  <p style={{ margin:0, fontSize:11, color:'var(--login-text-faint)', lineHeight:1.5 }}>
                    Cannot access your verified contact? <Link to="/support" style={{ color:'var(--brand-on-tint)', fontWeight:700, textDecoration:'underline' }}>Contact support</Link>.
                  </p>
                </motion.form>
              )}

              {/* Forgot sent success */}
              {forgotMode && forgotSent && (
                <motion.form onSubmit={handleRecoveryCode} initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }}
                  style={{ textAlign:'center', padding:'8px 0' }}>
                  <div style={{
                    width:64, height:64, borderRadius:20, margin:'0 auto 18px',
                    background:'rgba(22,163,74,0.12)', border:'1.5px solid rgba(22,163,74,0.3)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:'0 0 40px rgba(22,163,74,0.25)',
                  }}>
                    <KeyRound size={30} style={{color:'var(--brand-on-tint)'}}/>
                  </div>
                  <div style={{fontSize:18, fontWeight:800, color:'var(--login-text)', marginBottom:8, letterSpacing:'-0.02em'}}>Enter your verification code</div>
                  <div role="status" style={{fontSize:13, color:'var(--login-text-dim)', lineHeight:1.6}}>{RECOVERY_GENERIC_MESSAGE}</div>
                  <label htmlFor="recovery-code" style={{ ...labelStyle, textAlign:'left', marginTop:18 }}>6-digit code</label>
                  <input id="recovery-code" className="input" inputMode="numeric" autoComplete="one-time-code"
                    pattern="[0-9]{6}" maxLength={6} value={forgotCode}
                    onChange={e => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{ ...inputStyle('recovery-code'), textAlign:'center', fontSize:22, letterSpacing:'0.35em' }} autoFocus required />
                  <button type="submit" disabled={forgotLoading || forgotCode.length !== 6} className="tp-btn-shine" style={{
                    marginTop:22, width:'100%', padding:'12px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:forgotLoading?'not-allowed':'pointer',
                    boxShadow:'0 4px 24px rgba(22,163,74,0.3)',
                  }}>{forgotLoading ? 'Verifying…' : 'Verify and reset password'}</button>
                  <button type="button" onClick={() => { setForgotSent(false); setForgotCode(''); setForgotChallengeId(''); setError('') }}
                    style={{ marginTop:12, background:'none', border:'none', color:'var(--brand-on-tint)', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                    Change recovery method
                  </button>
                </motion.form>
              )}

              {/* ── SIGNUP FORM ───────────────────────────────────────────── */}
              {tab === 'signup' && !signupDone && (
                <motion.form key="signup"
                  initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleSignup}
                  style={{ display:'flex', flexDirection:'column', gap:14 }}
                >
                  {signupClosed && (
                    <div style={{
                      display:'flex', alignItems:'flex-start', gap:9,
                      padding:'11px 14px', borderRadius:12, fontSize:13,
                      color:'var(--login-warn-text)', background:'rgba(234,179,8,0.08)',
                      border:'1.5px solid rgba(234,179,8,0.22)', lineHeight:1.5,
                    }}>
                      <AlertCircle size={15} style={{flexShrink:0, marginTop:1}}/>
                      {t('auth.login.signupClosedNotice')}
                    </div>
                  )}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <label htmlFor="signup-fullname" style={labelStyle}>{t('auth.login.fullName')}</label>
                      <input id="signup-fullname" autoComplete="name" style={inputStyle('fname')} placeholder={t('auth.login.fullNamePlaceholder')}
                        value={fullName} onChange={e => setFullName(e.target.value)}
                        onFocus={() => setFocusedField('fname')} onBlur={() => setFocusedField(null)}/>
                    </div>
                    <div>
                      <label htmlFor="signup-username" style={labelStyle}>{t('auth.login.usernameRequired')}</label>
                      <input id="signup-username" autoComplete="username" style={inputStyle('uname')} placeholder={t('auth.login.usernamePlaceholder')}
                        value={signupUsername} onChange={e => setSignupUsername(e.target.value)}
                        onFocus={() => setFocusedField('uname')} onBlur={() => setFocusedField(null)} required/>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="signup-employee-id" style={labelStyle}>{t('auth.login.employeeIdRequired')}</label>
                    <input id="signup-employee-id" style={inputStyle('empid')} placeholder="EMP-1042"
                      value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                      onFocus={() => setFocusedField('empid')} onBlur={() => setFocusedField(null)} required/>
                  </div>
                  {[
                    { field:'spw',  show:showSignupPw,  set:setShowSignupPw,  val:password,  setVal:setPassword,  label:t('auth.login.passwordRequired') },
                    { field:'scpw', show:showConfirmPw, set:setShowConfirmPw, val:confirm,   setVal:setConfirm,   label:t('auth.login.confirmPasswordRequired') },
                  ].map(({ field, show, set, val, setVal, label }) => (
                    <div key={field}>
                      <label htmlFor={`signup-${field}`} style={labelStyle}>{label}</label>
                      <div style={{ position:'relative' }}>
                        <input id={`signup-${field}`} autoComplete="new-password" type={show ? 'text' : 'password'} style={{ ...inputStyle(field), paddingInlineEnd:44 }}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? 'login-error' : undefined}
                          placeholder="••••••••" value={val} onChange={e => setVal(e.target.value)}
                          onFocus={() => setFocusedField(field)} onBlur={() => setFocusedField(null)} required/>
                        <button type="button" className="tp-login-eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => set(v => !v)} style={{
                          position:'absolute', insetInlineEnd:13, top:'50%', transform:'translateY(-50%)',
                          color:'var(--login-icon)', background:'none', border:'none', cursor:'pointer', padding:4, display:'flex',
                        }}>
                          {show ? <EyeOff size={15}/> : <Eye size={15}/>}
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Strength indicator */}
                  {password.length > 0 && (
                    <div>
                      <div style={{ display:'flex', gap:4, marginBottom:5 }}>
                        {[1,2,3,4].map(i => {
                          const strength = password.length >= 12 && /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4
                            : password.length >= 10 ? 3
                            : password.length >= 8 ? 2 : 1
                          const active = i <= strength
                          return (
                            <div key={i} style={{
                              flex:1, height:3, borderRadius:999, transition:'background 0.3s',
                              background: active
                                ? strength >= 4 ? '#22c55e' : strength >= 3 ? '#84cc16' : strength >= 2 ? '#f59e0b' : '#ef4444'
                                : 'var(--login-strength-track)',
                            }}/>
                          )
                        })}
                      </div>
                      <div style={{ fontSize:10, color:'var(--login-text-faint)', fontWeight:600 }}>
                        {password.length < 8 ? t('auth.login.strengthTooShort') : password.length < 10 ? t('auth.login.strengthFair') : password.length < 12 ? t('auth.login.strengthGood') : t('auth.login.strengthStrong')}
                      </div>
                    </div>
                  )}

                  <div style={{
                    padding:'10px 14px', borderRadius:12, fontSize:12,
                    color:'var(--login-text-dim)', lineHeight:1.55,
                    background:'var(--login-notice-bg)', border:'1px solid var(--login-notice-border)',
                  }}>
                    {t('auth.login.approvalNotice')}
                  </div>

                  <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} onError={setError}
                    className="flex justify-center" />

                  <button type="submit" disabled={loading || signupClosed || (needsCaptcha && !captchaToken)} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background: (loading || signupClosed) ? 'rgba(22,163,74,0.3)' : 'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:(loading || signupClosed)?'not-allowed':'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow: (loading || signupClosed) ? 'none' : '0 4px 28px rgba(22,163,74,0.4)',
                  }}>
                    {loading && <Loader2 size={16} className="animate-spin"/>}
                    {loading ? t('auth.login.creatingAccount') : signupClosed ? t('auth.login.signupClosed') : t('auth.login.createAccount')}
                    {!loading && !signupClosed && <ArrowRight size={15} className="tp-dir-icon" aria-hidden="true"/>}
                  </button>
                </motion.form>
              )}

              {/* Signup success */}
              {tab === 'signup' && signupDone && (
                <motion.div initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }}
                  style={{ textAlign:'center', padding:'8px 0' }}>
                  <div style={{
                    width:64, height:64, borderRadius:20, margin:'0 auto 18px',
                    background:'rgba(234,179,8,0.1)', border:'1.5px solid rgba(234,179,8,0.25)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:30,
                    boxShadow:'0 0 40px rgba(234,179,8,0.2)',
                  }}>⏳</div>
                  <div style={{fontSize:18, fontWeight:800, color:'var(--login-text)', marginBottom:8, letterSpacing:'-0.02em'}}>{t('auth.login.accountSubmitted')}</div>
                  <div style={{fontSize:13, color:'var(--login-text-dim)', lineHeight:1.6, maxWidth:280, margin:'0 auto'}}>
                    {t('auth.login.accountSubmittedDesc')}
                  </div>
                  <button onClick={() => switchTab('login')} style={{
                    marginTop:22, width:'100%', padding:'12px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
                    boxShadow:'0 4px 24px rgba(22,163,74,0.3)',
                  }}>{t('auth.login.backToSignInBtn')}</button>
                </motion.div>
              )}
          </motion.div>

          {/* Footer */}
          <footer className="tpl-footer">
            <nav className="tp-login-footer-links" aria-label={p('footerNav')}>
              {footerLinks.map(([label, to]) => (
                <Link key={to} to={to}>{label}</Link>
              ))}
              <a href={`${MARKETING_URL}/contact`}>{p('contact')}</a>
            </nav>
            <small>{t('auth.login.footerCopyright')}{appVersion ? ` | ${p('version', { v: appVersion })}` : ''}</small>
          </footer>
        </main>
      </div>

      {/* MFA challenge modal - shown after password succeeds but AAL2 is required */}
      <TwoFactorChallenge
        open={!!mfaState}
        factorId={mfaState?.factorId}
        onSuccess={() => { setMfaState(null) }}
        onCancel={() => { setMfaState(null); setLoading(false) }}
      />
    </>
  )
}
