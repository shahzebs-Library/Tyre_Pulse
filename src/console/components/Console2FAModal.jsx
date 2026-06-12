/**
 * Console2FAModal
 * Handles TOTP enrollment, verification, and unenrollment for the super-admin.
 * Opened from the ConsoleLayout sidebar.
 */
import { useState, useEffect, useRef } from 'react'
import { Smartphone, Shield, CheckCircle, X, AlertTriangle, Copy, Eye, EyeOff } from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'

// step: 'status' | 'enroll_qr' | 'enroll_verify' | 'unenroll_confirm'
export default function Console2FAModal({ onClose }) {
  const { enrollMfa, confirmMfaEnrollment, unenrollMfa, listMfaFactors } = useConsoleAuth()

  const [step, setStep]           = useState('status')
  const [factors, setFactors]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [success, setSuccess]     = useState(null)

  // Enroll state
  const [enrollData, setEnrollData] = useState(null)   // { factorId, qrCode, secret, uri }
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied]         = useState(false)

  // Verify code
  const [code, setCode]   = useState(['', '', '', '', '', ''])
  const inputRefs         = useRef([])

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const f = await listMfaFactors()
    setFactors(f)
    setLoading(false)
  }

  async function startEnroll() {
    setError(null); setLoading(true)
    const result = await enrollMfa()
    setLoading(false)
    if (result.error) { setError(result.error.message); return }
    setEnrollData(result)
    setStep('enroll_qr')
  }

  async function handleVerify(e) {
    e?.preventDefault()
    const c = code.join('')
    if (c.length !== 6) { setError('Enter the full 6-digit code.'); return }
    setLoading(true); setError(null)
    const { error: err } = await confirmMfaEnrollment(enrollData.factorId, c)
    setLoading(false)
    if (err) {
      setError('Invalid code. Scan the QR code again and try a fresh code.')
      setCode(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
      return
    }
    setSuccess('Two-factor authentication is now active on your account.')
    await load()
    setStep('status')
  }

  async function handleUnenroll(factorId) {
    setLoading(true); setError(null)
    const { error: err } = await unenrollMfa(factorId)
    setLoading(false)
    if (err) { setError(err.message); return }
    setSuccess('2FA has been removed from your account.')
    await load()
    setStep('status')
  }

  function handleCodeInput(index, value) {
    if (value.length === 6 && /^\d{6}$/.test(value)) {
      setCode(value.split(''))
      inputRefs.current[5]?.focus()
      return
    }
    if (!/^\d*$/.test(value)) return
    const next = [...code]
    next[index] = value.slice(-1)
    setCode(next)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
    if (next.every(d => d !== '')) setTimeout(() => handleVerify(), 50)
  }

  function handleCodeKey(index, e) {
    if (e.key === 'Backspace' && !code[index] && index > 0) inputRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowLeft'  && index > 0) inputRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus()
  }

  function copySecret() {
    navigator.clipboard.writeText(enrollData?.secret ?? '').then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const verifiedFactors = factors.filter(f => f.status === 'verified')
  const has2FA = verifiedFactors.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-900/30 flex items-center justify-center">
              <Smartphone size={15} className="text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Two-Factor Authentication</p>
              <p className="text-[10px] text-gray-500">TOTP via Google Authenticator or Authy</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">

          {loading && step === 'status' ? (
            <div className="flex items-center justify-center h-24">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50 mb-4">
                  <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-950/50 border border-green-800/50 mb-4">
                  <CheckCircle size={13} className="text-green-400 flex-shrink-0" />
                  <p className="text-xs text-green-300">{success}</p>
                </div>
              )}

              {/* STATUS view */}
              {step === 'status' && (
                <div className="space-y-4">
                  {has2FA ? (
                    <>
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-green-900/20 border border-green-700/40">
                        <CheckCircle size={20} className="text-green-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-white">2FA is Active</p>
                          <p className="text-xs text-gray-400 mt-0.5">Your console login requires a TOTP code from your authenticator app.</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {verifiedFactors.map(f => (
                          <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/60 border border-gray-700">
                            <div className="flex items-center gap-2">
                              <Smartphone size={14} className="text-blue-400" />
                              <div>
                                <p className="text-xs font-semibold text-white">{f.friendly_name || 'Authenticator App'}</p>
                                <p className="text-[10px] text-gray-500">
                                  Added {new Date(f.created_at).toLocaleDateString()} · TOTP
                                </p>
                              </div>
                            </div>
                            <button onClick={() => { setStep('unenroll_confirm'); setError(null); setSuccess(null) }}
                              className="text-[10px] px-2.5 py-1 rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-700/40 transition-colors">
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-900/20 border border-yellow-700/40">
                        <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-white">2FA is not enabled</p>
                          <p className="text-xs text-gray-400 mt-0.5">Your console is protected by password only. Enable 2FA for stronger security.</p>
                        </div>
                      </div>
                      <ul className="space-y-1.5 text-xs text-gray-400">
                        <li className="flex items-center gap-2"><CheckCircle size={11} className="text-green-400" /> Works with Google Authenticator, Authy, 1Password, and any TOTP app</li>
                        <li className="flex items-center gap-2"><CheckCircle size={11} className="text-green-400" /> Required every login — protects even if password is compromised</li>
                        <li className="flex items-center gap-2"><CheckCircle size={11} className="text-green-400" /> 30-second rotating codes, no internet required</li>
                      </ul>
                    </>
                  )}
                </div>
              )}

              {/* ENROLL QR view */}
              {step === 'enroll_qr' && enrollData && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400">
                    Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then click <strong className="text-white">Next</strong>.
                  </p>
                  <div className="flex justify-center p-4 bg-white rounded-2xl">
                    <img src={enrollData.qrCode} alt="QR code" className="w-48 h-48" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Manual entry key (if camera unavailable)</p>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-800 border border-gray-700">
                      <code className="flex-1 text-xs font-mono text-gray-300 break-all select-all">
                        {showSecret ? enrollData.secret : '••••••••••••••••••••••••••••••••'}
                      </code>
                      <button onClick={() => setShowSecret(s => !s)} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                        {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button onClick={copySecret} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                        {copied ? <CheckCircle size={13} className="text-green-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ENROLL VERIFY view */}
              {step === 'enroll_verify' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400">
                    Enter the 6-digit code from your authenticator app to confirm the setup.
                  </p>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3 text-center">
                      Verification Code
                    </label>
                    <div className="flex justify-center gap-2">
                      {code.map((digit, i) => (
                        <input key={i} ref={el => inputRefs.current[i] = el}
                          type="text" inputMode="numeric" maxLength={6}
                          value={digit}
                          onChange={e => handleCodeInput(i, e.target.value)}
                          onKeyDown={e => handleCodeKey(i, e)}
                          onPaste={e => { e.preventDefault(); handleCodeInput(i, e.clipboardData.getData('text')) }}
                          className={`w-10 h-12 text-center text-lg font-bold rounded-xl border transition-all focus:outline-none ${
                            digit ? 'bg-gray-700 border-blue-500 text-white' : 'bg-gray-800/80 border-gray-700 text-white focus:border-blue-500'
                          }`}
                          style={{ caretColor: 'transparent' }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* UNENROLL CONFIRM */}
              {step === 'unenroll_confirm' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-red-900/20 border border-red-700/40">
                    <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-white">Remove 2FA?</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Your console will only be protected by password. This is less secure.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-800">
          {step === 'status' && !has2FA && (
            <>
              <button onClick={onClose}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
                Close
              </button>
              <button onClick={startEnroll} disabled={loading}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors"
                style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' }}>
                {loading ? 'Loading…' : 'Enable 2FA'}
              </button>
            </>
          )}
          {step === 'status' && has2FA && (
            <button onClick={onClose}
              className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
              Close
            </button>
          )}
          {step === 'enroll_qr' && (
            <>
              <button onClick={() => { setStep('status'); setEnrollData(null); setError(null) }}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => { setStep('enroll_verify'); setError(null); setCode(['','','','','','']) }}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' }}>
                I've scanned it → Next
              </button>
            </>
          )}
          {step === 'enroll_verify' && (
            <>
              <button onClick={() => { setStep('enroll_qr'); setError(null) }}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
                ← Back
              </button>
              <button onClick={handleVerify} disabled={loading || code.join('').length !== 6}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' }}>
                {loading ? 'Verifying…' : 'Confirm & Activate'}
              </button>
            </>
          )}
          {step === 'unenroll_confirm' && (
            <>
              <button onClick={() => { setStep('status'); setError(null) }}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleUnenroll(verifiedFactors[0]?.id)} disabled={loading}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-40 transition-colors">
                {loading ? 'Removing…' : 'Yes, Remove 2FA'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
