import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { secureStorage } from './secureStorage'

// Resolve connection config: EAS-injected env first, then app.json `extra`
// fallback so a built APK always has a valid Supabase connection even if the
// env injection path changes. The anon key is public-safe (RLS enforces access).
const extra = (Constants.expoConfig?.extra ?? (Constants as any).manifest?.extra ?? {}) as {
  supabaseUrl?: string
  supabaseAnonKey?: string
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? ''

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaces misconfiguration loudly in dev/logs instead of failing silently.
  if (__DEV__) console.error('[TyrePulse] Missing Supabase config - set EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY or app.json extra.')
}

/** Give up on a stalled request instead of hanging a screen forever.
 *
 *  React Native's fetch has NO default timeout, so on a half-dead cell link (the
 *  normal case in a yard) a request could sit open for minutes and every screen
 *  waiting on it appeared frozen with no error and no retry. A bounded timeout
 *  turns that into an honest, retryable failure.
 *
 *  Uploads get a much longer budget: a photo on a weak link is legitimately slow
 *  and must not be cut off mid-transfer. Detected by method, since Supabase
 *  Storage uploads are POST/PUT with a body while ordinary reads are GETs.
 */
const READ_TIMEOUT_MS = 12000
const UPLOAD_TIMEOUT_MS = 120000

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = String(init?.method || 'GET').toUpperCase()
  const isUpload = method !== 'GET' && method !== 'HEAD' && init?.body != null
  const budget = isUpload ? UPLOAD_TIMEOUT_MS : READ_TIMEOUT_MS

  // Respect a caller's own AbortSignal (e.g. a screen unmounting) as well as ours.
  const controller = new AbortController()
  const callerSignal = init?.signal
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const timer = setTimeout(() => controller.abort(), budget)
  return fetch(input as RequestInfo, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: timeoutFetch },
})
