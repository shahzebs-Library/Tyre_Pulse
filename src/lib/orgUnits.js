/**
 * Organization Units — pure, dependency-free domain logic for the Organization
 * Hierarchy admin module (/org-hierarchy, Enterprise §3). Turns a flat set of
 * `org_units` rows (each carrying an optional `parent_id`) into a navigable tree
 * and derives descendant sets, depth, active-assignment windows, and a KPI
 * summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/orgUnits.js`) and page
 * (`src/pages/OrgHierarchy.jsx`) both build on these primitives so the hierarchy
 * logic lives in exactly one place.
 *
 * Hierarchy is modelled by id (`parent_id` -> `id`) — a hard reference. Because
 * ids are user-reparentable, every traversal here is cycle-guarded: a node that
 * (directly or transitively) lists itself as an ancestor is treated as a
 * root/leaf boundary rather than recursed into forever.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Normalise an id to a stable key (trimmed string, or '' when absent). */
function idKey(v) {
  return v == null ? '' : String(v).trim()
}

/**
 * Index rows by their id (last row wins on duplicate ids) and expose parent →
 * [children]. Shared by every traversal so a `parent_id` that doesn't exist in
 * the set is reliably treated as absent (orphan → root).
 */
function indexById(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byId = new Map()
  const childrenOf = new Map()
  for (const r of list) {
    const id = idKey(r?.id)
    if (!id) continue
    byId.set(id, r)
  }
  for (const r of list) {
    const id = idKey(r?.id)
    if (!id) continue
    const parent = idKey(r?.parent_id)
    const hasRealParent = parent && parent !== id && byId.has(parent)
    if (hasRealParent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(r)
    }
  }
  return { list, byId, childrenOf }
}

/**
 * True when `row` is a root: it has no parent, its parent is itself, or its
 * parent is not a known unit in the set (orphaned parent reference).
 */
function isRoot(row, byId) {
  const id = idKey(row?.id)
  const parent = idKey(row?.parent_id)
  if (!parent) return true
  if (parent === id) return true
  return !byId.has(parent)
}

/**
 * Build a nested hierarchy tree from flat rows.
 *
 * Returns an array of root nodes. Each node is `{ unit, children: Node[] }`.
 * Roots are units whose `parent_id` is null/absent, self-referential, or points
 * at an id not present in the set. Cycles are guarded: once a unit appears on
 * the current ancestry path it is not expanded again, so a mutually referential
 * pair (A→B→A) still produces a finite tree.
 *
 * Rows without an `id` are ignored. Deterministic ordering: siblings keep their
 * input order.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ unit: object, children: Array }>}
 */
export function buildTree(rows = []) {
  const { list, byId, childrenOf } = indexById(rows)

  const build = (row, ancestry) => {
    const id = idKey(row?.id)
    const kids = childrenOf.get(id) || []
    const nextAncestry = new Set(ancestry)
    nextAncestry.add(id)
    const children = []
    for (const child of kids) {
      const childId = idKey(child?.id)
      // Cycle guard: skip a child already on this ancestry path.
      if (nextAncestry.has(childId)) continue
      children.push(build(child, nextAncestry))
    }
    return { unit: row, children }
  }

  const roots = []
  for (const row of list) {
    const id = idKey(row?.id)
    if (!id) continue
    if (isRoot(row, byId)) roots.push(build(row, new Set()))
  }
  return roots
}

/**
 * All descendant unit ids of `unitId` (children, grandchildren, …) — NOT
 * including the unit itself. Cycle-safe via a visited set so a corrupted parent
 * chain terminates. Returns [] when the unit is unknown or has no descendants.
 *
 * @param {Array<object>} rows
 * @param {string} unitId
 * @returns {Array<string>}
 */
export function descendantsOf(rows = [], unitId) {
  const { byId, childrenOf } = indexById(rows)
  const start = idKey(unitId)
  if (!byId.has(start)) return []

  const visited = new Set([start])
  const out = []
  const stack = [...(childrenOf.get(start) || [])]
  while (stack.length) {
    const node = stack.pop()
    const id = idKey(node?.id)
    if (!id || visited.has(id)) continue
    visited.add(id)
    out.push(id)
    for (const child of childrenOf.get(id) || []) {
      if (!visited.has(idKey(child?.id))) stack.push(child)
    }
  }
  return out
}

/**
 * Hierarchy depth of a unit (0-based): a root is 0, its direct child 1, and so
 * on. Depth is measured by walking up the parent chain. Returns null when the
 * unit is unknown. Cycle-guarded — a loop in the ancestry stops the walk.
 *
 * @param {Array<object>} rows
 * @param {string} unitId
 * @returns {number|null}
 */
export function depthOf(rows = [], unitId) {
  const { byId } = indexById(rows)
  const start = idKey(unitId)
  if (!byId.has(start)) return null

  let depth = 0
  let current = byId.get(start)
  const seen = new Set([start])
  while (current) {
    const parent = idKey(current?.parent_id)
    const self = idKey(current?.id)
    if (!parent || parent === self || !byId.has(parent) || seen.has(parent)) break
    depth += 1
    seen.add(parent)
    current = byId.get(parent)
  }
  return depth
}

/** Maximum depth present across the whole set (deepest node's 0-based depth). */
function computeMaxDepth(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let max = 0
  for (const r of list) {
    const id = idKey(r?.id)
    if (!id) continue
    const d = depthOf(list, id)
    if (d != null && d > max) max = d
  }
  return max
}

/**
 * Filter assignment rows to those active at `nowMs`. An assignment is active
 * when `nowMs` is within its [starts_at, ends_at] window; either bound may be
 * absent (open-ended). Boundaries are inclusive. `nowMs` is injected for
 * deterministic testing.
 *
 * @param {Array<object>} assignmentRows
 * @param {number} nowMs  epoch millis to evaluate against
 * @returns {Array<object>}
 */
export function assignmentsActive(assignmentRows = [], nowMs = Date.now()) {
  const list = Array.isArray(assignmentRows) ? assignmentRows : []
  const now = toFiniteNumber(nowMs)
  const at = now == null ? Date.now() : now
  return list.filter((a) => {
    const startsRaw = a?.starts_at
    const endsRaw = a?.ends_at
    if (startsRaw != null && startsRaw !== '') {
      const s = new Date(startsRaw).getTime()
      if (Number.isFinite(s) && at < s) return false
    }
    if (endsRaw != null && endsRaw !== '') {
      const e = new Date(endsRaw).getTime()
      if (Number.isFinite(e) && at > e) return false
    }
    return true
  })
}

/**
 * Summarise a set of units for the KPI header:
 *   • total      — number of units (rows with an id)
 *   • active     — count with active !== false
 *   • byType     — { [unit_type]: count } over known-typed units
 *   • rootCount  — count of top-level units (no known parent)
 *   • maxDepth   — deepest hierarchy level present (0-based)
 *
 * @param {Array<object>} rows
 * @returns {{ total:number, active:number, byType:Object,
 *             rootCount:number, maxDepth:number }}
 */
export function summariseUnits(rows = []) {
  const { list, byId } = indexById(rows)
  let total = 0
  let active = 0
  let rootCount = 0
  const byType = {}

  for (const r of list) {
    const id = idKey(r?.id)
    if (!id) continue
    total += 1
    if (r?.active !== false) active += 1
    if (isRoot(r, byId)) rootCount += 1
    const type = r?.unit_type == null ? '' : String(r.unit_type).trim()
    if (type) byType[type] = (byType[type] || 0) + 1
  }

  return {
    total,
    active,
    byType,
    rootCount,
    maxDepth: computeMaxDepth(list),
  }
}

// ── Scope resolution (Enterprise §3 Phase 3 groundwork) ─────────────────────
// Pure functions that turn "who is assigned where" into "which units does a
// user effectively cover". A user assigned to a unit covers that unit AND every
// unit beneath it (assignments are inherited down the tree). These are the
// building blocks a later opt-in, default-open location-scoped RLS phase will
// consume — kept here, deterministic and tested, with NO Supabase/RLS coupling.

/**
 * The set of unit ids a single user effectively covers: for each of the user's
 * currently-active assignments, the assigned unit plus all of its descendants.
 * Only assignments active at `nowMs` count (respecting the [starts_at, ends_at]
 * window). Returns a Set of id keys (empty when the user has no active cover).
 *
 * @param {Array<object>} rows          org_units rows
 * @param {Array<object>} assignments   user_org_assignments rows
 * @param {string} userId
 * @param {number} [nowMs]
 * @returns {Set<string>}
 */
export function effectiveUnitIdsForUser(rows = [], assignments = [], userId, nowMs = Date.now()) {
  const uid = idKey(userId)
  const out = new Set()
  if (!uid) return out
  const active = assignmentsActive(assignments, nowMs)
  for (const a of active) {
    if (idKey(a?.user_id) !== uid) continue
    const unitId = idKey(a?.org_unit_id)
    if (!unitId) continue
    out.add(unitId)
    for (const d of descendantsOf(rows, unitId)) out.add(d)
  }
  return out
}

/**
 * Per-user coverage roll-up for the Coverage view. For every user with at least
 * one active assignment, returns:
 *   • userId
 *   • directUnitIds     — ids the user is directly assigned to (active)
 *   • effectiveUnitIds  — direct ids + all inherited descendants
 *   • primaryUnitId     — the user's primary unit (is_primary), if any
 *   • directCount / effectiveCount — convenience counts
 * Sorted by effectiveCount desc, then userId, for stable display.
 *
 * @param {Array<object>} rows
 * @param {Array<object>} assignments
 * @param {number} [nowMs]
 * @returns {Array<object>}
 */
export function coverageByUser(rows = [], assignments = [], nowMs = Date.now()) {
  const active = assignmentsActive(assignments, nowMs)
  const byUser = new Map()
  for (const a of active) {
    const uid = idKey(a?.user_id)
    const unitId = idKey(a?.org_unit_id)
    if (!uid || !unitId) continue
    if (!byUser.has(uid)) byUser.set(uid, { direct: new Set(), primaryUnitId: null })
    const entry = byUser.get(uid)
    entry.direct.add(unitId)
    if (a?.is_primary && !entry.primaryUnitId) entry.primaryUnitId = unitId
  }

  const out = []
  for (const [userId, entry] of byUser) {
    const effective = new Set(entry.direct)
    for (const unitId of entry.direct) {
      for (const d of descendantsOf(rows, unitId)) effective.add(d)
    }
    out.push({
      userId,
      directUnitIds: [...entry.direct],
      effectiveUnitIds: [...effective],
      primaryUnitId: entry.primaryUnitId,
      directCount: entry.direct.size,
      effectiveCount: effective.size,
    })
  }
  out.sort((a, b) => b.effectiveCount - a.effectiveCount || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
  return out
}
