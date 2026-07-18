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
    // eslint-disable-next-line no-console
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
// A Console opened via the in-app <Link to="/console"> (client-side nav, no
// reload) keeps the tab's main-app session, so a signed-in super admin still
// reaches it seamlessly; only a separately-opened Console tab gets its own login.
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
    // keepalive keeps connections alive across page visibility changes.
    fetch: (url, options = {}) => fetch(url, { ...options, keepalive: true }),
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})
