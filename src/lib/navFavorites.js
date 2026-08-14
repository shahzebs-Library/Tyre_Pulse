/**
 * Nav favourites + recents - pinned routes and a "where I just was" trail for
 * the sidebar / command palette.
 *
 * Two halves, deliberately separated:
 *   - a thin localStorage layer (loadFavorites / saveFavorites / toggleFavorite /
 *     isFavorite / loadRecents / pushRecent) that can NEVER throw, and
 *   - PURE resolvers (visibleFavorites / visibleRecents) that take the stored
 *     routes, the live nav index and a permission predicate and return only what
 *     the user may actually open. No I/O, no clock, fully unit-testable.
 *
 * DESIGN RULES
 * - ROUTES ONLY. We persist route strings ('/tyres'), never labels and never
 *   permission state. Labels are read from the live nav at render time, so a
 *   renamed module cannot show a stale name; and access is RE-EVALUATED on every
 *   render, so a module revoked in the access matrix can never linger as a
 *   usable favourite. Caching the permission would turn a revoke into a
 *   still-clickable shortcut - the whole reason this file stores nothing but a path.
 * - FAIL CLOSED ON PERMISSION. If `canSee` is not a function we cannot verify
 *   access, so nothing is returned. "We could not check" is not "it is allowed".
 * - STORAGE IS OPTIONAL. localStorage can be disabled (private mode, embedded
 *   webview, storage quota). Every access is wrapped; a failure degrades to an
 *   empty list and the feature simply does nothing. It must never break the nav.
 * - UNKNOWN ROUTES ARE DROPPED, NEVER INVENTED. A favourite whose route no
 *   longer exists in the nav (removed module, renamed path) is filtered out.
 * - HOME IS NOT A "RECENT". Everyone lands on the dashboard, so recording it
 *   would push out the real signal - the handful of screens the user actually
 *   navigated to on purpose.
 */

export const FAVORITES_KEY = 'tp_nav_favorites'
export const RECENTS_KEY = 'tp_nav_recents'
export const MAX_FAVORITES = 12
export const MAX_RECENTS = 8

/**
 * Routes never recorded as a recent: the landing pages every session starts on.
 * Both are listed because '/' and '/dashboard' are the same destination here.
 */
export const RECENTS_EXCLUDED = new Set(['/', '/dashboard'])

/** A usable route is a non-blank absolute path. Anything else is junk from storage. */
function isRoute(v) {
  return typeof v === 'string' && v.trim().length > 1 && v.trim().startsWith('/')
}

/**
 * Clean a raw list: keep only real routes, trim, de-duplicate (first occurrence
 * wins so caller-supplied order is preserved), then cap.
 */
function normalizeRoutes(list, max) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (!isRoute(raw)) continue
    const route = raw.trim()
    if (seen.has(route)) continue
    seen.add(route)
    out.push(route)
    if (out.length >= max) break
  }
  return out
}

/** Read a capped route list from storage. Returns [] on any failure. */
function readRoutes(key, max) {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (!raw) return []
    return normalizeRoutes(JSON.parse(raw), max)
  } catch {
    // Storage unavailable or the stored value is not valid JSON. Either way the
    // feature has no data - that is not an error worth surfacing to the user.
    return []
  }
}

/**
 * Persist a capped route list. Returns the list that was written (already
 * normalized) so callers can update state from one value, even when the write
 * itself failed.
 */
function writeRoutes(key, routes, max) {
  const clean = normalizeRoutes(routes, max)
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(clean))
  } catch {
    // Quota exceeded or storage disabled - the in-memory list is still correct
    // for this session, it just will not survive a reload.
  }
  return clean
}

// ── Favourites ───────────────────────────────────────────────────────────────

/** Pinned routes, newest first. */
export function loadFavorites() {
  return readRoutes(FAVORITES_KEY, MAX_FAVORITES)
}

/** Replace the pinned set. Returns the normalized list actually stored. */
export function saveFavorites(routes) {
  return writeRoutes(FAVORITES_KEY, routes, MAX_FAVORITES)
}

/**
 * Pin or unpin a route. A new pin goes to the FRONT; at the cap the oldest pin
 * (the last entry) is dropped, so pinning always visibly works rather than
 * silently refusing.
 * @returns {string[]} the new pinned list
 */
export function toggleFavorite(route) {
  if (!isRoute(route)) return loadFavorites()
  const target = route.trim()
  const current = loadFavorites()
  const next = current.includes(target)
    ? current.filter((r) => r !== target)
    : [target, ...current]
  return saveFavorites(next)
}

/** Is this route currently pinned? */
export function isFavorite(route) {
  if (!isRoute(route)) return false
  return loadFavorites().includes(route.trim())
}

// ── Recents ──────────────────────────────────────────────────────────────────

/** Recently visited routes, most recent first. */
export function loadRecents() {
  return readRoutes(RECENTS_KEY, MAX_RECENTS)
}

/**
 * Record a visit. Re-visiting a route MOVES it to the front instead of adding a
 * duplicate. The dashboard/home route is skipped (see RECENTS_EXCLUDED).
 * @returns {string[]} the new recents list
 */
export function pushRecent(route) {
  if (!isRoute(route)) return loadRecents()
  const target = route.trim()
  if (RECENTS_EXCLUDED.has(target)) return loadRecents()
  const current = loadRecents()
  return writeRoutes(RECENTS_KEY, [target, ...current.filter((r) => r !== target)], MAX_RECENTS)
}

// ── Pure resolvers ───────────────────────────────────────────────────────────

/**
 * Resolve stored routes against the LIVE nav and the user's access. Pure.
 *
 * @param {string[]} routes  stored route strings, in display order
 * @param {Record<string, {label?:string, group?:string}>} navIndex  route -> nav entry
 * @param {(route:string)=>boolean} canSee  permission predicate, re-evaluated per render
 * @param {number} max  cap
 * @returns {{route:string, label:string, group:string}[]}
 */
function resolveRoutes(routes, navIndex, canSee, max) {
  if (!Array.isArray(routes) || !navIndex) return []
  // Fail closed: without a usable predicate we cannot prove the user may open
  // these routes, so we surface none of them.
  if (typeof canSee !== 'function') return []
  const out = []
  const seen = new Set()
  for (const raw of routes) {
    if (!isRoute(raw)) continue
    const route = raw.trim()
    if (seen.has(route)) continue
    const entry = navIndex[route]
    if (!entry) continue            // module no longer in the nav - drop, never invent
    if (canSee(route) !== true) continue // revoked or never granted - hide
    seen.add(route)
    out.push({
      route,
      label: entry.label || route,
      group: entry.group || '',
    })
    if (out.length >= max) break
  }
  return out
}

/** Pinned entries the user can still open. Pure. */
export function visibleFavorites(routes, navIndex, canSee) {
  return resolveRoutes(routes, navIndex, canSee, MAX_FAVORITES)
}

/** Recent entries the user can still open. Pure. */
export function visibleRecents(routes, navIndex, canSee) {
  return resolveRoutes(routes, navIndex, canSee, MAX_RECENTS)
}
