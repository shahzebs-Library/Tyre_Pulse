/**
 * Safe client-side PostgREST search-filter helpers.
 *
 * Screens build `.or('col.ilike.%term%,...')` expressions from a user-typed
 * search box. PostgREST treats comma and parentheses as list / logic-tree
 * delimiters, and SQL LIKE treats %, _, backslash (and the abbreviated `*`
 * wildcard) as pattern metacharacters. Interpolating a raw user string can
 * therefore break the filter or silently change what it matches.
 *
 * NOTE: the ideal long-term fix is a server-side indexed search RPC with
 * pagination (so we never fetch-then-filter and never build filters on the
 * client). This module is the immediate safety fix for the filters we build
 * on the client today: it turns any user term into a plain literal substring.
 */

// Characters that either delimit a PostgREST .or()/logic tree (comma, parens)
// or act as LIKE/ilike pattern metacharacters (%, _, backslash, *). We strip
// them so the remaining term is always matched literally. Hyphens, dots and
// single spaces are KEPT (common in asset numbers / serials / multi-word terms).
const UNSAFE_LIKE_CHARS = /[,()%_\\*]/g

const MAX_TERM_LENGTH = 100

/**
 * Sanitize a user search term for safe use inside an ilike pattern and inside
 * a comma-separated .or() list. Strips PostgREST/LIKE-significant characters,
 * collapses whitespace and caps the length. Returns '' for empty/whitespace
 * (the caller should then skip the search filter entirely).
 */
export function escapeLike(term: string): string {
  if (!term) return ''
  return term
    .replace(UNSAFE_LIKE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERM_LENGTH)
}

/**
 * Build a SAFE `col.ilike.%term%` comma-joined expression for supabase `.or()`
 * from an escaped term. Returns null when the term is empty or no columns are
 * given, so the caller can skip the `.or()` filter rather than send a broken or
 * unbounded one.
 */
export function orIlike(columns: string[], term: string): string | null {
  const safe = escapeLike(term)
  if (!safe) return null
  const cols = columns.filter(Boolean)
  if (cols.length === 0) return null
  return cols.map(col => `${col}.ilike.%${safe}%`).join(',')
}
