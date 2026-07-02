/**
 * apiClient - auth-aware client for the TyrePulse Go API (/api/v1).
 *
 * This is the Step 1 foundation for the backend migration. It is intentionally
 * NOT yet wired into any page: pages continue to use Supabase directly until
 * their module is cut over to the Go API (see docs/GO_BACKEND_MIGRATION_PLAN.md).
 * As each module migrates, its page swaps its `supabase.from(...)` calls for the
 * matching typed method here.
 *
 * Responsibilities:
 *  - attach the current Supabase access token as a Bearer credential
 *  - speak the API's JSON envelope ({ data, error, meta })
 *  - surface structured errors (ApiError) with stable codes
 *  - retry idempotent (GET) requests on transient network/5xx failures
 *  - carry an Idempotency-Key on writes so retries never double-apply
 */

import { supabase } from './supabase'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const API_PREFIX = '/api/v1'

/** Structured error thrown by the client. `code` is a stable machine string. */
export class ApiError extends Error {
  constructor(code, message, status, requestId) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Core request. Returns the envelope's `data`. Throws ApiError on failure.
 *
 * @param {string} method
 * @param {string} path        path under /api/v1, e.g. '/me'
 * @param {object} [opts]
 * @param {object} [opts.body] JSON body for writes
 * @param {object} [opts.query] query params
 * @param {number} [opts.retries] transient retry budget (GET only)
 * @param {string} [opts.idempotencyKey] override the generated key for writes
 * @param {AbortSignal} [opts.signal]
 */
export async function request(method, path, opts = {}) {
  const { body, query, retries = method === 'GET' ? 2 : 0, idempotencyKey, signal } = opts

  if (!BASE_URL) {
    throw new ApiError(
      'not_configured',
      'VITE_API_BASE_URL is not set - the Go API is not wired in this build.',
      0,
    )
  }

  const qs = query
    ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null)).toString()
    : ''
  const url = `${BASE_URL}${API_PREFIX}${path}${qs}`

  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': uuid(),
    ...(await authHeader()),
  }
  // Idempotency for writes so a retried request never applies twice.
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Idempotency-Key'] = idempotencyKey || uuid()
  }

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal,
        credentials: 'omit',
      })

      const requestId = res.headers.get('X-Request-Id') || undefined
      let envelope = null
      const text = await res.text()
      if (text) {
        try { envelope = JSON.parse(text) } catch { /* non-JSON error body */ }
      }

      if (!res.ok) {
        const err = envelope?.error
        // Retry transient server errors for idempotent methods.
        if (res.status >= 500 && attempt < retries) {
          attempt++
          await sleep(250 * 2 ** (attempt - 1))
          continue
        }
        throw new ApiError(
          err?.code || httpStatusToCode(res.status),
          err?.message || res.statusText,
          res.status,
          requestId,
        )
      }
      return envelope ? envelope.data : null
    } catch (e) {
      if (e instanceof ApiError) throw e
      // Network/abort error - retry idempotent methods.
      if (attempt < retries) {
        attempt++
        await sleep(250 * 2 ** (attempt - 1))
        continue
      }
      throw new ApiError('network_error', e?.message || 'Network request failed', 0)
    }
  }
}

function httpStatusToCode(status) {
  switch (status) {
    case 400: return 'bad_request'
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 404: return 'not_found'
    case 409: return 'conflict'
    case 429: return 'rate_limited'
    case 503: return 'service_unavailable'
    default:  return 'internal_error'
  }
}

/** Cursor-paginated GET helper. Returns { items, nextCursor }. */
export async function paginate(path, { cursor, limit = 50, ...filters } = {}) {
  const data = await request('GET', path, { query: { cursor, limit, ...filters } })
  // The API returns the page in `data` and pagination in `meta`; request()
  // returns only `data`, so list endpoints return { items, next_cursor }.
  if (Array.isArray(data)) return { items: data, nextCursor: null }
  return { items: data?.items ?? [], nextCursor: data?.next_cursor ?? null }
}

export const api = {
  get:    (path, opts) => request('GET', path, opts),
  post:   (path, body, opts) => request('POST', path, { ...opts, body }),
  put:    (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch:  (path, body, opts) => request('PATCH', path, { ...opts, body }),
  delete: (path, opts) => request('DELETE', path, opts),
  paginate,

  /** First migrated endpoint: the authenticated user's authoritative profile. */
  me: () => request('GET', '/me'),
}

export default api
