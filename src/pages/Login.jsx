import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const [tab, setTab]           = useState('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [signupDone, setSignupDone] = useState(false)

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
      await supabase.from('profiles').insert({
        id:        data.user.id,
        username:  username.trim(),
        full_name: fullName.trim() || null,
        role:      'Reporter',
        region:    'KSA',
      })
    }

    setSignupDone(true)
    setLoading(false)
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">

      {/* Background glows */}
      <div className="login-glow" />

      {/* Floating orbs for depth */}
      <div style={{
        position: 'fixed', top: '15%', left: '8%', width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', bottom: '10%', right: '6%', width: 320, height: 320,
        background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none',
      }} />

      <div className="relative w-full max-w-md z-10">

        {/* Brand header */}
        <div className="text-center mb-8">
          {/* Tyre icon with glow ring */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(37,99,235,0.25), rgba(99,102,241,0.15))',
              border: '1px solid rgba(37,99,235,0.35)',
              boxShadow: '0 0 32px rgba(37,99,235,0.25), 0 0 8px rgba(37,99,235,0.1) inset',
            }}>
            <span style={{ fontSize: 38 }}>🔄</span>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">TyrePulse</h1>
          <p className="text-gray-400 mt-2 text-sm tracking-wide">Tyre Intelligence Platform</p>
          <p className="text-gray-600 text-xs mt-1">Readymix Concrete Company · KSA</p>
        </div>

        {/* Card */}
        <div className="login-card">
          {/* Tabs */}
          <div className="flex mb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {[['login', 'Sign In'], ['signup', 'Create Account']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => { setTab(val); setError(''); setSignupDone(false) }}
                className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all duration-200 ${
                  tab === val
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg px-4 py-3 mb-4 text-sm text-red-300"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {error}
            </div>
          )}

          {/* ── Sign In ── */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Email address</label>
                <input type="email" className="input" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
              </div>
              <div>
                <label className="label">Password</label>
                <input type="password" className="input" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
                {loading ? 'Signing in…' : 'Sign In →'}
              </button>
            </form>
          )}

          {/* ── Create Account ── */}
          {tab === 'signup' && !signupDone && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" placeholder="Ahmed Al-Rashid"
                    value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="label">Username *</label>
                  <input className="input" placeholder="arashid"
                    value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
              </div>
              <div>
                <label className="label">Email *</label>
                <input type="email" className="input" placeholder="you@readymix.com.sa"
                  value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div>
                <label className="label">Password *</label>
                <input type="password" className="input" placeholder="Min. 6 characters"
                  value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input type="password" className="input" placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              <p className="text-xs text-gray-600">
                New accounts start as Reporter. An admin promotes your role after sign-up.
              </p>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Creating account…' : 'Create Account →'}
              </button>
            </form>
          )}

          {/* ── Success ── */}
          {tab === 'signup' && signupDone && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <span className="text-3xl">✅</span>
              </div>
              <p className="text-white font-semibold text-lg">Account created!</p>
              <p className="text-gray-400 text-sm mt-2">
                Check your email to confirm your address, then sign in.
              </p>
              <button
                onClick={() => { setTab('login'); setSignupDone(false) }}
                className="btn-primary mt-5 w-full"
              >
                Go to Sign In →
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-700 mt-6">
          Built by Shahzeb Rahman © 2026
        </p>
      </div>
    </div>
  )
}
