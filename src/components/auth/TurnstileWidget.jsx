/**
 * Cloudflare Turnstile CAPTCHA for the sign-in forms.
 *
 * Supabase Auth "CAPTCHA protection" refuses password, sign-up and SSO requests
 * that do not carry a captcha token. This widget produces that token.
 *
 * - The site key comes from VITE_TURNSTILE_SITE_KEY. When it is not set the
 *   widget renders nothing and reports `enabled: false`, so sign-in keeps
 *   working exactly as before while CAPTCHA is off in Supabase.
 * - A Turnstile token is single use. Callers must call `reset()` after every
 *   sign-in attempt, successful or not, or the next attempt is refused.
 * - The script is loaded once, on demand, only on screens that render it.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()
export const captchaEnabled = () => TURNSTILE_SITE_KEY.length > 0

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise = null

function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile failed to load')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/** Adds `captchaToken` to a supabase-js auth options object only when present. */
export function withCaptcha(options, token) {
  return token ? { ...(options || {}), captchaToken: token } : options
}

const TurnstileWidget = forwardRef(function TurnstileWidget(
  { onToken, onError, theme = 'auto', className = '' },
  ref,
) {
  const hostRef = useRef(null)
  const widgetRef = useRef(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current?.(null)
      if (widgetRef.current != null && window.turnstile) {
        try { window.turnstile.reset(widgetRef.current) } catch { /* widget gone */ }
      }
    },
  }), [])

  useEffect(() => {
    if (!captchaEnabled()) return undefined
    let cancelled = false
    loadScript()
      .then((ts) => {
        if (cancelled || !hostRef.current) return
        widgetRef.current = ts.render(hostRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme,
          appearance: 'always',
          callback: (token) => onTokenRef.current?.(token),
          'expired-callback': () => onTokenRef.current?.(null),
          'error-callback': () => {
            onTokenRef.current?.(null)
            onErrorRef.current?.('The security check could not load. Refresh the page and try again.')
          },
        })
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current?.('The security check could not load. Check your connection and refresh the page.')
      })
    return () => {
      cancelled = true
      // A token belongs to the widget that issued it; drop it on unmount.
      onTokenRef.current?.(null)
      if (widgetRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetRef.current) } catch { /* already removed */ }
      }
      widgetRef.current = null
    }
  }, [theme])

  if (!captchaEnabled()) return null
  return <div ref={hostRef} className={className} aria-label="Security check" />
})

export default TurnstileWidget
