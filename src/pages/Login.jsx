import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()

  const [tab, setTab]             = useState('login')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [fullName, setFullName]   = useState('')
  const [username, setUsername]   = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [signupDone, setSignupDone] = useState(false)

  // Password visibility toggles
  const [showLoginPw, setShowLoginPw]   = useState(false)
  const [showSignupPw, setShowSignupPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  // Forgot password state
  const [forgotMode, setForgotMode]     = useState(false)
  const [forgotEmail, setForgotEmail]   = useState('')
  const [forgotSent, setForgotSent]     = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const sessionExpired = localStorage.getItem('tp_session_expired') === '1'
  useEffect(() => {
    if (sessionExpired) localStorage.removeItem('tp_session_expired')
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const err = await signIn(email, password)
    if (err) { setError(err.message); setLoading(false) }
    else navigate('/')
  }

  async function handleSignup(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 6)  { setError('Password must be at least 6 characters'); return }
    if (!username.trim())     { setError('Username is required'); return }
    setLoading(true)

    const { data, error: authErr } = await supabase.auth.signUp({ email, password })
    if (authErr) { setError(authErr.message); setLoading(false); return }

    if (data?.user) {
      const { error: profileErr } = await supabase.from('profiles').insert({
        id:          data.user.id,
        username:    username.trim(),
        full_name:   fullName.trim() || null,
        employee_id: employeeId.trim() || null,
        role:        'Reporter',
        region:      'KSA',
        approved:    false,
      })
      // Profile creation may fail silently if email confirmation is required.
      // handle_new_user() trigger will create the row on email confirmation.
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

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">

      {/* Background glows */}
      <div className="login-glow" />
      <div style={{
        position: 'fixed', top: '15%', left: '8%', width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(22,163,74,0.12) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', bottom: '10%', right: '6%', width: 320, height: 320,
        background: 'radial-gradient(circle, rgba(120,113,108,0.10) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none',
      }} />

      <div className="relative w-full max-w-md z-10">

        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(22,163,74,0.22), rgba(120,113,108,0.12))',
              border: '1px solid rgba(22,163,74,0.35)',
              boxShadow: '0 0 32px rgba(22,163,74,0.22), 0 0 8px rgba(22,163,74,0.08) inset',
            }}>
            <span style={{ fontSize: 38 }}>🔄</span>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">TyrePulse</h1>
          <p className="text-gray-400 mt-2 text-sm tracking-wide">Tyre Intelligence Platform</p>
        </div>

        {sessionExpired && (
          <div className="rounded-lg px-4 py-3 mb-4 text-sm text-yellow-300 text-center"
            style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }}>
            Your session expired after inactivity. Please sign in again.
          </div>
        )}

        <div className="login-card">

          {/* Tabs — hidden when in forgot-password flow */}
          {!forgotMode && (
            <div className="flex mb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {[['login', 'Sign In'], ['signup', 'Create Account']].map(([val, label]) => (
                <button key={val} onClick={() => switchTab(val)}
                  className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all duration-200 ${
                    tab === val
                      ? 'border-green-500 text-green-400'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg px-4 py-3 mb-4 text-sm text-red-300"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {error}
            </div>
          )}

          {/* ── Sign In ── */}
          {tab === 'login' && !forgotMode && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Email address</label>
                <input type="email" className="input" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
              </div>
              <div className="relative">
                <label className="label">Password</label>
                <input type={showLoginPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} required />
                <button type="button"
                  onClick={() => setShowLoginPw(v => !v)}
                  className="absolute right-3 text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ top: '2.05rem' }}>
                  {showLoginPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex justify-end -mt-2">
                <button type="button"
                  onClick={() => { setForgotMode(true); setForgotEmail(email); setError('') }}
                  className="text-xs text-gray-500 hover:text-green-400 transition-colors">
                  Forgot Password?
                </button>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
                {loading ? 'Signing in…' : 'Sign In →'}
              </button>
            </form>
          )}

          {/* ── Forgot Password Form ── */}
          {forgotMode && !forgotSent && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="mb-1">
                <button type="button"
                  onClick={() => { setForgotMode(false); setError('') }}
                  className="text-xs text-gray-500 hover:text-green-400 transition-colors">
                  ← Back to sign in
                </button>
                <h3 className="text-white font-semibold mt-3 text-lg">Reset your password</h3>
                <p className="text-gray-400 text-sm mt-1">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>
              <div>
                <label className="label">Email address</label>
                <input type="email" className="input" placeholder="you@example.com"
                  value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required autoFocus />
              </div>
              <button type="submit" disabled={forgotLoading} className="btn-primary w-full">
                {forgotLoading ? 'Sending…' : 'Send Reset Link →'}
              </button>
            </form>
          )}

          {/* ── Forgot Password Sent ── */}
          {forgotMode && forgotSent && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <span className="text-3xl">✉️</span>
              </div>
              <p className="text-white font-semibold text-lg">Reset link sent!</p>
              <p className="text-gray-400 text-sm mt-2">
                Check your inbox for a password reset link. It may take a minute to arrive.
              </p>
              <button
                onClick={() => { setForgotMode(false); setForgotSent(false) }}
                className="btn-primary mt-5 w-full">
                Back to Sign In →
              </button>
            </div>
          )}

          {/* ── Create Account ── */}
          {tab === 'signup' && !signupDone && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" placeholder="Your full name"
                    value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="label">Username *</label>
                  <input className="input" placeholder="username"
                    value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
              </div>
              <div>
                <label className="label">Employee ID</label>
                <input className="input" placeholder="e.g. EMP-1042 (optional)"
                  value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
              </div>
              <div>
                <label className="label">Email *</label>
                <input type="email" className="input" placeholder="you@company.com"
                  value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="relative">
                <label className="label">Password *</label>
                <input type={showSignupPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="Min. 6 characters"
                  value={password} onChange={e => setPassword(e.target.value)} required />
                <button type="button"
                  onClick={() => setShowSignupPw(v => !v)}
                  className="absolute right-3 text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ top: '2.05rem' }}>
                  {showSignupPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="relative">
                <label className="label">Confirm Password *</label>
                <input type={showConfirmPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
                <button type="button"
                  onClick={() => setShowConfirmPw(v => !v)}
                  className="absolute right-3 text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ top: '2.05rem' }}>
                  {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-gray-600">
                New accounts require admin approval before access is granted.
              </p>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Creating account…' : 'Create Account →'}
              </button>
            </form>
          )}

          {/* ── Pending Approval ── */}
          {tab === 'signup' && signupDone && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
                <span className="text-3xl">⏳</span>
              </div>
              <p className="text-white font-semibold text-lg">Account submitted!</p>
              <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                Your account is pending admin approval. You'll be able to sign in once an administrator activates your account.
              </p>
              <button
                onClick={() => switchTab('login')}
                className="btn-primary mt-5 w-full">
                Back to Sign In →
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">
          Built by Shahzeb Rahman © 2026
        </p>
      </div>
    </div>
  )
}
