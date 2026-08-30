const SYSTEMS = new Set(['sap', 'oracle', 'odoo', 'dynamics', 'sage', 'custom'])
const AUTH_TYPES = new Set(['api_key', 'bearer', 'basic', 'oauth2'])
const ENTITIES = new Set(['tyre', 'fleet', 'stock', 'workorder', 'supplier'])
const FREQUENCIES = new Set(['manual', 'hourly', 'daily', 'weekly'])
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export const ERP_RETRY_POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30000 })

function assertAllowed(value, allowed, field) {
  if (!allowed.has(value)) throw new Error(`Unsupported ERP ${field}.`)
  return value
}

/** Validate a non-secret connector config before it crosses a trust boundary. */
export function validateErpConfig(input = {}) {
  const rawUrl = String(input.base_url || '').trim()
  let url
  try { url = new URL(rawUrl) } catch { throw new Error('ERP base URL is invalid.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('ERP base URL must be an HTTPS origin without credentials or fragments.')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal' ||
    /^(127\.|10\.|169\.254\.|192\.168\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^\d+$/.test(host) ||
    host === '::1' || host === '[::1]' || /^\[?(fc|fd|fe8|fe9|fea|feb)/.test(host)
  ) throw new Error('ERP base URL must not target a local, private, or metadata address.')

  const entities = [...new Set(Array.isArray(input.entities) ? input.entities : [])]
  if (!entities.length || entities.some((entity) => !ENTITIES.has(entity))) {
    throw new Error('Select at least one supported ERP entity.')
  }
  const credentialRef = String(input.credential_ref || '').trim()
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(credentialRef)) {
    throw new Error('Credential reference must be a server secret name, not a credential value.')
  }

  return {
    system: assertAllowed(String(input.system || ''), SYSTEMS, 'system'),
    name: String(input.name || 'ERP').trim().slice(0, 80),
    base_url: `${url.origin}${url.pathname.replace(/\/$/, '')}`,
    auth_type: assertAllowed(String(input.auth_type || ''), AUTH_TYPES, 'authentication type'),
    credential_ref: credentialRef,
    entities,
    frequency: assertAllowed(String(input.frequency || ''), FREQUENCIES, 'frequency'),
    enabled: input.enabled === true,
  }
}

export function erpIdempotencyKey({ connectionId, entity, sourceId, sourceVersion = '' }) {
  for (const [field, value] of Object.entries({ connectionId, entity, sourceId })) {
    if (!String(value || '').trim()) throw new Error(`${field} is required for ERP idempotency.`)
  }
  return [connectionId, entity, sourceId, sourceVersion].map((v) => encodeURIComponent(String(v))).join(':')
}

export function classifyErpFailure(error) {
  const status = Number(error?.status || error?.response?.status || 0)
  const code = String(error?.code || '').toUpperCase()
  const retryable = RETRYABLE_STATUS.has(status) || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)
  return { retryable, status: status || null, code: code || null }
}

/** Exponential backoff with bounded jitter. Pass random for deterministic tests. */
export function erpRetryDelay(attempt, policy = ERP_RETRY_POLICY, random = Math.random) {
  const n = Math.max(1, Number(attempt) || 1)
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (n - 1)))
  return Math.floor(ceiling * (0.5 + Math.max(0, Math.min(1, random())) * 0.5))
}

export function shouldDeadLetter(error, attempt, policy = ERP_RETRY_POLICY) {
  return !classifyErpFailure(error).retryable || attempt >= policy.maxAttempts
}

export function erpFreshness(lastSuccessAt, now = Date.now(), staleAfterMs = 26 * 60 * 60 * 1000) {
  if (!lastSuccessAt) return { state: 'never', ageMs: null }
  const ageMs = Math.max(0, now - new Date(lastSuccessAt).getTime())
  return { state: ageMs > staleAfterMs ? 'stale' : 'fresh', ageMs }
}
