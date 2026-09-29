/**
 * Tyre Passport view shapers (pure, no I/O). The passport maths lives in
 * src/lib/tyrePassport.js; this module only turns a built passport (plus the
 * inspections recorded for the tyre) into the rows and cards the page draws,
 * so the header, the cards, the tables and the exports cannot disagree.
 *
 * Honesty rules held here so they are testable:
 *   - a figure with no source is null (rendered N/A), never a fabricated 0,
 *   - an estimate is only produced when the passport can compute it, and is
 *     flagged `estimate: true` so the page labels it "(Est.)",
 *   - money is never shown in a currency the rows did not carry: a tyre whose
 *     records span two countries reports `mixed` instead of one blended total.
 */
import { normalizeTyreConditions } from './inspectionView'
import { EXPENSE_COUNTRY_CURRENCY } from './expenseReportAnalytics'

const DAY_MS = 86400000
const ts = (d) => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : NaN }
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null }
const normKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * The currency the tyre's money is in. One distinct country on the records
 * decides it; none falls back to the caller's active currency; two or more is
 * `mixed` with no currency, so the page shows N/A instead of a blended sum.
 */
export function passportCurrency(records = [], fallback = null) {
  const countries = [...new Set((Array.isArray(records) ? records : [])
    .map((r) => (r?.country ? String(r.country).trim() : ''))
    .filter(Boolean))]
  if (countries.length > 1) return { currency: null, mixed: true, countries }
  if (countries.length === 1) {
    return { currency: EXPENSE_COUNTRY_CURRENCY[countries[0]] || fallback, mixed: false, countries }
  }
  return { currency: fallback, mixed: false, countries }
}

/** Whole months from a day count; null when unknown. */
export function ageMonths(days) {
  const d = num(days)
  if (d == null || d < 0) return null
  return Math.floor(d / 30.4375)
}

/** Health band label for the score ring. */
export function healthLabel(risk) {
  return {
    low: 'Good condition', medium: 'Monitor', high: 'At risk', critical: 'Critical', unknown: 'Not scored',
  }[risk] || 'Not scored'
}

/** How many of the five health signals were actually measured. */
export function healthCoverage(health) {
  const comps = Object.values(health?.components || {})
  return { measured: comps.filter((c) => c?.hasData).length, total: comps.length }
}

/**
 * Tread card: current reading, share of usable tread left, and whether the
 * "new" reference was measured (first reading) or the engine default.
 */
export function treadInfo(p) {
  const w = p?.wear || {}
  if (w.currentTread == null) return { current: null, pct: null, initial: null, assumed: false }
  const first = p?.treadSeries?.[0]?.tread
  return {
    current: w.currentTread,
    pct: w.treadRemainingPct ?? null,
    initial: w.initialTread ?? null,
    assumed: first == null || Number(first) !== Number(w.initialTread),
  }
}

/**
 * Kilometres card. The expected life is only an estimate when the wear rate
 * could project the remaining distance; otherwise no bar is drawn.
 */
export function kmInfo(p) {
  const km = num(p?.totals?.km)
  const remaining = num(p?.predictions?.projectedRemainingKm)
  const run = km != null && km > 0 ? km : null
  if (run == null) return { km: null, estLife: null, pct: null }
  if (remaining == null) return { km: run, estLife: null, pct: null }
  const estLife = Math.round(run + remaining)
  return { km: run, estLife, pct: estLife > 0 ? Math.round((run / estLife) * 100) : null }
}

/** Per-stint CPK in fitment order, for the sparkline. Needs two points. */
export function cpkSeries(journey = []) {
  const pts = (Array.isArray(journey) ? journey : [])
    .filter((s) => s && s.cpk != null && Number.isFinite(Number(s.cpk)))
    .sort((a, b) => (ts(a.fitted) || 0) - (ts(b.fitted) || 0))
    .map((s) => Number(s.cpk))
  return pts.length >= 2 ? pts : []
}

/** Read a serial stored inside one raw tyre_conditions entry, if any. */
function rawEntrySerial(raw) {
  if (!raw || typeof raw !== 'object') return null
  const v = raw.serial ?? raw.serial_no ?? raw.tyre_serial ?? raw.serialNo
  return v ? normKey(v) : null
}

function rawConditions(inspection) {
  let tc = inspection?.tyre_conditions
  if (typeof tc === 'string') { try { tc = JSON.parse(tc) } catch { return {} } }
  if (!tc || typeof tc !== 'object') return {}
  if (Array.isArray(tc)) {
    const out = {}
    tc.forEach((d, i) => { out[d && (d.position || d.label) ? String(d.position || d.label) : String(i)] = d })
    return out
  }
  return tc
}

/**
 * Inspection rows that belong to THIS tyre. Two honest ways to tie a reading to
 * a tyre, reported per row as `basis`:
 *   - 'serial'   the inspection (or its tyre entry) names the serial,
 *   - 'position' the inspection was on the asset and position the tyre was
 *                fitted to, on a date inside that fitment stint.
 * An inspection matching neither is not this tyre's and is left out.
 */
export function inspectionRowsForTyre({ inspections = [], journey = [], serial, now = new Date() } = {}) {
  const want = normKey(serial)
  const end = new Date(now).getTime()
  const stints = (Array.isArray(journey) ? journey : []).filter((s) => s && s.asset_no && s.position)
  const seen = new Set()
  const rows = []
  for (const insp of Array.isArray(inspections) ? inspections : []) {
    if (!insp || seen.has(insp.id)) continue
    const date = insp.inspection_date || insp.completed_date || insp.created_at || null
    const when = ts(date)
    const raw = rawConditions(insp)
    const norm = normalizeTyreConditions(raw)
    let key = null
    let basis = null
    let stint = null

    // 1. An entry that names the serial.
    key = Object.keys(raw).find((k) => want && rawEntrySerial(raw[k]) === want) || null
    if (key) basis = 'serial'

    // 2. The inspection row names the serial.
    if (!basis && want && normKey(insp.tyre_serial) === want) basis = 'serial'

    // 3. Same asset, same position, inside the fitment window.
    if (Number.isFinite(when)) {
      stint = stints.find((s) => {
        if (normKey(s.asset_no) !== normKey(insp.asset_no)) return false
        const from = ts(s.fitted)
        const to = s.removed ? ts(s.removed) : end
        return Number.isFinite(from) && when >= from && (!Number.isFinite(to) || when <= to + DAY_MS)
      }) || null
    }
    if (!key && stint) {
      const k = Object.keys(norm).find((x) => normKey(x) === normKey(stint.position)) || null
      if (k) { key = k; if (!basis) basis = 'position' }
    }
    if (!basis) continue

    const entry = key ? norm[key] : null
    seen.add(insp.id)
    rows.push({
      id: insp.id,
      date,
      asset_no: insp.asset_no || null,
      site: insp.site || null,
      position: key || stint?.position || null,
      tread: entry?.tread ?? null,
      pressure: entry?.pressure ?? num(insp.pressure_reading),
      condition: entry?.condition ?? null,
      inspector: insp.inspector || null,
      findings: insp.findings || entry?.notes || null,
      basis,
    })
  }
  return rows.sort((a, b) => (ts(b.date) || 0) - (ts(a.date) || 0))
}

/**
 * The most recent pressure reading from any source, with where it came from.
 * No reading anywhere returns null values.
 */
export function latestPressure(p, inspectionRows = []) {
  const cands = []
  for (const e of p?.events || []) if (e.pressure != null) cands.push({ value: e.pressure, date: e.date, source: 'Tyre record' })
  for (const e of p?.serviceEvents || []) if (e.pressure != null) cands.push({ value: e.pressure, date: e.date, source: 'Service event' })
  for (const r of inspectionRows || []) if (r.pressure != null) cands.push({ value: r.pressure, date: r.date, source: 'Inspection' })
  if (!cands.length) return { value: null, date: null, source: null }
  cands.sort((a, b) => (ts(b.date) || 0) - (ts(a.date) || 0))
  return cands[0]
}

/**
 * Fitment and movement rows, newest first. Each fitment becomes a row whose
 * action says what happened relative to the previous one (fitted, moved to a
 * different asset, rotated to a different position); a removal is its own row.
 */
export function movementRows(events = []) {
  const list = (Array.isArray(events) ? events : []).filter(Boolean)
  const rows = []
  list.forEach((e, i) => {
    const prev = list[i - 1]
    let action = 'Fitted'
    if (prev) {
      if (e.asset_no && prev.asset_no && normKey(e.asset_no) !== normKey(prev.asset_no)) action = 'Moved'
      else if (e.position && prev.position && normKey(e.position) !== normKey(prev.position)) action = 'Rotated'
      else action = 'Refitted'
    }
    const fitDate = e.fitment_date || e.date || null
    rows.push({
      id: `${e.id ?? i}-fit`, date: fitDate, asset_no: e.asset_no, position: e.position,
      odometer: e.km_at_fitment ?? null, action, current: false,
    })
    if (e.removal_date) {
      rows.push({
        id: `${e.id ?? i}-rem`, date: e.removal_date, asset_no: e.asset_no, position: e.position,
        odometer: e.km_at_removal ?? null, action: 'Removed', reason: e.reason || null, current: false,
      })
    }
  })
  const last = list[list.length - 1]
  if (last && !last.removal_date && rows.length) {
    const fit = [...rows].reverse().find((r) => r.action !== 'Removed')
    if (fit) fit.current = true
  }
  return rows.sort((a, b) => (ts(b.date) || 0) - (ts(a.date) || 0))
}

/**
 * Lifecycle stepper. Only steps the data supports appear; the one estimate
 * (tread limit) appears only when the wear rate can project it.
 */
export function lifecycleSteps(p) {
  if (!p) return []
  const first = (p.events || [])[0] || {}
  const steps = [{
    key: 'fitted', label: 'Fitted', date: p.firstFittedDate || null,
    sub: first.km_at_fitment != null ? `${Number(first.km_at_fitment).toLocaleString('en-US')} km` : null,
    state: p.firstFittedDate ? 'done' : 'future',
  }]
  const moves = Math.max(0, (p.journey || []).length - 1)
  if (moves > 0) {
    const last = [...(p.journey || [])].sort((a, b) => (ts(b.fitted) || 0) - (ts(a.fitted) || 0))[0]
    steps.push({ key: 'moved', label: moves === 1 ? '1 move or rotation' : `${moves} moves or rotations`, date: last?.fitted || null, sub: last?.asset_no || null, state: 'done' })
  }
  const km = num(p.totals?.km)
  if (p.scrapped) {
    const removal = [...(p.events || [])].reverse().find((e) => e.removal_date)
    steps.push({ key: 'removed', label: 'Removed', date: removal?.removal_date || null, sub: p.scrapReason || null, state: 'done' })
  } else {
    steps.push({ key: 'service', label: 'In service', date: null, sub: km ? `${km.toLocaleString('en-US')} km run` : null, state: 'current' })
    const rep = p.predictions?.projectedReplacementDate
    const left = p.predictions?.projectedRemainingKm
    if (rep || left != null) {
      steps.push({
        key: 'limit', label: 'Tread limit (Est.)', date: rep || null,
        sub: left != null ? `~${Math.round(left).toLocaleString('en-US')} km left` : null, state: 'future', estimate: true,
      })
    }
  }
  return steps
}

/** Warranty card: the latest claim and the count. */
export function warrantySummary(p) {
  const list = Array.isArray(p?.warranty) ? p.warranty : []
  if (!list.length) return { count: 0, latest: null }
  const latest = [...list].sort((a, b) => (ts(b.credit_date || b.removal_date) || 0) - (ts(a.credit_date || a.removal_date) || 0))[0]
  return { count: list.length, latest }
}

/**
 * One chronological feed of everything recorded for the tyre, newest first:
 * fitments, removals, service events, warranty claims and inspections.
 */
export function timelineEvents(p, inspectionRows = []) {
  if (!p) return []
  const out = []
  for (const r of movementRows(p.events)) {
    out.push({
      id: `m-${r.id}`, date: r.date, kind: r.action === 'Removed' ? 'removed' : 'fitment',
      title: `${r.action}${r.asset_no ? ` on ${r.asset_no}` : ''}`,
      detail: [r.position, r.odometer != null ? `${Number(r.odometer).toLocaleString('en-US')} km` : null, r.reason].filter(Boolean).join(', ') || null,
    })
  }
  for (const e of p.serviceEvents || []) {
    out.push({ id: `s-${e.id}`, date: e.date, kind: 'service', title: `${String(e.type || 'Service').replace(/_/g, ' ')}`, detail: [e.asset_no, e.position, e.notes].filter(Boolean).join(', ') || null })
  }
  for (const c of p.warranty || []) {
    out.push({ id: `w-${c.id}`, date: c.credit_date || c.removal_date || null, kind: 'warranty', title: `Warranty claim${c.claim_no ? ` ${c.claim_no}` : ''}`, detail: [c.status, c.failure_type].filter(Boolean).join(', ') || null })
  }
  for (const r of inspectionRows || []) {
    out.push({ id: `i-${r.id}`, date: r.date, kind: 'inspection', title: `Inspected${r.asset_no ? ` on ${r.asset_no}` : ''}`, detail: [r.condition, r.tread != null ? `${r.tread} mm` : null, r.pressure != null ? `${r.pressure} psi` : null].filter(Boolean).join(', ') || null })
  }
  return out.sort((a, b) => (ts(b.date) || 0) - (ts(a.date) || 0))
}

/** Status pill tone for the kit's cc-pill classes. */
export function statusTone(status) {
  const v = String(status || '').toLowerCase()
  if (/scrap|write.?off/.test(v)) return 'bad'
  if (/remov/.test(v)) return 'muted'
  if (/service|fit|active/.test(v)) return 'good'
  return 'muted'
}

/** Readable status text. */
export function statusText(status) {
  const s = String(status || '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown'
}
