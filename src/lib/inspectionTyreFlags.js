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
