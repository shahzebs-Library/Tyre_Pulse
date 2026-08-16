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
 * Recently opened RECORDS (a vehicle, a tyre, a job card, a case) live in their
 * own store under their own key. Deliberately NOT mixed into RECENTS_KEY:
 *
 *  - a nav recent is a ROUTE and nothing else, resolved against the live nav.
 *    Records have no nav entry to resolve against, so they must carry a label,
 *    and letting a labelled object into the route store would break every
 *    resolver above (and a route into this one would render an untitled row).
 *  - the two are recorded by different surfaces - Layout records nav routes on
 *    navigation, the palette records a record when the user PICKS one - so
 *    sharing a key would let one starve the other out of the cap.
 */
export const RECORD_RECENTS_KEY = 'tp_record_recents'
export const MAX_RECORD_RECENTS = 6

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

// ── Recent records ───────────────────────────────────────────────────────────
//
// A record entry stores the MINIMUM that cannot be recovered later:
//   path    where it opens ('/vehicle/TM527', '/tyres?search=24098182')
//   label   what it is called ('TM527') - there is no nav entry to read it from
//   source  which RECORD_SOURCES entry produced it ('vehicles', 'tyres', ...)
//   icon    optional glyph name, display only
//
// `source` is what keeps the permission rule honest. Access is NOT stored;
// instead the source id lets the caller re-resolve that source's live `access`
// descriptor on every render, so a user who loses the module stops seeing its
// records immediately - the same reason the route stores keep nothing but a
// path. A source that no longer exists is dropped, never invented.

/** Is this a usable stored record? All three required fields must be real. */
function isRecord(v) {
  return !!v
    && typeof v === 'object'
    && isRoute(v.path)
    && typeof v.label === 'string' && v.label.trim().length > 0
    && typeof v.source === 'string' && v.source.trim().length > 0
}

/** Clean a raw record list: keep real entries, trim, de-duplicate by PATH, cap. */
function normalizeRecords(list, max = MAX_RECORD_RECENTS) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (!isRecord(raw)) continue
    const path = raw.path.trim()
    if (seen.has(path)) continue
    seen.add(path)
    out.push({
      path,
      label: raw.label.trim(),
      source: raw.source.trim(),
      ...(typeof raw.icon === 'string' && raw.icon ? { icon: raw.icon } : {}),
    })
    if (out.length >= max) break
  }
  return out
}

/** Recently opened records, most recent first. Returns [] on any failure. */
export function loadRecentRecords() {
  try {
    const raw = globalThis.localStorage?.getItem(RECORD_RECENTS_KEY)
    if (!raw) return []
    return normalizeRecords(JSON.parse(raw))
  } catch {
    return []
  }
}

/**
 * Record that the user opened a record. Re-opening MOVES it to the front rather
 * than adding a duplicate. Junk is ignored silently - a shortcut list is never
 * worth failing a navigation over.
 * @returns {Array} the new list
 */
export function pushRecentRecord(record) {
  const [clean] = normalizeRecords([record], 1)
  if (!clean) return loadRecentRecords()
  const next = normalizeRecords(
    [clean, ...loadRecentRecords().filter((r) => r.path !== clean.path)],
  )
  try {
    globalThis.localStorage?.setItem(RECORD_RECENTS_KEY, JSON.stringify(next))
  } catch {
    // Storage disabled or full: the returned list is still right for this
    // session, it just will not survive a reload.
  }
  return next
}

/**
 * Resolve stored records against the user's CURRENT access. Pure.
 *
 * Fails closed for the same reason `resolveRoutes` does: without a usable
 * predicate we cannot prove the user may open these, so none are returned.
 *
 * @param {Array} records  stored entries, in display order
 * @param {(record:object)=>boolean} canSee  re-evaluated on every render
 * @param {number} [max]
 */
export function visibleRecentRecords(records, canSee, max = MAX_RECORD_RECENTS) {
  if (!Array.isArray(records)) return []
  if (typeof canSee !== 'function') return []
  const out = []
  for (const entry of normalizeRecords(records, max)) {
    if (canSee(entry) !== true) continue
    out.push(entry)
    if (out.length >= max) break
  }
  return out
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
