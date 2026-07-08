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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storageKey:         'tp_auth',
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
