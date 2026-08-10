/**
 * inspectionTyreFlags - pure helpers linking inspections to tyre running-life
 * flags (single-calc rule: the band judgement is bandFor from tyreRunningLife,
 * never re-derived here). No I/O; everything injectable and null-tolerant.
 */
import { bandFor } from './tyreRunningLife'

/**
 * Group shaped running-life rows by asset.
 * Returns a plain object keyed by asset_no:
 *   { overdue: [rows], dueSoon: [rows], count }
 * Only assets that actually carry an overdue or due-soon tyre appear.
 */
export function buildAssetFlagMap(lifeRows = []) {
  const map = {}
  for (const row of Array.isArray(lifeRows) ? lifeRows : []) {
    if (!row || !row.asset) continue
    const band = bandFor(row)
    if (band !== 'overdue' && band !== 'due-soon') continue
    if (!map[row.asset]) map[row.asset] = { overdue: [], dueSoon: [], count: 0 }
    if (band === 'overdue') map[row.asset].overdue.push(row)
    else map[row.asset].dueSoon.push(row)
    map[row.asset].count += 1
  }
  return map
}

const DAMAGE_RE = /damage|puncture/i

function conditionOf(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (typeof value.condition === 'string') return value.condition
  }
  return ''
}

/**
 * Extract the damaged/punctured positions from one inspection's
 * tyre_conditions. Tolerates: an array of {position, condition}, an object
 * keyed by position (value = string or {condition}), or a JSON string of
 * either. Returns [] on anything unparseable.
 */
export function damagedPositions(inspection) {
  let tc = inspection ? inspection.tyre_conditions : null
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return [] }
  }
  if (!tc || typeof tc !== 'object') return []
  const out = []
  if (Array.isArray(tc)) {
    for (const entry of tc) {
      if (!entry || typeof entry !== 'object') continue
      const cond = conditionOf(entry)
      if (DAMAGE_RE.test(cond)) out.push({ position: entry.position || '', condition: cond })
    }
    return out
  }
  for (const [pos, val] of Object.entries(tc)) {
    const cond = conditionOf(val)
    if (DAMAGE_RE.test(cond)) out.push({ position: pos, condition: cond })
  }
  return out
}

function windowDate(r) {
  const raw = r.scheduled_date || r.inspection_date || r.completed_date || r.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

function inWindow(r, from, to) {
  if (!from && !to) return true
  const d = windowDate(r)
  if (!d) return false
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

/**
 * The "slide" numbers over the loaded inspections (optionally windowed by
 * from/to, YYYY-MM-DD string-prefix compare - same rule as the page filter).
 * Honest zeros; flagMap-derived figures are 0 when flagMap is empty.
 */
const WEAR_RE = /wear|worn/i
const GOOD_RE = /good|ok/i

/**
 * Count one inspection's tyre conditions into good / wear / damage / other.
 * Same shape tolerance as damagedPositions; zeros on anything unparseable.
 */
export function conditionCounts(inspection) {
  let tc = inspection ? inspection.tyre_conditions : null
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return { good: 0, wear: 0, damage: 0, other: 0 } }
  }
  const out = { good: 0, wear: 0, damage: 0, other: 0 }
  if (!tc || typeof tc !== 'object') return out
  const values = Array.isArray(tc) ? tc : Object.values(tc)
  for (const v of values) {
    const cond = conditionOf(v)
    if (!cond) continue
    if (DAMAGE_RE.test(cond)) out.damage += 1
    else if (WEAR_RE.test(cond)) out.wear += 1
    else if (GOOD_RE.test(cond)) out.good += 1
    else out.other += 1
  }
  return out
}

/**
 * Shareable per-site summary: one row per site (Site, Inspections, Vehicles,
 * Good, Wear, Damage, Tyres due) + a totals row, over the given date window
 * and optional single-site filter. Tyres due = flagged tyres (overdue +
 * due soon) on the site's INSPECTED assets only - honest zeros when the
 * running-life feed is unavailable.
 */
export function siteSummary(inspections = [], flagMap = {}, { from = '', to = '', site = '' } = {}) {
  const fm = flagMap && typeof flagMap === 'object' ? flagMap : {}
  const list = (Array.isArray(inspections) ? inspections : []).filter((r) => {
    if (!r || !inWindow(r, from, to)) return false
    if (site && String(r.site || '') !== site) return false
    return true
  })
  const bySite = {}
  for (const r of list) {
    const key = String(r.site || '') || 'No site'
    if (!bySite[key]) bySite[key] = { site: key, inspections: 0, assets: new Set(), good: 0, wear: 0, damage: 0 }
    const b = bySite[key]
    b.inspections += 1
    if (r.asset_no) b.assets.add(r.asset_no)
    const c = conditionCounts(r)
    b.good += c.good; b.wear += c.wear; b.damage += c.damage
  }
  const rows = Object.values(bySite).map((b) => {
    let tyresDue = 0
    for (const asset of b.assets) {
      const entry = fm[asset]
      if (entry && entry.count) tyresDue += entry.count
    }
    return {
      site: b.site,
      inspections: b.inspections,
      vehicles: b.assets.size,
      good: b.good,
      wear: b.wear,
      damage: b.damage,
      tyresDue,
    }
  }).sort((a, b) => b.inspections - a.inspections || a.site.localeCompare(b.site))
  const totals = rows.reduce((t, r) => ({
    site: 'Total',
    inspections: t.inspections + r.inspections,
    vehicles: t.vehicles + r.vehicles,
    good: t.good + r.good,
    wear: t.wear + r.wear,
    damage: t.damage + r.damage,
    tyresDue: t.tyresDue + r.tyresDue,
  }), { site: 'Total', inspections: 0, vehicles: 0, good: 0, wear: 0, damage: 0, tyresDue: 0 })
  return { rows, totals }
}

export function inspectionOverview(inspections = [], flagMap = {}, { from = '', to = '' } = {}) {
  const list = (Array.isArray(inspections) ? inspections : []).filter((r) => r && inWindow(r, from, to))
  const fm = flagMap && typeof flagMap === 'object' ? flagMap : {}
  const assets = new Set()
  let approved = 0
  let pendingApproval = 0
  let damagedFound = 0
  for (const r of list) {
    if (r.asset_no) assets.add(r.asset_no)
    if (r.approval_status === 'approved') approved += 1
    else if (r.approval_status === 'pending_approval' || r.approval_status === 'pending') pendingApproval += 1
    damagedFound += damagedPositions(r).length
  }
  let vehiclesWithTyresDue = 0
  let tyresOverdue = 0
  let tyresDueSoon = 0
  for (const asset of assets) {
    const entry = fm[asset]
    if (!entry || !entry.count) continue
    vehiclesWithTyresDue += 1
    tyresOverdue += (entry.overdue || []).length
    tyresDueSoon += (entry.dueSoon || []).length
  }
  return {
    inspectionsDone: list.length,
    vehiclesInspected: assets.size,
    approved,
    pendingApproval,
    vehiclesWithTyresDue,
    tyresOverdue,
    tyresDueSoon,
    damagedFound,
  }
}
