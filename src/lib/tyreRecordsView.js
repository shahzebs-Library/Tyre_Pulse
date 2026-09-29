/**
 * tyreRecordsView - pure shaping for the Tyre Records page (route /tyres).
 *
 * The page reads real tyre_records rows plus a few side reads (vehicle master,
 * running life, odometer, the tyre passport bundle). Everything here is a pure
 * function over those rows so the table, the KPI tiles and the detail panel
 * cannot disagree. A figure with no source returns null and renders "N/A";
 * nothing is estimated or defaulted.
 */

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const trim = (v) => (v == null ? '' : String(v).trim())

/**
 * The three statuses tyre_records actually carries (measured: Active, Removed,
 * Scrapped). There is no in-stock or in-repair status on a tyre record, so the
 * page never invents one.
 */
export const STATUS_META = {
  Active: { label: 'In use', tone: 'good' },
  Removed: { label: 'Removed', tone: 'muted' },
  Scrapped: { label: 'Scrapped', tone: 'bad' },
}

export const STATUS_OPTIONS = Object.keys(STATUS_META)

/** Pill label and tone for a stored status; an unknown value is shown as stored. */
export function statusMeta(status) {
  const s = trim(status)
  if (!s) return { label: 'Not recorded', tone: 'muted' }
  const key = Object.keys(STATUS_META).find((k) => k.toLowerCase() === s.toLowerCase())
  return key ? STATUS_META[key] : { label: s, tone: 'muted' }
}

/** Condition comes from the recorded risk level. Nothing recorded reads N/A. */
export const RISK_TONE = { Low: 'good', Medium: 'warn', High: 'orange', Critical: 'bad' }
export function conditionMeta(risk) {
  const r = trim(risk)
  if (!r) return null
  return { label: r, tone: RISK_TONE[r] || 'muted' }
}

/** Serial for display, across the three serial columns the table carries. */
export function serialOf(r) {
  return trim(r?.serial_no) || trim(r?.serial_number) || trim(r?.tyre_serial) || ''
}

/** Position for display (two position columns exist; `position` is primary). */
export function positionOf(r) {
  return trim(r?.position) || trim(r?.tyre_position) || ''
}

/**
 * Life earned by one record, in km: the stored total when positive, else the
 * removal odometer minus the fitment odometer when both exist and run forward.
 */
export function recordLifeKm(r) {
  const total = num(r?.total_km)
  if (total != null && total > 0) return total
  const fit = num(r?.km_at_fitment)
  const rem = num(r?.km_at_removal)
  if (fit != null && rem != null && rem > fit) return rem - fit
  return null
}

/** Vehicle master row for a record, matched on asset AND country when known. */
export function fleetKey(assetNo, country) {
  return `${trim(assetNo).toUpperCase()}|${trim(country).toUpperCase()}`
}
export function buildFleetMap(fleetRows = []) {
  const map = new Map()
  for (const f of fleetRows || []) {
    if (!f?.asset_no) continue
    const exact = fleetKey(f.asset_no, f.country)
    if (!map.has(exact)) map.set(exact, f)
    const any = fleetKey(f.asset_no, '')
    if (!map.has(any)) map.set(any, f)
  }
  return map
}
export function fleetFor(map, r) {
  if (!map || !r?.asset_no) return null
  return map.get(fleetKey(r.asset_no, r.country)) || (r.country ? null : map.get(fleetKey(r.asset_no, ''))) || null
}

const isActive = (r) => trim(r?.status).toLowerCase() === 'active'

/**
 * Odometer reading to show against a tyre. An active tyre reads its vehicle's
 * current odometer; a removed or scrapped tyre reads the odometer at removal.
 * @returns {{value:number|null, basis:'vehicle'|'removal'|null}}
 */
export function currentKmFor(r, fleet) {
  if (isActive(r)) {
    const v = num(fleet?.current_km)
    return v != null && v > 0 ? { value: v, basis: 'vehicle' } : { value: null, basis: null }
  }
  const rem = num(r?.km_at_removal)
  return rem != null && rem > 0 ? { value: rem, basis: 'removal' } : { value: null, basis: null }
}

/**
 * Life km for the table. A finished tyre reads its recorded life; an active one
 * reads the vehicle odometer minus the fitment odometer, when that runs forward.
 */
export function lifeKmFor(r, fleet) {
  const recorded = recordLifeKm(r)
  if (!isActive(r)) return recorded
  const fit = num(r?.km_at_fitment)
  const cur = num(fleet?.current_km)
  if (fit != null && cur != null && cur >= fit && fit > 0) return cur - fit
  return recorded
}

/** Cost per km of a finished tyre, or null when either side is missing. */
export function cpkOf(r) {
  const cost = num(r?.cost_per_tyre)
  const life = recordLifeKm(r)
  if (cost == null || life == null || life <= 0) return null
  return cost / life
}

/** Average of the positive life values, with the sample it rests on. */
export function averageLife(values = []) {
  const good = (values || []).map(num).filter((v) => v != null && v > 0)
  if (!good.length) return { avg: null, n: 0 }
  return { avg: good.reduce((a, b) => a + b, 0) / good.length, n: good.length }
}

/**
 * Distinct option values for a filter, byte-exact (the grid filters with an
 * exact match, so a trimmed option would miss padded rows) with blanks removed.
 */
export function distinctOptions(rows = [], key) {
  const set = new Set()
  for (const r of rows || []) {
    const v = r?.[key]
    if (v == null || !String(v).trim()) continue
    set.add(String(v))
  }
  return [...set].sort((a, b) => String(a).trim().localeCompare(String(b).trim(), 'en', { numeric: true }))
}

/** How many optional filters are active, for the "More filters (N)" badge. */
export function activeFilterCount(filters = {}) {
  return ['siteFilter', 'brandFilter', 'riskFilter', 'statusFilter', 'sizeFilter', 'positionFilter']
    .filter((k) => trim(filters[k])).length
}

/** Latest inspection date per asset from inspection rows (newest wins). */
export function latestInspectionByAsset(rows = []) {
  const out = new Map()
  for (const r of rows || []) {
    const key = trim(r?.asset_no).toUpperCase()
    const date = r?.completed_date || r?.inspection_date || null
    if (!key || !date) continue
    const prev = out.get(key)
    if (!prev || String(date) > String(prev)) out.set(key, String(date).slice(0, 10))
  }
  return out
}

/**
 * Life cycle and usage for the detail panel. The running-life row (active
 * tyres only) is the source of truth for run, expected life and remaining; a
 * finished tyre reads its recorded life and has no remaining figure.
 */
export function lifeUsage(record, runRow) {
  if (runRow) {
    const used = num(runRow.lifeUsedPct)
    return {
      currentKm: num(runRow.currentKm),
      runKm: num(runRow.kmRun),
      totalLifeKm: num(runRow.expectedLifeKm),
      usedPct: used == null ? null : Math.max(0, Math.min(100, used)),
      remainingKm: num(runRow.remainingKm),
      basis: 'running',
    }
  }
  return {
    currentKm: num(record?.km_at_removal),
    runKm: recordLifeKm(record),
    totalLifeKm: null,
    usedPct: null,
    remainingKm: null,
    basis: isActive(record) ? 'none' : 'finished',
  }
}

/** Pick this tyre's row from an asset's running-life rows (serial, then position). */
export function matchRunningRow(rows = [], record) {
  const serial = serialOf(record).toUpperCase()
  const pos = positionOf(record).toUpperCase()
  const list = rows || []
  if (serial) {
    const hit = list.find((r) => trim(r.serial).toUpperCase() === serial)
    if (hit) return hit
  }
  if (pos) return list.find((r) => trim(r.position).toUpperCase() === pos) || null
  return null
}

/**
 * Monthly odometer trend since fitment: the highest reading in each month,
 * expressed as km run on this tyre when the fitment odometer is known.
 */
export function kmTrend(readings = [], kmAtFitment = null) {
  const fit = num(kmAtFitment)
  const byMonth = new Map()
  for (const r of readings || []) {
    const km = num(r?.odometer_km)
    const date = trim(r?.reading_date)
    if (km == null || !date) continue
    const m = date.slice(0, 7)
    if (!byMonth.has(m) || km > byMonth.get(m)) byMonth.set(m, km)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, km]) => ({ month, km: fit != null && fit > 0 ? Math.max(0, km - fit) : km }))
}

/** Rows for the Installation history tab (each fitment on a vehicle). */
export function installationRows(passport) {
  return (passport?.events || [])
    .filter((e) => e.fitment_date || e.asset_no)
    .map((e) => ({
      id: e.id, date: e.fitment_date || e.date, asset_no: e.asset_no, position: e.position,
      site: e.site, km: e.km_at_fitment, status: e.status,
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

/** Service events of the given types, newest first. */
export function serviceRows(passport, types = []) {
  const want = new Set(types.map((t) => t.toLowerCase()))
  return (passport?.serviceEvents || [])
    .filter((e) => want.has(String(e.type || '').toLowerCase()))
}

/** Disposal history: removals with a reason, scrap status and scrap marks. */
export function disposalRows(passport) {
  const rows = (passport?.events || [])
    .filter((e) => e.removal_date || /scrap|remov/i.test(String(e.status || '')))
    .map((e) => ({
      id: e.id, date: e.removal_date || e.date, asset_no: e.asset_no, position: e.position,
      status: e.status, reason: e.reason, km: e.km_at_removal,
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  return { rows, marks: passport?.statusMarks || [] }
}

/** Every vehicle this tyre has served on, with the fitments per vehicle. */
export function linkedAssets(passport) {
  const map = new Map()
  for (const e of passport?.events || []) {
    if (!e.asset_no) continue
    const k = trim(e.asset_no).toUpperCase()
    const cur = map.get(k) || { asset_no: e.asset_no, fitments: 0, first: null, last: null, sites: new Set() }
    cur.fitments += 1
    const d = e.fitment_date || e.date
    if (d && (!cur.first || d < cur.first)) cur.first = d
    if (d && (!cur.last || d > cur.last)) cur.last = d
    if (e.site) cur.sites.add(e.site)
    map.set(k, cur)
  }
  return [...map.values()].map((a) => ({ ...a, sites: [...a.sites].join(', ') }))
}

/**
 * Cost history lines, one per priced record or costed event. Listed, never
 * totalled: fleet tyre spend comes from the expense grid, not from these prices.
 */
export function costRows(passport, records = []) {
  const byId = new Map((records || []).map((r) => [r.id, r]))
  const lines = []
  for (const e of passport?.events || []) {
    if (e.cost == null) continue
    lines.push({ id: `rec-${e.id}`, date: e.date, kind: 'Tyre price', amount: e.cost, country: byId.get(e.id)?.country || null, note: e.asset_no || '' })
  }
  for (const e of passport?.serviceEvents || []) {
    if (e.cost == null || !(Number(e.cost) > 0)) continue
    lines.push({ id: `svc-${e.id}`, date: e.date, kind: `Service: ${e.type || 'other'}`, amount: e.cost, country: null, note: e.asset_no || '' })
  }
  for (const c of passport?.retreadClaims || []) {
    if (c.cost == null) continue
    lines.push({ id: `rt-${c.id}`, date: c.claim_date || c.date || null, kind: 'Retread', amount: c.cost, country: c.country || null, note: c.vendor || '' })
  }
  return lines.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

/** Currency of a record's own country; null when the country is not known. */
export function currencyOf(country) {
  return COUNTRY_CURRENCY[trim(country)] || null
}

/** Photo URLs stored on a record (strings or { url } objects). */
export function photoUrls(r) {
  const p = r?.photos
  if (!Array.isArray(p)) return []
  return p.map((x) => (typeof x === 'string' ? x : x?.url || x?.path || null)).filter(Boolean)
}
