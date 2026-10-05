import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2, X } from 'lucide-react'
import { toUserMessage } from '../lib/safeError'

const LEN = 6

/**
 * Second step of sign-in. Six digit boxes that advance as you type, accept a
 * pasted code, submit by themselves when full, and shake + clear on a wrong
 * code. A backup code is one field instead. Styled in the sign-in page's
 * asphalt and signal-yellow system, in both themes.
 */
export default function TwoFactorChallenge({ open, factorId, onSuccess, onCancel }) {
  const [digits, setDigits]         = useState(() => Array(LEN).fill(''))
  const [verifying, setVerifying]   = useState(false)
  const [error, setError]           = useState('')
  const [shake, setShake]           = useState(0)
  const [useBackup, setUseBackup]   = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const boxes                       = useRef([])
  const backupRef                   = useRef(null)
  const dialogRef                   = useRef(null)

  useEffect(() => {
    if (!open) return
    setDigits(Array(LEN).fill('')); setError(''); setUseBackup(false); setBackupCode('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => (useBackup ? backupRef.current : boxes.current[0])?.focus(), 60)
    return () => clearTimeout(id)
  }, [open, useBackup])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !verifying) onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, verifying, onCancel])

  async function verify(codeValue) {
    if (!factorId || verifying) return
    setVerifying(true)
    setError('')
    try {
      const { data: challengeData, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId, challengeId: challengeData.id, code: codeValue.trim(),
      })
      if (vErr) throw vErr
      onSuccess?.()
    } catch (err) {
      setError(toUserMessage(err, 'That code did not work. Check your authenticator app and try again.'))
      setShake(n => n + 1)
      setDigits(Array(LEN).fill(''))
      setBackupCode('')
      setTimeout(() => (useBackup ? backupRef.current : boxes.current[0])?.focus(), 0)
    } finally {
      setVerifying(false)
    }
  }

  function fill(from, text) {
    const clean = text.replace(/\D/g, '')
    if (!clean) return
    const next = [...digits]
    let i = from
    for (const ch of clean) { if (i >= LEN) break; next[i++] = ch }
    setDigits(next)
    if (error) setError('')
    const code = next.join('')
    if (code.length === LEN) verify(code)
    else boxes.current[Math.min(i, LEN - 1)]?.focus()
  }

  function onBoxChange(i, e) {
    const v = e.target.value
    if (!v) { const next = [...digits]; next[i] = ''; setDigits(next); return }
    // A pasted or autofilled code arrives as several characters at once.
    if (v.replace(/\D/g, '').length > 2) { fill(i, v); return }
    fill(i, v.slice(-1) === digits[i] ? v.slice(0, 1) : v.slice(-1))
  }

  function onBoxKey(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      const next = [...digits]; next[i - 1] = ''; setDigits(next); boxes.current[i - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus()
    else if (e.key === 'ArrowRight' && i < LEN - 1) boxes.current[i + 1]?.focus()
  }

  if (!open) return null
  const code = digits.join('')

  return (
    <div className="tfa-root">
      <style>{TFA_CSS}</style>
      <div className="tfa-backdrop" onClick={() => !verifying && onCancel?.()} />
      <div className="tfa-wrap">
        <div ref={dialogRef} className="tfa-dialog" role="dialog" aria-modal="true" aria-labelledby="tfa-title" aria-describedby="tfa-desc">
          <button type="button" className="tfa-close" onClick={onCancel} aria-label="Cancel and go back to sign in" disabled={verifying}>
            <X size={18} />
          </button>
          <span className="tfa-bar" aria-hidden="true" />
          <h2 id="tfa-title" className="tfa-title">Check your authenticator</h2>
          <p id="tfa-desc" className="tfa-sub">
            {useBackup
              ? 'Enter one of the backup codes you saved when you turned on two-step sign-in.'
              : 'Enter the 6-digit code shown in your authenticator app for Tyre Pulse.'}
          </p>

          {!useBackup ? (
            <div key={shake} className={`tfa-digits${shake ? ' tfa-shake' : ''}`} role="group" aria-label="6-digit code">
              {digits.map((d, i) => (
                <input key={i} ref={el => { boxes.current[i] = el }}
                  className="tfa-box" data-filled={d ? 'true' : undefined} data-invalid={error ? 'true' : undefined}
                  type="text" inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={LEN} value={d} disabled={verifying}
                  aria-label={`Digit ${i + 1} of ${LEN}`} aria-invalid={error ? true : undefined}
                  onChange={e => onBoxChange(i, e)}
                  onKeyDown={e => onBoxKey(i, e)}
                  onPaste={e => { e.preventDefault(); fill(i, e.clipboardData.getData('text')) }}
                  onFocus={e => e.target.select()}
                />
              ))}
            </div>
          ) : (
            <div key={shake} className={shake ? 'tfa-shake' : undefined}>
              <label htmlFor="tfa-backup" className="tfa-label">Backup code</label>
              <input id="tfa-backup" ref={backupRef} className="tfa-backup" data-invalid={error ? 'true' : undefined}
                type="text" value={backupCode} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false}
                disabled={verifying} aria-invalid={error ? true : undefined}
                onChange={e => { setBackupCode(e.target.value.toUpperCase()); if (error) setError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && backupCode.trim()) verify(backupCode) }}
              />
            </div>
          )}

          <p className="tfa-error" role="alert">{error}</p>

          <button type="button" className="tfa-primary"
            disabled={verifying || (useBackup ? !backupCode.trim() : code.length !== LEN)}
            onClick={() => verify(useBackup ? backupCode : code)}>
            {verifying && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {verifying ? 'Checking code' : 'Verify and sign in'}
          </button>

          <button type="button" className="tfa-link"
            onClick={() => { setUseBackup(v => !v); setDigits(Array(LEN).fill('')); setBackupCode(''); setError('') }}>
            {useBackup ? 'Use the authenticator app instead' : 'Lost your phone? Use a backup code'}
          </button>
        </div>
      </div>
    </div>
  )
}

const TFA_CSS = `
.tfa-root {
  --tfa-bg: #1b1b19; --tfa-text: #f4f4f0; --tfa-dim: #c9c9c2; --tfa-box: #232320;
  --tfa-border: #3d3d38; --tfa-focus: #ffc629; --tfa-danger: #f97066; --tfa-link: #ffc629;
  --tfa-ease: cubic-bezier(0.23, 1, 0.32, 1);
  position: fixed; inset: 0; z-index: 60; font-family: 'Inter', system-ui, sans-serif;
}
html.light .tfa-root {
  --tfa-bg: #ffffff; --tfa-text: #161616; --tfa-dim: #56564f; --tfa-box: #ffffff;
  --tfa-border: #d3d3cb; --tfa-focus: #161616; --tfa-danger: #b42318; --tfa-link: #8a5a00;
}
.tfa-backdrop { position: absolute; inset: 0; background: rgba(10,10,10,0.62); backdrop-filter: blur(4px); animation: tfa-fade 200ms ease-out both; }
.tfa-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; pointer-events: none; }
.tfa-dialog {
  pointer-events: auto; position: relative; width: 100%; max-width: 420px;
  background: var(--tfa-bg); color: var(--tfa-text); border-radius: 14px; padding: 32px 28px 24px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.45);
  animation: tfa-in 260ms var(--tfa-ease) both;
}
.tfa-close { position: absolute; top: 12px; inset-inline-end: 12px; width: 44px; height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--tfa-dim); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 160ms ease, color 160ms ease; }
.tfa-close:hover { color: var(--tfa-text); background: rgba(127,127,127,0.12); }
.tfa-bar { display: block; width: 40px; height: 5px; background: #ffc629; margin-bottom: 18px; }
.tfa-title { margin: 0; font-family: 'Archivo', 'Inter', system-ui, sans-serif; font-size: 24px; font-weight: 800; letter-spacing: -0.03em; }
.tfa-sub { margin: 8px 0 24px; font-size: 14px; line-height: 1.55; color: var(--tfa-dim); max-width: 34ch; }
.tfa-digits { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; direction: ltr; }
.tfa-digits .tfa-box:nth-child(3) { margin-inline-end: 8px; }
.tfa-box {
  width: 100%; min-width: 0; height: 58px; border-radius: 10px; border: 1.5px solid var(--tfa-border);
  background: var(--tfa-box); color: var(--tfa-text); text-align: center; font-size: 26px; font-weight: 700;
  font-variant-numeric: tabular-nums; outline: none; caret-color: var(--tfa-focus);
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms var(--tfa-ease);
}
.tfa-box:focus { border-color: var(--tfa-focus); box-shadow: 0 0 0 4px rgba(255,198,41,0.35); }
.tfa-box[data-filled] { transform: translateY(-1px); }
.tfa-box[data-invalid], .tfa-backup[data-invalid] { border-color: var(--tfa-danger); }
.tfa-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 7px; }
.tfa-backup { width: 100%; min-height: 50px; border-radius: 10px; border: 1.5px solid var(--tfa-border); background: var(--tfa-box); color: var(--tfa-text); text-align: center; font-size: 18px; letter-spacing: 0.18em; font-weight: 600; outline: none; }
.tfa-backup:focus { border-color: var(--tfa-focus); box-shadow: 0 0 0 4px rgba(255,198,41,0.35); }
.tfa-error { min-height: 20px; margin: 10px 0 6px; font-size: 13px; line-height: 1.45; color: var(--tfa-danger); }
.tfa-error:empty { min-height: 8px; }
.tfa-primary { width: 100%; min-height: 50px; border: 0; border-radius: 8px; background: #ffc629; color: #161616; font-size: 15px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: background-color 160ms ease, transform 140ms var(--tfa-ease); }
.tfa-primary:active:not(:disabled) { transform: scale(0.98); }
.tfa-primary:disabled { opacity: 0.5; cursor: not-allowed; }
@media (hover: hover) and (pointer: fine) { .tfa-primary:hover:not(:disabled) { background: #ffd451; } }
.tfa-link { display: block; width: 100%; min-height: 44px; margin-top: 8px; border: 0; background: none; color: var(--tfa-link); font-size: 13px; font-weight: 700; cursor: pointer; }
.tfa-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.tfa-root button:focus-visible { outline: 3px solid var(--tfa-focus); outline-offset: 2px; }
.tfa-shake { animation: tfa-shake 380ms var(--tfa-ease); }
@keyframes tfa-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes tfa-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tfa-shake { 0%,100% { transform: none; } 20% { transform: translateX(-7px); } 45% { transform: translateX(6px); } 70% { transform: translateX(-3px); } }
@media (max-width: 380px) { .tfa-dialog { padding: 28px 18px 20px; } .tfa-digits { gap: 6px; } .tfa-box { height: 52px; font-size: 22px; } }
@media (prefers-reduced-motion: reduce) {
  .tfa-dialog { animation: tfa-fade 200ms ease both; }
  .tfa-shake, .tfa-box[data-filled] { animation: none; transform: none; }
}
`
