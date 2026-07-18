/**
 * Nav layout — pure, deterministic overlay engine for the super-admin
 * Navigation Customizer.
 *
 * The sidebar's structure lives in `NAV_GROUPS` (src/components/Layout.jsx): an
 * ordered list of groups, each with an ordered list of items. A super-admin can
 * reorder groups, reorder items inside a group, move an item to a different
 * group, rename a group, and hide groups/items. Rather than replace the nav, we
 * persist a small OVERLAY and apply it on top of the built-in defaults:
 *
 *   {
 *     version: 1,
 *     groups: [{ key, order, hidden, label? }],   // group key = its default label
 *     items:  [{ key, group, order, hidden }],     // item key = its route (`to`)
 *   }
 *
 * DESIGN RULES
 * - PURE + DETERMINISTIC: no I/O, no clock, no Math.random. Same inputs → same
 *   output, always. Fully covered by src/test/navLayout.test.js.
 * - OVERLAY, never a replacement: any group or item NOT mentioned in the layout
 *   keeps its default identity and is appended after the customized ones, so a
 *   partial or stale layout can never drop modules from the menu.
 * - HIDING IS COSMETIC, NOT SECURITY: an item hidden here is only removed from
 *   the sidebar for menu tidiness. Its route is still reachable and its access is
 *   still governed by RBAC/flags. This engine performs NO role/flag gating and
 *   MUST NOT be relied on for it — `applyNavLayout` runs BEFORE Layout.jsx's
 *   role/flag filtering, so gating still runs on the reordered/regrouped set and
 *   an item the user is not allowed to see is never surfaced by reordering it.
 * - UNKNOWN KEYS ARE IGNORED: a layout referencing a group/item that no longer
 *   exists (renamed route, removed module) is silently dropped, never invented.
 *
 * The engine is written against a generic "groups with items" shape so it works
 * for BOTH the live `NAV_GROUPS` (group key = `label`, item key = `to`) and the
 * lightweight `NAV_CATALOG` used by the console editor (group/item key = `key`).
 */

/** Group key = explicit `key` when present (catalog), else its `label` (NAV_GROUPS). */
const groupKeyOf = (g) => (g && typeof g.key === 'string' ? g.key : g && g.label) || ''
/** Item key = explicit `key` when present (catalog), else its route `to` (NAV_GROUPS). */
const itemKeyOf = (it) => (it && typeof it.key === 'string' ? it.key : it && it.to) || ''
/** Stable string comparator (tie-breaker so ordering is fully deterministic). */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Coerce a value to a finite number, or return null (missing/blank/NaN). */
function finiteOrNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/**
 * Validate and clamp a raw (possibly untrusted / stale) layout into the canonical
 * shape `{ version:1, groups:[], items:[] }`. Drops malformed entries, non-string
 * keys, duplicate keys (first wins), and non-numeric orders. Never throws.
 *
 * @param {*} raw
 * @returns {{version:1, groups:Array, items:Array}}
 */
export function normalizeNavLayout(raw) {
  const out = { version: 1, groups: [], items: [] }
  if (!raw || typeof raw !== 'object') return out

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : []
  const seenG = new Set()
  for (const g of rawGroups) {
    if (!g || typeof g !== 'object') continue
    const key = typeof g.key === 'string' ? g.key.trim() : ''
    if (!key || seenG.has(key)) continue
    seenG.add(key)
    const e = { key }
    const order = finiteOrNull(g.order)
    if (order !== null) e.order = order
    if (typeof g.hidden === 'boolean') e.hidden = g.hidden
    if (typeof g.label === 'string' && g.label.trim() !== '') e.label = g.label.trim()
    out.groups.push(e)
  }

  const rawItems = Array.isArray(raw.items) ? raw.items : []
  const seenI = new Set()
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue
    const key = typeof it.key === 'string' ? it.key.trim() : ''
    if (!key || seenI.has(key)) continue
    seenI.add(key)
    const e = { key }
    if (typeof it.group === 'string' && it.group.trim() !== '') e.group = it.group.trim()
    const order = finiteOrNull(it.order)
    if (order !== null) e.order = order
    if (typeof it.hidden === 'boolean') e.hidden = it.hidden
    out.items.push(e)
  }

  return out
}

/**
 * Core resolver shared by `applyNavLayout` and `buildNavEditorModel`. Returns the
 * fully-ordered group/item structure INCLUDING hidden entries (so the editor can
 * surface them to be un-hidden). Each returned group carries its source object so
 * `applyNavLayout` can preserve group-level props (groupRoles, etc.).
 *
 * @param {Array} defaultGroups the built-in nav definition
 * @param {*} rawLayout
 * @returns {Array<{key,defaultLabel,label,hidden,src,items:Array<{key,item,hidden,order,defaultIndex}>}>}
 */
function resolveNav(defaultGroups, rawLayout) {
  if (!Array.isArray(defaultGroups)) return []
  const layout = normalizeNavLayout(rawLayout)
  const gOv = new Map(layout.groups.map((g) => [g.key, g]))
  const iOv = new Map(layout.items.map((i) => [i.key, i]))

  const groupKeys = defaultGroups.map(groupKeyOf)
  const groupByKey = new Map(defaultGroups.map((g) => [groupKeyOf(g), g]))
  const groupIndex = new Map(groupKeys.map((k, i) => [k, i]))

  // Item catalog: key -> { item, defaultGroup, defaultIndex }.
  const itemCat = new Map()
  defaultGroups.forEach((g) => {
    const gk = groupKeyOf(g)
    ;(Array.isArray(g.items) ? g.items : []).forEach((it, idx) => {
      itemCat.set(itemKeyOf(it), { item: it, defaultGroup: gk, defaultIndex: idx })
    })
  })

  // Group ordering: groups given an explicit order come first (sorted by it,
  // default-index tie-break); groups not mentioned keep their default order and
  // are appended after the customized ones.
  const withOrder = []
  const without = []
  groupKeys.forEach((k) => {
    const ov = gOv.get(k)
    if (ov && typeof ov.order === 'number') withOrder.push(k)
    else without.push(k)
  })
  withOrder.sort((a, b) => (gOv.get(a).order - gOv.get(b).order) || (groupIndex.get(a) - groupIndex.get(b)))
  const orderedGroupKeys = [...withOrder, ...without]

  // Bucket every item into its EFFECTIVE group (default group, unless a valid
  // regroup override points it at another existing group).
  const bucket = new Map(groupKeys.map((k) => [k, []]))
  itemCat.forEach(({ item, defaultGroup, defaultIndex }, key) => {
    const ov = iOv.get(key)
    let group = defaultGroup
    if (ov && typeof ov.group === 'string' && groupByKey.has(ov.group)) group = ov.group
    const hidden = !!(ov && ov.hidden)
    const order = ov && typeof ov.order === 'number' ? ov.order : null
    bucket.get(group).push({ key, item, hidden, order, defaultIndex })
  })

  // Sort each bucket: explicit-order items first (by order), then the rest in
  // default order; string key as the final deterministic tie-break.
  bucket.forEach((list) => {
    list.sort((a, b) => {
      const am = a.order !== null
      const bm = b.order !== null
      if (am && bm) return (a.order - b.order) || cmp(a.key, b.key)
      if (am) return -1
      if (bm) return 1
      return (a.defaultIndex - b.defaultIndex) || cmp(a.key, b.key)
    })
  })

  return orderedGroupKeys.map((k) => {
    const src = groupByKey.get(k)
    const ov = gOv.get(k)
    const defaultLabel = (src && src.label) || k
    const label = ov && typeof ov.label === 'string' && ov.label.trim() !== '' ? ov.label.trim() : defaultLabel
    const hidden = !!(ov && ov.hidden)
    return { key: k, defaultLabel, label, hidden, src, items: bucket.get(k) }
  })
}

/**
 * Apply a persisted layout to the built-in nav, returning EFFECTIVE groups ready
 * for the sidebar: reordered, regrouped, renamed, with hidden groups/items
 * removed. Item objects are the ORIGINAL references, so their role/flag/adminOnly
 * gates are preserved untouched — Layout.jsx applies gating to this result, so
 * reordering/regrouping can never bypass access control.
 *
 * An empty/absent layout returns the defaults (same order, same items).
 *
 * @param {Array} defaultGroups
 * @param {*} layout
 * @returns {Array} effective groups: { ...group, key, label, items }
 */
export function applyNavLayout(defaultGroups, layout) {
  if (!Array.isArray(defaultGroups)) return []
  return resolveNav(defaultGroups, layout)
    .filter((g) => !g.hidden)
    .map((g) => ({
      ...(g.src || {}),
      key: g.key,
      label: g.label,
      items: g.items.filter((e) => !e.hidden).map((e) => e.item),
    }))
}

/**
 * Build the editor-facing model for the console customizer: the full group/item
 * tree in effective order, INCLUDING hidden entries (flagged) so they can be
 * toggled back on. Lightweight labels only (no icons / gates).
 *
 * @param {Array} defaultGroups
 * @param {*} layout
 * @returns {Array<{key,label,defaultLabel,hidden,items:Array<{key,label,hidden}>}>}
 */
export function buildNavEditorModel(defaultGroups, layout) {
  return resolveNav(defaultGroups, layout).map((g) => ({
    key: g.key,
    label: g.label,
    defaultLabel: g.defaultLabel,
    hidden: g.hidden,
    items: g.items.map((e) => ({
      key: e.key,
      label: (e.item && e.item.label) || e.key,
      hidden: e.hidden,
    })),
  }))
}

/**
 * Serialize an editor model back into the canonical persisted layout. Emits an
 * explicit order for every group and item (fully-specified layout) so the applied
 * result exactly reproduces the edited arrangement. A group label is only stored
 * when it differs from its default, so renames are honest and reversible.
 *
 * @param {Array<{key,label,defaultLabel,hidden,items:Array<{key,hidden}>}>} model
 * @returns {{version:1, groups:Array, items:Array}}
 */
export function editorModelToLayout(model) {
  const groups = []
  const items = []
  ;(Array.isArray(model) ? model : []).forEach((g, gi) => {
    const entry = { key: g.key, order: gi, hidden: !!g.hidden }
    if (typeof g.label === 'string' && g.label.trim() !== '' && g.label !== g.defaultLabel) {
      entry.label = g.label.trim()
    }
    groups.push(entry)
    ;(Array.isArray(g.items) ? g.items : []).forEach((it, ii) => {
      items.push({ key: it.key, group: g.key, order: ii, hidden: !!it.hidden })
    })
  })
  return normalizeNavLayout({ version: 1, groups, items })
}
