import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const [tab, setTab]         = useState('login')   // 'login' | 'signup'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
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

    // Create profile record
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
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <span className="text-5xl">🔄</span>
          <h1 className="text-3xl font-bold text-white mt-4">TyrePulse</h1>
          <p className="text-gray-400 mt-2">Tyre Intelligence Platform</p>
        </div>

        <div className="card">
          {/* Tabs */}
          <div className="flex border-b border-gray-800 mb-6 -mt-1">
            {[['login', 'Sign In'], ['signup', 'Create Account']].map(([val, label]) => (
              <button key={val} onClick={() => { setTab(val); setError(''); setSignupDone(false) }}
                className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === val ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
          )}

          {/* ── Login ─────────────────────────────────────────────────────── */}
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
              <button type="submit" disabled={loading} className="btn-primary w-full mt-2 disabled:opacity-50">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* ── Sign Up ───────────────────────────────────────────────────── */}
          {tab === 'signup' && !signupDone && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" placeholder="Jane Smith"
                    value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="label">Username *</label>
                  <input className="input" placeholder="jsmith"
                    value={username} onChange={e => setUsername(e.target.value)} required />
                </div>
              </div>
              <div>
                <label className="label">Email address *</label>
                <input type="email" className="input" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
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
              <p className="text-xs text-gray-500">New accounts start with Reporter role. An admin can promote your role after sign-up.</p>
              <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
          )}

          {/* ── Signup success ────────────────────────────────────────────── */}
          {tab === 'signup' && signupDone && (
            <div className="text-center py-4">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-white font-semibold">Account created!</p>
              <p className="text-gray-400 text-sm mt-2">Check your email to confirm your address, then sign in.</p>
              <button onClick={() => { setTab('login'); setSignupDone(false) }} className="btn-primary mt-4 w-full">
                Go to Sign In
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">Built by Shahzeb Rahman © 2026</p>
      </div>
    </div>
  )
}
