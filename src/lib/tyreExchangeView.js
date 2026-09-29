/**
 * Tyre Exchange view engine (pure, no I/O).
 *
 * Turns the tyre register (tyre_records) into an EXCHANGE register: every
 * fitting, replacement, transfer between vehicles, interchange between
 * positions on one vehicle and removal the records can prove. Nothing here is
 * invented: a column the register does not carry (time of day, technician,
 * condition) is left null and the page prints "N/A".
 *
 * Classification of one fitment record r, fitted on (asset, position):
 *   - the same serial was last on ANOTHER asset          -> Transfer
 *   - the same serial was last on this asset, other slot -> Interchange
 *   - another tyre was on this asset and position before -> Replacement
 *   - otherwise                                          -> Fitting
 * A record with a removal date and no later tyre on that position is also a
 * Removal event, dated on its removal date.
 */

export const EXCHANGE_TYPES = ['Replacement', 'Transfer', 'Interchange', 'Removal', 'Fitting']

export const TYPE_TONE = {
  Replacement: 'info',
  Transfer: 'orange',
  Interchange: 'warn',
  Removal: 'bad',
  Fitting: 'good',
}

/** Donut colours per type (kit tokens, so light and dark share them). */
export const TYPE_COLOR = {
  Replacement: 'var(--cc-blue)',
  Transfer: 'var(--cc-orange)',
  Interchange: 'var(--cc-purple)',
  Removal: 'var(--cc-red)',
  Fitting: 'var(--cc-green)',
}

export const STATUS_TONE = { Active: 'good', Removed: 'muted', Scrapped: 'bad' }

const txt = (v) => {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}
const up = (v) => (txt(v) ? txt(v).toUpperCase() : null)

export function serialOf(r) {
  return txt(r?.serial_no) || txt(r?.serial_number) || null
}
export function positionOf(r) {
  return up(r?.tyre_position) || up(r?.position) || null
}
export function dayOf(v) {
  const s = txt(v)
  return s ? s.slice(0, 10) : null
}
export function isRetread(r) {
  return String(r?.category || '').toLowerCase().includes('retread')
}

function tyreSnap(r) {
  if (!r) return null
  return {
    serial: serialOf(r),
    size: txt(r.size),
    brand: txt(r.brand),
    asset: up(r.asset_no),
    position: positionOf(r),
    retread: isRetread(r),
    status: txt(r.status),
  }
}

const byDate = (a, b) => {
  const da = dayOf(a.issue_date) || ''
  const db = dayOf(b.issue_date) || ''
  if (da !== db) return da < db ? -1 : 1
  return String(a.id ?? '').localeCompare(String(b.id ?? ''))
}

/**
 * Build the exchange register, newest first.
 * @param {Array<object>} records tyre_records rows
 * @returns {Array<object>} events
 */
export function deriveExchanges(records) {
  const rows = (records || []).filter((r) => dayOf(r.issue_date) && up(r.asset_no))
  rows.sort(byDate)
  const lastBySerial = new Map()
  const lastByPos = new Map()
  const laterAtPos = new Map() // posKey -> latest fitment date seen
  const events = []
  for (const r of rows) {
    const serial = serialOf(r)
    const asset = up(r.asset_no)
    const pos = positionOf(r)
    const posKey = pos ? `${asset}|${pos}` : null
    const prevSerial = serial ? lastBySerial.get(serial) : null
    const prevAtPos = posKey ? lastByPos.get(posKey) : null
    let type = 'Fitting'
    let from = null
    let removed = null
    if (prevSerial && up(prevSerial.asset_no) && up(prevSerial.asset_no) !== asset) {
      type = 'Transfer'
      from = { asset: up(prevSerial.asset_no), position: positionOf(prevSerial), site: txt(prevSerial.site) }
    } else if (prevSerial && positionOf(prevSerial) && pos && positionOf(prevSerial) !== pos) {
      type = 'Interchange'
      from = { asset, position: positionOf(prevSerial), site: txt(prevSerial.site) }
    } else if (prevAtPos && serialOf(prevAtPos) !== serial) {
      type = 'Replacement'
    }
    if (prevAtPos && serialOf(prevAtPos) !== serial) removed = tyreSnap(prevAtPos)
    events.push({
      id: `f-${r.id ?? events.length}`,
      recordId: r.id ?? null,
      date: dayOf(r.issue_date),
      type,
      asset,
      vehicleType: txt(r.vehicle_type),
      position: pos,
      site: txt(r.site),
      country: txt(r.country),
      brand: txt(r.brand),
      removed,
      installed: tyreSnap(r),
      from,
      to: { asset, position: pos, site: txt(r.site) },
      installedKind: isRetread(r) ? 'Retreaded' : (prevSerial ? 'Used' : 'New'),
      status: txt(r.status),
      photos: Array.isArray(r.photos) ? r.photos : [],
    })
    if (serial) lastBySerial.set(serial, r)
    if (posKey) { lastByPos.set(posKey, r); laterAtPos.set(posKey, dayOf(r.issue_date)) }
  }
  // Removals: a removal date with no later fitment on that position.
  for (const r of rows) {
    const rd = dayOf(r.removal_date)
    if (!rd) continue
    const pos = positionOf(r)
    const asset = up(r.asset_no)
    const posKey = pos ? `${asset}|${pos}` : null
    const last = posKey ? lastByPos.get(posKey) : null
    if (last && last !== r) continue
    events.push({
      id: `r-${r.id ?? events.length}`,
      recordId: r.id ?? null,
      date: rd,
      type: 'Removal',
      asset,
      vehicleType: txt(r.vehicle_type),
      position: pos,
      site: txt(r.site),
      country: txt(r.country),
      brand: txt(r.brand),
      removed: tyreSnap(r),
      installed: null,
      from: { asset, position: pos, site: txt(r.site) },
      to: null,
      installedKind: null,
      status: txt(r.status),
      photos: Array.isArray(r.photos) ? r.photos : [],
    })
  }
  events.sort((a, b) => (a.date === b.date ? String(b.id).localeCompare(String(a.id)) : (a.date < b.date ? 1 : -1)))
  return events
}

export const EMPTY_FILTERS = Object.freeze({
  site: '', asset: '', brand: '', type: '', status: '', position: '', search: '', from: '', to: '',
})

export function hasFilters(f = {}) {
  return Object.keys(EMPTY_FILTERS).some((k) => k !== 'from' && k !== 'to' && f[k])
}

/** Filter the register. Date bounds are inclusive YYYY-MM-DD strings. */
export function filterExchanges(events, f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (events || []).filter((e) => {
    if (f.from && (!e.date || e.date < f.from)) return false
    if (f.to && (!e.date || e.date > f.to)) return false
    if (f.site && e.site !== f.site) return false
    if (f.asset && e.asset !== f.asset) return false
    if (f.brand && e.brand !== f.brand) return false
    if (f.type && e.type !== f.type) return false
    if (f.status && (e.status || '') !== f.status) return false
    if (f.position && e.position !== f.position) return false
    if (q) {
      const hay = [e.asset, e.installed?.serial, e.removed?.serial, e.site, e.position]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct filter options drawn from the register itself. */
export function exchangeOptions(events) {
  const sets = { site: new Set(), asset: new Set(), brand: new Set(), status: new Set(), position: new Set() }
  for (const e of events || []) {
    if (e.site) sets.site.add(e.site)
    if (e.asset) sets.asset.add(e.asset)
    if (e.brand) sets.brand.add(e.brand)
    if (e.status) sets.status.add(e.status)
    if (e.position) sets.position.add(e.position)
  }
  const sorted = (s) => [...s].sort((a, b) => a.localeCompare(b))
  return {
    sites: sorted(sets.site), assets: sorted(sets.asset), brands: sorted(sets.brand),
    statuses: sorted(sets.status), positions: sorted(sets.position),
  }
}

/** The six headline counts over a (filtered) register. */
export function exchangeKpis(events) {
  const list = events || []
  const fitted = list.filter((e) => e.type !== 'Removal')
  return {
    total: list.length,
    fittings: fitted.length,
    removals: list.filter((e) => e.type === 'Removal' || e.removed).length,
    transfers: list.filter((e) => e.type === 'Transfer').length,
    newFitted: fitted.filter((e) => e.installedKind === 'New').length,
    retreadFitted: fitted.filter((e) => e.installedKind === 'Retreaded').length,
  }
}

/** Count by type as donut segments (fixed order, zero types kept). */
export function typeSegments(events) {
  const counts = Object.fromEntries(EXCHANGE_TYPES.map((t) => [t, 0]))
  for (const e of events || []) if (counts[e.type] != null) counts[e.type] += 1
  return EXCHANGE_TYPES.map((t) => ({ label: t, count: counts[t], color: TYPE_COLOR[t] }))
}

const iso = (d) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Window for the summary tabs, anchored on `now` (local calendar days). */
export function summaryWindow(key, now = new Date(), custom = {}) {
  const today = iso(now)
  if (key === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: iso(d), to: today } }
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  if (key === 'quarter') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: today }
  return { from: custom.from || '', to: custom.to || '' }
}

/** Default register window: the current year to date. */
export function defaultRange(now = new Date()) {
  return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) }
}

/** Shift an inclusive range back or forward by its own length (in days). */
export function shiftRange({ from, to }, dir) {
  if (!from || !to) return { from, to }
  const a = new Date(`${from}T00:00:00`); const b = new Date(`${to}T00:00:00`)
  const days = Math.round((b - a) / 86400000) + 1
  a.setDate(a.getDate() + dir * days); b.setDate(b.getDate() + dir * days)
  return { from: iso(a), to: iso(b) }
}

/** Vehicles for the new-exchange picker, from the register. */
export function assetChoices(records) {
  const by = new Map()
  for (const r of records || []) {
    const a = up(r.asset_no)
    if (!a) continue
    const cur = by.get(a) || { asset: a, vehicleType: null, site: null }
    if (!cur.vehicleType && txt(r.vehicle_type)) cur.vehicleType = txt(r.vehicle_type)
    if (txt(r.site)) cur.site = txt(r.site)
    by.set(a, cur)
  }
  return [...by.values()].sort((x, y) => x.asset.localeCompare(y.asset))
}

/** The tyre currently on (asset, position), from the latest active record. */
export function currentTyreAt(records, asset, position) {
  const a = up(asset); const p = up(position)
  if (!a || !p) return null
  let best = null
  for (const r of records || []) {
    if (up(r.asset_no) !== a || positionOf(r) !== p) continue
    if (String(r.status || '').toLowerCase() !== 'active') continue
    if (!best || (dayOf(r.issue_date) || '') > (dayOf(best.issue_date) || '')) best = r
  }
  return best ? tyreSnap(best) : null
}

export const EXCHANGE_EVENT_TYPE = { Replacement: 'replacement', Interchange: 'rotation', Transfer: 'other' }

/**
 * Validate the new-exchange form and build the tyre_service_events payload.
 * Returns { ok:false, errors } or { ok:true, payload }.
 */
export function buildExchangePayload(form = {}, { country = null, today = iso(new Date()) } = {}) {
  const errors = []
  const type = form.type
  if (!EXCHANGE_EVENT_TYPE[type]) errors.push('Choose an exchange type.')
  const asset = up(form.asset)
  if (!asset) errors.push('Choose a vehicle or asset.')
  const position = up(form.position)
  if (!position) errors.push('Choose a tyre position.')
  const installed = txt(form.installedSerial)
  const removed = txt(form.removedSerial)
  if (type === 'Replacement' && !installed) errors.push('Enter the installed tyre serial.')
  if ((type === 'Transfer' || type === 'Interchange') && !installed && !removed) errors.push('Enter the serial of the tyre being moved.')
  if (type === 'Transfer' && !up(form.toAsset)) errors.push('Choose the vehicle the tyre moves to.')
  if (type === 'Interchange' && !up(form.toPosition)) errors.push('Choose the position the tyre moves to.')
  if (errors.length) return { ok: false, errors }
  const lines = [`${type}.`]
  if (removed) lines.push(`Removed tyre ${removed}${txt(form.removedCondition) ? ` (${txt(form.removedCondition)})` : ''}.`)
  if (installed) lines.push(`Installed tyre ${installed}${txt(form.installedKind) ? `, ${txt(form.installedKind)}` : ''}${txt(form.installedCondition) ? ` (${txt(form.installedCondition)})` : ''}.`)
  if (type === 'Transfer') lines.push(`Moved from ${asset} ${position} to ${up(form.toAsset)}${up(form.toPosition) ? ` ${up(form.toPosition)}` : ''}.`)
  if (type === 'Interchange') lines.push(`Moved on ${asset} from ${position} to ${up(form.toPosition)}.`)
  if (txt(form.notes)) lines.push(txt(form.notes))
  return {
    ok: true,
    payload: {
      event_type: EXCHANGE_EVENT_TYPE[type],
      tyre_serial: installed || removed,
      asset_no: asset,
      position,
      event_date: txt(form.date) || today,
      technician: txt(form.technician),
      site: txt(form.site),
      notes: lines.join(' '),
      country: country && country !== 'All' ? country : null,
    },
  }
}

/** Export rows for the register. */
export const REGISTER_EXPORT_COLUMNS = [
  { key: 'date', header: 'Date' },
  { key: 'type', header: 'Type' },
  { key: 'asset', header: 'Vehicle / asset' },
  { key: 'position', header: 'Position' },
  { key: 'removedSerial', header: 'Removed tyre' },
  { key: 'installedSerial', header: 'Installed tyre' },
  { key: 'installedKind', header: 'Installed as' },
  { key: 'site', header: 'Site' },
  { key: 'status', header: 'Tyre status' },
]
export function registerExportRows(events) {
  return (events || []).map((e) => ({
    date: e.date || 'N/A',
    type: e.type,
    asset: e.asset || 'N/A',
    position: e.position || 'N/A',
    removedSerial: e.removed?.serial || 'N/A',
    installedSerial: e.installed?.serial || 'N/A',
    installedKind: e.installedKind || 'N/A',
    site: e.site || 'N/A',
    status: e.status || 'N/A',
  }))
}
