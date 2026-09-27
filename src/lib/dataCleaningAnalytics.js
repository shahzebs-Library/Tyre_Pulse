/**
 * dataCleaningAnalytics - the pure engine behind the Data Cleaning page.
 *
 * Every Quality Intelligence check and the page's KPI numbers are computed
 * here from rows the page has already read, so the rules live in ONE tested
 * place instead of inside seven useCallback bodies. No I/O, no Date.now():
 * anything time-dependent takes an explicit `now`.
 *
 * HONEST NULLS: a score or percentage that cannot be measured (no records,
 * nothing read) is null and renders as N/A. It is never a flattering 100 or 0.
 */

export const QUALITY_WEIGHTS = Object.freeze({
  odometer: 0.25,
  duplicateSerial: 0.20,
  missingTread: 0.15,
  invalidPressure: 0.15,
  serialIssues: 0.10,
  unrealisticLife: 0.10,
  missingInspect: 0.05,
})

/** Labels + weights in display order, for the breakdown strip and exports. */
export const QUALITY_CHECKS = Object.freeze([
  { key: 'odometer', label: 'Odometer', weight: 25 },
  { key: 'duplicateSerial', label: 'Duplicates', weight: 20 },
  { key: 'missingTread', label: 'Tread', weight: 15 },
  { key: 'invalidPressure', label: 'Pressure', weight: 15 },
  { key: 'serialIssues', label: 'Serials', weight: 10 },
  { key: 'unrealisticLife', label: 'Tyre Life', weight: 10 },
  { key: 'missingInspect', label: 'Inspections', weight: 5 },
])

export const PRESSURE_RANGE = Object.freeze({ min: 20, max: 200 })
export const LIFE_RANGE = Object.freeze({ min: 500, max: 400000 })
export const ODOMETER_MAX_LIFE = 500000
export const COST_RANGE = Object.freeze({ min: 50, max: 50000 })
export const INSPECTION_WINDOW_DAYS = 30

const num = (v) => {
  if (v === null || v === undefined || v === '') return NaN
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : NaN
}
const trimmed = (s) => (typeof s === 'string' ? s.trim() : s == null ? '' : String(s).trim())

/** The per-check "bad record" count that feeds the weighted score. */
export function checkBadCount(key, check) {
  if (!check) return 0
  if (key === 'duplicateSerial') return check.affectedCount ?? 0
  if (key === 'odometer') return check.count ?? check.issues?.length ?? 0
  return check.count ?? 0
}

/**
 * Weighted 0-100 quality score. Returns null when there is nothing to score
 * (no records) or when any check could not be measured - a partial score would
 * silently treat an unread check as clean.
 */
export function computeQualityScore(checks, totalRecords) {
  if (!Number.isFinite(totalRecords) || totalRecords <= 0) return null
  for (const k of Object.keys(QUALITY_WEIGHTS)) {
    const c = checks?.[k]
    if (!c || c.error || c.notApplicable) return null
  }
  let penalty = 0
  for (const [k, w] of Object.entries(QUALITY_WEIGHTS)) {
    const bad = Math.min(checkBadCount(k, checks[k]) / totalRecords, 1)
    penalty += w * bad
  }
  return Math.round(Math.max(0, (1 - penalty) * 100))
}

/** 'good' | 'warn' | 'crit' | null band for a 0-100 score. */
export function scoreBand(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) return null
  if (score >= 85) return 'good'
  if (score >= 70) return 'warn'
  return 'crit'
}

export function scoreVerdict(score, { incomplete = false, totalRecords = null } = {}) {
  if (incomplete) return 'Quality checks incomplete. Retry the failed reads to score the data.'
  if (totalRecords === 0) return 'No tyre records in scope, so there is nothing to score.'
  const band = scoreBand(score)
  if (band === null) return 'Computing across 7 quality checks...'
  if (band === 'good') return 'Fleet data quality is healthy'
  if (band === 'warn') return 'Moderate quality issues detected. Action recommended.'
  return 'Significant data quality problems. Immediate attention required.'
}

/** Serial problems: empty, too short, non-alphanumeric, or reused across vehicles. */
export function detectSerialIssues(rows = []) {
  const typeOf = (r) => {
    const s = trimmed(r.tyre_serial)
    if (!s) return 'Empty/null serial'
    if (s.length < 4) return 'Too short (<4 chars)'
    if (!/[a-zA-Z0-9]/.test(s)) return 'Non-alphanumeric pattern'
    return null
  }
  const bySerial = new Map()
  for (const r of rows) {
    const key = trimmed(r.tyre_serial)
    if (!key) continue
    if (!bySerial.has(key)) bySerial.set(key, new Set())
    bySerial.get(key).add(r.asset_no ?? null)
  }
  const out = []
  const seen = new Set()
  for (const r of rows) {
    const t = typeOf(r)
    if (t) { out.push({ ...r, issue_type: t }); seen.add(r.id) }
  }
  for (const r of rows) {
    if (seen.has(r.id)) continue
    const key = trimmed(r.tyre_serial)
    if (key && bySerial.get(key)?.size > 1) out.push({ ...r, issue_type: 'Serial reused across vehicles' })
  }
  return { count: out.length, issues: out }
}

/** Active records sharing one serial. */
export function groupDuplicateSerials(rows = []) {
  const groups = new Map()
  for (const r of rows) {
    const key = trimmed(r.tyre_serial)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const dupeGroups = [...groups.entries()]
    .filter(([, recs]) => recs.length > 1)
    .map(([serial, records]) => ({
      serial,
      count: records.length,
      records,
      asset_nos: [...new Set(records.map((r) => r.asset_no).filter(Boolean))],
      dates: records.map((r) => r.issue_date).filter(Boolean),
    }))
    .sort((a, b) => b.count - a.count || a.serial.localeCompare(b.serial))
  const affectedCount = dupeGroups.reduce((s, g) => s + g.count, 0)
  return { groups: dupeGroups, affectedCount, groupCount: dupeGroups.length }
}

/** Pressure outside the valid PSI band (blank / non-numeric counts as invalid). */
export function findInvalidPressure(rows = [], range = PRESSURE_RANGE) {
  const records = rows.filter((r) => {
    const v = num(r.pressure_reading)
    return Number.isNaN(v) || v < range.min || v > range.max
  })
  return { count: records.length, records }
}

/** Missing tread depth (null or 0) + share and per-site breakdown. pct null when nothing read. */
export function summarizeMissingTread(rows = []) {
  const records = rows.filter((r) => r.tread_depth === null || r.tread_depth === undefined || Number(r.tread_depth) === 0)
  const bySiteMap = new Map()
  for (const r of records) {
    const s = r.site || 'Unknown'
    bySiteMap.set(s, (bySiteMap.get(s) ?? 0) + 1)
  }
  const bySite = [...bySiteMap.entries()].sort((a, b) => b[1] - a[1]).map(([site, count]) => ({ site, count }))
  const pct = rows.length > 0 ? Math.round((records.length / rows.length) * 1000) / 10 : null
  return { count: records.length, pct, bySite, records }
}

/** YYYY-MM-DD cutoff `days` before `now` (local calendar, never toISOString). */
export function inspectionCutoff(now = new Date(), days = INSPECTION_WINDOW_DAYS) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Assets carrying tyres that have no inspection in the window. */
export function findMissingInspections(assetRows = [], inspectionRows = []) {
  const all = [...new Set(assetRows.map((r) => r.asset_no).filter(Boolean))]
  const inspected = new Set(inspectionRows.map((r) => r.asset_no).filter(Boolean))
  const asset_nos = all.filter((a) => !inspected.has(a)).sort()
  return { count: asset_nos.length, asset_nos }
}

/** Impossible / implausible / non-sequential odometer readings. */
export function detectOdometerIssues(rows = []) {
  const issues = []
  const flagged = new Set()
  for (const r of rows) {
    const fit = num(r.km_at_fitment)
    const rem = num(r.km_at_removal)
    if (Number.isNaN(fit) || Number.isNaN(rem)) continue
    if (rem < fit) {
      issues.push({ ...r, issue_type: 'Removal < Fitment (impossible)', severity: 'critical' })
      flagged.add(r.id)
    } else if (rem - fit > ODOMETER_MAX_LIFE) {
      issues.push({ ...r, issue_type: `Life ${(rem - fit).toLocaleString()} km exceeds ${ODOMETER_MAX_LIFE.toLocaleString()} km`, severity: 'high' })
      flagged.add(r.id)
    }
  }
  const byAsset = new Map()
  for (const r of rows) {
    if (!r.asset_no) continue
    if (!byAsset.has(r.asset_no)) byAsset.set(r.asset_no, [])
    byAsset.get(r.asset_no).push(r)
  }
  for (const records of byAsset.values()) {
    const sorted = [...records].filter((r) => !Number.isNaN(num(r.km_at_fitment)))
      .sort((a, b) => num(a.km_at_fitment) - num(b.km_at_fitment))
    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i]
      const prevRem = num(sorted[i - 1].km_at_removal)
      const curFit = num(r.km_at_fitment)
      if (!Number.isNaN(prevRem) && curFit < prevRem && !flagged.has(r.id)) {
        issues.push({ ...r, issue_type: `Fitment (${curFit.toLocaleString()}) < previous removal (${prevRem.toLocaleString()})`, severity: 'medium' })
        flagged.add(r.id)
      }
    }
  }
  return { count: issues.length, issues }
}

/** Tyre life outside LIFE_RANGE or cost outside COST_RANGE. */
export function detectUnrealisticLife(rows = []) {
  const issues = []
  const flagged = new Set()
  for (const r of rows) {
    const fit = num(r.km_at_fitment)
    const rem = num(r.km_at_removal)
    if (Number.isNaN(fit) || Number.isNaN(rem)) continue
    const life = rem - fit
    if (life >= 0 && life < LIFE_RANGE.min) {
      issues.push({ ...r, life, issue_type: `Life only ${life} km, likely entry error` }); flagged.add(r.id)
    } else if (life > LIFE_RANGE.max) {
      issues.push({ ...r, life, issue_type: `Life ${life.toLocaleString()} km, unrealistically high` }); flagged.add(r.id)
    }
  }
  for (const r of rows) {
    if (flagged.has(r.id)) continue
    const c = num(r.cost_per_tyre)
    if (Number.isNaN(c)) continue
    if (c > COST_RANGE.max || c < COST_RANGE.min) {
      issues.push({ ...r, issue_type: `Cost ${c.toLocaleString()} outside normal range (${COST_RANGE.min}-${COST_RANGE.max.toLocaleString()})` })
    }
  }
  return { count: issues.length, issues }
}

/** Plain-language verdict for an edited odometer pair (the modal preview). */
export function odometerEditVerdict(fitment, removal) {
  const f = num(fitment)
  const r = num(removal)
  if (Number.isNaN(f) || Number.isNaN(r)) return null
  const life = r - f
  if (life < 0) return { life, tone: 'crit', note: 'still invalid' }
  if (life < LIFE_RANGE.min || life > LIFE_RANGE.max) return { life, tone: 'warn', note: 'unusual value' }
  return { life, tone: 'good', note: 'looks valid' }
}

/** Case-insensitive search over the cleaned register. */
export function searchCleaned(rows = [], query = '') {
  const q = trimmed(query).toLowerCase()
  if (!q) return rows
  const fields = ['asset_no', 'brand', 'site', 'serial_no', 'tyre_serial', 'category', 'risk_level', 'remarks_cleaned']
  return rows.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(q)))
}

/** KPI summary of the cleaned register: counts by risk + top category. */
export function summarizeCleaned(rows = []) {
  const byRisk = { Critical: 0, High: 0, Medium: 0, Low: 0, Unrated: 0 }
  const byCategory = new Map()
  for (const r of rows) {
    const risk = byRisk[r.risk_level] !== undefined && r.risk_level !== 'Unrated' ? r.risk_level : 'Unrated'
    byRisk[risk] += 1
    const cat = r.category || 'Uncategorised'
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }))
  const highRisk = byRisk.Critical + byRisk.High
  return {
    total: rows.length,
    byRisk,
    highRisk,
    highRiskPct: rows.length ? Math.round((highRisk / rows.length) * 1000) / 10 : null,
    topCategory: categories[0] ?? null,
    categories,
  }
}

/** Share of all records already classified; null when there are none. */
export function cleanedShare(pending, cleaned) {
  const p = Number(pending) || 0
  const c = Number(cleaned) || 0
  if (p + c === 0) return null
  return Math.round((c / (p + c)) * 1000) / 10
}

/** Rows for the per-check Excel workbook (one flat issue list). */
export function qualityIssueExportRows(checks = {}) {
  const out = []
  const push = (check, r, issue) => out.push({
    check,
    serial: r.tyre_serial || 'N/A',
    asset_no: r.asset_no || 'N/A',
    site: r.site || 'N/A',
    issue_date: r.issue_date || 'N/A',
    issue,
  })
  for (const r of checks.serialIssues?.issues ?? []) push('Serials', r, r.issue_type)
  for (const g of checks.duplicateSerial?.groups ?? []) for (const r of g.records) push('Duplicates', r, `Serial ${g.serial} on ${g.count} active records`)
  for (const r of checks.invalidPressure?.records ?? []) push('Pressure', r, `Pressure ${r.pressure_reading ?? 'blank'} PSI`)
  for (const r of checks.missingTread?.records ?? []) push('Tread', r, 'Tread depth missing')
  for (const a of checks.missingInspect?.asset_nos ?? []) push('Inspections', { asset_no: a }, `No inspection in ${INSPECTION_WINDOW_DAYS} days`)
  for (const r of checks.odometer?.issues ?? []) push('Odometer', r, r.issue_type)
  for (const r of checks.unrealisticLife?.issues ?? []) push('Tyre Life', r, r.issue_type)
  return out
}
