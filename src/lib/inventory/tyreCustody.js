/**
 * Tyre custody engine (pure). Rules: docs/inventory/24_TYRE_CUSTODY_ENGINE.md
 *
 * One authoritative custody state per physical tyre (strong serial, per org +
 * country), derived by READING tyre_records-shaped rows, scrap marks and store
 * holdings. It never edits tyre history, never touches cost, and never feeds CPK:
 * fitmentCpk / withOnePricePerTyre / tyreKm stay the only tyre money and life rules.
 *
 * - Conflicting evidence (scrapped yet active, fitted and in stock, one serial on
 *   two assets) gives state 'unknown' + the evidence. It is never auto-resolved.
 * - A removed tyre with no recorded decision is 'removed_pending', never assumed
 *   reusable (that is a human call).
 * - A refit of a known tyre is not a new purchase and not new demand.
 * - Time spent in the store is a holding period, not running life.
 * - Weak serials (placeholders, DOT codes, sizes) cannot be tracked as one tyre;
 *   they are returned as a data-quality backlog.
 */
import { isStrongSerial } from '../tyreLifetime'

export const CUSTODY_STATES = Object.freeze([
  'new_stock', 'reserved', 'in_transit', 'fitted', 'removed_pending', 'reusable', 'under_repair',
  'warranty', 'quarantine', 'scrapped', 'returned_supplier', 'unknown',
])

/** States in which the tyre is physically held by the store (not on a wheel). */
export const STORE_STATES = Object.freeze(['new_stock', 'reserved', 'in_transit', 'reusable', 'quarantine', 'under_repair', 'warranty'])

/** Decision states a person may record for a removed tyre (disposition). */
const DISPOSITIONS = new Set(['reusable', 'under_repair', 'warranty', 'quarantine', 'scrapped', 'returned_supplier'])

export const CONFLICT_TYPES = Object.freeze({
  scrapped_but_active: 'Scrap-marked but still fitted (Active row with no removal)',
  fitted_and_in_stock: 'Fitted to a vehicle and also held in stock',
  serial_on_two_assets: 'Active on more than one asset at once',
})

export const canonSerial = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '')
const keyOf = (country, serial) => `${String(country ?? '').trim().toUpperCase()}|${canonSerial(serial)}`
const ms = (d) => {
  if (!d) return null
  const t = d instanceof Date ? d.getTime() : Date.parse(d)
  return Number.isFinite(t) ? t : null
}
const DAY = 86400000

const isActiveRow = (r) => String(r.status ?? '').toLowerCase() === 'active' && !r.removal_date
const isScrappedRow = (r) => String(r.status ?? '').toLowerCase() === 'scrapped'
const fitTime = (r) => ms(r.issue_date ?? r.fitment_date) ?? ms(r.created_at)

function latestRow(rows) {
  return [...rows].sort((a, b) => (fitTime(b) ?? 0) - (fitTime(a) ?? 0) || (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0))[0]
}

/**
 * Derive custody for every strong serial.
 *
 * input = {
 *   records:      tyre_records-shaped rows { id, serial_no, country, asset_no, tyre_position,
 *                 status, issue_date, removal_date, created_at, brand, size }
 *   scrapMarks:   tyre_status_marks rows { serial (or serial_no), country, mark_type, created_at, reason }
 *   holdings:     store holdings { serial, country, custody_state, location_id }  (tyre_items in a store state)
 *   dispositions: recorded decisions for removed tyres { serial, country, state, decided_at, decided_by }
 * }
 * Returns { items: [...one per serial], conflicts: [...], weakSerialRows: n, weakSerialSample: [...] }.
 */
export function deriveCustody({ records = [], scrapMarks = [], holdings = [], dispositions = [] } = {}) {
  const bySerial = new Map()
  const ensure = (country, serial) => {
    const k = keyOf(country, serial)
    if (!bySerial.has(k)) bySerial.set(k, { key: k, serial: canonSerial(serial), country: String(country ?? '').trim().toUpperCase() || null, rows: [], marks: [], holdings: [], dispositions: [] })
    return bySerial.get(k)
  }
  let weak = 0
  const weakSample = []
  for (const r of records) {
    if (!isStrongSerial(r.serial_no)) {
      weak += 1
      if (weakSample.length < 20) weakSample.push({ id: r.id ?? null, serial_no: r.serial_no ?? null })
      continue
    }
    ensure(r.country, r.serial_no).rows.push(r)
  }
  for (const m of scrapMarks) {
    const s = m.serial ?? m.serial_no
    if (String(m.mark_type ?? 'scrap').toLowerCase() !== 'scrap' || !isStrongSerial(s)) continue
    ensure(m.country, s).marks.push(m)
  }
  for (const h of holdings) {
    if (!isStrongSerial(h.serial)) continue
    ensure(h.country, h.serial).holdings.push(h)
  }
  for (const d of dispositions) {
    if (!isStrongSerial(d.serial) || !DISPOSITIONS.has(d.state)) continue
    ensure(d.country, d.serial).dispositions.push(d)
  }

  const items = []
  const conflicts = []
  for (const g of bySerial.values()) {
    const active = g.rows.filter(isActiveRow)
    const activeAssets = [...new Set(active.map((r) => String(r.asset_no ?? '').trim().toUpperCase()).filter(Boolean))]
    const scrapped = g.marks.length > 0 || g.rows.some(isScrappedRow)
    const stockHoldings = g.holdings.filter((h) => STORE_STATES.includes(h.custody_state))
    const local = []

    if (scrapped && active.length) {
      const markAt = g.marks.map((m) => ms(m.created_at)).filter((t) => t !== null).sort((a, b) => a - b)[0] ?? null
      local.push({
        type: 'scrapped_but_active',
        description: CONFLICT_TYPES.scrapped_but_active,
        evidence: {
          scrapMarks: g.marks.map((m) => ({ created_at: m.created_at ?? null, reason: m.reason ?? null })),
          activeRows: active.map((r) => ({
            id: r.id ?? null, asset_no: r.asset_no ?? null, position: r.tyre_position ?? null,
            issue_date: r.issue_date ?? null, created_at: r.created_at ?? null,
            createdAfterScrapMark: markAt !== null && ms(r.created_at) !== null ? ms(r.created_at) > markAt : null,
          })),
        },
      })
    }
    if (active.length && stockHoldings.length) {
      local.push({
        type: 'fitted_and_in_stock',
        description: CONFLICT_TYPES.fitted_and_in_stock,
        evidence: {
          activeRows: active.map((r) => ({ id: r.id ?? null, asset_no: r.asset_no ?? null, position: r.tyre_position ?? null })),
          holdings: stockHoldings.map((h) => ({ location_id: h.location_id ?? null, custody_state: h.custody_state })),
        },
      })
    }
    if (activeAssets.length > 1) {
      local.push({
        type: 'serial_on_two_assets',
        description: CONFLICT_TYPES.serial_on_two_assets,
        evidence: { assets: activeAssets, activeRows: active.map((r) => ({ id: r.id ?? null, asset_no: r.asset_no ?? null, issue_date: r.issue_date ?? null })) },
      })
    }

    let state
    let location = null
    let basis
    if (local.length) {
      state = 'unknown'
      basis = 'conflict'
    } else if (active.length) {
      const r = latestRow(active)
      state = 'fitted'
      location = { asset_no: r.asset_no ?? null, position: r.tyre_position ?? null }
      basis = 'active_fitment'
    } else if (scrapped) {
      state = 'scrapped'
      basis = g.marks.length ? 'scrap_mark' : 'scrapped_status'
    } else if (stockHoldings.length || g.holdings.length) {
      const h = (stockHoldings[0] ?? g.holdings[0])
      state = CUSTODY_STATES.includes(h.custody_state) ? h.custody_state : 'unknown'
      location = { location_id: h.location_id ?? null }
      basis = 'store_holding'
    } else if (g.rows.length) {
      // Removed with no fit since. Use a recorded decision if one is newer than the removal.
      const last = latestRow(g.rows)
      const removedAt = ms(last.removal_date)
      const decision = [...g.dispositions]
        .filter((d) => removedAt === null || (ms(d.decided_at) ?? 0) >= removedAt)
        .sort((a, b) => (ms(b.decided_at) ?? 0) - (ms(a.decided_at) ?? 0))[0]
      state = decision ? decision.state : 'removed_pending'
      basis = decision ? 'recorded_disposition' : 'removed_no_decision'
      location = { last_asset_no: last.asset_no ?? null, last_position: last.tyre_position ?? null, removed_at: last.removal_date ?? null }
    } else {
      state = 'unknown'
      basis = 'no_evidence'
    }

    const conflictIds = local.map((c) => `${c.type}:${g.key}`)
    for (const c of local) conflicts.push({ id: `${c.type}:${g.key}`, serial: g.serial, country: g.country, ...c })
    items.push({
      key: g.key,
      serial: g.serial,
      country: g.country,
      custody_state: state,
      basis,
      location,
      fitments: g.rows.length,
      conflicts: conflictIds,
    })
  }
  return { items, conflicts, weakSerialRows: weak, weakSerialSample: weakSample }
}

/**
 * Tag each fitment row as the tyre's first fit (a purchase) or a refit (reuse).
 * Rows are returned in input order with { fitKind: 'first_fit'|'refit'|'untracked' }.
 * Weak serials are 'untracked' (cannot be tied to other rows).
 * Also flags refit rows that still carry a price while an earlier row is priced
 * (`refitCarriesPrice`) - evidence for review only; CPK's own one-price rule is unchanged.
 */
export function classifyFitments(records = []) {
  const firstIdx = new Map()
  const firstPriced = new Map()
  records.forEach((r, i) => {
    if (!isStrongSerial(r.serial_no)) return
    const k = keyOf(r.country, r.serial_no)
    const cur = firstIdx.get(k)
    if (cur === undefined || (fitTime(r) ?? Infinity) < (fitTime(records[cur]) ?? Infinity)) firstIdx.set(k, i)
    if (Number(r.cost_per_tyre) > 0) {
      const p = firstPriced.get(k)
      if (p === undefined || (fitTime(r) ?? Infinity) < (fitTime(records[p]) ?? Infinity)) firstPriced.set(k, i)
    }
  })
  return records.map((r, i) => {
    if (!isStrongSerial(r.serial_no)) return { ...r, fitKind: 'untracked', refitCarriesPrice: false }
    const k = keyOf(r.country, r.serial_no)
    const first = firstIdx.get(k) === i
    const fp = firstPriced.get(k)
    return {
      ...r,
      fitKind: first ? 'first_fit' : 'refit',
      refitCarriesPrice: !first && Number(r.cost_per_tyre) > 0 && fp !== undefined && fp !== i,
    }
  })
}

/**
 * New-tyre demand in a window: only first fits count. A reusable tyre refitted is
 * not a new purchase. Untracked (weak serial) rows are counted separately, honestly,
 * because they cannot be proved to be first fits.
 */
export function newTyreDemand(records = [], { from, to } = {}) {
  const f = ms(from)
  const t = ms(to)
  const inWindow = (r) => {
    const x = fitTime(r)
    return x !== null && (f === null || x >= f) && (t === null || x <= t)
  }
  const tagged = classifyFitments(records)
  let firstFits = 0
  let refits = 0
  let untracked = 0
  for (const r of tagged) {
    if (!inWindow(r)) continue
    if (r.fitKind === 'first_fit') firstFits += 1
    else if (r.fitKind === 'refit') refits += 1
    else untracked += 1
  }
  return { firstFits, refits, untrackedFits: untracked, note: 'Refits of a known tyre are reuse, not new demand.' }
}

/**
 * Custody timeline for one tyre from its events
 * [{ state, at, asset_no?, location_id? }] (any order). Each segment says whether
 * it counts as running life: ONLY 'fitted' does. The store holding period is
 * reported separately and must never be added to running life or CPK km.
 */
export function custodyTimeline(events = [], { now } = {}) {
  const sorted = events.filter((e) => ms(e.at) !== null && CUSTODY_STATES.includes(e.state)).sort((a, b) => ms(a.at) - ms(b.at))
  const end = ms(now)
  const segments = sorted.map((e, i) => {
    const from = ms(e.at)
    const toMs = i + 1 < sorted.length ? ms(sorted[i + 1].at) : end
    const days = toMs === null ? null : Math.max(0, Math.floor((toMs - from) / DAY))
    return {
      state: e.state,
      from: e.at,
      to: i + 1 < sorted.length ? sorted[i + 1].at : now ?? null,
      days,
      countsAsRunningLife: e.state === 'fitted',
      isStoreHolding: STORE_STATES.includes(e.state),
      asset_no: e.asset_no ?? null,
      location_id: e.location_id ?? null,
    }
  })
  const sum = (pred) => segments.filter(pred).reduce((a, s) => (s.days === null ? a : a + s.days), 0)
  return {
    segments,
    fittedDays: sum((s) => s.countsAsRunningLife),
    holdingDays: sum((s) => s.isStoreHolding),
    note: 'Holding period is time in the store. It is not running life and is never added to tyre km or CPK.',
  }
}

/** Counts per custody state and per conflict type, for summary tiles. */
export function custodySummary({ items = [], conflicts = [], weakSerialRows = 0 } = {}) {
  const byState = Object.fromEntries(CUSTODY_STATES.map((s) => [s, 0]))
  for (const i of items) byState[i.custody_state] = (byState[i.custody_state] || 0) + 1
  const byConflict = Object.fromEntries(Object.keys(CONFLICT_TYPES).map((k) => [k, 0]))
  for (const c of conflicts) byConflict[c.type] = (byConflict[c.type] || 0) + 1
  return { tyres: items.length, byState, byConflict, conflictedTyres: items.filter((i) => i.conflicts.length).length, weakSerialRows }
}
