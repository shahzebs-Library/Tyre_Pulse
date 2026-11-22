/**
 * Inventory KPI + classification source reads (WEB lane, read-only).
 *
 * Feeds the KPI catalogue screen and the ABC / FSN / VED classification screen
 * in the Inventory Control Center. It ONLY reads rows; every figure is computed
 * by the tested engines in src/lib/inventory/kpi.js and classification.js
 * through the adapter in src/lib/inventory/kpiPanel.js.
 *
 * Each source is read independently and reported as
 *   { status: 'ok' | 'not_provisioned' | 'error', rows, truncated, error }
 * so one refused or missing table never blanks the whole screen: the KPIs that
 * depend on it say why, the rest still render. Reads are bounded (`max`) and
 * report `truncated` so a screen can say when it is not seeing everything.
 * Money columns come from the security_invoker views, which return NULL money
 * without stock:view_value; the screen hides money KPIs for those users rather
 * than presenting NULL as "unvalued".
 */
import { supabase, fetchAllPages, applyCountry, isNotProvisioned, isMissingColumn, toServiceError } from './_client'

const MAX = 20000
const notProvisioned = (err) => isNotProvisioned(err) || isMissingColumn(err)

function applySite(q, site) {
  return site && site !== 'all' ? q.eq('site', site) : q
}

/** One bounded full read; never throws (the failure is reported on the source). */
async function boundedRead(table, cols, { country, site, siteScoped = true, countryScoped = true, build, order = 'id', tiebreak = 'id', max = MAX } = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = supabase.from(table).select(cols)
      if (countryScoped) q = applyCountry(q, country)
      if (siteScoped) q = applySite(q, site)
      if (build) q = build(q)
      q = q.order(order, { ascending: true })
      // The tiebreak must be a real unique column of the relation (a view may not have `id`).
      if (tiebreak && tiebreak !== order) q = q.order(tiebreak, { ascending: true })
      return q.range(from, to)
    }, { max })
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false, error: null }
      return { status: 'error', rows: [], truncated: false, error: toServiceError(error).message }
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated, error: null }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false, error: null }
    return { status: 'error', rows: [], truncated: false, error: toServiceError(err).message }
  }
}

/** Read rows whose `col` is in `ids`, 100 ids per request, still bounded. */
async function readByIds(table, cols, col, ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))]
  if (!uniq.length) return { status: 'ok', rows: [], truncated: false, error: null }
  const out = []
  let truncated = false
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100)
    const r = await boundedRead(table, cols, { siteScoped: false, countryScoped: false, build: (q) => q.in(col, chunk), max: 5000 })
    if (r.status !== 'ok') return { ...r, truncated: truncated || !!r.truncated }
    truncated = truncated || !!r.truncated
    out.push(...r.rows)
  }
  return { status: 'ok', rows: out, truncated, error: null }
}

export { boundedRead as _boundedRead, readByIds as _readByIds }

const iso = (d) => (d instanceof Date ? d.toISOString() : d)

/** The first ledger posting in scope (bounds what "no issue on record" can prove). */
async function ledgerStart({ country, site }) {
  try {
    let q = supabase.from('v_inv_movements').select('posted_at')
    q = applySite(applyCountry(q, country), site)
    const { data, error } = await q.order('posted_at', { ascending: true }).limit(1)
    if (error) return null
    return data?.[0]?.posted_at || null
  } catch {
    return null
  }
}

const VALUATION_COLS = 'stock_id, item_id, country, site, location_id, description, ownership, owner_supplier_id, currency, qty_on_hand, qty_reserved, valued_qty, unvalued_qty, valued_value, avg_unit_cost, last_issue_at, last_receipt_at'
const ITEM_COLS = 'id, organisation_id, item_code, item_name, category, criticality, status, safety_stock, max_qty, lead_time_days, created_at'
const MOVEMENT_COLS = 'id, movement_type, item_id, stock_id, site, country, qty_change, value_change, unit_cost, currency, ownership, posted_at, unvalued_qty_change'

/**
 * Stock balances + item master + the last `historyMonths` of ledger movements.
 * Shared by the KPI and classification screens.
 */
export async function loadStockHistory({ country, site, historyFrom } = {}) {
  const [valuation, movements, startAt] = await Promise.all([
    boundedRead('v_inventory_valuation', VALUATION_COLS, { country, site, order: 'stock_id', tiebreak: null }),
    boundedRead('v_inv_movements', MOVEMENT_COLS, {
      country, site, order: 'posted_at',
      build: (q) => (historyFrom ? q.gte('posted_at', iso(historyFrom)) : q),
    }),
    ledgerStart({ country, site }),
  ])
  const itemIds = [...valuation.rows.map((r) => r.item_id), ...movements.rows.map((r) => r.item_id)]
  const items = await readByIds('material_master', ITEM_COLS, 'id', itemIds)
  return { valuation, movements, items, ledgerStartAt: startAt }
}

/**
 * Every source the 23 catalogue KPIs need for one scope and period.
 * `from`/`to` are ISO dates (YYYY-MM-DD) for the period KPIs; the turnover and
 * exposure KPIs always use the last 12 months regardless of the period.
 */
export async function loadKpiSources({ country, site, from, to, now = new Date() } = {}) {
  const yearAgo = new Date(now)
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 13)
  const inPeriod = (col) => (q) => {
    let x = q
    if (from) x = x.gte(col, `${from}T00:00:00`)
    if (to) x = x.lte(col, `${to}T23:59:59`)
    return x
  }
  const inDatePeriod = (col) => (q) => {
    let x = q
    if (from) x = x.gte(col, from)
    if (to) x = x.lte(col, to)
    return x
  }

  const [history, reservations, exceptions, orders, agreements, consumptions, audits] = await Promise.all([
    loadStockHistory({ country, site, historyFrom: yearAgo }),
    boundedRead('stock_reservations', 'id, stock_id, qty, qty_released, qty_consumed, status, created_at, site, country', { country, site, build: (q) => q.eq('status', 'active') }),
    boundedRead('stock_exceptions', 'id, exception_type, item_id, stock_id, qty, qty_requested, created_at, site, country', {
      country, site, order: 'created_at', build: (q) => inPeriod('created_at')(q.in('exception_type', ['shortage', 'backorder'])),
    }),
    boundedRead('purchase_orders', 'id, po_number, supplier_id, supplier_name, vendor_name, order_date, expected_delivery, priority, status, total_amount, currency, country, site', {
      country, site, order: 'order_date', build: inDatePeriod('order_date'), max: 5000,
    }),
    boundedRead('supplier_agreements', 'id, supplier_id, agreement_type, lead_time_days, max_qty, status, country', { country, siteScoped: false, max: 5000 }),
    boundedRead('consignment_consumptions', 'id, supplier_id, agreement_id, qty, created_at, site, country', {
      country, site, order: 'created_at', build: inPeriod('created_at'),
    }),
    boundedRead('inventory_audits', 'id, ref, status, site, country, audit_type, created_at, updated_at', {
      country, site, order: 'created_at',
      build: (q) => q.in('status', ['counting_completed', 'reconciliation', 'recount', 'investigation', 'approval', 'adjustment_posted', 'closed']),
      max: 500,
    }),
  ])

  // PO lines and their receipts, for the orders in the period.
  const poIds = orders.rows.map((r) => r.id)
  const poLines = orders.status === 'ok'
    ? await readByIds('purchase_order_lines', 'id, po_id, item_id, qty_ordered, qty_received, qty_accepted, unit_price, currency, status', 'po_id', poIds)
    : { status: orders.status, rows: [], truncated: false, error: orders.error }
  const grnLines = poLines.status === 'ok'
    ? await readByIds('goods_receipt_lines', 'id, grn_id, po_line_id, qty_accepted', 'po_line_id', poLines.rows.map((r) => r.id))
    : { status: poLines.status, rows: [], truncated: false, error: poLines.error }
  const grns = grnLines.status === 'ok'
    ? await readByIds('goods_receipts', 'id, po_id, received_date, created_at', 'id', grnLines.rows.map((r) => r.grn_id))
    : { status: grnLines.status, rows: [], truncated: false, error: grnLines.error }

  // The latest count that reached reconciliation (count KPIs are per approved count).
  const latestAudit = audits.status === 'ok' && audits.rows.length
    ? [...audits.rows].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0]
    : null
  let count = { status: audits.status, snapshot: [], counts: [], truncated: false, error: audits.error }
  if (latestAudit) {
    const [snap, lines] = await Promise.all([
      boundedRead('inventory_audit_snapshot_lines', 'id, audit_id, location_id, item_id, serial_no:serial, expected_qty, unit_cost, currency', {
        siteScoped: false, countryScoped: false, build: (q) => q.eq('audit_id', latestAudit.id),
      }),
      boundedRead('inventory_count_lines', 'id, audit_id, location_id, item_id, serial_no:serial, counted_qty, confirmed_zero, counted_at, round', {
        siteScoped: false, countryScoped: false, build: (q) => q.eq('audit_id', latestAudit.id),
      }),
    ])
    const bad = [snap, lines].find((s) => s.status !== 'ok')
    count = bad
      ? { status: bad.status, snapshot: [], counts: [], truncated: false, error: bad.error }
      : { status: 'ok', snapshot: snap.rows, counts: lines.rows, truncated: snap.truncated || lines.truncated, error: null }
  }

  return {
    ...history,
    reservations,
    exceptions,
    orders,
    poLines,
    grnLines,
    grns,
    agreements,
    consumptions,
    audit: latestAudit,
    count,
  }
}
