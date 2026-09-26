/**
 * orgHierarchyAnalytics - page-level engine for /org-hierarchy.
 *
 * Tree building, descendants, depth and active-window logic live in
 * `src/lib/orgUnits.js` and are REUSED here. This module owns what the page
 * used to compute inline: per-unit member counts, the unit register rows
 * (parent name, depth, members), filtering, the KPI strip, the type mix, the
 * member and coverage registers, and the export shapes. Pure; `nowMs` is
 * injected so the active-window maths is deterministic in tests.
 */
import { depthOf, summariseUnits, assignmentsActive, coverageByUser } from './orgUnits'

export const UNIT_TYPE_LABELS = {
  company: 'Company', country: 'Country', region: 'Region', branch: 'Branch', project: 'Project',
  site: 'Site', workshop: 'Workshop', department: 'Department', team: 'Team',
}
export const typeLabel = (t) => UNIT_TYPE_LABELS[t] || t || 'N/A'

export function personLabel(profile, userId) {
  if (!profile) return { name: 'Unknown user', sub: String(userId || '').slice(0, 8) }
  return {
    name: profile.full_name || profile.username || profile.email || 'Unnamed user',
    sub: profile.email || profile.username || profile.role || '',
  }
}

/** Map<unitId, {total, active}> over all assignments. */
export function countsByUnit(assignments = [], nowMs = Date.now()) {
  const m = new Map()
  const bump = (k, key) => {
    const cur = m.get(k) || { total: 0, active: 0 }
    cur[key] += 1
    m.set(k, cur)
  }
  for (const a of assignments || []) bump(String(a.org_unit_id), 'total')
  for (const a of assignmentsActive(assignments || [], nowMs)) bump(String(a.org_unit_id), 'active')
  return m
}

/** One enriched register row per unit. */
export function unitRegister(rows = [], assignments = [], nowMs = Date.now()) {
  const list = rows || []
  const nameById = new Map(list.map((r) => [String(r.id), r.name]))
  const counts = countsByUnit(assignments, nowMs)
  const childCount = new Map()
  for (const r of list) if (r.parent_id) childCount.set(String(r.parent_id), (childCount.get(String(r.parent_id)) || 0) + 1)
  return list.map((r) => {
    const c = counts.get(String(r.id)) || { total: 0, active: 0 }
    return {
      ...r,
      typeLabel: typeLabel(r.unit_type),
      parentName: r.parent_id ? (nameById.get(String(r.parent_id)) || null) : null,
      isRoot: !r.parent_id,
      orphanParent: !!r.parent_id && !nameById.has(String(r.parent_id)),
      depth: depthOf(list, r.id),
      children: childCount.get(String(r.id)) || 0,
      members: c.total,
      activeMembers: c.active,
      isActive: r.active !== false,
    }
  })
}

export function filterUnits(rows = [], { search = '', type = '', status = '', staffing = '' } = {}) {
  const q = String(search).trim().toLowerCase()
  return rows.filter((r) => {
    if (type && r.unit_type !== type) return false
    if (status === 'active' && !r.isActive) return false
    if (status === 'inactive' && r.isActive) return false
    if (staffing === 'staffed' && r.activeMembers === 0) return false
    if (staffing === 'unstaffed' && r.activeMembers > 0) return false
    if (q) {
      const hay = `${r.name || ''} ${r.code || ''} ${r.country || ''} ${r.site_ref || ''} ${r.typeLabel || ''} ${r.parentName || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function hierarchyKpis(rows = [], register = [], assignments = [], nowMs = Date.now()) {
  const s = summariseUnits(rows || [])
  const activeAssignments = assignmentsActive(assignments || [], nowMs)
  const activeUnits = register.filter((r) => r.isActive)
  const unstaffed = activeUnits.filter((r) => r.activeMembers === 0).length
  return {
    total: s.total,
    active: s.active,
    inactive: s.total - s.active,
    roots: s.rootCount,
    maxDepth: s.maxDepth,
    activeMembers: activeAssignments.length,
    people: new Set(activeAssignments.map((a) => String(a.user_id))).size,
    unstaffed,
    staffedPct: activeUnits.length ? Math.round(((activeUnits.length - unstaffed) / activeUnits.length) * 1000) / 10 : null,
    orphanParents: register.filter((r) => r.orphanParent).length,
  }
}

/** Unit count by type, catalogue order, types with zero units omitted. */
export function typeMix(register = []) {
  const counts = new Map()
  for (const r of register) counts.set(r.unit_type || 'unknown', (counts.get(r.unit_type || 'unknown') || 0) + 1)
  const order = [...Object.keys(UNIT_TYPE_LABELS), 'unknown']
  return order.filter((k) => counts.get(k)).map((k) => ({ type: k, label: k === 'unknown' ? 'No type' : typeLabel(k), count: counts.get(k) }))
}

export function memberRows(assignments = [], unitId, profilesById = new Map(), nowMs = Date.now()) {
  if (!unitId) return []
  const activeIds = new Set(assignmentsActive(assignments || [], nowMs).map((a) => a.id))
  return (assignments || [])
    .filter((a) => String(a.org_unit_id) === String(unitId))
    .map((a) => {
      const who = personLabel(profilesById.get(String(a.user_id)), a.user_id)
      return { ...a, _active: activeIds.has(a.id), name: who.name, sub: who.sub }
    })
    .sort((x, y) => (y.is_primary ? 1 : 0) - (x.is_primary ? 1 : 0) || x.name.localeCompare(y.name))
}

export function coverageRows(rows = [], assignments = [], profilesById = new Map(), nowMs = Date.now()) {
  const nameById = new Map((rows || []).map((r) => [String(r.id), r.name]))
  return coverageByUser(rows || [], assignments || [], nowMs).map((c) => {
    const who = personLabel(profilesById.get(String(c.userId)), c.userId)
    return {
      ...c,
      name: who.name,
      sub: who.sub,
      primaryUnit: c.primaryUnitId ? (nameById.get(String(c.primaryUnitId)) || null) : null,
      inherited: Math.max(0, c.effectiveCount - c.directCount),
    }
  })
}

const dateText = (v) => (v ? String(v).slice(0, 10) : 'Open')

export const UNIT_EXPORT_COLS = ['name', 'unit_type', 'parent', 'depth', 'code', 'country', 'site_ref', 'members', 'activeMembers', 'active', 'sort_order']
export const UNIT_EXPORT_HEADERS = ['Unit', 'Type', 'Parent', 'Depth', 'Code', 'Country', 'Site ref', 'Members', 'Active members', 'Active', 'Sort']
export function unitExportRows(rows = []) {
  return rows.map((r) => ({
    name: r.name || 'N/A', unit_type: r.typeLabel, parent: r.parentName || (r.isRoot ? 'Root' : 'N/A'),
    depth: r.depth ?? 'N/A', code: r.code || 'N/A', country: r.country || 'N/A', site_ref: r.site_ref || 'N/A',
    members: r.members, activeMembers: r.activeMembers, active: r.isActive ? 'Yes' : 'No', sort_order: r.sort_order ?? 'N/A',
  }))
}

export const MEMBER_EXPORT_COLS = ['name', 'sub', 'role', 'starts', 'ends', 'primary', 'status']
export const MEMBER_EXPORT_HEADERS = ['User', 'Contact', 'Role at unit', 'Starts', 'Ends', 'Primary', 'Status']
export function memberExportRows(rows = []) {
  return rows.map((m) => ({
    name: m.name, sub: m.sub || 'N/A', role: m.role || 'N/A', starts: dateText(m.starts_at), ends: dateText(m.ends_at),
    primary: m.is_primary ? 'Yes' : 'No', status: m._active ? 'Active' : 'Scheduled or ended',
  }))
}
