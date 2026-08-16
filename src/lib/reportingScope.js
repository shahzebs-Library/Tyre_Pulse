/**
 * REPORTING SCOPE - which countries an ANALYTICS surface aggregates over.
 *
 * Deliberately a DIFFERENT concept from the working context
 * (src/lib/workingContext.js): the working context is one operational place at a
 * time, a reporting scope may be several countries or all of them. Nothing here
 * ever writes the working context, and nothing here touches the legacy
 * `activeCountry` bridge - a report that spans countries must not silently
 * re-point the operational selection.
 *
 * Money is NEVER blended across countries elsewhere in this app (KSA=SAR,
 * UAE=AED, Egypt=EGP), so a multi-country scope means "report each of these",
 * not "add them up". Callers keep that responsibility.
 *
 * PURE: no I/O, no React. Permission rules are read off the same allowed tree
 * the working context uses, so the two can never disagree about what a user may
 * see. RLS remains the real boundary.
 */
import { allowedContext } from './workingContext'

/** Sentinel meaning "every country this user may see". */
export const SCOPE_ALL = 'All'

/**
 * A scope that selects nothing. It is NOT the same as SCOPE_ALL: an unresolved
 * or emptied scope must never read as "all countries" (it would overstate what
 * a report covers). normalizeScope() turns it into an honest default.
 */
export const EMPTY_SCOPE = Object.freeze({ countries: Object.freeze([]) })

const txt = (v) => (v == null ? '' : String(v).trim())
const isAll = (v) => txt(v).toLowerCase() === SCOPE_ALL.toLowerCase() || txt(v) === '*'

/** Read the countries out of a scope object (tolerates a bare array or string). */
function entriesOf(scope) {
  if (scope == null) return []
  if (Array.isArray(scope)) return scope.map(txt).filter(Boolean)
  if (typeof scope === 'string') return [txt(scope)].filter(Boolean)
  const list = Array.isArray(scope.countries) ? scope.countries : [scope.countries]
  return list.map(txt).filter(Boolean)
}

/**
 * The countries this profile may aggregate over, in tree order.
 * Same permission rule as the working context (delegated, never re-implemented).
 */
export function allowedScopeCountries(profile, tree) {
  return allowedContext(profile, tree).map(node => node.country)
}

/**
 * Resolve a scope to a concrete country list. SCOPE_ALL expands to every allowed
 * country; anything the user may not see is DROPPED (persisted state is never
 * trusted). Returns canonical spellings taken from `allowed`.
 */
export function scopeCountries(scope, allowed) {
  const permitted = (Array.isArray(allowed) ? allowed : []).map(txt).filter(Boolean)
  const entries = entriesOf(scope)
  if (!entries.length) return []
  if (entries.some(isAll)) return permitted
  const byLower = new Map(permitted.map(c => [c.toLowerCase(), c]))
  const out = []
  for (const entry of entries) {
    const hit = byLower.get(entry.toLowerCase())
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

/**
 * Readable label. ASCII only, and never flattering: a scope that resolves to
 * nothing says so instead of implying full coverage.
 */
export function scopeLabel(scope, allowed) {
  const permitted = (Array.isArray(allowed) ? allowed : []).map(txt).filter(Boolean)
  const resolved = scopeCountries(scope, permitted)
  if (!resolved.length) return 'No countries'
  if (resolved.length === 1) return resolved[0]
  if (permitted.length > 1 && resolved.length === permitted.length) return 'All countries'
  return `${resolved.length} countries`
}

/**
 * Validate a restored / incoming scope against what the user may see now.
 * Returns { scope, changed, reason } - the same shape as
 * workingContext.normalizeContext, so the pair reads consistently.
 *   null                    the saved scope stands
 *   'initial'               nothing usable was saved, a default was picked
 *   'countries_unavailable' some or all saved countries are no longer permitted
 *   'no_access'             the user may aggregate over nothing
 */
export function normalizeScope(saved, allowed) {
  const permitted = (Array.isArray(allowed) ? allowed : []).map(txt).filter(Boolean)
  if (!permitted.length) {
    return { scope: { countries: [] }, changed: true, reason: 'no_access' }
  }

  // The honest default: everything the user may see when that is more than one
  // country, otherwise the single country itself (SCOPE_ALL would be a needless
  // indirection for a one-country user).
  const fallback = () => (permitted.length > 1
    ? { countries: [SCOPE_ALL] }
    : { countries: [permitted[0]] })

  const entries = entriesOf(saved)
  if (!entries.length) return { scope: fallback(), changed: true, reason: 'initial' }

  const resolved = scopeCountries(entries, permitted)
  if (!resolved.length) {
    return { scope: fallback(), changed: true, reason: 'countries_unavailable' }
  }

  if (entries.some(isAll)) {
    // Keep the sentinel where it still means something: it should carry on
    // meaning "all" as the user's scope widens. Nothing was denied here, so the
    // reason stays null even when the representation was tidied.
    const scope = permitted.length > 1 ? { countries: [SCOPE_ALL] } : { countries: [permitted[0]] }
    const tidy = entries.length === 1 && permitted.length > 1
    return { scope, changed: !tidy, reason: null }
  }

  const dropped = resolved.length !== entries.length
  return {
    scope: { countries: resolved },
    changed: dropped,
    reason: dropped ? 'countries_unavailable' : null,
  }
}
