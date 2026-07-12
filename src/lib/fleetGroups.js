/**
 * Fleet Groups — pure, dependency-free domain logic for the Fleet Groups /
 * Holding-Company Hierarchy module (/fleet-groups). Turns a flat set of group
 * rows (each carrying an optional `parent_group` name) into a navigable tree and
 * derives roll-up counts, depth, and a fleet-level KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/fleetGroups.js`) and page
 * (`src/pages/FleetGroups.jsx`) both build on these primitives so the hierarchy
 * logic lives in exactly one place.
 *
 * Hierarchy is modelled by NAME (parent_group -> group_name) rather than by id
 * so a partial import or a re-parent never breaks a foreign key. Because names
 * are user-supplied and mutable, every traversal here is cycle-guarded: a group
 * that (directly or transitively) lists itself as an ancestor is treated as a
 * root/leaf boundary rather than recursed into forever.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Normalise a group name to a stable key (trimmed string, or '' when absent). */
function nameKey(v) {
  return v == null ? '' : String(v).trim()
}

/**
 * Index rows by their group_name (last row wins on duplicate names) and expose
 * the set of known names. Shared by every traversal so a "parent" that doesn't
 * exist in the set is reliably treated as absent (orphan → root).
 */
function indexByName(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byName = new Map()
  const childrenOf = new Map()
  for (const r of list) {
    const name = nameKey(r?.group_name)
    if (!name) continue
    byName.set(name, r)
  }
  // Build parent → [children] using only parents that actually exist in the set.
  for (const r of list) {
    const name = nameKey(r?.group_name)
    if (!name) continue
    const parent = nameKey(r?.parent_group)
    const hasRealParent = parent && parent !== name && byName.has(parent)
    if (hasRealParent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(r)
    }
  }
  return { list, byName, childrenOf }
}

/**
 * True when `name` is a root: it has no parent, its parent is itself, or its
 * parent is not a known group in the set (orphaned parent reference).
 */
function isRoot(row, byName) {
  const name = nameKey(row?.group_name)
  const parent = nameKey(row?.parent_group)
  if (!parent) return true
  if (parent === name) return true
  return !byName.has(parent)
}

/**
 * Build a nested hierarchy tree from flat rows.
 *
 * Returns an array of root nodes. Each node is `{ group, children: Node[] }`.
 * Roots are groups whose `parent_group` is null/absent, self-referential, or
 * points at a name not present in the set. Cycles are guarded: once a group
 * appears on the current ancestry path it is not expanded again, so a mutually
 * referential pair (A→B→A) still produces a finite tree.
 *
 * Rows without a `group_name` are ignored. Deterministic ordering: siblings keep
 * their input order.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ group: object, children: Array }>}
 */
export function buildHierarchy(rows = []) {
  const { list, byName, childrenOf } = indexByName(rows)

  const build = (row, ancestry) => {
    const name = nameKey(row?.group_name)
    const kids = childrenOf.get(name) || []
    const nextAncestry = new Set(ancestry)
    nextAncestry.add(name)
    const children = []
    for (const child of kids) {
      const childName = nameKey(child?.group_name)
      // Cycle guard: skip a child already on this ancestry path.
      if (nextAncestry.has(childName)) continue
      children.push(build(child, nextAncestry))
    }
    return { group: row, children }
  }

  const roots = []
  for (const row of list) {
    const name = nameKey(row?.group_name)
    if (!name) continue
    if (isRoot(row, byName)) roots.push(build(row, new Set()))
  }
  return roots
}

/**
 * Collect a group and every descendant (by name) into a flat list of rows.
 * Cycle-guarded via a visited set so a corrupted parent chain terminates.
 *
 * @param {Array<object>} rows
 * @param {string} groupName
 * @returns {Array<object>}  the group's own row first, then all descendants
 */
export function collectSubtree(rows = [], groupName) {
  const { byName, childrenOf } = indexByName(rows)
  const start = nameKey(groupName)
  const root = byName.get(start)
  if (!root) return []

  const visited = new Set()
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    const name = nameKey(node?.group_name)
    if (visited.has(name)) continue
    visited.add(name)
    out.push(node)
    const kids = childrenOf.get(name) || []
    for (const child of kids) {
      if (!visited.has(nameKey(child?.group_name))) stack.push(child)
    }
  }
  return out
}

/**
 * Roll up the `asset_count` of a group plus all of its descendants.
 * Returns 0 when the group is unknown. Non-numeric asset counts count as 0.
 *
 * @param {Array<object>} rows
 * @param {string} groupName
 * @returns {number}
 */
export function rollupAssetCount(rows = [], groupName) {
  return collectSubtree(rows, groupName).reduce((sum, r) => {
    const n = toFiniteNumber(r?.asset_count)
    return sum + (n != null && n > 0 ? n : 0)
  }, 0)
}

/**
 * Hierarchy depth of a group (0-based): a root is 0, its direct child 1, and so
 * on. Depth is measured by walking up the parent chain. Returns null when the
 * group is unknown. Cycle-guarded — a loop in the ancestry stops the walk.
 *
 * @param {Array<object>} rows
 * @param {string} groupName
 * @returns {number|null}
 */
export function depthOf(rows = [], groupName) {
  const { byName } = indexByName(rows)
  const start = nameKey(groupName)
  if (!byName.has(start)) return null

  let depth = 0
  let current = byName.get(start)
  const seen = new Set([start])
  while (current) {
    const parent = nameKey(current?.parent_group)
    const self = nameKey(current?.group_name)
    if (!parent || parent === self || !byName.has(parent) || seen.has(parent)) break
    depth += 1
    seen.add(parent)
    current = byName.get(parent)
  }
  return depth
}

/**
 * Maximum depth present across the whole set (deepest node's 0-based depth).
 * Returns 0 for an empty set.
 */
function computeMaxDepth(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let max = 0
  for (const r of list) {
    const name = nameKey(r?.group_name)
    if (!name) continue
    const d = depthOf(list, name)
    if (d != null && d > max) max = d
  }
  return max
}

/**
 * Summarise a set of groups for the KPI header:
 *   • totalGroups  — number of named groups
 *   • activeGroups — count with active !== false
 *   • rootGroups   — count of top-level groups (no known parent)
 *   • totalAssets  — sum of every group's own asset_count (fleet size)
 *   • maxDepth     — deepest hierarchy level present (0-based)
 *   • totalBudget  — sum of every group's budget
 *
 * @param {Array<object>} rows
 * @returns {{ totalGroups:number, activeGroups:number, rootGroups:number,
 *             totalAssets:number, maxDepth:number, totalBudget:number }}
 */
export function summariseGroups(rows = []) {
  const { list, byName } = indexByName(rows)
  let totalGroups = 0
  let activeGroups = 0
  let rootGroups = 0
  let totalAssets = 0
  let totalBudget = 0

  for (const r of list) {
    const name = nameKey(r?.group_name)
    if (!name) continue
    totalGroups += 1
    if (r?.active !== false) activeGroups += 1
    if (isRoot(r, byName)) rootGroups += 1
    const assets = toFiniteNumber(r?.asset_count)
    if (assets != null && assets > 0) totalAssets += assets
    const budget = toFiniteNumber(r?.budget)
    if (budget != null) totalBudget += budget
  }

  return {
    totalGroups,
    activeGroups,
    rootGroups,
    totalAssets,
    maxDepth: computeMaxDepth(list),
    totalBudget,
  }
}
