/**
 * Fitment Validation view model (pure, no I/O).
 *
 * Turns real rows (vehicle_fleet, tyre_records, tyre_specifications fitment
 * specs, tyre_spec_catalog, fitment_rules) into the pre-installation check
 * list, its score, the fleet audit statuses and the page summaries.
 *
 * Honesty rules:
 *  - A check with no source data is 'na' ("Not checked") and is left out of
 *    the score. A score with zero checks run is null, never 0 or 100.
 *  - Pressure is only checked when a pressure is entered AND a real target
 *    exists (the matched specification's recommended pressure).
 *  - Duplicate serial = the serial is active (no removal date) on another
 *    asset or another position in tyre_records.
 */
import { normalizeSize } from './fitmentValidation'

export const AXLE_ROLES = ['Steer', 'Drive', 'Trailer', 'Lift', 'Tag']

/** Pressure tolerance against the specification target, in percent. */
export const PRESSURE_PASS_PCT = 5
export const PRESSURE_ADVISORY_PCT = 10

/** Speed symbols from slowest to fastest (tyre industry order). */
export const SPEED_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y']

export const CHECK_STATUS_META = {
  pass: { label: 'Pass', tone: 'good' },
  advisory: { label: 'Advisory', tone: 'warn' },
  fail: { label: 'Fail', tone: 'bad' },
  na: { label: 'Not checked', tone: 'muted' },
}

const up = (v) => String(v ?? '').trim().toUpperCase()
const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function speedRank(sym) {
  const s = up(sym)
  if (!s) return null
  const i = SPEED_ORDER.indexOf(s)
  return i < 0 ? null : i
}

/** "156/150 L", "154M", "152 N" -> { load, loadDual, speed }. */
export function parseLoadSpeed(text) {
  const t = up(text)
  if (!t) return { load: null, loadDual: null, speed: null }
  const m = t.match(/(\d{2,3})\s*(?:\/\s*(\d{2,3}))?\s*([A-Z])?/)
  if (!m) return { load: null, loadDual: null, speed: null }
  return {
    load: m[1] ? Number(m[1]) : null,
    loadDual: m[2] ? Number(m[2]) : null,
    speed: m[3] || null,
  }
}

/** Load/speed text from a tyre_spec_catalog row, e.g. "156/150 L". */
export function catalogLoadSpeed(row) {
  if (!row) return ''
  const li = row.load_index_single
  const ld = row.load_index_dual
  const sp = row.speed_rating
  if (li == null && !sp) return ''
  return `${li ?? ''}${ld != null ? `/${ld}` : ''}${sp ? ` ${sp}` : ''}`.trim()
}

/** Catalogue rows that fit a size (and brand when given), approved first. */
export function catalogFor(catalog, size, brand) {
  const s = normalizeSize(size)
  if (!s) return []
  const b = up(brand)
  const rank = (r) => (r.approval_status === 'approved' ? 0 : r.approval_status === 'pending' ? 1 : 2)
  return (Array.isArray(catalog) ? catalog : [])
    .filter((r) => normalizeSize(r.size) === s && (!b || up(r.brand) === b))
    .sort((a, b2) => rank(a) - rank(b2))
}

/**
 * Specifications (fitment rows from tyre_specifications) for a vehicle type.
 * Exact type match first; when none, a spec whose type is contained in the
 * vehicle type (for example MIXER inside TR-MIXER). `matchedBy` says which.
 */
export function specsForVehicle(specs, vehicleType) {
  const vt = up(vehicleType)
  const list = Array.isArray(specs) ? specs : []
  if (!vt) return { rows: [], matchedBy: null }
  const exact = list.filter((s) => up(s.vehicle_type) === vt)
  if (exact.length) return { rows: exact, matchedBy: 'exact' }
  const partial = list.filter((s) => up(s.vehicle_type) && vt.includes(up(s.vehicle_type)))
  const types = new Set(partial.map((s) => up(s.vehicle_type)))
  if (partial.length && types.size === 1) return { rows: partial, matchedBy: 'partial' }
  return { rows: [], matchedBy: null }
}

export function specForPosition(specRows, axleRole) {
  const a = up(axleRole)
  if (!a) return null
  return (Array.isArray(specRows) ? specRows : []).find((s) => up(s.position) === a) || null
}

/** Active rows for this serial that are NOT the target asset and position. */
export function duplicateFitments(activeRows, { assetNo, position } = {}) {
  const a = up(assetNo)
  const p = up(position)
  return (Array.isArray(activeRows) ? activeRows : []).filter((r) => {
    const ra = up(r.asset_no)
    const rp = up(r.position || r.tyre_position)
    if (a && ra === a && (!p || !rp || rp === p)) return false
    return true
  })
}

const check = (key, label, status, value, detail) => ({ key, label, status, value, detail })

/**
 * Build the pre-installation check list from real inputs.
 *
 * @param {object} p
 * @param {object|null} p.tyre         resolved tyre_records row (null = not found)
 * @param {boolean}     p.tyreLooked   true when a serial lookup ran
 * @param {object|null} p.vehicle      vehicle_fleet row
 * @param {string}      p.axleRole     Steer / Drive / Trailer ...
 * @param {string}      p.size         the size being installed (tyre or chosen spec)
 * @param {Array}       p.specs        tyre_specifications rows
 * @param {object|null} p.rule         matched fitment_rules row (or default)
 * @param {string}      p.loadSpeed    entered or catalogue load/speed text
 * @param {number|null} p.pressure     entered pressure in PSI
 * @param {Array|null}  p.duplicates   duplicateFitments() output; null = not looked up
 * @param {object|null} p.engine       validateFitment() result for lifecycle and tread
 */
export function buildFitmentChecks(p = {}) {
  const { vehicle, axleRole, specs, rule, engine } = p
  const size = String(p.size || '').trim()
  const { rows: typeSpecs, matchedBy } = specsForVehicle(specs, vehicle?.vehicle_type)
  const spec = specForPosition(typeSpecs, axleRole)
  const checks = []

  // 1. Tyre size
  const approved = spec?.approved_sizes?.length ? spec.approved_sizes
    : (rule && !rule._default && rule.approved_sizes?.length ? rule.approved_sizes
      : (vehicle?.tyre_size ? [vehicle.tyre_size] : []))
  const source = spec?.approved_sizes?.length ? 'specification' : (rule && !rule._default && rule.approved_sizes?.length ? 'fitment rule' : 'vehicle spec size')
  if (!size || !approved.length) {
    checks.push(check('size', 'Tyre size', 'na', 'Not checked', !size ? 'No size for the tyre' : 'No approved size recorded for this vehicle'))
  } else {
    const ok = approved.map(normalizeSize).includes(normalizeSize(size))
    checks.push(check('size', 'Tyre size', ok ? 'pass' : 'fail', ok ? 'Match' : 'Wrong size', `${size} against ${source}: ${approved.join(', ')}`))
  }

  // 2 and 3. Load index and speed rating against the specification minimums.
  const ls = parseLoadSpeed(p.loadSpeed)
  const minLoad = num(spec?.min_load_index)
  if (minLoad == null || ls.load == null) {
    checks.push(check('load', 'Load index', 'na', 'Not checked', minLoad == null ? 'No minimum load index in the specification' : 'No load index for the tyre'))
  } else {
    const ok = ls.load >= minLoad
    checks.push(check('load', 'Load index', ok ? 'pass' : 'fail', ok ? 'Pass' : 'Too low', `${ls.load} against minimum ${minLoad}`))
  }
  const minSpeed = speedRank(spec?.min_speed_index)
  const tyreSpeed = speedRank(ls.speed)
  if (minSpeed == null || tyreSpeed == null) {
    checks.push(check('speed', 'Speed rating', 'na', 'Not checked', minSpeed == null ? 'No minimum speed rating in the specification' : 'No speed rating for the tyre'))
  } else {
    const ok = tyreSpeed >= minSpeed
    checks.push(check('speed', 'Speed rating', ok ? 'pass' : 'fail', ok ? 'Pass' : 'Too low', `${up(ls.speed)} against minimum ${up(spec.min_speed_index)}`))
  }

  // 4. Axle position: is there an approved specification for this position?
  if (!typeSpecs.length || !axleRole) {
    checks.push(check('axle', 'Axle position', 'na', 'Not checked', !axleRole ? 'No axle position chosen' : 'No specification for this vehicle type'))
  } else if (spec) {
    checks.push(check('axle', 'Axle position', 'pass', 'Approved', `${spec.vehicle_type} ${spec.position}${matchedBy === 'partial' ? ' (matched by type family)' : ''}`))
  } else {
    checks.push(check('axle', 'Axle position', 'advisory', 'No spec', `No specification for the ${axleRole} position on ${typeSpecs[0].vehicle_type}`))
  }

  // 5. Pressure: only with an entered value and a real target.
  const target = num(spec?.recommended_pressure)
  const pressure = num(p.pressure)
  if (pressure == null || target == null) {
    checks.push(check('pressure', 'Pressure', 'na', 'Not checked', pressure == null ? 'No pressure entered' : 'No target pressure in the specification'))
  } else {
    const diff = pressure - target
    const pct = Math.abs(diff) / target * 100
    const status = pct <= PRESSURE_PASS_PCT ? 'pass' : pct <= PRESSURE_ADVISORY_PCT ? 'advisory' : 'fail'
    const sign = diff > 0 ? '+' : ''
    checks.push(check('pressure', 'Pressure', status, diff === 0 ? 'On target' : `${sign}${Math.round(diff * 10) / 10} PSI`, `${pressure} PSI against target ${target} PSI`))
  }

  // 6. Duplicate serial
  if (p.duplicates == null) {
    checks.push(check('duplicate', 'Duplicate serial', 'na', 'Not checked', 'No serial entered'))
  } else if (p.duplicates.length) {
    const where = p.duplicates.slice(0, 3).map((r) => `${r.asset_no || 'unknown asset'} ${r.position || r.tyre_position || ''}`.trim()).join(', ')
    checks.push(check('duplicate', 'Duplicate serial', 'fail', `Active on ${p.duplicates.length}`, `Already fitted: ${where}`))
  } else {
    checks.push(check('duplicate', 'Duplicate serial', 'pass', 'None', 'Not active on any other asset or position'))
  }

  // 7 and 8. Lifecycle and tread from the engine (tyre_records status and tread).
  if (p.tyreLooked && !p.tyre) {
    checks.push(check('record', 'Tyre record', 'fail', 'Not found', 'No tyre matched this serial'))
  } else if (p.tyre) {
    const vs = engine?.violations || []
    const ws = engine?.warnings || []
    const life = vs.find((v) => v.rule === 'unfit_condition')
    if (!p.tyre.status) checks.push(check('condition', 'Tyre condition', 'na', 'Not checked', 'No status recorded'))
    else checks.push(check('condition', 'Tyre condition', life ? 'fail' : 'pass', life ? 'Unfit' : 'Fit', life ? life.message : `Status ${p.tyre.status}`))
    const low = vs.find((v) => v.rule === 'below_min_tread')
    const warn = ws.find((w) => w.rule === 'low_tread_warning')
    if (num(p.tyre.tread_depth) == null) checks.push(check('tread', 'Tread depth', 'na', 'Not checked', 'No tread depth recorded'))
    else checks.push(check('tread', 'Tread depth', low ? 'fail' : warn ? 'advisory' : 'pass', `${num(p.tyre.tread_depth)} mm`, (low || warn)?.message || 'Above the minimum'))
  }

  return { checks, spec, typeSpecs, matchedBy }
}

/**
 * Score from real outcomes: pass = 1, advisory = 0.5, fail = 0, 'na' excluded.
 * Verdict: any fail blocks; any advisory passes with advisory.
 */
export function scoreChecks(checks) {
  const run = (Array.isArray(checks) ? checks : []).filter((c) => c.status !== 'na')
  if (!run.length) return { score: null, verdict: 'Not enough data', tone: 'muted', run: 0, allowed: null }
  const pts = run.reduce((s, c) => s + (c.status === 'pass' ? 1 : c.status === 'advisory' ? 0.5 : 0), 0)
  const score = Math.round((pts / run.length) * 100)
  const fails = run.filter((c) => c.status === 'fail').length
  const adv = run.filter((c) => c.status === 'advisory').length
  if (fails) return { score, verdict: 'Fitment blocked', badge: 'FAIL', tone: 'bad', run: run.length, allowed: false }
  if (adv) return { score, verdict: 'Fitment allowed', badge: 'PASS WITH ADVISORY', tone: 'warn', run: run.length, allowed: true }
  return { score, verdict: 'Fitment allowed', badge: 'PASS', tone: 'good', run: run.length, allowed: true }
}

/** Ledger shape for fitment_validations (violations = fails, warnings = advisories). */
export function checksToLedger(checks) {
  const list = Array.isArray(checks) ? checks : []
  const violations = list.filter((c) => c.status === 'fail').map((c) => ({ rule: c.key, severity: 'critical', message: `${c.label}: ${c.detail}` }))
  const warnings = list.filter((c) => c.status === 'advisory').map((c) => ({ rule: c.key, severity: 'warning', message: `${c.label}: ${c.detail}` }))
  return { is_valid: violations.length === 0, violations, warnings }
}

// ── Fleet size audit ───────────────────────────────────────────────────────

export const AUDIT_STATUS = {
  compliant: { label: 'Compliant', tone: 'good', severity: 'ok' },
  wrong_size: { label: 'Wrong size', tone: 'bad', severity: 'critical' },
  no_spec: { label: 'No spec size', tone: 'warn', severity: 'data' },
  no_tyres: { label: 'No tyre data', tone: 'muted', severity: 'data' },
}

export const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Non-compliant' },
  { value: 'data', label: 'Unclear or missing data' },
  { value: 'ok', label: 'Compliant' },
]

export function auditStatus(row) {
  if (row?.band === 'match') return 'compliant'
  if (row?.band === 'mismatch') return 'wrong_size'
  if (!row?.specNorm) return 'no_spec'
  return 'no_tyres'
}

export function filterAudit(rows, { site = '', vehicleType = '', severity = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (site && r.site !== site) return false
    if (vehicleType && r.vehicle_type !== vehicleType) return false
    if (severity && AUDIT_STATUS[auditStatus(r)].severity !== severity) return false
    if (q) {
      const hay = `${r.asset_no} ${r.make} ${r.model} ${r.vehicle_type} ${r.spec} ${(r.fittedSizes || []).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function distinctValues(rows, key) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
}

/** Compliance by vehicle type, over checkable assets only; null pct when none. */
export function complianceByCategory(rows, limit = 6) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.band !== 'match' && r.band !== 'mismatch') continue
    const k = r.vehicle_type || 'Type not recorded'
    const e = map.get(k) || { category: k, match: 0, checked: 0 }
    e.checked += 1
    if (r.band === 'match') e.match += 1
    map.set(k, e)
  }
  return [...map.values()]
    .map((e) => ({ ...e, pct: Math.round((e.match / e.checked) * 100) }))
    .sort((a, b) => b.checked - a.checked)
    .slice(0, limit)
}

export function fleetFootprint(vehicles) {
  const list = Array.isArray(vehicles) ? vehicles : []
  return { vehicles: list.length, sites: new Set(list.map((v) => v.site).filter(Boolean)).size }
}

/** A rule is "enforced" by this engine only through these fields. */
export function ruleEnforces(rule) {
  const out = []
  if (rule?.approved_sizes?.length) out.push(`Sizes: ${rule.approved_sizes.join(', ')}`)
  if (rule?.min_tread_depth_mm != null) out.push(`Min tread ${rule.min_tread_depth_mm} mm`)
  out.push('Blocks scrapped, removed or damaged tyres')
  return out
}

export function ruleScope(rule) {
  const t = Array.isArray(rule?.applies_to_vehicle_types) && rule.applies_to_vehicle_types.length ? rule.applies_to_vehicle_types.join(', ') : 'All vehicle types'
  return t
}
