import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, Mail, AlertCircle, CheckCircle2, Loader2, AtSign, Hash, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import TpLogo from '../assets/logo.svg'
import { cn } from '../lib/cn'

const ID_MODES = [
  { value: 'email',    label: 'Email',       icon: Mail,    placeholder: 'you@example.com',  type: 'email' },
  { value: 'username', label: 'Username',    icon: AtSign,  placeholder: 'your_username',    type: 'text' },
  { value: 'empid',   label: 'Employee ID',  icon: Hash,    placeholder: 'e.g. EMP-1042',    type: 'text' },
]

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()

  const [tab, setTab]             = useState('login')
  const [idMode, setIdMode]       = useState('email')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [fullName, setFullName]   = useState('')
  const [signupUsername, setSignupUsername] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [signupDone, setSignupDone] = useState(false)

  const [showLoginPw, setShowLoginPw]     = useState(false)
  const [showSignupPw, setShowSignupPw]   = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  const [forgotMode, setForgotMode]       = useState(false)
  const [forgotEmail, setForgotEmail]     = useState('')
  const [forgotSent, setForgotSent]       = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const sessionExpired = localStorage.getItem('tp_session_expired') === '1'
  useEffect(() => {
    if (sessionExpired) localStorage.removeItem('tp_session_expired')
  }, [])

  const currentMode = ID_MODES.find(m => m.value === idMode)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const err = await signIn(identifier, password)
    if (err) { setError(err.message); setLoading(false) }
    else navigate('/')
  }

  async function handleSignup(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm)       { setError('Passwords do not match'); return }
    if (password.length < 6)        { setError('Password must be at least 6 characters'); return }
    if (!signupUsername.trim())     { setError('Username is required'); return }
    setLoading(true)

    const { data, error: authErr } = await supabase.auth.signUp({ email: signupEmail, password })
    if (authErr) { setError(authErr.message); setLoading(false); return }

    if (data?.user) {
      const { error: profileErr } = await supabase.from('profiles').insert({
        id:          data.user.id,
        username:    signupUsername.trim(),
        full_name:   fullName.trim() || null,
        employee_id: employeeId.trim() || null,
        role:        'Reporter',
        region:      'KSA',
        approved:    false,
      })
      if (profileErr && profileErr.code !== '42501' && profileErr.code !== '23505') {
        console.warn('Profile insert warning:', profileErr.message)
      }
    }

    setSignupDone(true)
    setLoading(false)
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError('')
    setForgotLoading(true)
    const { error: forgotErr } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (forgotErr) setError(forgotErr.message)
    else setForgotSent(true)
    setForgotLoading(false)
  }

  function switchTab(val) {
    setTab(val)
    setError('')
    setSignupDone(false)
    setForgotMode(false)
    setForgotSent(false)
  }

  function switchIdMode(val) {
    setIdMode(val)
    setIdentifier('')
    setError('')
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div style={{ position:'absolute', top:'10%', left:'5%', width:500, height:500, background:'radial-gradient(circle, rgba(22,163,74,0.14) 0%, transparent 65%)', borderRadius:'50%', filter:'blur(60px)' }} />
        <div style={{ position:'absolute', bottom:'5%', right:'5%', width:400, height:400, background:'radial-gradient(circle, rgba(22,163,74,0.08) 0%, transparent 65%)', borderRadius:'50%', filter:'blur(50px)' }} />
        <div style={{ position:'absolute', top:'45%', right:'20%', width:250, height:250, background:'radial-gradient(circle, rgba(74,222,128,0.05) 0%, transparent 65%)', borderRadius:'50%', filter:'blur(40px)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md z-10"
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4, ease: [0.175, 0.885, 0.32, 1.275] }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5"
            style={{
              background: 'linear-gradient(135deg, rgba(22,163,74,0.2), rgba(6,14,9,0.8))',
              border: '1px solid rgba(22,163,74,0.35)',
              boxShadow: '0 0 40px rgba(22,163,74,0.25), inset 0 0 20px rgba(22,163,74,0.05)',
            }}
          >
            <img src={TpLogo} alt="TyrePulse" className="w-12 h-12" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.4 }}
            className="text-3xl font-bold text-white tracking-tight"
          >
            TyrePulse
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="text-muted text-sm mt-1.5 tracking-wide"
          >
            Fleet Intelligence Platform
          </motion.p>
        </div>

        {/* Session expired banner */}
        <AnimatePresence>
          {sessionExpired && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4 text-sm text-yellow-300 bg-yellow-500/10 border border-yellow-500/25"
            >
              <AlertCircle size={14} className="shrink-0" />
              Session expired after 30 minutes of inactivity. Please sign in again.
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl p-6 overflow-hidden"
          style={{
            background: 'rgba(6,14,9,0.85)',
            border: '1px solid rgba(22,163,74,0.14)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Tabs */}
          {!forgotMode && (
            <div className="flex mb-6 border-b border-[var(--border-dim)]">
              {[['login', 'Sign In'], ['signup', 'Create Account']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => switchTab(val)}
                  className={cn(
                    'flex-1 py-3 text-sm font-semibold border-b-2 transition-all duration-200 -mb-px',
                    tab === val
                      ? 'border-brand-400 text-brand-bright'
                      : 'border-transparent text-muted hover:text-white'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/25"
              >
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sign In */}
          {tab === 'login' && !forgotMode && (
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Identifier mode selector */}
              <div>
                <label className="label mb-1.5">Sign in with</label>
                <div className="flex gap-1.5 p-1 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[var(--border-dim)]">
                  {ID_MODES.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => switchIdMode(value)}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                        idMode === value
                          ? 'bg-brand-subtle text-brand-bright border border-brand-600/30 shadow-sm'
                          : 'text-muted hover:text-white'
                      )}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Identifier input */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={idMode}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  <label className="label">{currentMode.label}</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                      <currentMode.icon size={15} />
                    </div>
                    <input
                      type={currentMode.type}
                      className="input pl-9"
                      placeholder={currentMode.placeholder}
                      value={identifier}
                      onChange={e => setIdentifier(e.target.value)}
                      required
                      autoFocus
                      autoComplete={idMode === 'email' ? 'email' : 'off'}
                    />
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="relative">
                <label className="label">Password</label>
                <input
                  type={showLoginPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} required
                />
                <button
                  type="button" onClick={() => setShowLoginPw(v => !v)}
                  className="absolute right-3 top-[2.1rem] text-muted hover:text-white transition-colors"
                >
                  {showLoginPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  onClick={() => { setForgotMode(true); setForgotEmail(idMode === 'email' ? identifier : ''); setError('') }}
                  className="text-xs text-muted hover:text-brand-bright transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 mt-1">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                {loading ? 'Signing in…' : 'Sign In'}
                {!loading && <ArrowRight size={15} />}
              </button>
            </form>
          )}

          {/* Forgot Password */}
          {forgotMode && !forgotSent && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => { setForgotMode(false); setError('') }}
                  className="text-xs text-muted hover:text-brand-bright transition-colors"
                >
                  ← Back to sign in
                </button>
                <h3 className="text-white font-semibold mt-3 text-base">Reset your password</h3>
                <p className="text-muted text-sm mt-1">Enter your email and we'll send a reset link.</p>
              </div>
              <div>
                <label className="label">Email address</label>
                <input
                  type="email" className="input" placeholder="you@example.com"
                  value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required autoFocus
                />
              </div>
              <button type="submit" disabled={forgotLoading} className="btn-primary w-full flex items-center justify-center gap-2">
                {forgotLoading ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                {forgotLoading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}

          {/* Forgot sent */}
          {forgotMode && forgotSent && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-brand-subtle border border-brand-600/25">
                <CheckCircle2 className="w-7 h-7 text-brand-bright" />
              </div>
              <p className="text-white font-semibold text-base">Reset link sent!</p>
              <p className="text-muted text-sm mt-2 leading-relaxed">
                Check your inbox. It may take a minute to arrive.
              </p>
              <button onClick={() => { setForgotMode(false); setForgotSent(false) }} className="btn-primary mt-5 w-full">
                Back to Sign In
              </button>
            </div>
          )}

          {/* Create Account */}
          {tab === 'signup' && !signupDone && (
            <form onSubmit={handleSignup} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" placeholder="Your full name" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="label">Username *</label>
                  <input className="input" placeholder="username" value={signupUsername} onChange={e => setSignupUsername(e.target.value)} required />
                </div>
              </div>
              <div>
                <label className="label">Employee ID</label>
                <input className="input" placeholder="e.g. EMP-1042 (optional)" value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
              </div>
              <div>
                <label className="label">Email *</label>
                <input type="email" className="input" placeholder="you@company.com" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} required />
              </div>
              <div className="relative">
                <label className="label">Password *</label>
                <input
                  type={showSignupPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="Min. 6 characters" value={password} onChange={e => setPassword(e.target.value)} required
                />
                <button type="button" onClick={() => setShowSignupPw(v => !v)} className="absolute right-3 top-[2.1rem] text-muted hover:text-white transition-colors">
                  {showSignupPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="relative">
                <label className="label">Confirm Password *</label>
                <input
                  type={showConfirmPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} required
                />
                <button type="button" onClick={() => setShowConfirmPw(v => !v)} className="absolute right-3 top-[2.1rem] text-muted hover:text-white transition-colors">
                  {showConfirmPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-xs text-muted bg-surface-2 rounded-lg px-3 py-2 border border-[var(--border-dim)]">
                New accounts require admin approval before access is granted.
              </p>
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 mt-1">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                {loading ? 'Creating account…' : 'Create Account'}
                {!loading && <ArrowRight size={15} />}
              </button>
            </form>
          )}

          {/* Pending Approval */}
          {tab === 'signup' && signupDone && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-yellow-500/10 border border-yellow-500/25">
                <span className="text-3xl">⏳</span>
              </div>
              <p className="text-white font-semibold text-base">Account submitted!</p>
              <p className="text-muted text-sm mt-2 leading-relaxed">
                Pending admin approval. You'll be notified once your account is activated.
              </p>
              <button onClick={() => switchTab('login')} className="btn-primary mt-5 w-full">
                Back to Sign In
              </button>
            </div>
          )}
        </motion.div>

        <p className="text-center text-xs text-dim mt-6">
          Built by Shahzeb Rahman © 2026
        </p>
      </motion.div>
    </div>
  )
}
