/**
 * Sanitise user-typed search terms before they are interpolated into PostgREST
 * filter strings (`.or('col.ilike.%term%,...')`, `.ilike`, `.eq`).
 *
 * In a PostgREST `.or(...)` expression the characters `,` `(` `)` are STRUCTURAL
 * (they separate conditions and open/close groups) and `*` is an `ilike`
 * wildcard. A raw search term containing them can break out of its intended
 * condition and inject additional predicates, provoke query errors, or turn a
 * search into a match-all scan. Row access is still bounded by RLS, but this
 * removes the predicate-injection / malformed-filter surface entirely.
 *
 * We strip the structural metacharacters and the `*` wildcard; `%` is left as-is
 * because callers add their own `%term%` wrappers and a stray `%` only widens the
 * (row-scoped, limited) match.
 *
 * @param {unknown} term
 * @returns {string} a safe term (empty string for nullish input)
 */
export function sanitizeSearchTerm(term) {
  if (term == null) return ''
  return String(term).replace(/[,()\\*]/g, '').trim()
}
