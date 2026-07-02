import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  X, Shield, Copy, Check, Download, Loader2, CheckCircle2, AlertCircle, KeyRound,
} from 'lucide-react'

/* ── helpers ─────────────────────────────────────────────────────────────── */
function generateBackupCodes() {
  return Array.from({ length: 8 }, () => {
    const buf = new Uint8Array(4)
    crypto.getRandomValues(buf)
    const num = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
    const upper = parseInt(num, 16).toString(36).toUpperCase().padStart(8, '0').slice(0, 8)
    return `${upper.slice(0, 4)}-${upper.slice(4, 8)}`
  })
}

/* ── overlay backdrop ─────────────────────────────────────────────────────── */
function Overlay({ onClick }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
      onClick={onClick}
    />
  )
}

/* ── step indicator ───────────────────────────────────────────────────────── */
function StepDot({ active, done, label, n }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 ${
        done  ? 'bg-green-600 border-green-500 text-white'
              : active ? 'bg-orange-500 border-orange-400 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-500'
      }`}>
        {done ? <Check size={14} /> : n}
      </div>
      <span className={`text-xs font-medium ${active ? 'text-orange-400' : done ? 'text-green-400' : 'text-gray-600'}`}>
        {label}
      </span>
    </div>
  )
}

/* ── main component ───────────────────────────────────────────────────────── */
export default function TwoFactorSetup({ open, onClose, onSuccess }) {
  const [step, setStep]               = useState(1)
  const [enrolling, setEnrolling]     = useState(false)
  const [enrollData, setEnrollData]   = useState(null) // { id, qr_code, secret }
  const [code, setCode]               = useState('')
  const [verifying, setVerifying]     = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [copied, setCopied]           = useState(false)
  const [backupCodes]                 = useState(() => generateBackupCodes())
  const codeRef                       = useRef(null)

  /* enroll on open */
  const startEnroll = useCallback(async () => {
    setEnrolling(true)
    setVerifyError('')
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    if (error) {
      setVerifyError(error.message)
      setEnrolling(false)
      return
    }
    setEnrollData({ id: data.id, qr_code: data.totp.qr_code, secret: data.totp.secret })
    setEnrolling(false)
  }, [])

  useEffect(() => {
    if (open) {
      setStep(1)
      setCode('')
      setVerifyError('')
      setEnrollData(null)
      startEnroll()
    }
  }, [open, startEnroll])

  /* auto-focus code input on step 2 */
  useEffect(() => {
    if (step === 2 && codeRef.current) {
      setTimeout(() => codeRef.current?.focus(), 120)
    }
  }, [step])

  async function handleVerify() {
    if (code.length !== 6) return
    setVerifying(true)
    setVerifyError('')
    try {
      const { data: challengeData, error: cErr } = await supabase.auth.mfa.challenge({ factorId: enrollData.id })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId:    enrollData.id,
        challengeId: challengeData.id,
        code,
      })
      if (vErr) throw vErr
      setStep(3)
      onSuccess?.()
    } catch (err) {
      setVerifyError(err.message ?? 'Invalid code, please try again')
      setCode('')
      codeRef.current?.focus()
    } finally {
      setVerifying(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleVerify()
  }

  function copySecret() {
    if (!enrollData?.secret) return
    navigator.clipboard.writeText(enrollData.secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadCodes() {
    const content = [
      'TyrePulse - Two-Factor Authentication Backup Codes',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      'Store these codes securely. Each code can only be used once.',
      '',
      ...backupCodes,
      '',
      'If you lose your authenticator app, use one of these codes to sign in.',
    ].join('\n')
    const blob = new URL.createObjectURL
      ? URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
      : null
    if (blob) {
      const a = document.createElement('a')
      a.href = blob
      a.download = 'tyrepulse-backup-codes.txt'
      a.click()
      URL.revokeObjectURL(blob)
    }
  }

  function downloadBackupCodes() {
    const content = [
      'TyrePulse - Two-Factor Authentication Backup Codes',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      'Store these codes securely. Each code can only be used once.',
      '',
      ...backupCodes,
      '',
      'If you lose your authenticator app, use one of these codes to sign in.',
    ].join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'tyrepulse-backup-codes.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  return (
    <>
      <Overlay onClick={step < 3 ? undefined : onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
          style={{ boxShadow: '0 0 0 1px rgba(249,115,22,0.08), 0 32px 80px rgba(0,0,0,0.8)' }}
        >
          {/* header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
                <Shield size={16} className="text-orange-400" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Two-Factor Authentication</p>
                <p className="text-gray-500 text-xs">TOTP Authenticator Setup</p>
              </div>
            </div>
            {step === 3 && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* step indicator */}
          <div className="flex items-center justify-center gap-0 px-6 pt-5 pb-1">
            <StepDot n={1} label="Scan"   active={step === 1} done={step > 1} />
            <div className={`flex-1 h-px mx-3 transition-colors ${step > 1 ? 'bg-green-600' : 'bg-gray-700'}`} />
            <StepDot n={2} label="Verify" active={step === 2} done={step > 2} />
            <div className={`flex-1 h-px mx-3 transition-colors ${step > 2 ? 'bg-green-600' : 'bg-gray-700'}`} />
            <StepDot n={3} label="Done"   active={step === 3} done={false} />
          </div>

          {/* ── STEP 1: Scan QR ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="px-6 pb-6 pt-4 space-y-5">
              <div>
                <p className="text-white font-medium text-sm mb-1">Scan QR Code</p>
                <p className="text-gray-400 text-xs leading-relaxed">
                  Open your authenticator app (Google Authenticator, Authy, 1Password) and scan the code below.
                </p>
              </div>

              {/* QR */}
              <div className="flex justify-center">
                {enrolling ? (
                  <div className="w-48 h-48 bg-gray-800 rounded-xl flex items-center justify-center border border-gray-700">
                    <Loader2 size={28} className="text-orange-400 animate-spin" />
                  </div>
                ) : enrollData?.qr_code ? (
                  <div className="p-3 bg-white rounded-xl">
                    <img src={enrollData.qr_code} alt="TOTP QR Code" className="w-44 h-44 block" />
                  </div>
                ) : (
                  <div className="w-48 h-48 bg-gray-800 rounded-xl flex flex-col items-center justify-center border border-red-800/50 gap-2">
                    <AlertCircle size={24} className="text-red-400" />
                    <p className="text-red-400 text-xs text-center px-3">{verifyError || 'Failed to load QR'}</p>
                    <button onClick={startEnroll} className="text-xs text-orange-400 hover:underline mt-1">Retry</button>
                  </div>
                )}
              </div>

              {/* Manual secret */}
              {enrollData?.secret && (
                <div>
                  <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider font-medium">Or enter manually</p>
                  <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
                    <code className="text-orange-300 text-xs font-mono tracking-widest flex-1 break-all select-all">
                      {enrollData.secret}
                    </code>
                    <button
                      onClick={copySecret}
                      className="shrink-0 w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                      title="Copy secret"
                    >
                      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              )}

              {verifyError && !enrollData && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-950/40 border border-red-800/40 rounded-lg text-red-400 text-xs">
                  <AlertCircle size={13} className="shrink-0" />
                  {verifyError}
                </div>
              )}

              <button
                onClick={() => setStep(2)}
                disabled={!enrollData || enrolling}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                Continue
              </button>
            </div>
          )}

          {/* ── STEP 2: Verify Code ──────────────────────────────────────── */}
          {step === 2 && (
            <div className="px-6 pb-6 pt-4 space-y-5">
              <div>
                <p className="text-white font-medium text-sm mb-1">Enter Verification Code</p>
                <p className="text-gray-400 text-xs leading-relaxed">
                  Enter the 6-digit code displayed in your authenticator app to confirm setup.
                </p>
              </div>

              <div>
                <input
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, '')
                    setCode(v)
                    if (verifyError) setVerifyError('')
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="000000"
                  className="w-full text-center text-3xl tracking-[0.5em] font-mono bg-gray-800 border border-gray-700 focus:border-orange-500 focus:outline-none rounded-xl py-4 text-white placeholder-gray-600 transition-colors"
                  style={{ letterSpacing: '0.45em' }}
                  autoComplete="one-time-code"
                />
                {verifyError && (
                  <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-red-950/40 border border-red-800/40 rounded-lg text-red-400 text-xs">
                    <AlertCircle size={13} className="shrink-0" />
                    {verifyError}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep(1); setCode(''); setVerifyError('') }}
                  className="flex-1 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-sm transition-colors border border-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={handleVerify}
                  disabled={code.length !== 6 || verifying}
                  className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {verifying ? <Loader2 size={15} className="animate-spin" /> : <Shield size={15} />}
                  {verifying ? 'Verifying...' : 'Verify & Enable'}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Success ──────────────────────────────────────────── */}
          {step === 3 && (
            <div className="px-6 pb-6 pt-4 space-y-5">
              {/* success banner */}
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-green-600/15 border border-green-500/30 flex items-center justify-center">
                    <CheckCircle2 size={32} className="text-green-400" />
                  </div>
                  <div className="absolute -inset-2 rounded-full border border-green-500/20 animate-ping" style={{ animationDuration: '2s' }} />
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold text-base">2FA is now enabled</p>
                  <p className="text-gray-400 text-xs mt-1">Your account is protected with two-factor authentication</p>
                </div>
              </div>

              {/* backup codes */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <KeyRound size={14} className="text-orange-400" />
                  <p className="text-white text-sm font-semibold">Backup Codes</p>
                  <span className="text-xs text-gray-500 ml-auto">Save these now</span>
                </div>
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map(c => (
                      <code key={c} className="text-xs font-mono text-orange-300 tracking-widest bg-gray-900/60 px-3 py-1.5 rounded-lg text-center">
                        {c}
                      </code>
                    ))}
                  </div>
                  <p className="text-gray-600 text-xs mt-3 text-center leading-relaxed">
                    Each code can be used once if you lose access to your authenticator app.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={downloadBackupCodes}
                  className="flex-1 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Download size={14} />
                  Download Codes
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
