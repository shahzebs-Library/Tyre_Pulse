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
 */
export function unwrap(result) {
  const { data, error } = result || {}
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
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
