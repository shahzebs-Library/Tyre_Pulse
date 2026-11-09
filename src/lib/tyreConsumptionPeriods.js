/**
 * tyreConsumptionPeriods - pure shaping for get_tyre_consumption_v2
 * (migration 20261110110000): quarter-to-date, year-to-date and the same period
 * last year, the event counts, and the breakdown tables.
 *
 * MIRROR of the SQL period rules - change both together:
 *   * every window is anchored on the period END (the "to" date);
 *   * QTD starts on the first day of that date's quarter, YTD on 1 January;
 *   * the previous-year window shifts BOTH ends back one calendar year, and
 *     29 February becomes 28 February (Postgres `date - interval '1 year'`).
 *
 * Two different counts are never mixed (rule T19 spirit, applied to counts):
 *   installations      every fitment event, quantity honoured, minus rows that are
 *                      the same fitment entered twice;
 *   physical tyres     distinct tyres consumed: a real serial counts once, on its
 *                      FIRST fitment; an unreadable serial counts once per
 *                      vehicle, wheel and date.
 * A refit, rotation or transfer is an installation but not consumption.
 *
 * No I/O, no clock unless injected. Unknown stays null, never 0.
 */

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

/** Parse 'YYYY-MM-DD' into numbers; null when it is not a date. */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''))
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null
  return { y, m: mo, d }
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysIn(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

/** Same calendar day one year earlier; 29 Feb -> 28 Feb (Postgres semantics). */
export function shiftYear(day, years = -1) {
  const p = parseDay(day)
  if (!p) return null
  const y = p.y + years
  return iso(y, p.m, Math.min(p.d, daysIn(y, p.m)))
}

export function quarterStart(day) {
  const p = parseDay(day)
  if (!p) return null
  return iso(p.y, Math.floor((p.m - 1) / 3) * 3 + 1, 1)
}

export function yearStart(day) {
  const p = parseDay(day)
  return p ? iso(p.y, 1, 1) : null
}

/**
 * Every window the v2 RPC reports, from the selected period.
 * @returns {null | Record<'selected'|'selected_prev'|'qtd'|'qtd_prev'|'ytd'|'ytd_prev', {from, to}>}
 */
export function periodWindows(from, to) {
  if (!parseDay(from) || !parseDay(to) || from > to) return null
  const q = quarterStart(to)
  const y = yearStart(to)
  const toPrev = shiftYear(to)
  return {
    selected: { from, to },
    selected_prev: { from: shiftYear(from), to: toPrev },
    qtd: { from: q, to },
    qtd_prev: { from: shiftYear(q), to: toPrev },
    ytd: { from: y, to },
    ytd_prev: { from: shiftYear(y), to: toPrev },
  }
}

/** Plain-English label for a window, e.g. "1 Jan 2026 to 31 Oct 2026". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function windowLabel(w) {
  const a = parseDay(w?.from); const b = parseDay(w?.to)
  if (!a || !b) return 'Period not known'
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} to ${b.d} ${MONTHS[b.m - 1]} ${b.y}`
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** % change current vs previous; null when either is unknown or previous is 0. */
export function pctChange(cur, prev) {
  const c = num(cur); const p = num(prev)
  if (c == null || p == null || p === 0) return null
  return Math.round(((c - p) / p) * 1000) / 10
}

/** The counts the screen and the export show, in display order. */
export const EVENT_ROWS = [
  { key: 'installations', label: 'Installations (fitment events)', help: 'Every fitment, quantity honoured. The same fitment entered twice counts once.' },
  { key: 'physical_consumed', label: 'Physical tyres consumed', help: 'Distinct tyres put into service for the first time. A refit, rotation or transfer is not consumption.' },
  { key: 'new_fitments', label: 'New fitments (readable serial)', help: 'First fitment of a tyre with a real serial.' },
  { key: 'physical_unidentified', label: 'Serial not readable', help: 'Batch code, size or blank in the serial; counted once per vehicle, wheel and date.' },
  { key: 'reused', label: 'Reused fitments', help: 'Rotations, refits on the same wheel and transfers together.' },
  { key: 'rotations', label: 'Rotations', help: 'Same tyre moved to another wheel of the same vehicle.' },
  { key: 'reinstalled', label: 'Refitted on the same wheel', help: 'Same tyre back on the same wheel later.' },
  { key: 'transfers', label: 'Transfers', help: 'Same tyre fitted to another vehicle.' },
  { key: 'duplicate_entries', label: 'Repeated entries ignored', help: 'The same fitment recorded more than once (for example a file loaded twice). Not counted anywhere above.' },
  { key: 'removed', label: 'Tyres removed', help: 'Distinct tyres with a removal date in the period.' },
  { key: 'scrapped', label: 'Tyres scrapped', help: 'Distinct tyres marked Scrapped whose removal date is in the period.' },
  { key: 'retreaded', label: 'Retreads returned', help: 'Retread jobs returned and retread service events in the period.' },
  { key: 'warranty_replacements', label: 'Warranty replacements', help: 'Warranty claims (not rejected) and fitments priced at zero under warranty.' },
]

export const PERIOD_KEYS = ['selected', 'qtd', 'ytd']
export const PERIOD_LABEL = { selected: 'Selected period', qtd: 'Quarter to date', ytd: 'Year to date' }

export const BREAKDOWN_DIMS = [
  { key: 'site', label: 'Site' },
  { key: 'brand', label: 'Brand' },
  { key: 'size', label: 'Size' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'vehicle_type', label: 'Vehicle type' },
]

function periodBlock(raw) {
  const out = { from: raw?.from ?? null, to: raw?.to ?? null }
  for (const r of EVENT_ROWS) out[r.key] = num(raw?.[r.key])
  return out
}

/**
 * Shape the v2 payload. Returns { ok:false, reason } when the payload is an error.
 */
export function shapeConsumptionV2(payload) {
  if (!payload || payload.ok === false) {
    return { ok: false, reason: payload?.reason || 'The tyre consumption service returned nothing.' }
  }
  const p = payload.periods || {}
  const periods = {}
  for (const k of ['selected', 'selected_prev', 'qtd', 'qtd_prev', 'ytd', 'ytd_prev']) periods[k] = periodBlock(p[k])

  const cards = PERIOD_KEYS.map((k) => {
    const cur = periods[k]; const prev = periods[`${k}_prev`]
    return {
      key: k,
      label: PERIOD_LABEL[k],
      window: windowLabel(cur),
      prevWindow: windowLabel(prev),
      installations: cur.installations,
      physical: cur.physical_consumed,
      prevInstallations: prev.installations,
      prevPhysical: prev.physical_consumed,
      installationsChangePct: pctChange(cur.installations, prev.installations),
      physicalChangePct: pctChange(cur.physical_consumed, prev.physical_consumed),
    }
  })

  const eventRows = EVENT_ROWS.map((r) => {
    const row = { key: r.key, label: r.label, help: r.help }
    for (const k of PERIOD_KEYS) {
      row[k] = periods[k][r.key]
      row[`${k}_prev`] = periods[`${k}_prev`][r.key]
      row[`${k}_change`] = pctChange(periods[k][r.key], periods[`${k}_prev`][r.key])
    }
    return row
  })

  const breakdowns = {}
  for (const d of BREAKDOWN_DIMS) {
    const rows = Array.isArray(payload.breakdowns?.[d.key]) ? payload.breakdowns[d.key] : []
    const totalInst = rows.reduce((s, r) => s + (num(r.installations) ?? 0), 0)
    breakdowns[d.key] = rows.map((r) => ({
      key: String(r.k ?? 'Not recorded'),
      resolved: r.resolved !== false,
      installations: num(r.installations) ?? 0,
      physicalNew: num(r.physical_new) ?? 0,
      reused: num(r.reused) ?? 0,
      removed: num(r.removed) ?? 0,
      sharePct: totalInst > 0 ? Math.round(((num(r.installations) ?? 0) / totalInst) * 1000) / 10 : null,
    }))
  }

  const supplierRecorded = num(payload.supplier_recorded)
  return {
    ok: true,
    from: payload.from ?? null,
    to: payload.to ?? null,
    periods,
    cards,
    eventRows,
    breakdowns,
    undatedFitments: num(payload.undated_fitments),
    undatedScrapped: num(payload.undated_scrapped),
    supplierRecorded,
    supplierMissing: supplierRecorded === 0,
  }
}

/** Sheets for exportSheetsToExcel: event counts across every window + each breakdown. */
export function consumptionV2Sheets(shaped) {
  if (!shaped?.ok) return []
  const fmt = (v) => (v == null ? 'N/A' : v)
  const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
  const w = shaped.periods
  const eventSheet = {
    name: 'Counts by period',
    note: 'Installations count every fitment event; physical tyres count each tyre once on its first fitment.',
    columns: ['label', 'selected', 'selected_prev', 'selected_change', 'qtd', 'qtd_prev', 'qtd_change', 'ytd', 'ytd_prev', 'ytd_change'],
    headers: [
      'Measure',
      `Selected (${windowLabel(w.selected)})`, `Same period last year (${windowLabel(w.selected_prev)})`, 'Change',
      `Quarter to date (${windowLabel(w.qtd)})`, `Last year (${windowLabel(w.qtd_prev)})`, 'Change',
      `Year to date (${windowLabel(w.ytd)})`, `Last year (${windowLabel(w.ytd_prev)})`, 'Change',
    ],
    rows: shaped.eventRows.map((r) => ({
      label: r.label,
      selected: fmt(r.selected), selected_prev: fmt(r.selected_prev), selected_change: fmtPct(r.selected_change),
      qtd: fmt(r.qtd), qtd_prev: fmt(r.qtd_prev), qtd_change: fmtPct(r.qtd_change),
      ytd: fmt(r.ytd), ytd_prev: fmt(r.ytd_prev), ytd_change: fmtPct(r.ytd_change),
    })),
  }
  const dimSheets = BREAKDOWN_DIMS.map((d) => ({
    name: `By ${d.label.toLowerCase()}`,
    note: `Selected period, by ${d.label.toLowerCase()}.`,
    columns: ['key', 'installations', 'physicalNew', 'reused', 'removed', 'share'],
    headers: [d.label, 'Installations', 'Physical tyres (new)', 'Reused fitments', 'Tyres removed', 'Share of installations'],
    rows: (shaped.breakdowns[d.key] || []).map((r) => ({
      key: r.key, installations: r.installations, physicalNew: r.physicalNew,
      reused: r.reused, removed: r.removed, share: fmtPct(r.sharePct),
    })),
  }))
  return [eventSheet, ...dimSheets]
}
