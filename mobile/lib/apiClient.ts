/**
 * apiClient — auth-aware client for the TyrePulse Go API (/api/v1).
 *
 * Step 1 foundation for the backend migration. NOT yet wired into screens:
 * the app keeps using Supabase directly until each module is cut over. As
 * modules migrate, the screen swaps its direct `supabase.from(...)` write for
 * the matching typed offline command (see OfflineCommand below) which this
 * client posts to the API with an idempotency key.
 *
 * See docs/ADR/0004-offline-mobile-sync.md.
 */

import Constants from 'expo-constants'
import { supabase } from './supabase'

const extra = (Constants.expoConfig?.extra ?? (Constants as any).manifest?.extra ?? {}) as {
  apiBaseUrl?: string
}
const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? '').replace(/\/$/, '')
const API_PREFIX = '/api/v1'

/** Stable, machine-readable error codes returned by the API. */
export type ApiErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found'
  | 'conflict' | 'rate_limited' | 'internal_error' | 'service_unavailable'
  | 'network_error' | 'not_configured'

export class ApiError extends Error {
  code: ApiErrorCode
  status: number
  requestId?: string
  constructor(code: ApiErrorCode, message: string, status: number, requestId?: string) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

interface Envelope<T> {
  data?: T
  error?: { code: ApiErrorCode; message: string }
  meta?: unknown
}

interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  idempotencyKey?: string
  signal?: AbortSignal
}

function uuid(): string {
  // Hermes exposes crypto.randomUUID in recent RN; fall back if absent.
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError('not_configured', 'EXPO_PUBLIC_API_BASE_URL is not set — Go API not wired in this build.', 0)
  }
  const qs = opts.query
    ? '?' + new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : ''
  const url = `${BASE_URL}${API_PREFIX}${path}${qs}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': uuid(),
    ...(await authHeader()),
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Idempotency-Key'] = opts.idempotencyKey || uuid()
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e: any) {
    throw new ApiError('network_error', e?.message ?? 'Network request failed', 0)
  }

  const requestId = res.headers.get('X-Request-Id') ?? undefined
  let env: Envelope<T> | null = null
  const text = await res.text()
  if (text) {
    try { env = JSON.parse(text) as Envelope<T> } catch { /* non-JSON */ }
  }
  if (!res.ok) {
    throw new ApiError(
      env?.error?.code ?? 'internal_error',
      env?.error?.message ?? res.statusText,
      res.status,
      requestId,
    )
  }
  return (env?.data as T)
}

/** Authoritative profile (role/scope) of the authenticated user. */
export interface ApiProfile {
  id: string
  email?: string
  full_name?: string
  username?: string
  role: string
  site?: string
  country?: string[]
  approved: boolean
  locked: boolean
}

export const api = {
  get:    <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post:   <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  put:    <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
  patch:  <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),

  me: () => request<ApiProfile>('GET', '/me'),
}

export default api
