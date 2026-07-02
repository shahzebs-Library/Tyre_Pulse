import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff, AlertTriangle, Lock, Smartphone, ChevronLeft } from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'

// step: 'credentials' | 'totp'
export default function ConsoleLogin() {
  const { signIn, verifyMfa } = useConsoleAuth()
  const navigate = useNavigate()

  const [step, setStep]           = useState('credentials')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  // TOTP step state
  const [totpCode, setTotpCode]   = useState(['', '', '', '', '', ''])
  const [factorId, setFactorId]   = useState(null)
  const [challengeId, setChallengeId] = useState(null)
  const inputRefs = useRef([])

  // Auto-focus first TOTP input when step changes
  useEffect(() => {
    if (step === 'totp') {
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, [step])

  async function handleCredentials(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setLoading(true); setError(null)

    const { error: err, mfaRequired, factorId: fid, challengeId: cid } = await signIn(
      email.trim().toLowerCase(), password
    )

    if (err) {
      setError(err.message); setLoading(false); return
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

  async function handleTotp(e) {
    e?.preventDefault()
    const code = totpCode.join('')
    if (code.length !== 6) { setError('Enter the full 6-digit code.'); return }
    setLoading(true); setError(null)

    const { error: err } = await verifyMfa(factorId, challengeId, code)
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
      const digits = value.split('')
      setTotpCode(digits)
      inputRefs.current[5]?.focus()
      return
    }
    if (!/^\d*$/.test(value)) return
    const next = [...totpCode]
    next[index] = value.slice(-1)
    setTotpCode(next)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
    // auto-submit when all 6 digits entered
    if (next.every(d => d !== '') && next.join('').length === 6) {
      setTimeout(() => handleTotp(), 50)
    }
  }

  function handleTotpKeyDown(index, e) {
    if (e.key === 'Backspace' && !totpCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus()
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      {/* Background grid */}
      <div className="fixed inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(#f97316 1px, transparent 1px), linear-gradient(90deg, #f97316 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="w-full max-w-md relative z-10">
        {/* Icon + title */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-all"
            style={{ background: step === 'totp' ? 'rgba(59,130,246,0.12)' : 'rgba(249,115,22,0.12)', border: `1px solid ${step === 'totp' ? 'rgba(59,130,246,0.3)' : 'rgba(249,115,22,0.3)'}`, boxShadow: `0 0 40px ${step === 'totp' ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)'}` }}>
            {step === 'totp'
              ? <Smartphone size={30} className="text-blue-400" />
              : <Shield size={30} className="text-orange-400" />
            }
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {step === 'totp' ? 'Two-Factor Authentication' : 'System Console'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {step === 'totp'
              ? 'Enter the 6-digit code from your authenticator app'
              : 'Restricted to system administrators only'
            }
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/80 backdrop-blur p-8 shadow-2xl">

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <StepDot active={step === 'credentials'} done={step === 'totp'} label="1" />
            <div className={`flex-1 h-px max-w-12 transition-colors ${step === 'totp' ? 'bg-orange-500' : 'bg-gray-700'}`} />
            <StepDot active={step === 'totp'} done={false} label="2" />
          </div>

          {step === 'credentials' && (
            <>
              <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg bg-orange-950/40 border border-orange-800/30">
                <AlertTriangle size={14} className="text-orange-400 flex-shrink-0" />
                <p className="text-xs text-orange-300">This area is not accessible to regular users. All access is logged.</p>
              </div>

              {error && <ErrBox msg={error} />}

              <form onSubmit={handleCredentials} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Email</label>
                  <input type="email" value={email}
                    onChange={e => { setEmail(e.target.value); setError(null) }}
                    placeholder="admin@tyrepulse.com"
                    className="w-full h-11 bg-gray-800/80 border border-gray-700 rounded-xl px-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                    autoComplete="username" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Password</label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} value={password}
                      onChange={e => { setPassword(e.target.value); setError(null) }}
                      placeholder="••••••••••"
                      className="w-full h-11 bg-gray-800/80 border border-gray-700 rounded-xl px-4 pr-11 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                      autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPass(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full h-11 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: loading ? 'rgba(249,115,22,0.4)' : 'linear-gradient(135deg, #ea580c, #f97316)', boxShadow: loading ? 'none' : '0 4px 20px rgba(249,115,22,0.35)' }}>
                  {loading
                    ? <><Spinner /> Verifying...</>
                    : <><Lock size={15} /> Enter Console</>
                  }
                </button>
              </form>
            </>
          )}

          {step === 'totp' && (
            <>
              <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg bg-blue-950/40 border border-blue-800/30">
                <Smartphone size={14} className="text-blue-400 flex-shrink-0" />
                <p className="text-xs text-blue-300">Open your authenticator app and enter the code for TyrePulse Console.</p>
              </div>

              {error && <ErrBox msg={error} />}

              <form onSubmit={handleTotp} className="space-y-6">
                {/* 6-digit input boxes */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 text-center">Authentication Code</label>
                  <div className="flex justify-center gap-2">
                    {totpCode.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => inputRefs.current[i] = el}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={digit}
                        onChange={e => handleTotpInput(i, e.target.value)}
                        onKeyDown={e => handleTotpKeyDown(i, e)}
                        onPaste={e => {
                          e.preventDefault()
                          handleTotpInput(i, e.clipboardData.getData('text'))
                        }}
                        className={`w-11 h-14 text-center text-xl font-bold rounded-xl border transition-all focus:outline-none ${
                          digit
                            ? 'bg-gray-700 border-orange-500 text-white'
                            : 'bg-gray-800/80 border-gray-700 text-white focus:border-orange-500'
                        }`}
                        style={{ caretColor: 'transparent' }}
                      />
                    ))}
                  </div>
                  <p className="text-center text-[10px] text-gray-600 mt-2">Code refreshes every 30 seconds</p>
                </div>

                <button type="submit" disabled={loading || totpCode.join('').length !== 6}
                  className="w-full h-11 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', boxShadow: '0 4px 20px rgba(59,130,246,0.3)' }}>
                  {loading ? <><Spinner /> Verifying...</> : <><Smartphone size={15} /> Verify Code</>}
                </button>
              </form>

              <button onClick={() => { setStep('credentials'); setError(null); setTotpCode(['','','','','','']) }}
                className="w-full flex items-center justify-center gap-1.5 mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                <ChevronLeft size={12} /> Back to login
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">
          TyrePulse System Console · All sessions are recorded
        </p>
      </div>
    </div>
  )
}

function StepDot({ active, done, label }) {
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
      done ? 'bg-orange-500 text-white' :
      active ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50' :
      'bg-gray-800 text-gray-600 border border-gray-700'
    }`}>{label}</div>
  )
}

function ErrBox({ msg }) {
  return (
    <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/50 flex items-center gap-2">
      <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
      <p className="text-sm text-red-300">{msg}</p>
    </div>
  )
}

function Spinner() {
  return <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
}
