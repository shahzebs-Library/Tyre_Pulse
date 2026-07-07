/**
 * webhooks.js — outbound webhook dispatcher (roadmap #25).
 *
 * Endpoint config lives in `app_settings` under key `webhook_endpoints`
 * (same non-secret JSON-blob pattern as erp.js / `erp_connection`):
 *   [{ id, url, events: ['workorder.created', ...] | ['*'], enabled,
 *      secret?, description, created_by, created_at }]
 *
 * dispatchEvent(event) POSTs `{ id, type, occurred_at, payload }` to every
 * enabled endpoint subscribed to the event type. Fire-and-forget: 5s timeout,
 * failures are a console.warn + monitoring breadcrumb — NEVER a thrown error
 * into the app.
 *
 * SECURITY:
 *   • https:// only — enforced at save time AND again at dispatch time (a row
 *     edited directly in the DB still can't target http/internal hosts).
 *   • Obvious internal/SSRF targets are blocked: localhost, 127.*, 10.*,
 *     172.16-31.*, 192.168.*, 169.254.*, 0.0.0.0, [::1], *.local, *.internal.
 *   • Optional HMAC-SHA256 signature (`X-TyrePulse-Signature`, hex) over the
 *     exact body via WebCrypto so receivers can verify authenticity. If
 *     crypto.subtle is unavailable the header is simply omitted.
 *
 * HONEST LIMITATION: this dispatcher runs in the browser, so delivery is
 * best-effort — receivers must allow CORS (or use a relay such as n8n, a
 * Supabase edge function, or any serverless proxy) and delivery only happens
 * while a user has the app open. The panel copy says so explicitly.
 */
import { supabase } from './supabase'
import { addBreadcrumb } from './monitoring'

const KEY = 'webhook_endpoints'
const DISPATCH_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 60_000
const MAX_ENDPOINTS = 20

// ── URL validation (SSRF guard) ───────────────────────────────────────────────
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,                          // loopback v4
  /^10\./,                           // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,      // RFC1918 172.16.0.0/12
  /^192\.168\./,                     // RFC1918
  /^169\.254\./,                     // link-local / cloud metadata
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,                     // loopback v6
  /\.local$/i,
  /\.internal$/i,
]

/**
 * Validate a webhook target URL. Returns `{ ok: true }` or
 * `{ ok: false, reason }`. Enforced at save AND dispatch time.
 */
export function validateWebhookUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return { ok: false, reason: 'URL is required.' }
  let parsed
  try { parsed = new URL(url.trim()) } catch { return { ok: false, reason: 'Not a valid URL.' } }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'Only https:// endpoints are allowed.' }
  const host = parsed.hostname
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, reason: 'Internal / private network targets are not allowed.' }
  }
  return { ok: true }
}

/** True when an endpoint config is subscribed to this event type. */
export function endpointAcceptsEvent(endpoint, eventType) {
  if (!endpoint?.enabled) return false
  const events = Array.isArray(endpoint.events) ? endpoint.events : []
  return events.includes('*') || events.includes(eventType)
}

// ── Config persistence (app_settings, erp.js pattern) ────────────────────────
let cache = { endpoints: null, fetchedAt: 0 }

/** Drop the in-memory endpoint cache (used after saves and in tests). */
export function clearWebhookCache() {
  cache = { endpoints: null, fetchedAt: 0 }
}

function sanitizeEndpoint(raw) {
  return {
    id: raw.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    url: String(raw.url || '').trim().slice(0, 500),
    events: Array.isArray(raw.events) && raw.events.length ? raw.events.slice(0, 50) : ['*'],
    enabled: !!raw.enabled,
    secret: raw.secret ? String(raw.secret).slice(0, 200) : null,
    description: String(raw.description || '').slice(0, 200),
    created_by: raw.created_by ?? null,
    created_at: raw.created_at || new Date().toISOString(),
  }
}

/** Read saved webhook endpoints (cached with a short TTL). Never throws. */
export async function getWebhookEndpoints({ force = false } = {}) {
  const now = Date.now()
  if (!force && cache.endpoints && now - cache.fetchedAt < CACHE_TTL_MS) return cache.endpoints
  try {
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', KEY).maybeSingle()
    if (error) throw error
    let list = []
    if (data?.value) {
      const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      if (Array.isArray(v)) list = v.map(sanitizeEndpoint)
    }
    cache = { endpoints: list, fetchedAt: now }
    return list
  } catch (err) {
    console.warn('[webhooks] could not load endpoints (non-blocking):', err?.message || err)
    return cache.endpoints || []
  }
}

/**
 * Save the full endpoint list (admins only — enforced by app_settings RLS).
 * Validates every URL (https-only + SSRF block) and refreshes the cache.
 * Throws on validation/persistence failure so the panel can show the error.
 */
export async function saveWebhookEndpoints(endpoints) {
  const list = (Array.isArray(endpoints) ? endpoints : []).slice(0, MAX_ENDPOINTS).map(sanitizeEndpoint)
  for (const ep of list) {
    const check = validateWebhookUrl(ep.url)
    if (!check.ok) throw new Error(`${ep.url || '(empty)'}: ${check.reason}`)
  }
  const { error } = await supabase.from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(list) }, { onConflict: 'key' },
  )
  if (error) throw new Error(error.message || 'Could not save webhook endpoints.')
  cache = { endpoints: list, fetchedAt: Date.now() }
  return list
}

// ── Signing ───────────────────────────────────────────────────────────────────
/**
 * Hex HMAC-SHA256 of `body` with `secret` via WebCrypto.
 * Returns null when crypto.subtle is unavailable (header is then omitted).
 */
export async function signBody(secret, body) {
  try {
    const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
    if (!subtle || !secret) return null
    const enc = new TextEncoder()
    const key = await subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const sig = await subtle.sign('HMAC', key, enc.encode(body))
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch (err) {
    console.warn('[webhooks] signing failed — sending unsigned:', err?.message || err)
    return null
  }
}

// ── Delivery ──────────────────────────────────────────────────────────────────
async function deliverToEndpoint(endpoint, event) {
  // Re-validate at dispatch time: a row edited straight in the DB must still
  // never make the browser call an internal/plain-http target.
  const check = validateWebhookUrl(endpoint.url)
  if (!check.ok) {
    console.warn(`[webhooks] skipped "${endpoint.url}": ${check.reason}`)
    return { ok: false, reason: check.reason }
  }
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    occurred_at: event.occurred_at,
    payload: event.payload ?? {},
  })
  const headers = { 'Content-Type': 'application/json' }
  if (endpoint.secret) {
    const signature = await signBody(endpoint.secret, body)
    if (signature) headers['X-TyrePulse-Signature'] = signature
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS) : null
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body,
      signal: controller?.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { ok: true }
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `timeout after ${DISPATCH_TIMEOUT_MS}ms` : (err?.message || 'delivery failed')
    console.warn(`[webhooks] delivery to ${endpoint.url} failed (non-blocking): ${reason}`)
    addBreadcrumb('webhook', 'delivery failed', { endpoint_id: endpoint.id, event_type: event.type, reason })
    return { ok: false, reason }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Dispatch one bus event to every enabled endpoint subscribed to its type.
 * Fire-and-forget: NEVER throws into the app; each endpoint is isolated.
 * Returns per-endpoint results (used by tests and the panel's test button).
 */
export async function dispatchEvent(event) {
  try {
    if (!event?.type) return []
    const endpoints = await getWebhookEndpoints()
    const targets = endpoints.filter((ep) => endpointAcceptsEvent(ep, event.type))
    if (targets.length === 0) return []
    return await Promise.all(targets.map((ep) =>
      deliverToEndpoint(ep, event).catch((err) => {
        // Belt-and-braces: deliverToEndpoint already catches, but nothing may escape.
        console.warn('[webhooks] dispatch error (isolated):', err?.message || err)
        return { ok: false, reason: err?.message || 'dispatch error' }
      }),
    ))
  } catch (err) {
    console.warn('[webhooks] dispatchEvent failed (non-blocking):', err?.message || err)
    return []
  }
}

/**
 * Send a test event to ONE endpoint regardless of its enabled flag — used by
 * the panel's "Send test" button so admins can verify wiring before enabling.
 */
export async function sendTestEvent(endpoint, eventType) {
  const event = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `test-${Date.now()}`,
    type: eventType,
    occurred_at: new Date().toISOString(),
    payload: { test: true, message: 'TyrePulse webhook test delivery', event_type: eventType },
  }
  return deliverToEndpoint(endpoint, event)
}
