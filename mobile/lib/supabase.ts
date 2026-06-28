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
  console.error('[TyrePulse] Missing Supabase config — set EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY or app.json extra.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
