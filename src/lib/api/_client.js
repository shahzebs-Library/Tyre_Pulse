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
import { fetchAllPages, fetchAllRpcPages } from '../fetchAll'
import { toUserMessage } from '../safeError'

export { supabase, fetchAllPages, fetchAllRpcPages }

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
 * STRICT "not provisioned yet" test, by CODE only - for the honest console
 * reads. `isMissingRelation` above falls back to sniffing the text for a bare
 * "relation", and a permission denial ("permission denied for relation x") can
 * contain that word; a read that must surface permission and network failures
 * uses this instead, so only a genuinely undeployed table or function degrades
 * to an empty/"not provisioned" state.
 */
const NOT_PROVISIONED_CODES = new Set(['42P01', 'PGRST205', '42883', 'PGRST202'])

export function isNotProvisioned(err) {
  if (!err) return false
  const code = String(err.code || err.cause?.code || '')
  return NOT_PROVISIONED_CODES.has(code)
}

/**
 * probeRelation - does this table actually exist?
 *
 * WHY THIS IS NEEDED AT ALL. Most `listX()` services deliberately DEGRADE a
 * missing relation to `[]` so a page ships before its migration is applied.
 * That is the right default, but it destroys the distinction the page needs:
 * "nothing recorded yet" and "this table does not exist" arrive identically.
 * Several pages carry a correct "apply the migration" banner behind a `catch`
 * that the swallowing service guarantees will never run - so the page instead
 * invites the user to create the first record in a table that is not there.
 *
 * THE HONESTY RULE IS `checked`. When we cannot tell - a network failure, an
 * RLS denial, anything that is not a definite missing-relation - this reports
 * `checked: false` and `exists: true`, so a caller NEVER renders "apply the
 * migration" on a guess. A false provisioning banner sends someone to the
 * database over a dropped request; that is worse than the empty state.
 *
 * Costs one HEAD request and returns no rows, so call it only when a list came
 * back empty AND the page actually renders such a banner.
 */
export async function probeRelation(table) {
  try {
    const { error } = await supabase.from(table).select('id', { head: true, count: 'exact' }).limit(1)
    if (error) {
      if (isMissingRelation(error)) return { exists: false, checked: true }
      return { exists: true, checked: false }
    }
    return { exists: true, checked: true }
  } catch (err) {
    if (isMissingRelation(err)) return { exists: false, checked: true }
    return { exists: true, checked: false }
  }
}

/**
 * True when a failure means "this COLUMN is not provisioned yet" (a migration
 * authored in the repo but not yet applied - the SHIP-BEFORE-MIGRATE case).
 * PostgREST fails the whole request on an unknown column (42703 / PGRST204),
 * so a caller that selects newly-added columns should fall back to its base
 * column list when this is true, rather than showing an error.
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

export function isMissingColumn(err) {
  if (!err) return false
  const code = err.code || err.cause?.code
  if (code && MISSING_COLUMN_CODES.has(String(code))) return true
  const raw = String(err.cause?.message ?? err.message ?? '').toLowerCase()
  return raw.includes('could not find the') && raw.includes('column')
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

/**
 * Normalise a country LIST into the distinct, non-blank countries to filter on.
 *
 * The "All" sentinel is dropped rather than treated as a country: a caller that
 * genuinely means every country passes an empty list (or omits the parameter),
 * which applies no filter - exactly what `applyCountry` does with "All". Keeping
 * the sentinel in the list would send `country=in.(All,...)` and match nothing.
 *
 * @param {string[]|string} [countries]
 * @returns {string[]}
 */
export function countryList(countries) {
  const raw = Array.isArray(countries) ? countries : countries ? [countries] : []
  const out = []
  for (const c of raw) {
    const v = String(c ?? '').trim()
    if (!v || v === 'All' || out.includes(v)) continue
    out.push(v)
  }
  return out
}

/**
 * Country scoping for a LIST of countries - the multi-country generalisation of
 * `applyCountry`, for reporting surfaces whose scope is a SET of countries
 * rather than the one operational country.
 *
 * WHY ONE QUERY, NOT ONE PER COUNTRY. Every read this replaces is bounded (a
 * `fetchAllPages` with a `{ max }` ceiling). Issuing N separate reads would turn
 * one bounded read into N bounded reads and multiply the ceiling by N behind the
 * page's back; a single `in.(...)` keeps the read - and its cap - exactly as
 * bounded as it was.
 *
 * NULL-COUNTRY BEHAVIOUR IS THE CALLER'S EXISTING BEHAVIOUR, and getting it
 * wrong silently moves totals. Two conventions live in this codebase and both
 * are deliberate:
 *   nullSafe: true  (default, mirrors `applyCountry`) - rows with a NULL country
 *                   are INCLUDED, so legitimately uncategorised rows are not
 *                   dropped.
 *   nullSafe: false - a strict `country = X` match, which is what the page-level
 *                   reads (engineeringKpi, accidents, work orders, stock) have
 *                   always used. Switching them to the null-safe form would pull
 *                   in rows they have never counted.
 * A SINGLE-country list is emitted in exactly the form the scalar helpers
 * already emit, so a one-country scope is byte-identical to today's query.
 *
 * @param {object} query                 a Supabase query builder
 * @param {string[]} countries           country names ("All" and blanks dropped)
 * @param {{nullSafe?:boolean}} [opts]
 */
export function applyCountries(query, countries, { nullSafe = true } = {}) {
  const list = countryList(countries)
  if (!list.length) return query
  if (list.length === 1) {
    return nullSafe ? applyCountry(query, list[0]) : query.eq('country', list[0])
  }
  // `.in()` builds and escapes the value list itself, so no country name can
  // break out of the filter expression.
  if (!nullSafe) return query.in('country', list)
  // Null-safe needs an OR tree, which is a string. Quote each value so a name
  // containing a comma or a space cannot split the expression.
  const quoted = list.map((c) => `"${String(c).replace(/(["\\])/g, '\\$1')}"`).join(',')
  return query.or(`country.in.(${quoted}),country.is.null`)
}
