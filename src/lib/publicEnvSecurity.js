// Shared by Vite before bundling and the browser client. Never include values
// in diagnostics: even a rejected configuration may contain real credentials.
const FORBIDDEN = new Set([
  'VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_SERVICE_ROLE_KEY',
  'VITE_ANTHROPIC_API_KEY', 'VITE_OPENAI_API_KEY', 'VITE_RESEND_API_KEY',
  'VITE_SMTP_PASSWORD', 'VITE_DATABASE_URL', 'VITE_SUPABASE_JWT_SECRET',
])

function isPrivileged(value) {
  value = value.trim()
  if (value.startsWith('sb_secret_') || value.includes('service_role')) return true
  const parts = value.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.role === 'string' && payload.role !== 'anon'
  } catch {
    return false
  }
}

export function assertPublicEnv(env) {
  const unsafe = Object.entries(env).filter(([key, value]) =>
    key.startsWith('VITE_') && typeof value === 'string' && value.length > 0 &&
    (FORBIDDEN.has(key) || isPrivileged(value)),
  ).map(([key]) => key)
  if (unsafe.length) {
    throw new Error(`Privileged credentials cannot be bundled: ${unsafe.join(', ')}`)
  }
}
