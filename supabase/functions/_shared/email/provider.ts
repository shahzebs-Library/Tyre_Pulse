// One email provider interface, chosen by config only (EMAIL_PROVIDER).
//   resend (default)  - implemented.
//   smtp              - stub for Mailcow. Supabase Edge blocks outbound 25 and
//                       587, so only implicit-TLS port 465 is accepted.
// Pure: no Deno globals. The caller passes an env reader and fetch.
import { BRAND } from './brand.ts'
import { cleanAddress, stripCrLf } from './escape.ts'

export type OutgoingEmail = {
  to: string
  subject: string
  html: string
  text: string
  from?: string
  replyTo?: string
  /** Provider idempotency key so a retried send can never deliver twice. */
  idempotencyKey?: string
  headers?: Record<string, string>
}
export type SendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; kind: 'transient' | 'permanent'; status: number | null; error: string; retryAfterSeconds?: number }

export interface EmailProvider { readonly name: string; send(msg: OutgoingEmail): Promise<SendResult> }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type EnvReader = (key: string) => string | undefined

/** 429 / 408 / 5xx and network errors retry; any other 4xx is permanent. */
export function classifyStatus(status: number): 'transient' | 'permanent' {
  return status === 429 || status === 408 || status >= 500 ? 'transient' : 'permanent'
}

export function parseRetryAfter(raw: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.ceil(n), 3600)
  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.min(Math.max(0, Math.ceil((at - now) / 1000)), 3600)
  return undefined
}

function sanitise(msg: OutgoingEmail): OutgoingEmail | string {
  const to = cleanAddress(msg.to)
  if (!to) return 'invalid or synthetic recipient address'
  const replyTo = msg.replyTo ? cleanAddress(msg.replyTo) : null
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(msg.headers || {})) {
    if (/^[A-Za-z0-9-]{1,64}$/.test(k)) headers[k] = stripCrLf(v).slice(0, 500)
  }
  return {
    ...msg,
    to,
    subject: stripCrLf(msg.subject).slice(0, 200),
    from: stripCrLf(msg.from || BRAND.from),
    replyTo: replyTo || BRAND.replyTo,
    headers,
  }
}

export class ResendAdapter implements EmailProvider {
  readonly name = 'resend'
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {}
  async send(raw: OutgoingEmail): Promise<SendResult> {
    const msg = sanitise(raw)
    if (typeof msg === 'string') return { ok: false, kind: 'permanent', status: null, error: msg }
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(msg.idempotencyKey ? { 'Idempotency-Key': stripCrLf(msg.idempotencyKey).slice(0, 256) } : {}),
        },
        body: JSON.stringify({
          from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
          reply_to: msg.replyTo, headers: msg.headers,
        }),
      })
      const body = await res.json().catch(() => ({})) as { id?: string; message?: string; name?: string }
      if (res.ok) return { ok: true, providerId: body.id ?? null }
      return {
        ok: false, kind: classifyStatus(res.status), status: res.status,
        error: String(body.message || body.name || `HTTP ${res.status}`).slice(0, 300),
        retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
      }
    } catch (err) {
      return { ok: false, kind: 'transient', status: null, error: err instanceof Error ? err.message : 'network error' }
    }
  }
}

export class SmtpAdapter implements EmailProvider {
  readonly name = 'smtp'
  constructor(readonly config: { host: string; port: number; user?: string; pass?: string }) {
    if (config.port !== 465) throw new Error('SMTP: only port 465 (implicit TLS) is supported on Supabase Edge')
    if (!config.host) throw new Error('SMTP: host is required')
  }
  send(_msg: OutgoingEmail): Promise<SendResult> {
    // Mailcow host is not known yet. Fail permanently and loudly rather than
    // pretend; switch EMAIL_PROVIDER back to resend to keep mail flowing.
    return Promise.resolve({ ok: false, kind: 'permanent', status: null, error: 'SMTP adapter not implemented yet' })
  }
}

export function providerFromEnv(env: EnvReader, fetchImpl: FetchLike = fetch): EmailProvider | null {
  const kind = (env('EMAIL_PROVIDER') || 'resend').toLowerCase()
  if (kind === 'smtp') {
    return new SmtpAdapter({ host: env('SMTP_HOST') || '', port: Number(env('SMTP_PORT') || 465), user: env('SMTP_USER'), pass: env('SMTP_PASS') })
  }
  const key = env('RESEND_API_KEY')
  return key ? new ResendAdapter(key, fetchImpl) : null
}
