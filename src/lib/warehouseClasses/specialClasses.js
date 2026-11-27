/**
 * Special inventory classes (pure, no I/O): tool calibration, lubricant
 * dispensing and consumption, serialised repairable units, scrap requests and
 * location capacity / rules.
 *
 * The database is the authority (migration 20261124133000, NOT APPLIED): every
 * rule below is re-checked server-side. These helpers only shape what the
 * screens show and stop an obviously incomplete form before it is sent.
 *
 * Owner rules kept here: a value with no cost stays null (never 0); money is
 * summed per currency only; a date that is missing is "not set", never overdue.
 */

import { textFn } from '../wmsText'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const DAY = 24 * 60 * 60 * 1000
const dayStart = (d) => {
  if (!d) return null
  const t = new Date(d)
  if (!Number.isFinite(t.getTime())) return null
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

// ── Locations ────────────────────────────────────────────────────────────────

/** English names for location types that have no locale entry yet. */
export const LOCATION_TYPE_LABELS = Object.freeze({
  receiving: 'Receiving bay',
  inspection: 'Inspection area',
  service_van: 'Service van',
  workshop_store: 'Workshop store',
  bulk_tank: 'Bulk tank (lubricants)',
})

export const LOCATION_RESTRICTIONS = Object.freeze([
  { value: '', label: 'No restriction' },
  { value: 'tyres_only', label: 'Tyres only' },
  { value: 'lubricants_only', label: 'Lubricants only' },
  { value: 'hazardous', label: 'Hazardous goods' },
  { value: 'serial_tracked_only', label: 'Serial-tracked items only' },
  { value: 'no_mixing', label: 'One item only (no mixing)' },
  { value: 'quarantine_only', label: 'Quarantine stock only' },
])

export const restrictionLabel = (v) => LOCATION_RESTRICTIONS.find((r) => r.value === (v || ''))?.label || 'No restriction'
const restrictionKey = (v) => (v && LOCATION_RESTRICTIONS.some((r) => r.value === v) ? v : 'none')

/** Validate the extra location fields. Returns { errors } keyed by field. */
export function validateLocationClass(d = {}, t) {
  const tx = textFn(t)
  const errors = {}
  const cap = num(d.capacity_qty)
  if (d.capacity_qty !== '' && d.capacity_qty !== null && d.capacity_qty !== undefined && (cap === null || cap <= 0)) {
    errors.capacity_qty = tx('wmsmsgparts.loc.capacityPositive')
  }
  if (cap !== null && cap > 0 && !String(d.capacity_uom || '').trim()) errors.capacity_uom = tx('wmsmsgparts.loc.capacityUnit')
  if (d.van_asset_no && String(d.van_asset_no).trim() && d.location_type !== 'service_van') {
    errors.van_asset_no = tx('wmsmsgparts.loc.vanOnlyService')
  }
  if (d.location_type === 'service_van' && !String(d.van_asset_no || '').trim()) {
    errors.van_asset_no = tx('wmsmsgparts.loc.vanRequired')
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

/** Findings for one utilisation row: over capacity, rule breach, mixing. */
export function locationFindings(row, t) {
  const tx = textFn(t)
  const out = []
  const pct = num(row?.pct_used)
  if (pct !== null && pct > 100) out.push({ tone: 'bad', text: tx('wmsmsgparts.loc.over', { pct }) })
  else if (pct !== null && pct >= 90) out.push({ tone: 'warn', text: tx('wmsmsgparts.loc.nearly', { pct }) })
  const br = num(row?.restriction_breaches) || 0
  if (br > 0) {
    const rule = typeof t === 'function' ? tx(`wmsmsgparts.loc.restriction.${restrictionKey(row.restriction)}`) : restrictionLabel(row.restriction)
    out.push({ tone: 'bad', text: tx(br === 1 ? 'wmsmsgparts.loc.breachOne' : 'wmsmsgparts.loc.breachMany', { n: br, rule }) })
  }
  if (row?.mixing_breach) out.push({ tone: 'bad', text: tx('wmsmsgparts.loc.mixing') })
  return out
}

// ── Tools: calibration ───────────────────────────────────────────────────────

export const CALIBRATION_SOON_DAYS = 30

/**
 * Calibration state of one tool. No due date is "not set" (never overdue).
 * @returns {{ state: 'not_set'|'overdue'|'due_soon'|'ok', days: number|null }}
 */
export function calibrationState(tool, now = Date.now()) {
  const due = dayStart(tool?.calibration_due)
  if (due === null) return { state: 'not_set', days: null }
  const today = dayStart(now)
  const days = Math.round((due - today) / DAY)
  if (days < 0) return { state: 'overdue', days: -days }
  if (days <= CALIBRATION_SOON_DAYS) return { state: 'due_soon', days }
  return { state: 'ok', days }
}

/** Tools needing calibration attention, overdue first (most overdue first), then due soon. */
export function calibrationWatchList(tools, now = Date.now()) {
  return (tools || [])
    .filter((t) => t?.status !== 'retired')
    .map((t) => ({ ...t, ...calibrationState(t, now) }))
    .filter((t) => t.state === 'overdue' || t.state === 'due_soon')
    .sort((a, b) => (a.state === b.state ? (a.state === 'overdue' ? b.days - a.days : a.days - b.days) : a.state === 'overdue' ? -1 : 1))
}

/** Validate a calibration record before sending. */
export function validateCalibration(form = {}, now = Date.now(), t) {
  const tx = textFn(t)
  const on = dayStart(form.calibrated_on)
  const due = dayStart(form.next_due)
  const res = String(form.result || '')
  if (on === null) return { error: tx('wmsmsgparts.tool.calDate') }
  if (on > dayStart(now)) return { error: tx('wmsmsgparts.tool.calFuture') }
  if (!['pass', 'adjusted', 'fail'].includes(res)) return { error: tx('wmsmsgparts.tool.calResult') }
  if (res !== 'fail' && (due === null || due <= on)) return { error: tx('wmsmsgparts.tool.calNextDue') }
  return { error: null }
}

/** Validate a tool issue before sending. */
export function validateToolIssue(form = {}, now = Date.now(), t) {
  const tx = textFn(t)
  if (!form.holder_user_id && !String(form.holder_name || '').trim()) return { error: tx('wmsmsgparts.tool.holder') }
  if (form.due_back_at) {
    const t = new Date(form.due_back_at).getTime()
    if (!Number.isFinite(t)) return { error: tx('wmsmsgparts.tool.dueBackInvalid') }
    if (t < now) return { error: tx('wmsmsgparts.tool.dueBackPast') }
  }
  return { error: null }
}

// ── Lubricants ───────────────────────────────────────────────────────────────

/** Validate a dispense form. `stock` is the chosen balance. */
export function validateDispense(stock, form = {}, t) {
  const tx = textFn(t)
  if (!stock?.id) return { error: tx('wmsmsgparts.lube.stockLine') }
  const qty = num(form.qty)
  if (qty === null || qty <= 0) return { error: tx('wmsmsgparts.lube.qty') }
  const free = num(stock.qty_on_hand) === null ? null : (num(stock.qty_on_hand) || 0) - (num(stock.qty_reserved) || 0)
  if (free !== null && qty > free) return { error: tx('wmsmsgparts.lube.onlyFree', { free }) }
  if (!String(form.asset_no || '').trim()) return { error: tx('wmsmsgparts.lube.asset') }
  const meter = num(form.meter_reading)
  if (form.meter_reading !== '' && form.meter_reading !== undefined && form.meter_reading !== null && (meter === null || meter < 0)) {
    return { error: tx('wmsmsgparts.lube.meterNumber') }
  }
  if (meter !== null && !['km', 'hours'].includes(form.meter_type)) return { error: tx('wmsmsgparts.lube.meterType') }
  return { error: null }
}

/**
 * Per-asset lubricant consumption from v_inv_lubricant_consumption rows.
 * Quantity is kept per unit (no unit is converted or invented); value per
 * currency; a row whose value is null adds nothing and is counted unvalued.
 */
export function consumptionByAsset(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const asset = String(r?.asset_no || '').trim().toUpperCase()
    if (!asset) continue
    const cur = map.get(asset) || { asset_no: asset, app: { qty: {}, lines: 0 }, erp: { qty: {}, lines: 0 }, value: {}, unvaluedLines: 0, lastMonth: null }
    const side = r.source === 'app' ? cur.app : cur.erp
    const unit = String(r.uom || '').trim().toUpperCase() || 'UNIT'
    const q = num(r.qty)
    if (q !== null) side.qty[unit] = (side.qty[unit] || 0) + q
    side.lines += num(r.lines) || 0
    const v = num(r.value)
    if (v !== null && r.currency) cur.value[r.currency] = (cur.value[r.currency] || 0) + v
    else cur.unvaluedLines += num(r.lines) || 0
    if (r.month && (!cur.lastMonth || r.month > cur.lastMonth)) cur.lastMonth = r.month
    map.set(asset, cur)
  }
  return [...map.values()].sort((a, b) => sumQty(b) - sumQty(a) || a.asset_no.localeCompare(b.asset_no))
}
const sumQty = (r) => Object.values(r.app.qty).concat(Object.values(r.erp.qty)).reduce((a, b) => a + b, 0)

/** "12 L | 3 UNIT" style text for a qty-by-unit map; empty map reads None. */
export function qtyByUnitText(map) {
  const parts = Object.entries(map || {}).filter(([, q]) => q).map(([u, q]) => `${Math.round(q * 100) / 100} ${u === 'UNIT' ? 'units' : u}`)
  return parts.length ? parts.join(' | ') : 'None'
}

// ── Serialised units (repairables) ───────────────────────────────────────────

export const UNIT_EVENTS = Object.freeze([
  { value: 'installed_on_asset', label: 'Installed on an asset', cap: 'issue' },
  { value: 'removed_from_asset', label: 'Removed from an asset', cap: 'issue' },
  { value: 'sent_for_repair', label: 'Sent to a vendor for repair', cap: 'transfer' },
  { value: 'returned_from_repair', label: 'Returned from repair', cap: 'transfer' },
  { value: 'beyond_repair', label: 'Beyond repair', cap: 'engineering_approve' },
  { value: 'evaluated', label: 'Engineering evaluation note', cap: 'engineering_approve' },
])
export const UNIT_STATE_LABEL = Object.freeze({
  installed: 'Installed', at_vendor: 'At vendor', beyond_repair: 'Beyond repair', in_store: 'In store',
})
export const unitEventLabel = (v) => UNIT_EVENTS.find((e) => e.value === v)?.label || v

/** Events this user may record, given the unit's latest state. */
export function allowedUnitEvents(latest, can = () => false) {
  const state = latest?.unit_state || null
  return UNIT_EVENTS.filter((e) => {
    if (!can(e.cap)) return false
    if (e.value === 'returned_from_repair') return state === 'at_vendor'
    if (e.value === 'sent_for_repair') return state !== 'at_vendor' && state !== 'installed' && state !== 'beyond_repair'
    if (e.value === 'installed_on_asset') return state !== 'at_vendor' && state !== 'beyond_repair'
    if (e.value === 'removed_from_asset') return state === 'installed' || state === null
    return true
  })
}

/** Validate a unit event before sending. */
export function validateUnitEvent(form = {}, t) {
  const tx = textFn(t)
  if (!form.item_id) return { error: tx('wmsmsgparts.unit.item') }
  if (!String(form.serial || '').trim()) return { error: tx('wmsmsgparts.unit.serial') }
  if (!UNIT_EVENTS.some((e) => e.value === form.event_type)) return { error: tx('wmsmsgparts.unit.event') }
  if (['installed_on_asset', 'removed_from_asset'].includes(form.event_type) && !String(form.asset_no || '').trim()) {
    return { error: tx('wmsmsgparts.unit.asset') }
  }
  if (form.event_type === 'sent_for_repair' && !form.supplier_id) return { error: tx('wmsmsgparts.unit.vendor') }
  return { error: null }
}

// ── Scrap requests ───────────────────────────────────────────────────────────

export const SCRAP_STATUS = Object.freeze({
  proposed: { label: 'Waiting for engineering', tone: 'info' },
  evaluated: { label: 'Waiting for approval', tone: 'warn' },
  not_scrap: { label: 'Engineering: not scrap', tone: 'muted' },
  approved: { label: 'Approved, not posted', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'bad' },
  posted: { label: 'Written off, disposal pending', tone: 'info' },
  disposed: { label: 'Disposed', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
})

/**
 * The next action this user may take on a request. Mirrors the server: the
 * proposer may never evaluate, approve or post their own request.
 */
export function scrapNextAction(req, userId, can = () => false) {
  if (!req) return null
  const own = req.proposed_by && userId && req.proposed_by === userId
  switch (req.status) {
    case 'proposed': return !own && can('engineering_approve') ? 'evaluate' : (own ? 'cancel' : null)
    case 'evaluated': return !own && can('scrap_approve') ? 'decide' : null
    case 'approved': return !own && can('scrap_approve') ? 'post' : null
    case 'posted': return can('scrap_approve') || can('financial_post') ? 'dispose' : null
    default: return null
  }
}

export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', EGYPT: 'EGP' })
export const currencyForCountry = (c) => COUNTRY_CURRENCY[String(c || '').trim().toUpperCase()] || null

/** Recovery totals per currency; requests without a recovery value are counted, not zeroed. */
export function recoverySummary(requests) {
  const totals = {}
  let unknown = 0
  for (const r of requests || []) {
    if (r?.status !== 'disposed') continue
    const v = num(r.recovery_value)
    if (v === null || !r.recovery_currency) { unknown += 1; continue }
    totals[r.recovery_currency] = (totals[r.recovery_currency] || 0) + v
  }
  return { totals, unknown }
}
