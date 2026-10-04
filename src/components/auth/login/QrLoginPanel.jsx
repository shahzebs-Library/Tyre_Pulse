import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Smartphone } from 'lucide-react'
import { useLanguage } from '../../../contexts/LanguageContext'
import { startQrLogin, pollQrLogin, redeemQrLogin, qrPayload } from '../../../lib/api/loginShowcase'

const POLL_MS = 2000
const FALLBACK_TTL_MS = 2 * 60 * 1000
// Auto-refresh only a few times in a row; after that the reader presses the
// button, so an unattended tab does not mint codes forever.
const MAX_AUTO_REFRESH = 5

/**
 * "Login with QR Code". Shown only when qr_login_enabled is on. The browser
 * mints a short-lived code, polls its status while the tab is visible, and on
 * approval redeems it for a session. AuthContext's auth listener then picks the
 * session up and the page's existing post-login redirect runs.
 */
export default function QrLoginPanel({ onError }) {
  const { t } = useLanguage()
  const q = (k) => t(`auth.login.page.qr.${k}`)
  const [state, setState] = useState('loading') // loading | ready | approved | expired | denied | unavailable
  const [img, setImg] = useState('')
  const codeRef = useRef(null) // { id, secret, expiresAt }
  const busyRef = useRef(false)
  const autoRef = useRef(0)
  const aliveRef = useRef(true)

  const generate = useCallback(async (auto = false) => {
    if (auto) autoRef.current += 1
    else autoRef.current = 0
    setState('loading'); setImg('')
    const res = await startQrLogin()
    if (!aliveRef.current) return
    if (!res.ok) { codeRef.current = null; setState('unavailable'); return }
    try {
      const QR = await import('qrcode')
      const toDataURL = QR.toDataURL || QR.default?.toDataURL
      const url = await toDataURL(qrPayload(res.id, res.secret), { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      if (!aliveRef.current) return
      const expires = Date.parse(res.expiresAt)
      codeRef.current = { id: res.id, secret: res.secret, expiresAt: Number.isFinite(expires) ? expires : Date.now() + FALLBACK_TTL_MS }
      setImg(url)
      setState('ready')
    } catch {
      if (aliveRef.current) setState('unavailable')
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    generate(false)
    return () => { aliveRef.current = false }
  }, [generate])

  // Poll while a code is showing and the tab is visible; refresh at expiry.
  useEffect(() => {
    if (state !== 'ready') return undefined
    const tick = async () => {
      if (busyRef.current || document.hidden) return
      const code = codeRef.current
      if (!code) return
      if (Date.now() >= code.expiresAt) {
        if (autoRef.current < MAX_AUTO_REFRESH) generate(true)
        else setState('expired')
        return
      }
      busyRef.current = true
      try {
        const status = await pollQrLogin(code.id, code.secret)
        if (!aliveRef.current || codeRef.current !== code) return
        if (status === 'approved') {
          setState('approved')
          try {
            await redeemQrLogin(code.id, code.secret)
          } catch (err) {
            if (aliveRef.current) { setState('expired'); onError?.(err?.message) }
          }
        } else if (status === 'expired' || status === 'consumed') {
          setState('expired')
        } else if (status === 'denied') {
          setState('denied')
        } else if (status === 'invalid') {
          setState('expired')
        }
      } finally {
        busyRef.current = false
      }
    }
    const id = setInterval(tick, POLL_MS)
    const onVis = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [state, generate, onError])

  const message = state === 'expired' ? q('expired')
    : state === 'denied' ? q('denied')
    : state === 'unavailable' ? q('unavailable')
    : null

  return (
    <section className="tpl-qr" aria-labelledby="tpl-qr-title">
      <div className="tpl-qr-code">
        {state === 'ready' && img ? (
          <img src={img} alt={q('alt')} width="96" height="96" />
        ) : (
          <div className="tpl-qr-placeholder" aria-hidden={state === 'loading' ? undefined : true}>
            {state === 'loading' || state === 'approved'
              ? <Loader2 size={22} className="animate-spin" aria-label={state === 'loading' ? q('generating') : q('approved')} />
              : <RefreshCw size={22} aria-hidden="true" />}
          </div>
        )}
      </div>
      <div className="tpl-qr-text">
        <h2 id="tpl-qr-title">{q('title')}</h2>
        <p>{q('desc')}</p>
        <div aria-live="polite" className="tpl-qr-status">
          {state === 'approved' && <span>{q('approved')}</span>}
          {state === 'ready' && <span className="tpl-muted">{q('expiresIn')}</span>}
          {message && <span>{message}</span>}
        </div>
        {(state === 'expired' || state === 'denied' || state === 'unavailable') && (
          <button type="button" className="tpl-qr-btn" onClick={() => generate(false)}>
            <RefreshCw size={14} aria-hidden="true" />{q('regenerate')}
          </button>
        )}
      </div>
      <div className="tpl-qr-phone" aria-hidden="true">
        <Smartphone size={40} strokeWidth={1.25} />
      </div>
    </section>
  )
}
