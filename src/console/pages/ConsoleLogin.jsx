import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff, AlertTriangle, Lock } from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'

export default function ConsoleLogin() {
  const { signIn } = useConsoleAuth()
  const navigate   = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setLoading(true); setError(null)
    const { error: err } = await signIn(email.trim().toLowerCase(), password)
    if (err) { setError(err.message); setLoading(false) }
    else navigate('/console', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      {/* Background grid */}
      <div className="fixed inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(#f97316 1px, transparent 1px), linear-gradient(90deg, #f97316 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="w-full max-w-md relative z-10">
        {/* Lock icon */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', boxShadow: '0 0 40px rgba(249,115,22,0.15)' }}>
            <Shield size={30} className="text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">System Console</h1>
          <p className="text-sm text-gray-500 mt-1">Restricted to system administrators only</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/80 backdrop-blur p-8 shadow-2xl">
          <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg bg-orange-950/40 border border-orange-800/30">
            <AlertTriangle size={14} className="text-orange-400 flex-shrink-0" />
            <p className="text-xs text-orange-300">This area is not accessible to regular users. All access is logged.</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/50 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null) }}
                placeholder="admin@tyrepulse.com"
                className="w-full h-11 bg-gray-800/80 border border-gray-700 rounded-xl px-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                autoComplete="username"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null) }}
                  placeholder="••••••••••"
                  className="w-full h-11 bg-gray-800/80 border border-gray-700 rounded-xl px-4 pr-11 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-11 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: loading ? 'rgba(249,115,22,0.4)' : 'linear-gradient(135deg, #ea580c, #f97316)', boxShadow: loading ? 'none' : '0 4px 20px rgba(249,115,22,0.35)' }}>
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying…</>
              ) : (
                <><Lock size={15} /> Enter Console</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">
          TyrePulse System Console · All sessions are recorded
        </p>
      </div>
    </div>
  )
}
