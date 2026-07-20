/**
 * Site-scope sentinel semantics (single source of truth).
 *
 * Attribute-based access scoping for a user's `sites` array:
 *   - blank / empty / non-array        -> NO site-scoped access
 *   - contains an 'ALL' / '*' sentinel -> org-wide (every site)
 *   - a specific list                  -> exactly those sites
 *
 * Admins / super-admins always see everything regardless of this value; this
 * module only governs the attribute list itself. Kept as a tiny pure module so
 * the console UI and the invariant tests share ONE implementation.
 */

// The tokens that mean "org-wide" when present anywhere in a sites array.
export const SITE_ALL_TOKENS = ['ALL', '*']

const normalizeToken = (s) => String(s ?? '').trim().toUpperCase()

/**
 * True when the sites array grants org-wide access via an ALL/* sentinel.
 * Blank/empty/non-array is NOT org-wide (it is no access).
 * @param {unknown} arr
 * @returns {boolean}
 */
export function isOrgWideSites(arr) {
  return Array.isArray(arr) && arr.some((s) => SITE_ALL_TOKENS.includes(normalizeToken(s)))
}

/**
 * Return the concrete (non-sentinel) sites, stripping any ALL/* tokens.
 * Non-array input yields an empty array.
 * @param {unknown} arr
 * @returns {string[]}
 */
export function withoutOrgWide(arr) {
  return (Array.isArray(arr) ? arr : []).filter(
    (s) => !SITE_ALL_TOKENS.includes(normalizeToken(s)),
  )
}
