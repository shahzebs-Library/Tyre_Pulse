import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

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
    headers: { 'x-app-name': 'tyrepulse' },
    // keepalive keeps connections alive across page visibility changes
    fetch: (url, options = {}) => fetch(url, { ...options, keepalive: true }),
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})
