/**
 * stockLedger - pure engine for the stock movement ledger (stock_movements).
 *
 * Every figure here comes from ledger rows: received, utilised (issued out),
 * count corrections and other adjustments are kept apart so a daily count that
 * raises a balance is never read as stock received. No I/O; day keys use LOCAL
 * calendar getters (never toISOString, which is UTC).
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** movement_type (any case) -> display bucket and group. Unknown types are reported, never guessed. */
const TYPES = {
  receipt: ['received', 'received'], in: ['received', 'received'], reorder: ['received', 'received'],
  initial: ['received', 'received'], return: ['returned', 'received'], transfer_in: ['transferIn', 'received'],
  issue: ['utilised', 'utilised'], out: ['utilised', 'utilised'], scrap: ['scrapped', 'utilised'],
  transfer_out: ['transferOut', 'utilised'],
  stocktake: ['countAdj', 'count'], count: ['countAdj', 'count'],
  adjustment_up: ['adjustment', 'adjustment'], adjustment_down: ['adjustment', 'adjustment'],
}
export const MOVEMENT_GROUPS = Object.freeze({
  received: 'Received', utilised: 'Utilised', count: 'Count corrections', adjustment: 'Other adjustments',
})

export function classifyMovement(type) {
  const hit = TYPES[String(type ?? '').trim().toLowerCase()]
  return hit ? { bucket: hit[0], group: hit[1], known: true } : { bucket: 'unknown', group: 'adjustment', known: false }
}

/** YYYY-MM-DD of the LOCAL calendar day. */
export function ledgerDay(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const byTime = (a, b) => {
  const d = Date.parse(a.created_at) - Date.parse(b.created_at)
  return d || String(a.id ?? '').localeCompare(String(b.id ?? ''))
}

function blank() {
  return { received: 0, utilised: 0, countAdj: 0, otherAdj: 0, opening: null, closing: null, moves: 0 }
}

/** Add one signed movement to a running total, by group. */
function add(total, m) {
  const change = num(m.qty_change)
  if (change === null) return
  const { group } = classifyMovement(m.movement_type)
  if (group === 'received') total.received += change
  else if (group === 'utilised') total.utilised += Math.abs(change)
  else if (group === 'count') total.countAdj += change
  else total.otherAdj += change
  total.moves++
}

/**
 * Per-item and overall summary of the ledger. `opening` is the balance before the first
 * movement in the window and `closing` the balance after the last one; both are null for an
 * item with no movement in the window (its balance did not change, so nothing is claimed).
 */
export function summarizeLedger(movements = []) {
  const items = new Map()
  const totals = { ...blank(), net: 0 }
  const unknownTypes = new Set()
  for (const m of [...(movements || [])].sort(byTime)) {
    if (!m?.stock_id) continue
    const cls = classifyMovement(m.movement_type)
    if (!cls.known) unknownTypes.add(String(m.movement_type ?? ''))
    let row = items.get(m.stock_id)
    if (!row) {
      row = { stockId: m.stock_id, site: m.site || '', description: m.description || '', ...blank() }
      items.set(m.stock_id, row)
    }
    if (row.opening === null) row.opening = num(m.qty_before)
    row.closing = num(m.qty_after) ?? row.closing
    add(row, m)
    add(totals, m)
  }
  const rows = [...items.values()].map(r => ({ ...r, net: r.received - r.utilised + r.countAdj + r.otherAdj }))
  totals.net = totals.received - totals.utilised + totals.countAdj + totals.otherAdj
  return { rows, totals, unknownTypes: [...unknownTypes] }
}

/** One row per local day, newest first. */
export function dailyLedger(movements = []) {
  const days = new Map()
  for (const m of movements || []) {
    const day = ledgerDay(m?.created_at)
    if (!day) continue
    const row = days.get(day) || { date: day, ...blank() }
    add(row, m)
    days.set(day, row)
  }
  return [...days.values()]
    .map(r => ({ ...r, net: r.received - r.utilised + r.countAdj + r.otherAdj }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Tyres fitted in the window, from tyre records ({qty} defaults to one tyre). */
export function tyresFitted(issues = []) {
  return (issues || []).reduce((sum, r) => { const q = num(r?.qty); return sum + (q === null || q <= 0 ? 1 : q) }, 0)
}

/** Honest comparison of tyres fitted against stock recorded as utilised. */
export function utilisationGap(fitted, utilised) {
  if (!fitted) return { gap: 0, note: '' }
  const gap = Math.max(0, fitted - utilised)
  if (!gap) return { gap: 0, note: '' }
  return {
    gap,
    note: `${fitted} tyre${fitted === 1 ? '' : 's'} were fitted in this period but only ${utilised} ${utilised === 1 ? 'was' : 'were'} issued from stock. Fitments are not deducted automatically: record an Issue so balances fall when tyres are used.`,
  }
}
