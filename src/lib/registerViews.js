/**
 * Register views — the pure engine behind Level 2 "operator-grade" registers.
 *
 * A saved view is what an operator arranged and wants back tomorrow: which
 * columns, in what order, how wide, what is pinned, how it is sorted, which
 * filters and how dense. This module owns the RULES; it performs no I/O so it
 * can be tested exhaustively. The service layer persists the shape it returns.
 *
 * THE TWO RULES THAT MATTER, because both fail silently:
 *
 *  1. A NEW COLUMN MUST APPEAR. When a release adds a column, every operator
 *     with a saved view would otherwise never see it — their view lists the old
 *     columns and the new one is simply absent. Months later someone reports
 *     "the app is missing the X column" and it has been shipped all along. So a
 *     column present in the catalog but absent from the saved view is APPENDED
 *     and VISIBLE. Opt-out is an explicit hide, never an omission.
 *
 *  2. A REMOVED COLUMN MUST VANISH QUIETLY. When a column is dropped from the
 *     app, a saved view still naming it must not render a ghost header over
 *     undefined cells. Unknown keys are dropped, not preserved "just in case".
 *
 * Together: the catalog is the source of truth for WHICH columns exist; the
 * saved view only expresses PREFERENCE over them.
 */

export const DENSITIES = ['comfortable', 'compact']
export const SORT_DIRS = ['asc', 'desc']

/** Hard ceilings so a corrupt or hostile stored blob cannot break a layout. */
export const LIMITS = {
  nameMax: 60,
  minWidth: 56,
  maxWidth: 720,
  maxPinned: 4,
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * A column catalog entry is `{ key, label, defaultHidden?, pinnable?, width? }`.
 * `catalogKeys` keeps the app's own declared order — that is the fallback order
 * for anything the saved view does not mention.
 */
export function catalogKeys(catalog) {
  return (Array.isArray(catalog) ? catalog : []).map((c) => c && c.key).filter(Boolean)
}

/** Empty, valid view for a page that has never been customised. */
export function emptyView(moduleKey = '') {
  return {
    moduleKey: String(moduleKey || ''),
    name: '',
    columns: [],
    hidden: [],
    widths: {},
    pinned: [],
    sort: null,
    filters: {},
    density: null,
  }
}

/**
 * normalizeView — reconcile a stored view against the CURRENT column catalog.
 * Always returns a valid view; never throws, whatever the stored blob contains.
 */
export function normalizeView(raw, catalog) {
  const known = catalogKeys(catalog)
  const knownSet = new Set(known)
  const byKey = new Map((catalog || []).filter(Boolean).map((c) => [c.key, c]))
  const v = raw && typeof raw === 'object' ? raw : {}

  // Rule 2: keep only columns that still exist, de-duplicated, order preserved.
  const ordered = []
  const seen = new Set()
  for (const k of Array.isArray(v.columns) ? v.columns : []) {
    if (knownSet.has(k) && !seen.has(k)) { ordered.push(k); seen.add(k) }
  }
  // Rule 1: anything new in the catalog is appended, in catalog order.
  for (const k of known) if (!seen.has(k)) { ordered.push(k); seen.add(k) }

  // Hidden: only meaningful for a column that exists. A column the CATALOG
  // marks defaultHidden starts hidden, but only while the view has never
  // expressed an opinion about it (i.e. it was not in the stored column list).
  const storedKnew = new Set((Array.isArray(v.columns) ? v.columns : []).filter((k) => knownSet.has(k)))
  const explicitHidden = new Set((Array.isArray(v.hidden) ? v.hidden : []).filter((k) => knownSet.has(k)))
  const hidden = ordered.filter((k) => {
    if (explicitHidden.has(k)) return true
    if (storedKnew.has(k)) return false          // the view already showed it
    return !!(byKey.get(k) || {}).defaultHidden  // brand new -> catalog decides
  })

  // Widths: numeric and clamped only.
  const widths = {}
  const rawW = v.widths && typeof v.widths === 'object' ? v.widths : {}
  for (const [k, w] of Object.entries(rawW)) {
    if (!knownSet.has(k)) continue
    const n = typeof w === 'string' ? Number(w) : w
    if (isFiniteNum(n)) widths[k] = clamp(Math.round(n), LIMITS.minWidth, LIMITS.maxWidth)
  }

  // Pinned: existing, pinnable, visible, de-duplicated, capped.
  const hiddenSet = new Set(hidden)
  const pinned = []
  for (const k of Array.isArray(v.pinned) ? v.pinned : []) {
    if (!knownSet.has(k) || hiddenSet.has(k) || pinned.includes(k)) continue
    if ((byKey.get(k) || {}).pinnable === false) continue
    if (pinned.length >= LIMITS.maxPinned) break
    pinned.push(k)
  }

  // Sort: must name a column that still exists, else drop it entirely. Sorting
  // by a vanished column would silently reorder rows by nothing.
  let sort = null
  if (v.sort && knownSet.has(v.sort.key)) {
    sort = { key: v.sort.key, dir: SORT_DIRS.includes(v.sort.dir) ? v.sort.dir : 'asc' }
  }

  return {
    moduleKey: String(v.moduleKey || ''),
    name: String(v.name || '').slice(0, LIMITS.nameMax),
    columns: ordered,
    hidden,
    widths,
    pinned,
    sort,
    filters: v.filters && typeof v.filters === 'object' && !Array.isArray(v.filters) ? { ...v.filters } : {},
    density: DENSITIES.includes(v.density) ? v.density : null,
  }
}

/**
 * resolveColumns — what the table actually renders: pinned first (in pin
 * order), then the rest in view order, hidden removed, each carrying its width.
 */
export function resolveColumns(view, catalog) {
  const v = normalizeView(view, catalog)
  const byKey = new Map((catalog || []).filter(Boolean).map((c) => [c.key, c]))
  const hiddenSet = new Set(v.hidden)
  const pinnedSet = new Set(v.pinned)

  const decorate = (key, isPinned) => {
    const c = byKey.get(key) || {}
    return { ...c, key, pinned: isPinned, width: v.widths[key] ?? c.width ?? null }
  }

  return [
    ...v.pinned.map((k) => decorate(k, true)),
    ...v.columns.filter((k) => !hiddenSet.has(k) && !pinnedSet.has(k)).map((k) => decorate(k, false)),
  ]
}

/** Toggle one column's visibility. Refuses to hide the last visible column. */
export function toggleColumn(view, catalog, key) {
  const v = normalizeView(view, catalog)
  if (!v.columns.includes(key)) return v
  const hiddenSet = new Set(v.hidden)
  if (hiddenSet.has(key)) {
    hiddenSet.delete(key)
  } else {
    // A table with zero columns is a blank screen the operator cannot recover
    // from without knowing the reset control exists.
    if (v.columns.filter((k) => !hiddenSet.has(k)).length <= 1) return v
    hiddenSet.add(key)
  }
  const next = { ...v, hidden: v.columns.filter((k) => hiddenSet.has(k)) }
  // Hiding a pinned column unpins it, or the pin rail renders an empty slot.
  next.pinned = v.pinned.filter((k) => !hiddenSet.has(k))
  return normalizeView(next, catalog)
}

/** Move a column to a new index in the view order. */
export function moveColumn(view, catalog, key, toIndex) {
  const v = normalizeView(view, catalog)
  const from = v.columns.indexOf(key)
  if (from < 0) return v
  const cols = v.columns.slice()
  cols.splice(from, 1)
  cols.splice(clamp(toIndex, 0, cols.length), 0, key)
  return normalizeView({ ...v, columns: cols }, catalog)
}

/** Pin / unpin, respecting the cap and the pinnable flag. */
export function togglePin(view, catalog, key) {
  const v = normalizeView(view, catalog)
  const next = v.pinned.includes(key) ? v.pinned.filter((k) => k !== key) : [...v.pinned, key]
  return normalizeView({ ...v, pinned: next }, catalog)
}

/** Set a column width; the clamp lives in normalizeView so it cannot be bypassed. */
export function setWidth(view, catalog, key, width) {
  const v = normalizeView(view, catalog)
  return normalizeView({ ...v, widths: { ...v.widths, [key]: width } }, catalog)
}

/** Cycle a column's sort: none -> asc -> desc -> none. */
export function cycleSort(view, catalog, key) {
  const v = normalizeView(view, catalog)
  if (!v.columns.includes(key)) return v
  let sort
  if (!v.sort || v.sort.key !== key) sort = { key, dir: 'asc' }
  else if (v.sort.dir === 'asc') sort = { key, dir: 'desc' }
  else sort = null
  return normalizeView({ ...v, sort }, catalog)
}

/**
 * isCustomised — has the operator actually changed anything from the catalog
 * default? Drives whether a "Reset view" control is offered at all; showing it
 * permanently trains people to ignore it.
 */
export function isCustomised(view, catalog) {
  const v = normalizeView(view, catalog)
  const base = normalizeView(emptyView(v.moduleKey), catalog)
  return (
    v.columns.join('|') !== base.columns.join('|') ||
    v.hidden.join('|') !== base.hidden.join('|') ||
    v.pinned.join('|') !== base.pinned.join('|') ||
    Object.keys(v.widths).length > 0 ||
    !!v.sort ||
    Object.keys(v.filters).length > 0 ||
    v.density !== base.density
  )
}

/** Human summary for a view chip, e.g. "8 of 12 columns, sorted by Cost". */
export function describeView(view, catalog) {
  const v = normalizeView(view, catalog)
  const total = v.columns.length
  const shown = total - v.hidden.length
  const byKey = new Map((catalog || []).filter(Boolean).map((c) => [c.key, c]))
  const parts = []
  if (total) parts.push(shown === total ? `all ${total} columns` : `${shown} of ${total} columns`)
  if (v.pinned.length) parts.push(`${v.pinned.length} pinned`)
  if (v.sort) parts.push(`sorted by ${(byKey.get(v.sort.key) || {}).label || v.sort.key}`)
  const nf = Object.keys(v.filters).length
  if (nf) parts.push(`${nf} filter${nf === 1 ? '' : 's'}`)
  return parts.join(', ')
}
