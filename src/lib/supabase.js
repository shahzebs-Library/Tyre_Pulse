import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Secret-exposure guard. VITE_* values are bundled into public client JS, so
// only the public Supabase URL + anon key may live there. Anything that looks
// like a privileged secret (service_role / AI / SMTP / storage keys) must stay
// server-side in Edge Function secrets - never in a VITE_ variable. This fails
// loudly in dev and warns in prod rather than silently shipping a leaked key.
;(() => {
  const FORBIDDEN = [
    'VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_SERVICE_ROLE_KEY',
    'VITE_ANTHROPIC_API_KEY', 'VITE_OPENAI_API_KEY', 'VITE_RESEND_API_KEY',
    'VITE_SMTP_PASSWORD', 'VITE_DATABASE_URL', 'VITE_SUPABASE_JWT_SECRET',
  ]
  const leaked = FORBIDDEN.filter((k) => {
    const v = import.meta.env[k]
    return typeof v === 'string' && v.length > 0
  })
  // A service_role JWT carries "role":"service_role"; catch it even if mis-named.
  if (typeof supabaseAnonKey === 'string' && supabaseAnonKey.includes('service_role')) {
    leaked.push('VITE_SUPABASE_ANON_KEY (contains a service_role token!)')
  }
  if (leaked.length > 0) {
    const msg = `[TyrePulse] SECURITY: privileged secret(s) exposed to the client bundle: ${leaked.join(', ')}. ` +
      'Move these to Supabase Edge Function secrets / server-side env and remove them from VITE_ variables.'
    if (import.meta.env.DEV) throw new Error(msg)
    console.error(msg)
  }
})()

// ── Auth-session partition by surface ────────────────────────────────────────
// The admin Console (/console) is a separate secure area and MUST NOT share its
// login session with the main app: a Console login in one browser tab must never
// authenticate a main-app tab (or vice versa). React Router renders EITHER the
// console route tree OR the main-app tree per tab (App.jsx: `/console/*` vs `*`),
// so the URL the tab BOOTED on uniquely identifies the surface. supabase-js only
// cross-tab-syncs sessions stored under its own `storageKey`, so giving each
// surface a distinct key yields two fully independent sessions across tabs.
// The console is ONLY served on its own surface: the in-app System Console
// entry opens a NEW tab (Layout.jsx), and a same-tab client-side navigation to
// /console renders an "open in secure tab" screen instead of the console
// (App.jsx ConsoleSurfaceGate) - so console entry ALWAYS goes through the
// console's own sign-in on the tab-local session, never the main-app session.
export const IS_CONSOLE_SURFACE =
  typeof window !== 'undefined' &&
  typeof window.location?.pathname === 'string' &&
  window.location.pathname.startsWith('/console')

export const AUTH_STORAGE_KEY = IS_CONSOLE_SURFACE ? 'tp_console_auth' : 'tp_auth'

// Console is a break-glass admin area: its session is TAB-LOCAL (sessionStorage)
// - it is never shared with any other tab (not even another console tab), and it
// is CLEARED the moment the tab closes, so an admin console can never be left
// silently authenticated. The main app keeps localStorage persistence (field
// users on phones/shared terminals rely on staying signed in; RLS + the AAL 2FA
// gate are their server-side boundary). sessionStorage satisfies the supabase
// storage interface (getItem/setItem/removeItem) and is tab-scoped by spec.
const AUTH_STORAGE =
  IS_CONSOLE_SURFACE && typeof window !== 'undefined' && window.sessionStorage
    ? window.sessionStorage
    : undefined // undefined -> supabase default (localStorage)

// A build shipped without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY gives the
// user a SILENT WHITE PAGE. Verified in a real browser: supabase-js throws
// "supabaseUrl is required." from createClient at MODULE LOAD, which is before
// React mounts, so no error boundary exists to catch it and #root stays empty
// with nothing on screen and nothing in the UI to explain it.
//
// The throw is still correct - carrying on with a broken client would fail later
// in a far more confusing place - but it must not be the only thing that
// happens. So say something first, straight into the DOM, since React is never
// going to run. Built with textContent rather than innerHTML: the text is all
// static today, and keeping it that way means this can never become an
// injection point if someone later interpolates a value into it.
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl ? 'VITE_SUPABASE_URL' : null,
    !supabaseAnonKey ? 'VITE_SUPABASE_ANON_KEY' : null,
  ].filter(Boolean).join(' and ')
  const message = `TyrePulse is not configured: ${missing} is missing from this build.`

  if (typeof document !== 'undefined') {
    const host = document.getElementById('root') || document.body
    if (host) {
      const panel = document.createElement('div')
      panel.setAttribute('role', 'alert')
      panel.style.cssText = 'max-width:34rem;margin:12vh auto;padding:2rem;'
        + 'font-family:system-ui,sans-serif;line-height:1.6;color:#0f172a;'
        + 'background:#fff;border:1px solid #e2e8f0;border-radius:12px'
      const title = document.createElement('h1')
      title.textContent = 'This app is not configured'
      title.style.cssText = 'margin:0 0 .75rem;font-size:1.25rem'
      const detail = document.createElement('p')
      detail.textContent = message
      detail.style.cssText = 'margin:0 0 .75rem'
      const hint = document.createElement('p')
      hint.textContent = 'Nobody can sign in until it is set. This is a deployment '
        + 'setting, not something you can fix from here - please tell whoever '
        + 'deployed the site.'
      hint.style.cssText = 'margin:0;color:#475569;font-size:.9rem'
      panel.append(title, detail, hint)
      host.append(panel)
    }
  }
  throw new Error(message)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storageKey:         AUTH_STORAGE_KEY,
    ...(AUTH_STORAGE ? { storage: AUTH_STORAGE } : {}),
  },
  db: {
    schema: 'public',
  },
  global: {
    // NOTE: do NOT add custom request headers here. supabase-js applies global
    // headers to EVERY request including Edge Function calls, which turns them
    // into non-safelisted CORS requests — any header the function's
    // Access-Control-Allow-Headers doesn't list makes the browser block the
    // whole call ("Request header field ... is not allowed"). A prior
    // 'x-app-name' header (read by nothing) caused exactly that on chat-ai.
    // keepalive is only safe for tiny, body-less requests. Browsers cap
    // keepalive request bodies, so applying it to bulk import POSTs can make
    // wide Excel uploads fail before they ever reach Supabase.
    fetch: (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase()
      const hasBody = options.body != null
      const canKeepAlive = !hasBody && (method === 'GET' || method === 'HEAD')
      return fetch(url, { ...options, ...(canKeepAlive ? { keepalive: true } : {}) })
    },
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})
