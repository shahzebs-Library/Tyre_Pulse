import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [done, setDone]           = useState(false)
  const [ready, setReady]         = useState(false)

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the user arrives via the reset link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    // Also check existing session (user may already be in PASSWORD_RECOVERY state)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 6)  { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
    } else {
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="login-glow" />
      <div style={{
        position: 'fixed', top: '15%', left: '8%', width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(22,163,74,0.12) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none',
      }} />

      <div className="relative w-full max-w-md z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(22,163,74,0.22), rgba(120,113,108,0.12))',
              border: '1px solid rgba(22,163,74,0.35)',
              boxShadow: '0 0 32px rgba(22,163,74,0.22)',
            }}>
            <span style={{ fontSize: 38 }}>🔄</span>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">TyrePulse</h1>
          <p className="text-gray-400 mt-2 text-sm">Tyre Intelligence Platform</p>
        </div>

        <div className="login-card">
          {done ? (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <span className="text-3xl">✅</span>
              </div>
              <p className="text-white font-semibold text-lg">Password updated!</p>
              <p className="text-gray-400 text-sm mt-2">Redirecting you to sign in...</p>
            </div>
          ) : !ready ? (
            <div className="text-center py-8">
              <p className="text-gray-400 text-sm">Verifying reset link...</p>
              <p className="text-gray-600 text-xs mt-2">
                If nothing happens,{' '}
                <button onClick={() => navigate('/login')} className="text-green-400 hover:underline">
                  return to sign in
                </button>
                {' '}and request a new link.
              </p>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="mb-2">
                <h3 className="text-white font-semibold text-lg">Set a new password</h3>
                <p className="text-gray-400 text-sm mt-1">Choose a strong password for your account.</p>
              </div>

              {error && (
                <div className="rounded-lg px-4 py-3 text-sm text-red-300"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {error}
                </div>
              )}

              <div className="relative">
                <label className="label">New password</label>
                <input type={showPw ? 'text' : 'password'} className="input pr-10"
                  placeholder="Min. 6 characters"
                  value={password} onChange={e => setPassword(e.target.value)} required autoFocus />
                <button type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ top: '2.05rem' }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div className="relative">
                <label className="label">Confirm new password</label>
                <input type={showConfirm ? 'text' : 'password'} className="input pr-10"
                  placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
                <button type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 text-gray-400 hover:text-gray-200 transition-colors"
                  style={{ top: '2.05rem' }}>
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Updating...' : 'Set New Password →'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">
          Built by Shahzeb Rahman © 2026
        </p>
      </div>
    </div>
  )
}
