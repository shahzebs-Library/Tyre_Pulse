/**
 * safeError - convert ANY thrown error / Supabase error into a clean, generic
 * user-facing message. Never leaks database internals (Postgres/PostgREST text,
 * column/constraint/relation names, uuids, SQL), auth tokens, or API endpoints
 * to the UI. The real detail still goes to Sentry / __DEV__ logs, not the screen.
 *
 * Usage:
 *   catch (err) { setError(toUserMessage(err)) }
 *   if (error) Alert.alert('Error', toUserMessage(error))
 */

type AnyErr =
  | { message?: unknown; code?: unknown; status?: unknown; error_description?: unknown; name?: unknown }
  | string
  | null
  | undefined

const GENERIC = 'Something went wrong. Please try again.'

// Substrings that indicate a raw backend/DB/internal error we must NOT show.
const LEAKY = [
  'invalid input syntax', 'violates', 'constraint', 'relation ', 'column ',
  'syntax error', 'permission denied for', 'function ', 'operator ', 'type uuid',
  'duplicate key', 'null value in column', 'foreign key', 'rls', 'row-level security',
  'jwt', 'schema cache', 'pgrst', 'supabase', 'postgres', '/rest/v1', '/auth/v1',
  'http', 'econn', 'fetch', 'xhr', 'stack', 'at object.', 'select ', 'insert ', 'update ',
]

const raw = (e: AnyErr): string => {
  if (!e) return ''
  if (typeof e === 'string') return e
  const m = (e as any).message
  return typeof m === 'string' ? m : ''
}

const codeOf = (e: AnyErr): string => {
  if (!e || typeof e === 'string') return ''
  return String((e as any).code ?? (e as any).status ?? '')
}

/** True when the message clearly exposes backend / DB / transport internals. */
function isLeaky(msg: string): boolean {
  const m = msg.toLowerCase()
  return LEAKY.some((p) => m.includes(p))
}

/**
 * Map an error to a safe user message.
 * @param err     the caught error / Supabase error
 * @param fallback message to use when nothing specific and safe applies
 */
export function toUserMessage(err: AnyErr, fallback: string = GENERIC): string {
  const msg = raw(err).trim()
  const code = codeOf(err)
  const low = msg.toLowerCase()

  // Offline / network - actionable and safe to name.
  if (
    low.includes('network') || low.includes('failed to fetch') ||
    low.includes('timeout') || low.includes('offline') || code === 'ECONNABORTED'
  ) {
    return 'Network problem. Check your connection and try again.'
  }

  // Auth / permission - safe category messages (no backend text).
  if (code === '401' || code === '403' || code === '42501' || low.includes('permission denied') || low.includes('not authorized') || low.includes('jwt')) {
    return 'You do not have permission to do this.'
  }
  if (low.includes('invalid credentials') || low.includes('invalid login')) {
    return 'Invalid credentials. Please try again.'
  }
  if (code === '404' || low.includes('not found')) {
    return 'That item could not be found.'
  }
  if (code === '409' || low.includes('duplicate') || low.includes('already exists')) {
    return 'That already exists.'
  }

  // A short, human message with no backend fingerprints can pass through.
  if (msg && msg.length <= 120 && !isLeaky(msg)) return msg

  // Anything else (raw DB/PostgREST/transport text) -> generic.
  return fallback
}

/** Dev-only detail for logging (never rendered to users in production). */
export function errorDetail(err: AnyErr): string {
  return raw(err) || codeOf(err) || 'unknown'
}
