/**
 * Workshop <-> warehouse: the material story of one job card. Pure, no I/O.
 *
 * One row per stock line used by the job card:
 *   requested   = reserved for the job card (minus what was released)
 *   reserved    = still held, not yet issued
 *   issued      = issue movements against the job card (reversed ones excluded)
 *   installed   = confirmed fitted by the workshop (job_material_installations)
 *   returned    = issue_return / return movements against the job card
 *   unreconciled = issued - returned - installed  (parts handed over but not yet
 *                  accounted for as fitted or returned)
 *
 * Money: per currency, never added across currencies. An issue with no cost is
 * counted as UNVALUED quantity, never as 0 (owner rule).
 */

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round = (n) => Math.round(n * 1e6) / 1e6
const text = (v) => String(v ?? '').trim()

export const ISSUE_TYPES = ['issue']
export const RETURN_TYPES = ['issue_return', 'return']

/** Quantity of a reservation still held. */
export function reservationOpen(r) {
  if (!r || (r.status && r.status !== 'active')) return 0
  return Math.max(0, round((num(r.qty) || 0) - (num(r.qty_released) || 0) - (num(r.qty_consumed) || 0)))
}

/** Ids of movements that were reversed (some other movement points at them). */
export function reversedIds(movements = [], reversals = []) {
  const s = new Set()
  for (const m of [...(movements || []), ...(reversals || [])]) {
    if (m?.reverses_movement_id) s.add(m.reverses_movement_id)
  }
  return s
}

/** Is this issue movement fully valued (a cost the ledger knows)? */
export function issueValued(m) {
  return num(m?.value_change) !== null && (num(m?.unvalued_qty_change) || 0) === 0
    && (!m?.valuation_status || !/unvalued|pending|partial/i.test(String(m.valuation_status)))
}

function addMoney(map, currency, amount) {
  const c = text(currency).toUpperCase() || 'NO CURRENCY'
  map.set(c, round((map.get(c) || 0) + amount))
}

const moneyList = (map) => [...map.entries()]
  .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
  .sort((a, b) => a.currency.localeCompare(b.currency))

/**
 * Build the job card material rows.
 * @param {object} p
 * @param {Array} p.reservations  stock_reservations rows of the job card
 * @param {Array} p.movements     v_inv_movements rows (issue / returns) of the job card
 * @param {Array} [p.reversals]   movements that reverse any of the above
 * @param {Array} [p.installations] job_material_installations rows
 * @param {Array} [p.balances]    v_inv_balances rows, for item code / description / site
 */
export function buildJobMaterials({ reservations = [], movements = [], reversals = [], installations = [], balances = [] } = {}) {
  const bal = new Map((balances || []).map((b) => [b.id, b]))
  const reversed = reversedIds(movements, reversals)
  const rows = new Map()
  const row = (stockId, seed = {}) => {
    const key = stockId || `item:${seed.item_code || 'unknown'}`
    if (!rows.has(key)) {
      const b = bal.get(stockId) || {}
      rows.set(key, {
        key, stockId: stockId || null,
        itemId: b.item_id || seed.item_id || null,
        itemCode: b.item_code || seed.item_code || null,
        description: b.description || null,
        site: b.site || seed.site || null,
        country: b.country || seed.country || null,
        location: b.location_code || seed.location_code || null,
        uom: b.uom || null,
        onHand: num(b.qty_on_hand),
        free: b.qty_on_hand == null ? null : Math.max(0, (num(b.qty_on_hand) || 0) - (num(b.qty_reserved) || 0)),
        requested: 0, reserved: 0, issued: 0, returned: 0, installed: 0,
        reservations: [], issues: [],
        issuedValue: new Map(), returnedValue: new Map(), unvaluedQty: 0,
      })
    }
    return rows.get(key)
  }

  for (const r of reservations || []) {
    const x = row(r.stock_id, r)
    x.requested = round(x.requested + Math.max(0, (num(r.qty) || 0) - (num(r.qty_released) || 0)))
    const open = reservationOpen(r)
    x.reserved = round(x.reserved + open)
    if (open > 0) x.reservations.push({ id: r.id, open, createdAt: r.created_at || null })
  }

  for (const m of movements || []) {
    if (reversed.has(m.id)) continue
    const x = row(m.stock_id, m)
    const q = Math.abs(num(m.qty_change) || 0)
    if (ISSUE_TYPES.includes(m.movement_type)) {
      x.issued = round(x.issued + q)
      x.issues.push({ id: m.id, qty: q, postedAt: m.posted_at || m.created_at || null, actorId: m.actor_id || m.created_by || null, reference: m.reference_no || null })
      if (issueValued(m)) addMoney(x.issuedValue, m.currency, Math.abs(num(m.value_change)))
      else x.unvaluedQty = round(x.unvaluedQty + q)
    } else if (RETURN_TYPES.includes(m.movement_type)) {
      x.returned = round(x.returned + q)
      const v = num(m.value_change)
      if (v !== null) addMoney(x.returnedValue, m.currency, Math.abs(v))
    }
  }

  const installedByMove = new Map()
  for (const i of installations || []) {
    const x = row(i.stock_id, i)
    const q = num(i.qty) || 0
    x.installed = round(x.installed + q)
    installedByMove.set(i.movement_id, round((installedByMove.get(i.movement_id) || 0) + q))
  }

  const out = [...rows.values()].map((x) => {
    const net = new Map(x.issuedValue)
    for (const [c, a] of x.returnedValue) net.set(c, round((net.get(c) || 0) - a))
    const unreconciled = round(x.issued - x.returned - x.installed)
    return {
      key: x.key, stockId: x.stockId, itemId: x.itemId, itemCode: x.itemCode, description: x.description,
      site: x.site, country: x.country, location: x.location, uom: x.uom, onHand: x.onHand, free: x.free,
      requested: x.requested, reserved: x.reserved, issued: x.issued, returned: x.returned, installed: x.installed,
      unreconciled: Math.max(0, unreconciled),
      overAccounted: unreconciled < 0,
      reservations: x.reservations,
      issues: x.issues.map((iss) => ({ ...iss, installed: installedByMove.get(iss.id) || 0, open: Math.max(0, round(iss.qty - (installedByMove.get(iss.id) || 0))) })),
      cost: moneyList(net),
      unvaluedQty: x.unvaluedQty,
    }
  })
  return out.sort((a, b) => text(a.itemCode).localeCompare(text(b.itemCode)) || text(a.location).localeCompare(text(b.location)))
}

/** Totals for the KPI strip. Money stays per currency. */
export function summariseJobMaterials(rows = [], requisitions = []) {
  const t = { lines: rows.length, requested: 0, reserved: 0, issued: 0, installed: 0, returned: 0, unreconciled: 0, unvaluedQty: 0 }
  const money = new Map()
  for (const r of rows) {
    for (const k of ['requested', 'reserved', 'issued', 'installed', 'returned', 'unreconciled', 'unvaluedQty']) t[k] = round(t[k] + (r[k] || 0))
    for (const c of r.cost || []) addMoney(money, c.currency, c.amount)
  }
  const openReq = (requisitions || []).filter((q) => !['rejected', 'ordered', 'cancelled', 'received', 'closed'].includes(String(q.status || '').toLowerCase()))
  return {
    ...t,
    cost: moneyList(money),
    mixedCurrency: money.size > 1,
    openRequisitions: openReq.length,
    onOrderQty: round(openReq.reduce((n, q) => n + (num(q.quantity) || 0), 0)),
    reconciled: t.issued > 0 && t.unreconciled === 0,
  }
}

/**
 * Reserve before buying: split a requested quantity over the stock lines that
 * have free stock (most free first). What cannot be covered is the shortage,
 * which becomes a requisition. Lines of another site are never offered.
 * @returns {{ allocations:{stockId:string, qty:number, location:string|null}[], covered:number, shortage:number }}
 */
export function planRequest({ qty, balances = [], site } = {}) {
  const want = num(qty)
  if (want === null || want <= 0) return { allocations: [], covered: 0, shortage: 0, error: 'Enter a quantity above zero.' }
  const s = text(site).toUpperCase()
  const lines = (balances || [])
    .filter((b) => !s || text(b.site).toUpperCase() === s)
    .map((b) => ({ b, free: Math.max(0, (num(b.qty_on_hand) || 0) - (num(b.qty_reserved) || 0)) }))
    .filter((l) => l.free > 0)
    .sort((a, b) => b.free - a.free || text(a.b.id).localeCompare(text(b.b.id)))
  let left = want
  const allocations = []
  for (const l of lines) {
    if (left <= 0) break
    const take = Math.min(left, l.free)
    allocations.push({ stockId: l.b.id, qty: round(take), location: l.b.location_code || null, itemId: l.b.item_id || null })
    left = round(left - take)
  }
  return { allocations, covered: round(want - left), shortage: Math.max(0, round(left)) }
}

/** Validate an installation confirmation against one issue line. */
export function validateInstall({ issue, row, qty }) {
  const n = num(qty)
  if (!issue) return { ok: false, error: 'Choose the issue the parts came from.' }
  if (n === null || n <= 0) return { ok: false, error: 'Enter a quantity above zero.' }
  const limit = Math.min(issue.open ?? issue.qty, row ? row.unreconciled : Infinity)
  if (n > limit) return { ok: false, error: `Only ${limit} of this issue is still to account for.` }
  return { ok: true, qty: n }
}

/** Validate a return of unused parts (bounded by what is not yet installed). */
export function validateReturn({ row, qty, reason }) {
  const n = num(qty)
  if (!row?.stockId) return { ok: false, error: 'This line has no stock line to return to.' }
  if (n === null || n <= 0) return { ok: false, error: 'Enter a quantity above zero.' }
  if (n > row.unreconciled) return { ok: false, error: `Only ${row.unreconciled} is issued and not yet installed or returned.` }
  if (!text(reason)) return { ok: false, error: 'Give a reason for the return.' }
  return { ok: true, qty: n }
}

/**
 * Material cost per asset, from the job cards of that asset. `jobCards` are
 * work_orders rows, `movements` the issue / return movements of those cards.
 */
export function assetMaterialCost({ jobCards = [], movements = [], reversals = [], installations = [] } = {}) {
  const byCard = new Map()
  for (const j of jobCards || []) byCard.set(j.work_order_no, { jobCard: j.work_order_no, status: j.status || null, openedAt: j.opened_at || null, movements: [], installations: [] })
  for (const m of movements || []) byCard.get(m.source_doc_id)?.movements.push(m)
  for (const i of installations || []) byCard.get(i.job_card_no)?.installations.push(i)
  const cards = [...byCard.values()].map((c) => {
    const rows = buildJobMaterials({ movements: c.movements, reversals, installations: c.installations })
    const s = summariseJobMaterials(rows)
    return { jobCard: c.jobCard, status: c.status, openedAt: c.openedAt, issued: s.issued, installed: s.installed, returned: s.returned, unreconciled: s.unreconciled, unvaluedQty: s.unvaluedQty, cost: s.cost }
  }).filter((c) => c.issued > 0 || c.returned > 0)
  const money = new Map()
  let unvaluedQty = 0
  let unreconciled = 0
  for (const c of cards) {
    for (const m of c.cost) addMoney(money, m.currency, m.amount)
    unvaluedQty = round(unvaluedQty + c.unvaluedQty)
    unreconciled = round(unreconciled + c.unreconciled)
  }
  return { cards: cards.sort((a, b) => text(b.openedAt).localeCompare(text(a.openedAt))), cost: moneyList(money), unvaluedQty, unreconciled }
}

export const JOB_MATERIAL_EXPORT_COLUMNS = [
  { key: 'itemCode', header: 'Item code' },
  { key: 'description', header: 'Description' },
  { key: 'location', header: 'Location' },
  { key: 'requested', header: 'Requested' },
  { key: 'reserved', header: 'Reserved' },
  { key: 'issued', header: 'Issued' },
  { key: 'installed', header: 'Installed' },
  { key: 'returned', header: 'Returned' },
  { key: 'unreconciled', header: 'Unreconciled' },
  { key: 'costText', header: 'Net cost' },
  { key: 'unvaluedQty', header: 'Unvalued qty' },
]
