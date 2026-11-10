// aiSecurity.ts - pure security helpers shared by the three AI edge functions
// (chat-ai, ai-orchestrator, ai-tyre-inspection).
//
// Pure TypeScript: no Deno, no network, no Supabase import, so vitest exercises
// every rule here directly (src/test/aiSecurity.test.js). Each function either
// refuses (returns null / false / an error object) or returns a value that is
// safe to pass on. Nothing here ever throws on hostile input.

// ── Error text ──────────────────────────────────────────────────────────────
// Provider / Postgres / PostgREST messages carry SQL, column names, constraint
// names and stack fragments. Those must never reach the model (it may repeat
// them) or the user. Map to a short fixed phrase; the raw text stays in the
// function log only.
export function sanitizeErrorText(e: unknown): string {
  const m = String((e as { message?: unknown })?.message ?? e ?? '')
  if (/permission|not allowed|forbidden|42501|row-level security|rls/i.test(m)) return 'not permitted for this user'
  if (/does not exist|42883|42P01|PGRST20|not provisioned/i.test(m)) return 'not provisioned'
  if (/timeout|timed out|57014|aborted/i.test(m)) return 'timed out'
  return 'query failed'
}

// An RPC refusal reason ({ok:false, reason}) is shown to the model. Only short
// lower-case tokens such as 'forbidden' or 'invalid' pass; anything else is
// collapsed so free text from a function body cannot become an instruction.
export function safeRefusalReason(reason: unknown): string {
  const s = String(reason ?? '').trim()
  return /^[a-z][a-z_ ]{0,39}$/.test(s) ? s : 'refused'
}

// ── Identifiers ─────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/**
 * A conversation id supplied by the browser is only usable when the stored row
 * belongs to the caller. Any doubt (missing row, missing ids, type mismatch)
 * is a refusal; the endpoint then answers 404 so the id's existence is not
 * confirmed to someone else.
 */
export function ownsConversation(conv: { user_id?: unknown } | null | undefined, userId: unknown): boolean {
  return !!conv && typeof userId === 'string' && userId.length > 0 &&
    typeof conv.user_id === 'string' && conv.user_id === userId
}

// ── Free text that is echoed back into prompts ─────────────────────────────
// Control characters and line breaks are how an injected string pretends to
// be a new system line. Collapse them; clamp length.
// Control characters plus U+2028/U+2029 (line terminators). Built without backslash-u escapes in the source
// so the file survives transports that decode them.
const CONTROL_CHARS_RE = new RegExp('[\\x00-\\x1f\\x7f' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g')

export function cleanPromptText(v: unknown, max = 80): string | null {
  const s = String(v ?? '').replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

// ── chat-ai request validation ─────────────────────────────────────────────
export const CHAT_LIMITS = {
  maxMessages: 40,
  maxTotalChars: 150_000,
  maxSystemChars: 60_000,
  maxTokens: 2000,
}

type ChatMessage = { role: 'user' | 'assistant'; content: string | Array<{ type: 'text'; text: string }> }

function contentChars(c: unknown): number | null {
  if (typeof c === 'string') return c.length
  if (Array.isArray(c)) {
    let n = 0
    for (const b of c) {
      // Only plain text blocks: no images, documents, tool_use or tool_result
      // from the browser (those would let a client forge tool output).
      if (!b || typeof b !== 'object' || (b as { type?: unknown }).type !== 'text' || typeof (b as { text?: unknown }).text !== 'string') return null
      n += (b as { text: string }).text.length
    }
    return n
  }
  return null
}

export type ChatPayloadResult =
  | { ok: true; system: string | null; messages: ChatMessage[]; maxTokens: number }
  | { ok: false; error: string }

/** Validate the body chat-ai forwards to the model. Pure. */
export function validateChatPayload(body: unknown): ChatPayloadResult {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {}
  const raw = Array.isArray(b.messages) && b.messages.length > 0
    ? b.messages
    : [{ role: 'user', content: b.user ?? '' }]
  if (raw.length > CHAT_LIMITS.maxMessages) return { ok: false, error: 'Too many messages in one request' }
  let total = 0
  const messages: ChatMessage[] = []
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role
    if (role !== 'user' && role !== 'assistant') return { ok: false, error: 'Invalid message role' }
    const content = (m as { content?: unknown }).content
    const n = contentChars(content)
    if (n === null) return { ok: false, error: 'Invalid message content' }
    total += n
    messages.push({ role, content: content as ChatMessage['content'] })
  }
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user' || !contentChars(last.content)) return { ok: false, error: 'Missing message content' }
  let system: string | null = null
  if (b.system !== undefined && b.system !== null && b.system !== '') {
    if (typeof b.system !== 'string') return { ok: false, error: 'Invalid system prompt' }
    if (b.system.length > CHAT_LIMITS.maxSystemChars) return { ok: false, error: 'Request too large' }
    system = b.system
    total += b.system.length
  }
  if (total > CHAT_LIMITS.maxTotalChars) return { ok: false, error: 'Request too large' }
  const maxTokens = Math.min(Math.max(Math.trunc(Number(b.max_tokens)) || 1000, 1), CHAT_LIMITS.maxTokens)
  return { ok: true, system, messages, maxTokens }
}

// ── Monthly spend (budget guard) ───────────────────────────────────────────
// PostgREST caps every response at db-max-rows (1000 here). A plain select of
// the month's ai_token_logs therefore under-counts once a month has more than
// 1000 calls and the budget cap silently stops working. Page explicitly and
// fail CLOSED (null) on any error, corrupt value or page ceiling.
type Page = { data: Array<{ cost_usd?: unknown }> | null; error: unknown }
export async function pagedMonthSpend(
  fetchPage: (from: number, to: number) => PromiseLike<Page>,
  pageSize = 1000,
  maxPages = 100,
): Promise<number | null> {
  let sum = 0
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await fetchPage(p * pageSize, (p + 1) * pageSize - 1)
    if (error) return null
    const rows = data ?? []
    for (const r of rows) {
      if (r?.cost_usd === null || r?.cost_usd === undefined) continue
      const n = Number(r.cost_usd)
      if (!Number.isFinite(n) || n < 0) return null
      sum += n
    }
    if (rows.length < pageSize) return Number(sum.toFixed(6))
  }
  return null
}

// ── Private photo references (ai-tyre-inspection) ──────────────────────────
// The worker downloads photos with the SERVICE ROLE, so the bucket must be on
// an allow-list: otherwise a tyre_conditions entry written by any field user
// could point the worker at another private bucket. Live data (2026-11-10):
// all 883 jobs reference 'tyre-photos'.
export const AI_PHOTO_BUCKETS = ['tyre-photos'] as const

export function parseStorageRef(value: unknown, allowedBuckets: readonly string[] = AI_PHOTO_BUCKETS):
  { bucket: string; path: string } | null {
  if (typeof value !== 'string' || !value.startsWith('tp-storage://')) return null
  const raw = value.slice('tp-storage://'.length)
  const i = raw.indexOf('/')
  if (i <= 0) return null
  const bucket = raw.slice(0, i)
  const path = raw.slice(i + 1)
  if (!/^[a-z0-9_-]+$/.test(bucket) || !allowedBuckets.includes(bucket)) return null
  if (!path || path.includes('..') || path.startsWith('/') || /[\x00-\x1f\\]/.test(path) || path.length > 500) return null
  return { bucket, path }
}

// ── Account state ──────────────────────────────────────────────────────────
/** Approval is fail-closed: null/legacy values do not pass; a lock always blocks. */
export function isActiveAccount(p: { approved?: unknown; locked?: unknown } | null | undefined): boolean {
  return !!p && p.approved === true && p.locked !== true
}
