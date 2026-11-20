/**
 * CaptchaBridge - PUBLIC page (no login) at /captcha-bridge.
 *
 * The installed Expo app 1.6.0 has no in-app web view, so when Supabase CAPTCHA
 * protection is on it opens this page in the phone's browser. The person solves the
 * Cloudflare Turnstile check here and taps "Return to Tyre Pulse", which opens the app
 * with the single-use token. See src/lib/captchaBridge.js for the security rules.
 * No password or account detail ever touches this page.
 */
import { useMemo, useRef, useState } from 'react'
import TurnstileWidget, { captchaEnabled } from '../components/auth/TurnstileWidget'
import { readBridgeParams, buildReturnLink, BRIDGE_TEXT } from '../lib/captchaBridge'

export default function CaptchaBridge() {
  const { state, lang } = useMemo(() => readBridgeParams(window.location.search), [])
  const t = BRIDGE_TEXT[lang]
  const [token, setToken] = useState(null)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const link = token ? buildReturnLink(state, token) : null

  let body
  if (!state) body = <p role="alert" style={S.note}>{t.invalid}</p>
  else if (!captchaEnabled()) body = <p role="status" style={S.note}>{t.off}</p>
  else {
    body = (
      <>
        <p style={S.lead}>{t.lead}</p>
        <TurnstileWidget ref={ref} onToken={(v) => { setToken(v); if (v) setError('') }} onError={setError} />
        {!token && !error && <p aria-live="polite" style={S.muted}>{t.loading}</p>}
        {error && <p role="alert" style={S.error}>{error}</p>}
        {link && <a href={link} style={S.button} rel="noreferrer">{t.back}</a>}
      </>
    )
  }
  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} style={S.page}>
      <div style={S.card}>
        <h1 style={S.h1}>{t.title}</h1>
        {body}
      </div>
    </main>
  )
}

const S = {
  page: { minHeight: '100vh', background: '#f6f7f9', color: '#161616', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'system-ui, sans-serif' },
  card: { width: '100%', maxWidth: 420, background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,.08)', display: 'grid', gap: 16 },
  h1: { fontSize: 22, margin: 0 },
  lead: { margin: 0, lineHeight: 1.5 },
  note: { margin: 0, lineHeight: 1.5 },
  muted: { margin: 0, color: '#555' },
  error: { margin: 0, color: '#b42318' },
  button: { display: 'block', textAlign: 'center', background: '#15803d', color: '#fff', padding: '14px 16px', minHeight: 48, borderRadius: 10, fontWeight: 600, textDecoration: 'none', fontSize: 17 },
}
