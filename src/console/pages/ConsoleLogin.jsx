/**
 * ConsoleLogin.jsx - the System Console (super admin) sign-in page.
 *
 * Left: a dark control-room hero with what the console controls, real platform
 * counts from get_login_showcase (N/A when unreadable, never invented) and the
 * industries the platform serves. Right: the sign-in card.
 *
 * Behaviour is unchanged from the previous screen: ConsoleAuthContext.signIn
 * (super-admin check + MFA challenge), verifyMfa, Turnstile when configured,
 * and the isolated tab-local console session (src/lib/supabase.js). "Remember
 * me" stores the email only, never the session. Microsoft and Google appear only
 * when an admin has switched them on (system_config, read via get_public_config).
 *
 * Every link that leaves the console is a plain <a href>, never a router Link:
 * the Supabase storage key is chosen when the tab boots, so a same-tab client
 * navigation to /login would keep the console's storage.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, AlertTriangle, Lock, Mail, Smartphone, ChevronLeft, ArrowRight, ArrowLeft, Crown, Globe,
  Building2, Users, Settings2, BarChart3, Plug, ShieldCheck, Sun, Moon, KeyRound,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import TurnstileWidget, { captchaEnabled } from '../../components/auth/TurnstileWidget'
import { useTheme } from '../../contexts/ThemeContext'
import { getLoginShowcase, signInOptions, signInWithProvider } from '../../lib/api/loginShowcase'
import { getPublicConfig } from '../../lib/api/systemConfig'
import './consoleLogin.css'

const REMEMBER_KEY = 'tp_console_remember'
const SITE = 'https://tyre-pulse-eezl.vercel.app'
const NAV = [
  ['Platform', `${SITE}/platform`],
  ['Industries', `${SITE}/industries`],
  ['Modules', `${SITE}/platform/fleet-assets`],
  ['Security', `${SITE}/security`],
  ['Support', `${SITE}/contact`],
]

const CAPABILITIES = [
  { icon: Building2, title: 'Multi-Site Fleet Management', sub: 'Every site and asset in one view' },
  { icon: Users, title: 'Users & Roles', sub: 'Access Control' },
  { icon: Settings2, title: 'System Configuration', sub: 'Platform-wide switches' },
  { icon: BarChart3, title: 'Data & Analytics', sub: 'Real-Time Insights' },
  { icon: Plug, title: 'Integrations', sub: 'API & Third Party' },
  { icon: ShieldCheck, title: 'Security & Audit', sub: 'Logs & Monitoring' },
]

const INDUSTRIES = [
  { title: 'Construction', img: 'console-construction.webp', items: ['Earthmovers', 'Dump Trucks', 'Loaders', 'Excavators'] },
  { title: 'Mining', img: 'console-mining.webp', items: ['Haul Trucks', 'Drills', 'Dozers', 'Graders'] },
  { title: 'Oil & Gas', img: 'console-oilgas.webp', items: ['Heavy Equipment', 'Tankers', 'Generators', 'Support Vehicles'] },
  { title: 'Logistics & Transport', img: 'console-logistics.webp', items: ['Trucks', 'Trailers', 'Prime Movers', 'Fleet Trucks'] },
  { title: 'Concrete & Batching', img: 'console-concrete.webp', items: ['Transit Mixers', 'Pumps', 'Batch Plants', 'Service Vehicles'] },
  { title: 'Ports & Terminals', img: 'console-ports.webp', items: ['Yard Trucks', 'Reach Stackers', 'Forklifts', 'Terminal Tractors'] },
  { title: 'Government', img: 'console-government.webp', items: ['Municipal Fleet', 'Service Vehicles', 'Waste Trucks', 'Utility Equipment'] },
]

const fmt = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US') : 'N/A')

function readRemembered() {
  try { return window.localStorage.getItem(REMEMBER_KEY) || '' } catch { return '' }
}
function writeRemembered(email) {
  try {
    if (email) window.localStorage.setItem(REMEMBER_KEY, email)
    else window.localStorage.removeItem(REMEMBER_KEY)
  } catch { /* storage blocked: remembering is a convenience only */ }
}

// step: 'credentials' | 'totp'
export default function ConsoleLogin() {
  const { signIn, verifyMfa } = useConsoleAuth()
  const navigate = useNavigate()
  const { isDark, setTheme } = useTheme()

  const initialEmail = useRef(readRemembered()).current
  const [step, setStep]           = useState('credentials')
  const [email, setEmail]         = useState(initialEmail)
  const [remember, setRemember]   = useState(!!initialEmail)
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [captchaToken, setCaptchaToken] = useState(null)
  const captchaRef = useRef(null)
  const needsCaptcha = captchaEnabled()

  const [showcase, setShowcase] = useState(null)
  const [options, setOptions] = useState({ google: false, microsoft: false, qr: false })
  const [oauthBusy, setOauthBusy] = useState(null)

  // TOTP step state
  const [totpCode, setTotpCode]   = useState(['', '', '', '', '', ''])
  const [factorId, setFactorId]   = useState(null)
  const [challengeId, setChallengeId] = useState(null)
  const inputRefs = useRef([])

  useEffect(() => {
    let live = true
    getLoginShowcase().then((s) => { if (live) setShowcase(s) })
    getPublicConfig().then((cfg) => { if (live) setOptions(signInOptions(cfg)) })
    return () => { live = false }
  }, [])

  // Auto-focus first TOTP input when step changes
  useEffect(() => {
    if (step === 'totp') {
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, [step])

  async function handleCredentials(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    if (needsCaptcha && !captchaToken) { setError('Complete the security check, then try again.'); return }
    setLoading(true); setError(null)
    writeRemembered(remember ? email.trim().toLowerCase() : '')

    // signIn RETURNS an error for a bad password but can still THROW on a dead
    // network. Without this the button stays disabled and the only way back in
    // is a page reload - the worst possible failure on a login screen.
    let res
    try {
      res = await signIn(email.trim().toLowerCase(), password, captchaToken)
    } catch (e) {
      captchaRef.current?.reset()
      setError(toUserMessage(e, 'Could not reach the server. Check your connection and try again.'))
      setLoading(false)
      return
    }
    // A Turnstile token works once; get a fresh one for any next attempt.
    captchaRef.current?.reset()
    const { error: err, mfaRequired, factorId: fid, challengeId: cid } = res || {}

    if (err) {
      setError(toUserMessage(err, 'Could not sign you in. Check your details and try again.')); setLoading(false); return
    }
    if (mfaRequired) {
      setFactorId(fid)
      setChallengeId(cid)
      setLoading(false)
      setStep('totp')
      return
    }
    navigate('/console', { replace: true })
  }

  async function handleTotp(e, codeOverride) {
    e?.preventDefault?.()
    const code = codeOverride || totpCode.join('')
    if (code.length !== 6) { setError('Enter the full 6-digit code.'); return }
    setLoading(true); setError(null)

    let vres
    try {
      vres = await verifyMfa(factorId, challengeId, code)
    } catch (e) {
      setError(toUserMessage(e, 'Could not reach the server. Check your connection and try again.'))
      setLoading(false)
      return
    }
    const { error: err } = vres || {}
    if (err) {
      setError('Invalid code. Please try again.')
      setTotpCode(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      setLoading(false)
      return
    }
    navigate('/console', { replace: true })
  }

  function handleTotpInput(index, value) {
    // accept paste of full 6-digit code
    if (value.length === 6 && /^\d{6}$/.test(value)) {
      setTotpCode(value.split(''))
      inputRefs.current[5]?.focus()
      return
    }
    if (!/^\d*$/.test(value)) return
    const next = [...totpCode]
    next[index] = value.slice(-1)
    setTotpCode(next)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
    // auto-submit when all 6 digits entered (pass the code: state is not yet updated)
    if (next.every(d => d !== '') && next.join('').length === 6) {
      const code = next.join('')
      setTimeout(() => handleTotp(null, code), 50)
    }
  }

  function handleTotpKeyDown(index, e) {
    if (e.key === 'Backspace' && !totpCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus()
  }

  const startProvider = useCallback(async (provider) => {
    setError(null); setOauthBusy(provider)
    try {
      await signInWithProvider(provider, `${window.location.origin}/console`)
    } catch (e) {
      setError(toUserMessage(e, 'That sign-in method is not available right now. Use your email and password.'))
      setOauthBusy(null)
    }
  }, [])

  const hasProviders = options.microsoft || options.google
  const s = showcase
  const countries = s?.countries || []
  const version = import.meta.env.VITE_APP_VERSION

  return (
    <div className="cl" data-theme={isDark ? 'dark' : 'light'}>
      {/* ── Hero ── */}
      <section className="cl-hero" aria-label="About the System Console">
        <div className="cl-hero-bg" aria-hidden="true" />
        <div className="cl-hero-overlay" aria-hidden="true" />
        <div className="cl-hero-grid" aria-hidden="true" />

        <div className="cl-hero-inner">
          <div className="cl-top">
            <Brand />
            <nav className="cl-nav" aria-label="Tyre Pulse website">
              {NAV.map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
              ))}
              <span className="cl-lang" title="English"><Globe size={13} aria-hidden="true" /> EN</span>
            </nav>
          </div>

          <div>
            <span className="cl-badge"><Crown size={14} aria-hidden="true" /> SUPER ADMIN CONSOLE</span>
            <h1 className="cl-h1">Total Control of Your <span>PMV Operations</span></h1>
            <p className="cl-lead cl-hero-extra">
              Manage all sites, assets, users, data, integrations and system settings from one powerful console.
            </p>
          </div>

          <div className="cl-caps cl-hero-extra">
            {CAPABILITIES.map(({ icon: Icon, title, sub }) => (
              <div className="cl-cap" key={title}>
                <span className="cl-cap-icon"><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></span>
                <span style={{ minWidth: 0 }}>
                  <span className="cl-cap-title" style={{ display: 'block' }}>{title}</span>
                  <span className="cl-cap-sub" style={{ display: 'block' }}>{sub}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="cl-stats cl-hero-extra">
            <dl className="cl-kpis" style={{ margin: 0 }}>
              <Kpi label="Total Assets" value={s?.vehicles} />
              <Kpi label="Active" value={s?.activeVehicles} />
              <Kpi label="In Workshop" value={s?.inWorkshop} title="Assets out of production on an open job card" />
              <Kpi label="Total Sites" value={s?.sites} />
              <Kpi label="Total Users" value={s?.users} />
            </dl>
            <div className="cl-where">
              <div className="cl-kpi-label">Operating in</div>
              {countries.length ? (
                <div className="cl-where-list">
                  {countries.map((c) => <span className="cl-chip" key={c}>{c}</span>)}
                </div>
              ) : (
                <div className="cl-kpi-value na">N/A</div>
              )}
            </div>
          </div>

          <div className="cl-hero-extra">
            <p className="cl-section-label">Industries We Serve</p>
            <div className="cl-industries">
              {INDUSTRIES.map((ind) => (
                <div className="cl-ind" key={ind.title}>
                  <div className="cl-ind-img" style={{ backgroundImage: `url('/login-art/${ind.img}')` }} aria-hidden="true" />
                  <div className="cl-ind-body">
                    <div className="cl-ind-title">{ind.title}</div>
                    <ul>{ind.items.map((it) => <li key={it}>{it}</li>)}</ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="cl-bottom cl-hero-extra">
          <span><strong>{fmt(s?.vehicles)}</strong> vehicles</span>
          <span><strong>{fmt(s?.sites)}</strong> sites</span>
          <span><strong>{fmt(s?.users)}</strong> users</span>
          <span className="cl-tags">Global Operations | Real-Time Data | Secure | Scalable</span>
        </div>
      </section>

      {/* ── Sign-in ── */}
      <main className="cl-side">
        <div className="cl-side-top">
          <button type="button" className="cl-theme" onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            {isDark ? 'Light' : 'Dark'}
          </button>
        </div>

        <div className="cl-card">
          <div className="cl-card-head">
            <Brand />
            <ShieldCrown totp={step === 'totp'} />
            <h2>{step === 'totp' ? 'Two-Factor Authentication' : 'Super Admin Console'}</h2>
            <p className="cl-card-sub">
              {step === 'totp'
                ? 'Enter the 6-digit code from your authenticator app.'
                : 'Exclusive access for authorized administrators only.'}
            </p>
          </div>

          {step === 'credentials' && (
            <>
              <form onSubmit={handleCredentials} className="cl-form" noValidate>
                {error && <ErrBox msg={error} />}
                <div>
                  <label htmlFor="console-login-email" className="cl-label">Email Address</label>
                  <div className="cl-input-wrap">
                    <Mail size={16} className="cl-input-icon" aria-hidden="true" />
                    <input id="console-login-email" type="email" value={email} className="cl-input"
                      onChange={e => { setEmail(e.target.value); setError(null) }}
                      placeholder="admin@company.com" autoComplete="username" autoFocus={!initialEmail} />
                  </div>
                </div>
                <div>
                  <label htmlFor="console-login-password" className="cl-label">Password</label>
                  <div className="cl-input-wrap">
                    <Lock size={16} className="cl-input-icon" aria-hidden="true" />
                    <input id="console-login-password" type={showPass ? 'text' : 'password'} value={password} className="cl-input"
                      onChange={e => { setPassword(e.target.value); setError(null) }}
                      placeholder="Enter your password" autoComplete="current-password" autoFocus={!!initialEmail} />
                    <button type="button" className="cl-eye" onClick={() => setShowPass(v => !v)}
                      aria-label={showPass ? 'Hide password' : 'Show password'} title={showPass ? 'Hide password' : 'Show password'}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="cl-row">
                  <label className="cl-check">
                    <input type="checkbox" checked={remember}
                      onChange={(e) => { setRemember(e.target.checked); if (!e.target.checked) writeRemembered('') }} />
                    Remember me
                  </label>
                  <a className="cl-link" href="/login?forgot=1" target="_blank" rel="noopener noreferrer">Forgot password?</a>
                </div>
                <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} onError={setError}
                  theme={isDark ? 'dark' : 'light'} className="flex justify-center" />
                <button type="submit" className="cl-btn" disabled={loading || (needsCaptcha && !captchaToken)}>
                  {loading ? <><Spinner /> Verifying...</> : <>Sign In to Console <ArrowRight size={16} aria-hidden="true" /></>}
                </button>
              </form>

              {hasProviders && (
                <>
                  <div className="cl-or">or continue with</div>
                  <div className="cl-providers">
                    {options.microsoft && (
                      <button type="button" className="cl-provider" disabled={!!oauthBusy} onClick={() => startProvider('azure')}>
                        <MicrosoftMark /> {oauthBusy === 'azure' ? 'Opening...' : 'Microsoft'}
                      </button>
                    )}
                    {options.google && (
                      <button type="button" className="cl-provider" disabled={!!oauthBusy} onClick={() => startProvider('google')}>
                        <GoogleMark /> {oauthBusy === 'google' ? 'Opening...' : 'Google'}
                      </button>
                    )}
                  </div>
                </>
              )}

              <div className="cl-alert notice" role="note">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>This is a restricted area. All activities are logged and monitored for security.</span>
              </div>

              <a className="cl-back" href="/login"><ArrowLeft size={15} aria-hidden="true" /> Back to User Login</a>
            </>
          )}

          {step === 'totp' && (
            <>
              <form onSubmit={handleTotp} className="cl-form">
                <div className="cl-alert info">
                  <Smartphone size={16} aria-hidden="true" />
                  <span>Open your authenticator app and enter the code for TyrePulse Console.</span>
                </div>
                {error && <ErrBox msg={error} />}
                <div>
                  <p id="console-login-code" className="cl-label" style={{ textAlign: 'center' }}>Authentication Code</p>
                  <div className="cl-totp" role="group" aria-labelledby="console-login-code">
                    {totpCode.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => inputRefs.current[i] = el}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete={i === 0 ? 'one-time-code' : 'off'}
                        aria-label={`Digit ${i + 1} of 6`}
                        value={digit}
                        className={digit ? 'filled' : ''}
                        onChange={e => handleTotpInput(i, e.target.value)}
                        onKeyDown={e => handleTotpKeyDown(i, e)}
                        onPaste={e => {
                          e.preventDefault()
                          handleTotpInput(i, e.clipboardData.getData('text'))
                        }}
                      />
                    ))}
                  </div>
                  <p className="cl-hint">Code refreshes every 30 seconds</p>
                </div>
                <button type="submit" className="cl-btn" disabled={loading || totpCode.join('').length !== 6}>
                  {loading ? <><Spinner /> Verifying...</> : <><KeyRound size={16} aria-hidden="true" /> Verify Code</>}
                </button>
              </form>

              <button type="button" className="cl-back cl-back-btn"
                onClick={() => { setStep('credentials'); setError(null); setTotpCode(['', '', '', '', '', '']) }}>
                <ChevronLeft size={15} aria-hidden="true" /> Back to sign in
              </button>
            </>
          )}
        </div>

        <footer className="cl-foot">
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
          <span aria-hidden="true">|</span>
          <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
          <span aria-hidden="true">|</span>
          <a href={`${SITE}/contact`} target="_blank" rel="noopener noreferrer">Contact Us</a>
          {version ? <><span aria-hidden="true">|</span><span>Version {version}</span></> : null}
        </footer>
      </main>
    </div>
  )
}

function Brand() {
  return (
    <span className="cl-brand" aria-label="TyrePulse Fleet Intelligence">
      <svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="#22c55e" strokeWidth="5" />
        <circle cx="20" cy="20" r="17" fill="none" stroke="#15803d" strokeWidth="5" strokeDasharray="3 4.2" opacity="0.7" />
        <circle cx="20" cy="20" r="11.5" fill="none" stroke="#22c55e" strokeWidth="1.4" opacity="0.6" />
        <path d="M6 21h7l2.5-6 4 12 3-9 2 3h9.5" fill="none" stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>
        <span className="cl-brand-name">Tyre<b>Pulse</b></span>
        <span className="cl-brand-sub">FLEET INTELLIGENCE</span>
      </span>
    </span>
  )
}

function Kpi({ label, value, title }) {
  const ok = Number.isFinite(value)
  return (
    <div className="cl-kpi" title={title}>
      <dt className="cl-kpi-label">{label}</dt>
      <dd className={`cl-kpi-value${ok ? '' : ' na'}`} style={{ margin: 0 }}>{fmt(value)}</dd>
    </div>
  )
}

/** Shield with a crown, drawn inline so no external image is needed. */
function ShieldCrown({ totp }) {
  return (
    <svg width="76" height="84" viewBox="0 0 76 84" aria-hidden="true" style={{ marginTop: 2 }}>
      <defs>
        <linearGradient id="cl-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <path d="M38 6 L66 16 V40 C66 58 54 71 38 78 C22 71 10 58 10 40 V16 Z" fill="url(#cl-shield)" opacity="0.16" />
      <path d="M38 6 L66 16 V40 C66 58 54 71 38 78 C22 71 10 58 10 40 V16 Z" fill="none" stroke="url(#cl-shield)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M38 14 L59 21.5 V40 C59 54 50 64.5 38 70 C26 64.5 17 54 17 40 V21.5 Z" fill="none" stroke="#22c55e" strokeOpacity="0.45" strokeWidth="1.2" strokeLinejoin="round" />
      {totp ? (
        <g fill="none" stroke="#22c55e" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="28" y="30" width="20" height="28" rx="3.5" />
          <path d="M35 53h6" />
        </g>
      ) : (
        <g fill="#22c55e">
          <path d="M24 52 L22 32 L31 40 L38 27 L45 40 L54 32 L52 52 Z" />
          <rect x="24" y="54.5" width="28" height="4" rx="1.5" />
          <circle cx="22" cy="31" r="2.4" /><circle cx="38" cy="26" r="2.4" /><circle cx="54" cy="31" r="2.4" />
        </g>
      )}
    </svg>
  )
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0" y="0" width="7.5" height="7.5" fill="#f25022" /><rect x="8.5" y="0" width="7.5" height="7.5" fill="#7fba00" />
      <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00a4ef" /><rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#ffb900" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  )
}

function ErrBox({ msg }) {
  return (
    <div role="alert" className="cl-alert err">
      <AlertTriangle size={16} aria-hidden="true" />
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{msg}</span>
    </div>
  )
}

function Spinner() {
  return <span className="cl-spinner" aria-hidden="true" />
}
