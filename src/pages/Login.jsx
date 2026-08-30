import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, ArrowRight, Mail, Phone, KeyRound, AlertCircle, CheckCircle2,
  Loader2, User, Zap, Wifi, WifiOff, Clock,
  BarChart3, Shield, Smartphone, Brain, TrendingUp, Bell,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { supabase } from '../lib/supabase'
import { getPublicConfig } from '../lib/api/systemConfig'
import { loginAttemptStatus, recordLoginFailure, resetLoginAttempts, lockMinutes } from '../lib/api/loginGuard'
import TpLogo from '../assets/logo.svg'
import { readCachedLogo } from '../lib/brand/library'
import TwoFactorChallenge from '../components/TwoFactorChallenge'
import { Illustration } from '../components/illustrations'
import BrandIcon from '../components/ui/BrandIcon'
import ThemeToggle from '../components/ui/ThemeToggle'
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

/* ── CSS injected once ────────────────────────────────────────────────────── */
const STYLES = `
@keyframes tp-spin       { to { transform: rotate(360deg); } }
@keyframes tp-spin-rev   { to { transform: rotate(-360deg); } }
@keyframes tp-pulse-ring {
  0%,100% { transform: scale(1);   opacity: 0.5; }
  50%      { transform: scale(1.3); opacity: 0; }
}
@keyframes tp-float {
  0%,100% { transform: translateY(0); }
  50%      { transform: translateY(-12px); }
}
@keyframes tp-scan {
  0%   { transform: translateY(-100%); opacity:0; }
  10%  { opacity: 0.5; }
  90%  { opacity: 0.5; }
  100% { transform: translateY(100vh); opacity:0; }
}
@keyframes tp-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
@keyframes tp-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes tp-counter {
  0%   { content: '127'; }
  50%  { content: '128'; }
  100% { content: '129'; }
}
.tp-spin     { animation: tp-spin     4s  linear       infinite; transform-origin: center; }
.tp-spin-rev { animation: tp-spin-rev 6s  linear       infinite; transform-origin: center; }
.tp-float    { animation: tp-float    4s  ease-in-out  infinite; }
.tp-btn-shine {
  position: relative; overflow: hidden;
}
.tp-btn-shine::after {
  content: ''; position: absolute;
  top: 0; left: -100%; width: 60%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  animation: tp-shimmer 2.8s ease-in-out infinite;
  pointer-events: none;
}
.tp-pulse-ring {
  position: absolute; inset: -6px; border-radius: 50%;
  border: 2px solid rgba(22,163,74,0.5);
  animation: tp-pulse-ring 2.2s ease-out infinite;
}
.tp-feature-card {
  animation: tp-fade-up 0.4s ease-out both;
}
`

/* ── Spinning Tyre ───────────────────────────────────────────────────────── */
function Tyre({ size = 120, reverse = false, opacity = 1, className = '' }) {
  const cx = size / 2
  const R  = size / 2 - 2
  const r1 = R * 0.76
  const r2 = R * 0.54
  const r3 = R * 0.17
  const spokes = 5
  const treads = 24
  const id = `t-${size}-${reverse ? 'r' : 'f'}`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ display:'block', opacity, filter:`drop-shadow(0 0 10px rgba(22,163,74,0.6))` }}>
      <defs>
        <radialGradient id={`rb-${id}`} cx="50%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#1a2e1a"/>
          <stop offset="100%" stopColor="#060c06"/>
        </radialGradient>
        <radialGradient id={`rm-${id}`} cx="40%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#4ade80" stopOpacity="0.85"/>
          <stop offset="45%"  stopColor="#16a34a" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="#052010"/>
        </radialGradient>
        <radialGradient id={`rh-${id}`} cx="35%" cy="30%" r="65%">
          <stop offset="0%"  stopColor="#86efac"/>
          <stop offset="100%" stopColor="#16a34a"/>
        </radialGradient>
      </defs>
      <g className={reverse ? 'tp-spin-rev' : 'tp-spin'}>
        {/* rubber */}
        <circle cx={cx} cy={cx} r={R} fill={`url(#rb-${id})`}/>
        {/* treads */}
        {Array.from({length:treads}).map((_,i) => {
          const a1 = (i/treads)*360, a2 = ((i+0.58)/treads)*360
          const toRad = a => a*Math.PI/180
          const oR = R, iR = r1+1
          const pts = [
            [cx+oR*Math.cos(toRad(a1)), cx+oR*Math.sin(toRad(a1))],
            [cx+oR*Math.cos(toRad(a2)), cx+oR*Math.sin(toRad(a2))],
            [cx+iR*Math.cos(toRad(a2)), cx+iR*Math.sin(toRad(a2))],
            [cx+iR*Math.cos(toRad(a1)), cx+iR*Math.sin(toRad(a1))],
          ]
          return (
            <path key={i}
              d={`M${pts[0].join(',')} A${oR},${oR} 0 0,1 ${pts[1].join(',')} L${pts[2].join(',')} A${iR},${iR} 0 0,0 ${pts[3].join(',')} Z`}
              fill={i%2===0 ? 'rgba(74,222,128,0.22)' : 'rgba(0,0,0,0.35)'}
            />
          )
        })}
        {/* rim */}
        <circle cx={cx} cy={cx} r={r1} fill={`url(#rm-${id})`}/>
        <circle cx={cx} cy={cx} r={r1+1} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth="2.5"/>
        {/* spokes */}
        {Array.from({length:spokes}).map((_,i) => {
          const a = (i/spokes)*360*Math.PI/180
          const w = r1*0.13
          const perp = a + Math.PI/2
          const x1 = cx+r3*1.1*Math.cos(a), y1 = cx+r3*1.1*Math.sin(a)
          const x2 = cx+r2*0.95*Math.cos(a), y2 = cx+r2*0.95*Math.sin(a)
          return (
            <polygon key={i}
              points={`${x1+w*0.6*Math.cos(perp)},${y1+w*0.6*Math.sin(perp)} ${x1-w*0.6*Math.cos(perp)},${y1-w*0.6*Math.sin(perp)} ${x2-w*0.35*Math.cos(perp)},${y2-w*0.35*Math.sin(perp)} ${x2+w*0.35*Math.cos(perp)},${y2+w*0.35*Math.sin(perp)}`}
              fill="rgba(74,222,128,0.75)" stroke="rgba(134,239,172,0.4)" strokeWidth="0.5"
            />
          )
        })}
        {/* inner */}
        <circle cx={cx} cy={cx} r={r2} fill="rgba(2,12,5,0.96)" stroke="rgba(74,222,128,0.35)" strokeWidth="1.5"/>
        {Array.from({length:8}).map((_,i) => {
          const a = (i/8)*360*Math.PI/180
          return <line key={i} x1={cx+(r3+1)*Math.cos(a)} y1={cx+(r3+1)*Math.sin(a)} x2={cx+r2*0.82*Math.cos(a)} y2={cx+r2*0.82*Math.sin(a)} stroke="rgba(22,163,74,0.15)" strokeWidth="0.8"/>
        })}
        {/* hub */}
        <circle cx={cx} cy={cx} r={r3+2} fill="rgba(3,12,4,0.98)" stroke="rgba(74,222,128,0.5)" strokeWidth="1.2"/>
        <circle cx={cx} cy={cx} r={r3}   fill={`url(#rh-${id})`}/>
        <circle cx={cx} cy={cx} r={r3*0.5} fill="rgba(2,8,3,0.9)"/>
        <circle cx={cx-r3*0.18} cy={cx-r3*0.18} r={r3*0.2} fill="rgba(255,255,255,0.28)"/>
      </g>
    </svg>
  )
}

/* ── Feature pill ────────────────────────────────────────────────────────── */
function FeatureChip({ icon: Icon, label, delay = 0 }) {
  return (
    <div className="tp-feature-card flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl"
      style={{
        background: 'rgba(22,163,74,0.1)',
        border: '1px solid rgba(22,163,74,0.22)',
        animationDelay: `${delay}s`,
      }}>
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(22,163,74,0.18)', border: '1px solid rgba(22,163,74,0.3)' }}>
        <Icon size={14} style={{ color: 'var(--brand-on-tint)' }} strokeWidth={2}/>
      </div>
      <span style={{ fontSize:12, fontWeight:600, color:'var(--login-text)' }}>{label}</span>
    </div>
  )
}

const FEATURES = [
  { icon: BarChart3,  labelKey: 'auth.login.features.analytics' },
  { icon: Brain,      labelKey: 'auth.login.features.predictive' },
  { icon: Bell,       labelKey: 'auth.login.features.alerts' },
  { icon: Shield,     labelKey: 'auth.login.features.rca' },
  { icon: TrendingUp, labelKey: 'auth.login.features.cpk' },
  { icon: Smartphone, labelKey: 'auth.login.features.mobile' },
]

export default function Login() {
  const loginLogo = readCachedLogo('login') || TpLogo
  const { signIn, user, loading: authLoading } = useAuth()
  const { t }               = useLanguage()
  const navigate            = useNavigate()

  // Navigate to dashboard once auth state resolves - avoids race with async fetchProfile
  useEffect(() => {
    if (!authLoading && user) navigate('/', { replace: true })
  }, [user, authLoading, navigate])

  const [tab, setTab]                 = useState('login')
  const [identifier, setIdentifier]   = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [fullName, setFullName]       = useState('')
  const [signupUsername, setSignupUsername] = useState('')
  const [employeeId, setEmployeeId]   = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [signupDone, setSignupDone]   = useState(false)
  const [pendingApproval, setPendingApproval] = useState(false)
  const [showLoginPw, setShowLoginPw] = useState(false)
  const [showSignupPw, setShowSignupPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [forgotMode, setForgotMode]   = useState(false)
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
  // Registration switch (registration_open / legacy allow_signups). When OFF,
  // self-service signup is blocked. Read via the anon-safe get_public_config RPC
  // before any session exists. Defaults to OPEN so a transient read never blocks.
  const [signupClosed, setSignupClosed] = useState(false)

  // Pre-auth read of the registration switch on mount. getPublicConfig never
  // throws (returns {} on failure), so a read miss leaves signup permissively open.
  useEffect(() => {
    let alive = true
    getPublicConfig().then((cfg) => {
      if (!alive) return
      if (cfg?.registration_open === 'false' || cfg?.allow_signups === 'false') setSignupClosed(true)
    })
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
      result = await signIn(identifier, password)
    } catch (err) {
      // Any unexpected failure (network drop, RPC crash) must surface a message
      // and release the button — never leave it stuck on "Signing in…".
      setError(err?.message || t('auth.login.errUnexpected'))
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
      const { data, error: ssoErr } = await supabase.auth.signInWithSSO({ domain })
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
        options: { data: { username: uname, full_name: fullName.trim() || null, employee_id: empId, region: 'KSA' } },
      })
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
    background: 'var(--login-input-bg)',
    border: `1.5px solid ${focusedField === field ? 'var(--login-input-border-focus)' : 'var(--login-input-border)'}`,
    borderRadius: 12,
    color: 'var(--login-text)',
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: '0.01em',
    transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(22,163,74,0.15), 0 0 20px rgba(22,163,74,0.08)' : 'none',
    outline: 'none',
    backdropFilter: 'blur(8px)',
  })

  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: 'var(--login-text-dim)', letterSpacing: '0.08em',
    textTransform: 'uppercase', marginBottom: 7,
  }

  return (
    <>
      <style>{STYLES}</style>

      {/* The auth screen now genuinely follows the app's light/dark theme - every
          surface reads from the --login-* tokens in index.css (dark and light
          both fully defined), and the reader can flip it right here via the
          Theme control below without ever having to sign in first. */}
      <div className="tp-login-shell" style={{ minHeight:'100vh', display:'flex', background:'var(--login-bg)', position:'relative', overflow:'hidden' }}>

        {/* ── Background layers ──────────────────────────────────────────── */}
        {/* Deep radial glow */}
        <div style={{
          position:'fixed', inset:0, pointerEvents:'none',
          background:'radial-gradient(ellipse 80% 60% at 20% 50%, var(--login-glow-a) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 50%, var(--login-glow-b) 0%, transparent 55%)',
        }}/>
        {/* Grid */}
        <div style={{
          position:'fixed', inset:0, pointerEvents:'none',
          backgroundImage: 'linear-gradient(var(--login-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--login-grid-line) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}/>
        {/* Scan line */}
        <div style={{
          position:'fixed', left:0, right:0, height:2, top:0,
          background:'linear-gradient(90deg, transparent, rgba(22,163,74,0.5), rgba(74,222,128,0.7), rgba(22,163,74,0.5), transparent)',
          animation:'tp-scan 9s ease-in-out infinite',
          pointerEvents:'none',
        }}/>

        {/* Network status pill */}
        <div style={{
          position:'fixed', top:16, left:'50%', transform:'translateX(-50%)',
          zIndex:100, display:'flex', alignItems:'center', gap:6,
          padding:'5px 12px', borderRadius:999,
          background: isOnline ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${isOnline ? 'rgba(22,163,74,0.25)' : 'rgba(239,68,68,0.3)'}`,
          transition:'all 0.4s',
        }}>
          {isOnline
            ? <><Wifi size={11} style={{ color: 'var(--brand-on-tint)' }}/><span style={{fontSize:10, fontWeight:700, color:'var(--brand-on-tint)', letterSpacing:'0.06em'}}>{t('auth.login.connected')}</span></>
            : <><WifiOff size={11} style={{ color: 'var(--login-danger-text)' }}/><span style={{fontSize:10, fontWeight:700, color:'var(--login-danger-text)', letterSpacing:'0.06em'}}>{t('auth.login.offline')}</span></>
          }
        </div>

        {/* Theme + language controls - fixed top-right, reachable before signing
            in and on every viewport (the desktop layout otherwise has nowhere to
            switch either). */}
        <div style={{
          position:'fixed', top:16, right:16, zIndex:100,
          display:'flex', alignItems:'center', gap:8,
        }}>
          <LanguageSwitcher />
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            width:32, height:32, borderRadius:999,
            background: 'var(--login-card-bg)', border: '1px solid var(--login-card-border)',
            color: 'var(--login-text-dim)',
          }}>
            <ThemeToggle size={15} />
          </div>
        </div>

        {/* ── LEFT PANEL (desktop) ─────────────────────────────────────────── */}
        <div style={{
          display:'none',
          flexDirection:'column',
          justifyContent:'center',
          padding:'60px 56px',
          flex:'0 0 48%',
          position:'relative',
        }}
          className="lg-panel">

          {/* Big background tyre */}
          <div style={{ position:'absolute', right:-60, top:'50%', transform:'translateY(-50%)', opacity:0.08, pointerEvents:'none' }}>
            <Tyre size={500} reverse/>
          </div>

          {/* Brand */}
          <div style={{ marginBottom:48 }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
              <div style={{
                width:52, height:52, borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center',
                background:'linear-gradient(135deg, rgba(22,163,74,0.22), rgba(4,20,10,0.9))',
                border:'1.5px solid rgba(22,163,74,0.4)',
                boxShadow:'0 0 30px rgba(22,163,74,0.3)',
              }}>
                <BrandIcon src={loginLogo} custom={loginLogo !== TpLogo} chip={false} size={30} />
              </div>
              <div>
                <div style={{fontSize:26, fontWeight:800, color:'var(--login-text)', letterSpacing:'-0.03em', lineHeight:1}}>TyrePulse</div>
                <div style={{fontSize:11, color:'var(--brand-on-tint)', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:600, marginTop:2}}>{t('auth.login.brandTagline')}</div>
              </div>
            </div>

            <h2 style={{ fontSize:36, fontWeight:800, color:'var(--login-text)', lineHeight:1.2, letterSpacing:'-0.03em', margin:'0 0 12px' }}>
              {t('auth.login.heroLine1')}<br/>
              <span style={{ background:'linear-gradient(135deg, var(--login-hero-accent-1), var(--login-hero-accent-2))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
                {t('auth.login.heroLine2')}
              </span>
            </h2>
            <p style={{ fontSize:14, color:'var(--login-text-dim)', lineHeight:1.6, margin:0, maxWidth:340 }}>
              {t('auth.login.heroDesc')}
            </p>

            {/* Premium marketing hero — reinforces the brand moment without
                touching the centered auth card on the right */}
            <div style={{ marginTop:28, opacity:0.96, pointerEvents:'none' }}>
              <Illustration name="marketing/hero-platform" size={300} title={t('auth.login.brandTagline')} />
            </div>
          </div>

          {/* Features grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, maxWidth:380 }}>
            {FEATURES.map((f, i) => (
              <FeatureChip key={f.labelKey} icon={f.icon} label={t(f.labelKey)} delay={i * 0.08}/>
            ))}
          </div>

          {/* Product capabilities — avoid unsupported operational statistics on the public surface. */}
          <div style={{ display:'flex', gap:32, marginTop:40 }}>
            {[['auth.login.stats.lifecycle','auth.login.stats.tyresTracked'],['auth.login.stats.scoped','auth.login.stats.uptime'],['auth.login.stats.actionable','auth.login.stats.alertTime']].map(([valKey, lblKey]) => (
              <div key={lblKey}>
                <div style={{fontSize:22, fontWeight:800, color:'var(--brand-on-tint)', letterSpacing:'-0.02em'}}>{t(valKey)}</div>
                <div style={{fontSize:11, color:'var(--login-text-dim)', fontWeight:500, marginTop:2}}>{t(lblKey)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT PANEL / Single Column Mobile ──────────────────────────── */}
        <div style={{
          flex:1, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center',
          padding:'24px 20px',
          minHeight:'100vh',
        }}>

          {/* Mobile-only brand */}
          <motion.div
            initial={{ opacity:1, y:-16 }}
            animate={{ opacity:1, y:0 }}
            transition={{ duration:0.45, ease:[0.22,1,0.36,1] }}
            style={{ textAlign:'center', marginBottom:24 }}
            className="mobile-brand"
          >
            <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
              <div style={{ position:'relative' }}>
                <div className="tp-pulse-ring" style={{ inset:-10 }}/>
                <Tyre size={76} opacity={0.95}/>
              </div>
            </div>
            <div style={{fontSize:24, fontWeight:800, color:'var(--login-text)', letterSpacing:'-0.03em'}}>TyrePulse</div>
            <div style={{fontSize:11, color:'var(--brand-on-tint)', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:600, marginTop:3}}>{t('auth.login.brandTaglinePlatform')}</div>
          </motion.div>

          {/* Session expired banner */}
          <AnimatePresence>
            {sessionExpired && (
              <motion.div
                initial={{ opacity:0, y:-8, height:0 }}
                animate={{ opacity:1, y:0, height:'auto' }}
                exit={{ opacity:0, height:0 }}
                style={{
                  display:'flex', alignItems:'center', gap:8,
                  padding:'10px 14px', borderRadius:12, marginBottom:12,
                  fontSize:13, color:'var(--login-warn-text)',
                  background:'rgba(234,179,8,0.08)',
                  border:'1px solid rgba(234,179,8,0.2)',
                  width:'100%', maxWidth:420,
                }}
              >
                <AlertCircle size={14} style={{flexShrink:0}}/>
                {t('auth.login.sessionExpiredBanner')}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Access revoked banner */}
          <AnimatePresence>
            {accessRevoked && (
              <motion.div
                initial={{ opacity:0, y:-8, height:0 }}
                animate={{ opacity:1, y:0, height:'auto' }}
                exit={{ opacity:0, height:0 }}
                style={{
                  display:'flex', alignItems:'center', gap:8,
                  padding:'10px 14px', borderRadius:12, marginBottom:12,
                  fontSize:13, color:'var(--login-danger-text)',
                  background:'rgba(239,68,68,0.08)',
                  border:'1px solid rgba(239,68,68,0.25)',
                  width:'100%', maxWidth:420,
                }}
              >
                <AlertCircle size={14} style={{flexShrink:0}}/>
                Your account access has been suspended. Contact your administrator.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main card */}
          <motion.div
            initial={{ opacity:1, y:20, scale:0.98 }}
            animate={{ opacity:1, y:0, scale:1 }}
            transition={{ duration:0.5, ease:[0.22,1,0.36,1] }}
            style={{ width:'100%', maxWidth:420 }}
          >
            <div style={{
              background:'var(--login-card-bg)',
              border:'1.5px solid var(--login-card-border)',
              borderRadius:24,
              padding:'28px 28px 32px',
              boxShadow:'var(--login-card-shadow)',
              backdropFilter:'blur(32px)',
              position:'relative',
              overflow:'hidden',
            }}>

              {/* Top glow stripe */}
              <div style={{
                position:'absolute', top:0, left:'15%', right:'15%', height:1,
                background:'linear-gradient(90deg, transparent, rgba(74,222,128,0.7), transparent)',
              }}/>

              {/* Tabs */}
              {!forgotMode && !pendingApproval && (
                <div style={{ display:'flex', marginBottom:24, gap:4 }}>
                  {[['login',t('auth.login.tabSignIn')],['signup',t('auth.login.tabCreateAccount')]].map(([val,label]) => (
                    <button key={val} onClick={() => switchTab(val)} style={{
                      flex:1, padding:'9px 0', fontSize:13, fontWeight:700,
                      border:'none', borderRadius:10,
                      background: tab===val ? 'rgba(22,163,74,0.18)' : 'var(--login-tab-bg)',
                      boxShadow: tab===val ? 'inset 0 0 0 1.5px rgba(22,163,74,0.45)' : `inset 0 0 0 1.5px var(--login-tab-border)`,
                      color: tab===val ? 'var(--brand-on-tint)' : 'var(--login-text-dim)',
                      cursor:'pointer', transition:'all 0.2s',
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
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
                  style={{ display:'flex', flexDirection:'column', gap:18 }}
                >
                  {/* Unified identifier input - accepts email, username, or employee ID */}
                  <div>
                    <label htmlFor="login-identifier" style={labelStyle}>{t('auth.login.idAnyLabel')}</label>
                    <div style={{ position:'relative' }}>
                      <div style={{
                        position:'absolute', left:13, top:'50%', transform:'translateY(-50%)',
                        color: focusedField==='id' ? 'var(--brand-on-tint)' : 'var(--login-icon)',
                        transition:'color 0.2s', pointerEvents:'none',
                      }}>
                        <User size={15}/>
                      </div>
                      <input
                        id="login-identifier"
                        name="identifier"
                        type="text"
                        style={{ ...inputStyle('id'), paddingLeft:40 }}
                        placeholder={t('auth.login.idAnyPlaceholder')}
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
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                      <label htmlFor="login-password" style={labelStyle}>{t('auth.passwordLabel')}</label>
                      <button type="button"
                        onClick={() => {
                          const typed = identifier.trim()
                          const looksLikePhone = /^(?:\+|00)[\d\s().-]+$/.test(typed)
                          setForgotChannel(looksLikePhone ? 'sms' : 'email')
                          setForgotDestination(typed.includes('@') || looksLikePhone ? typed : '')
                          setForgotMode(true); setError('')
                        }}
                        style={{ fontSize:11, color:'var(--brand-on-tint)', opacity:0.75, background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:600, transition:'opacity 0.2s', letterSpacing:'0.02em' }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '0.75' }}
                      >
                        {t('auth.forgotPassword')}
                      </button>
                    </div>
                    <div style={{ position:'relative' }}>
                      <input
                        id="login-password"
                        name="password"
                        type={showLoginPw ? 'text' : 'password'}
                        style={{ ...inputStyle('pw'), paddingRight:44 }}
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onFocus={() => setFocusedField('pw')}
                        onBlur={() => setFocusedField(null)}
                        required autoComplete="current-password"
                      />
                      <button type="button" aria-label={showLoginPw ? 'Hide password' : 'Show password'} onClick={() => setShowLoginPw(v => !v)} style={{
                        position:'absolute', right:13, top:'50%', transform:'translateY(-50%)',
                        color:'var(--login-icon)', background:'none', border:'none',
                        cursor:'pointer', padding:4, transition:'color 0.2s', display:'flex',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--login-icon-hover)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--login-icon)' }}
                      >
                        {showLoginPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                      </button>
                    </div>
                  </div>

                  {/* Submit */}
                  <button type="submit" disabled={loading || !isOnline} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background: loading
                      ? 'rgba(22,163,74,0.3)'
                      : !isOnline
                        ? 'rgba(107,114,128,0.3)'
                        : 'linear-gradient(135deg, #16a34a 0%, #15803d 55%, #166534 100%)',
                    color:'#fff', fontSize:14, fontWeight:700,
                    cursor: (loading || !isOnline) ? 'not-allowed' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow: loading || !isOnline ? 'none' : '0 4px 28px rgba(22,163,74,0.4), 0 0 0 1px rgba(74,222,128,0.12)',
                    transition:'all 0.2s', letterSpacing:'0.01em',
                    marginTop:4,
                  }}>
                    {loading ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16}/>}
                    {loading ? t('auth.login.signingIn') : !isOnline ? t('auth.login.noConnection') : t('auth.login.tabSignIn')}
                    {!loading && isOnline && <ArrowRight size={15}/>}
                  </button>

                  {/* Enterprise SSO */}
                  <div style={{ display:'flex', alignItems:'center', gap:10, margin:'2px 0' }}>
                    <div style={{ flex:1, height:1, background:'var(--login-divider)' }}/>
                    <span style={{ fontSize:10, fontWeight:700, color:'var(--login-text-faint)', letterSpacing:'0.08em' }}>{t('auth.login.or')}</span>
                    <div style={{ flex:1, height:1, background:'var(--login-divider)' }}/>
                  </div>
                  <button type="button" onClick={handleSso} disabled={ssoLoading || !isOnline} style={{
                    width:'100%', padding:'11px', borderRadius:14,
                    border:'1.5px solid rgba(74,222,128,0.28)', background:'rgba(22,163,74,0.08)',
                    color:'var(--brand-on-tint)', fontSize:13, fontWeight:700,
                    cursor:(ssoLoading || !isOnline) ? 'not-allowed' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    transition:'all 0.2s',
                  }}>
                    {ssoLoading ? <Loader2 size={15} className="animate-spin"/> : <Shield size={15}/>}
                    {ssoLoading ? t('auth.login.redirecting') : t('auth.login.signInWithSso')}
                  </button>
                </motion.form>
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
                    <button type="button" onClick={() => { setForgotMode(false); setError('') }}
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
                          padding:'10px', borderRadius:12, cursor:'pointer', fontSize:13, fontWeight:700,
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
                    Cannot access your verified contact? <Link to="/support" style={{ color:'var(--brand-on-tint)', fontWeight:700 }}>Contact support</Link>.
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
                      <div style={labelStyle}>{t('auth.login.fullName')}</div>
                      <input style={inputStyle('fname')} placeholder={t('auth.login.fullNamePlaceholder')}
                        value={fullName} onChange={e => setFullName(e.target.value)}
                        onFocus={() => setFocusedField('fname')} onBlur={() => setFocusedField(null)}/>
                    </div>
                    <div>
                      <div style={labelStyle}>{t('auth.login.usernameRequired')}</div>
                      <input style={inputStyle('uname')} placeholder={t('auth.login.usernamePlaceholder')}
                        value={signupUsername} onChange={e => setSignupUsername(e.target.value)}
                        onFocus={() => setFocusedField('uname')} onBlur={() => setFocusedField(null)} required/>
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>{t('auth.login.employeeIdRequired')}</div>
                    <input style={inputStyle('empid')} placeholder="EMP-1042"
                      value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                      onFocus={() => setFocusedField('empid')} onBlur={() => setFocusedField(null)} required/>
                  </div>
                  {[
                    { field:'spw',  show:showSignupPw,  set:setShowSignupPw,  val:password,  setVal:setPassword,  label:t('auth.login.passwordRequired') },
                    { field:'scpw', show:showConfirmPw, set:setShowConfirmPw, val:confirm,   setVal:setConfirm,   label:t('auth.login.confirmPasswordRequired') },
                  ].map(({ field, show, set, val, setVal, label }) => (
                    <div key={field}>
                      <div style={labelStyle}>{label}</div>
                      <div style={{ position:'relative' }}>
                        <input type={show ? 'text' : 'password'} style={{ ...inputStyle(field), paddingRight:44 }}
                          placeholder="••••••••" value={val} onChange={e => setVal(e.target.value)}
                          onFocus={() => setFocusedField(field)} onBlur={() => setFocusedField(null)} required/>
                        <button type="button" onClick={() => set(v => !v)} style={{
                          position:'absolute', right:13, top:'50%', transform:'translateY(-50%)',
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

                  <button type="submit" disabled={loading || signupClosed} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background: (loading || signupClosed) ? 'rgba(22,163,74,0.3)' : 'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:(loading || signupClosed)?'not-allowed':'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow: (loading || signupClosed) ? 'none' : '0 4px 28px rgba(22,163,74,0.4)',
                  }}>
                    {loading && <Loader2 size={16} className="animate-spin"/>}
                    {loading ? t('auth.login.creatingAccount') : signupClosed ? t('auth.login.signupClosed') : t('auth.login.createAccount')}
                    {!loading && !signupClosed && <ArrowRight size={15}/>}
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
            </div>

            {/* Footer */}
            <motion.div
              initial={{ opacity:1 }} animate={{ opacity:1 }} transition={{ delay:0.55 }}
              style={{ textAlign:'center', marginTop:20, display:'flex', flexDirection:'column', gap:6 }}
            >
              <p style={{ fontSize:11, color:'var(--login-text-faint)', letterSpacing:'0.04em' }}>
                {t('auth.login.footerCopyright')}
              </p>
              <div style={{ display:'flex', justifyContent:'center', gap:16 }}>
                {[
                  [t('auth.login.footerPrivacy'), '/privacy'],
                  [t('auth.login.footerTerms'), '/terms'],
                  [t('auth.login.footerSupport'), '/support'],
                  ['Status', '/status'],
                ].map(([label, to]) => (
                  <Link key={to} to={to} style={{ fontSize:10, color:'var(--login-text-faint)', fontWeight:600, letterSpacing:'0.04em', textDecoration:'none' }}>
                    {label}
                  </Link>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Responsive split - show left panel on large screens */}
      <style>{`
        @media (min-width: 1024px) {
          .lg-panel { display: flex !important; }
          .mobile-brand { display: none !important; }
        }
      `}</style>

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
