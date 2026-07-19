import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Shield, Loader2, AlertCircle, X, KeyRound } from 'lucide-react'
import { toUserMessage } from '../lib/safeError'

export default function TwoFactorChallenge({ open, factorId, onSuccess, onCancel }) {
  const [code, setCode]               = useState('')
  const [verifying, setVerifying]     = useState(false)
  const [error, setError]             = useState('')
  const [useBackup, setUseBackup]     = useState(false)
  const [backupCode, setBackupCode]   = useState('')
  const codeRef                       = useRef(null)
  const backupRef                     = useRef(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setError('')
      setUseBackup(false)
      setBackupCode('')
    }
  }, [open])

  useEffect(() => {
    if (open && !useBackup) {
      setTimeout(() => codeRef.current?.focus(), 120)
    }
  }, [open, useBackup])

  useEffect(() => {
    if (useBackup) {
      setTimeout(() => backupRef.current?.focus(), 80)
    }
  }, [useBackup])

  async function verify(codeValue) {
    if (!factorId) return
    setVerifying(true)
    setError('')
    try {
      const { data: challengeData, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: codeValue.trim(),
      })
      if (vErr) throw vErr
      onSuccess?.()
    } catch (err) {
      setError(toUserMessage(err, 'Invalid code. Please try again.'))
      setCode('')
      setBackupCode('')
      if (useBackup) backupRef.current?.focus()
      else codeRef.current?.focus()
    } finally {
      setVerifying(false)
    }
  }

  function handleCodeChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(v)
    if (error) setError('')
    if (v.length === 6) verify(v)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      if (useBackup) verify(backupCode)
      else if (code.length === 6) verify(code)
    }
  }

  if (!open) return null

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50" onClick={onCancel} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
          style={{ boxShadow: '0 0 0 1px rgba(249,115,22,0.1), 0 32px 80px rgba(0,0,0,0.85)' }}
        >
          {/* header */}
          <div className="relative px-6 pt-6 pb-0">
            <button
              onClick={onCancel}
              className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            >
              <X size={15} />
            </button>

            <div className="flex flex-col items-center gap-3 pb-5 border-b border-gray-800">
              <div className="w-14 h-14 rounded-2xl bg-orange-500/12 border border-orange-500/25 flex items-center justify-center"
                style={{ boxShadow: '0 0 30px rgba(249,115,22,0.15)' }}>
                <Shield size={26} className="text-orange-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-base">Two-Factor Authentication</p>
                <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                  {useBackup
                    ? 'Enter one of your backup codes'
                    : 'Enter the 6-digit code from your authenticator app'}
                </p>
              </div>
            </div>
          </div>

          {/* body */}
          <div className="px-6 py-5 space-y-4">
            {!useBackup ? (
              /* TOTP input */
              <div>
                <input
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={handleCodeChange}
                  onKeyDown={handleKeyDown}
                  placeholder="000 000"
                  className="w-full text-center bg-gray-800 border border-gray-700 focus:border-orange-500 focus:outline-none rounded-xl py-4 text-white placeholder-gray-600 transition-colors"
                  style={{ fontSize: 32, letterSpacing: '0.4em', fontFamily: 'monospace', fontWeight: 600 }}
                  autoComplete="one-time-code"
                  disabled={verifying}
                />
                {/* auto-submits on 6 digits - show subtle hint */}
                <p className="text-gray-600 text-xs text-center mt-2">Code submits automatically when complete</p>
              </div>
            ) : (
              /* backup code input */
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Backup Code
                </label>
                <input
                  ref={backupRef}
                  type="text"
                  value={backupCode}
                  onChange={e => { setBackupCode(e.target.value.toUpperCase()); if (error) setError('') }}
                  onKeyDown={handleKeyDown}
                  placeholder="XXXX-XXXX"
                  className="w-full text-center bg-gray-800 border border-gray-700 focus:border-orange-500 focus:outline-none rounded-xl py-3 text-white placeholder-gray-600 transition-colors font-mono tracking-widest text-lg"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={verifying}
                />
              </div>
            )}

            {/* error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-950/40 border border-red-800/40 rounded-xl text-red-400 text-sm">
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            {/* verify button (backup mode only - TOTP auto-verifies) */}
            {useBackup && (
              <button
                onClick={() => verify(backupCode)}
                disabled={!backupCode.trim() || verifying}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {verifying ? <Loader2 size={15} className="animate-spin" /> : <Shield size={15} />}
                {verifying ? 'Verifying...' : 'Verify Code'}
              </button>
            )}

            {/* manual verify button for TOTP when needed */}
            {!useBackup && (
              <button
                onClick={() => verify(code)}
                disabled={code.length !== 6 || verifying}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {verifying ? <Loader2 size={15} className="animate-spin" /> : <Shield size={15} />}
                {verifying ? 'Verifying...' : 'Verify'}
              </button>
            )}

            {/* toggle backup */}
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setUseBackup(v => !v); setCode(''); setBackupCode(''); setError('') }}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 transition-colors"
              >
                <KeyRound size={12} />
                {useBackup ? 'Use authenticator app instead' : 'Use a backup code'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
