/**
 * Service-layer core. The `src/lib/api/*` modules are the single place that
 * talks to Supabase for a given domain; React pages migrate onto them
 * gradually (the directive: "migrate module by module"), replacing inline
 * `supabase.from(...)` calls. Supabase stays *behind* this layer for now.
 *
 * Benefits: one place per domain for column lists (least-privilege selects),
 * null-safe country scoping, consistent error handling, and a seam for tests.
 */
import { supabase } from '../supabase'
import { fetchAllPages } from '../fetchAll'
import { toUserMessage } from '../safeError'

export { supabase, fetchAllPages }

/** Typed error thrown by every service method on a Supabase failure. */
export class ServiceError extends Error {
  constructor(message, code, cause) {
    super(message || 'Request failed')
    this.name = 'ServiceError'
    this.code = code
    this.cause = cause
  }
}

/**
 * Unwrap a Supabase `{ data, error }` result: throw a ServiceError on failure,
 * otherwise return the data. Keeps call sites free of repetitive error checks.
 *
 * The message is SANITISED here, at the boundary, rather than trusting ~150
 * service modules and every page that renders `err.message` to remember to do
 * it. Postgres error text names constraints, columns, relations and RLS
 * policies; a page that printed it verbatim was showing users the raw internals
 * of the database. The untouched original stays on `.cause`, so Sentry and the
 * console still get the full detail for debugging.
 */
export function unwrap(result) {
  const { data, error } = result || {}
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data
}

/**
 * True when a failure means "this table/function is not provisioned yet"
 * (an org that has not run a migration), as opposed to a real error. Callers
 * degrade to an honest empty state instead of showing a failure.
 *
 * This is THE shared implementation. It used to be copy-pasted into 20+ service
 * modules, each sniffing only `err.message` - which stopped working the moment
 * unwrap() began sanitising that message for display. Detection therefore reads
 * the CODE first (a real missing relation always carries 42P01 or PGRST205) and
 * falls back to the untouched original text preserved on `.cause`.
 */
const MISSING_RELATION_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

export function isMissingRelation(err) {
  if (!err) return false
  const code = err.code || err.cause?.code
  if (code && MISSING_RELATION_CODES.has(String(code))) return true
  // Fall back to the raw text: `.cause` holds the original Supabase error, so
  // this still matches even though `err.message` is now the sanitised copy.
  const raw = err.cause?.message ?? err.message ?? ''
  const m = String(raw).toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('schema cache') ||
    m.includes('could not find the table') ||
    m.includes('could not find the function') ||
    m.includes('relation')
  )
}

/**
 * Null-safe country scoping. When a real country is active, include rows for
 * that country OR with a NULL country (legitimately uncategorised rows are
 * never silently dropped). With no country (or "All"), apply no filter.
 *
 * @param {object} query  a Supabase query builder
 * @param {string} [country]
 */
export function applyCountry(query, country) {
  if (country && country !== 'All') {
    return query.or(`country.eq.${country},country.is.null`)
  }
  return query
}
