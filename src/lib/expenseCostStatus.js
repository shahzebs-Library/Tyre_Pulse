/**
 * expenseCostStatus - the ONE vocabulary for purchase-cost status (rule T17), used by
 * tyres (v_tyre_lifetime / toLifetimeTyres) and by expense lines (parts_consumption,
 * SQL expense_cost_status_lines / get_expense_cost_status_summary, migration
 * 20261110090000).
 *
 * Statuses, highest precedence first (an expense line gets exactly one):
 *   DISPUTED        a person must decide; the line is not safe to sum blindly
 *                   (cross_load_copy: same content already arrived in an earlier upload;
 *                    conflicting_revision: same ERP line uploaded with different values)
 *   CONFIRMED_ZERO  zero amount on a warranty / free-of-charge line
 *   ESTIMATED       the ERP sent nothing; priced from the item-code median (filled_cost)
 *   MISSING         zero amount, no estimate, not warranty
 *   ACTUAL          the ERP sent an amount (a negative amount is a credit, still ACTUAL)
 *
 * `classifyExpenseLines` is the JS MIRROR of the SQL classification (same keys, same
 * precedence, upload = the hour the row arrived). Change both together.
 *
 * Money is never blended across currencies (T10): every summary is per country, in
 * that country's currency. No I/O here.
 */

export const COST_STATUS = Object.freeze({
  ACTUAL: 'ACTUAL',
  ESTIMATED: 'ESTIMATED',
  CONFIRMED_ZERO: 'CONFIRMED_ZERO',
  MISSING: 'MISSING',
  DISPUTED: 'DISPUTED',
})

/** Display order: money that is solid first, then what needs a person. */
export const COST_STATUS_ORDER = Object.freeze(['ACTUAL', 'ESTIMATED', 'CONFIRMED_ZERO', 'MISSING', 'DISPUTED'])

export const COST_STATUS_LABEL = Object.freeze({
  ACTUAL: 'Actual',
  ESTIMATED: 'Estimated',
  CONFIRMED_ZERO: 'Confirmed zero',
  MISSING: 'Missing',
  DISPUTED: 'Disputed',
})

export const COST_STATUS_HINT = Object.freeze({
  ACTUAL: 'The ERP sent an amount for this line. A negative amount is a credit (refund or return).',
  ESTIMATED: 'The ERP sent no amount; the line is priced from the median of the same item code. Not a paid price.',
  CONFIRMED_ZERO: 'Zero on purpose: the description marks it as warranty or free of charge.',
  MISSING: 'Zero amount with no estimate and no warranty evidence. The real cost is unknown.',
  DISPUTED: 'Needs a person: the same line arrived in an earlier upload, or was uploaded again with a different value.',
})

export const DISPUTE_REASON_LABEL = Object.freeze({
  cross_load_copy: 'Repeated in a later upload',
  conflicting_revision: 'Uploaded again with a different value',
})

const WARRANTY_RE = /(warrant|warrent|warent|waranty|gaurantee|guarantee|free of charge|free issue|\bfoc\b|no charge|zero charge|complimentary|f\.o\.c|replacement claim|under claim)/i

const num = (v) => {
  if (v == null || v === '') return null
  const x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(x) ? x : null
}
const nz = (v) => (v == null || v === 0 ? null : v)

/** The amount the ERP itself sent, or null (mirror of erp_amt in SQL). */
export function erpAmountOf(line) {
  if (!line) return null
  const v = num(line.value_amount)
  const t = num(line.total_amount)
  const parts = [num(line.spare_parts_amount) ?? 0, num(line.tyre_amount) ?? 0, num(line.oil_amount) ?? 0]
  return nz(v) ?? nz(t) ?? nz(Math.max(...parts)) ?? nz(Math.min(...parts))
}

/** True when the description evidences a warranty / free-of-charge line. */
export const isWarrantyLine = (desc) => WARRANTY_RE.test(String(desc || ''))

const field = (v) => (v == null ? '' : String(v))
const CONTENT_FIELDS = ['country', 'issue_number', 'work_order_no', 'txn_date', 'asset_code', 'store_code',
  'cost_center', 'item_code', 'qty', 'item_description', 'value_amount', 'spare_parts_amount',
  'tyre_amount', 'oil_amount', 'total_amount']
const BUSINESS_FIELDS = CONTENT_FIELDS.slice(0, 10)
const keyOf = (line, fields) => fields.map((f) => field(line[f])).join('|')
const loadOf = (line) => {
  const d = new Date(line?.created_at)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}
const lineCostOf = (line) => num(line?.line_cost) ?? 0

/**
 * Classify raw parts_consumption rows. Returns a NEW array of
 * { ...line, cost_status, dispute_reason, is_credit }. Mirrors
 * expense_cost_status_lines(): the earliest upload of a content key stays ACTUAL;
 * a later upload's copies up to the earlier count are DISPUTED (cross_load_copy).
 */
export function classifyExpenseLines(lines = []) {
  const rows = (lines || []).filter(Boolean)
  // per content key -> per load -> rows (in id order)
  const byContent = new Map()
  const revisionCounts = new Map()
  rows.forEach((r, i) => {
    const ck = keyOf(r, CONTENT_FIELDS)
    if (!byContent.has(ck)) byContent.set(ck, new Map())
    const loads = byContent.get(ck)
    const ld = loadOf(r)
    if (!loads.has(ld)) loads.set(ld, [])
    loads.get(ld).push(i)
    const src = field(r.source_row).trim()
    if (src) {
      const rk = `${keyOf(r, BUSINESS_FIELDS)}#${src}`
      if (!revisionCounts.has(rk)) revisionCounts.set(rk, { values: new Set(), splits: new Set() })
      const g = revisionCounts.get(rk)
      g.values.add(field(r.value_amount))
      g.splits.add(`${field(r.tyre_amount)}|${field(r.total_amount)}`)
    }
  })
  const dispute = new Array(rows.length).fill(null)
  for (const loads of byContent.values()) {
    const ordered = [...loads.keys()].sort()
    let priorMax = 0
    for (const ld of ordered) {
      const idxs = loads.get(ld).slice().sort((a, b) => { const x = field(rows[a].id); const y = field(rows[b].id); return x < y ? -1 : x > y ? 1 : a - b })
      idxs.forEach((idx, pos) => { if (pos + 1 <= priorMax) dispute[idx] = 'cross_load_copy' })
      priorMax = Math.max(priorMax, idxs.length)
    }
  }
  rows.forEach((r, i) => {
    const src = field(r.source_row).trim()
    if (!src) return
    const g = revisionCounts.get(`${keyOf(r, BUSINESS_FIELDS)}#${src}`)
    if (g && (g.values.size > 1 || g.splits.size > 1)) dispute[i] = 'conflicting_revision'
  })
  return rows.map((r, i) => {
    const cost = lineCostOf(r)
    const erp = erpAmountOf(r)
    const filled = num(r.filled_cost)
    let status
    if (dispute[i]) status = COST_STATUS.DISPUTED
    else if (cost === 0 && isWarrantyLine(r.item_description)) status = COST_STATUS.CONFIRMED_ZERO
    else if (erp == null && filled != null && filled > 0) status = COST_STATUS.ESTIMATED
    else if (cost === 0) status = COST_STATUS.MISSING
    else status = COST_STATUS.ACTUAL
    return { ...r, cost_status: status, dispute_reason: dispute[i], is_credit: cost < 0 }
  })
}

/** Per-country summary of classified lines (own currency, never blended). */
export function summarizeExpenseStatuses(classified = []) {
  const map = new Map()
  for (const r of classified) {
    const c = r.country || 'Unknown'
    if (!map.has(c)) {
      map.set(c, {
        country: c, currency: r.currency || null, lines: 0, total: 0,
        statuses: Object.fromEntries(COST_STATUS_ORDER.map((s) => [s, { lines: 0, amount: 0 }])),
      })
    }
    const g = map.get(c)
    const cost = lineCostOf(r)
    g.lines += 1
    g.total += cost
    const s = g.statuses[r.cost_status] || (g.statuses[r.cost_status] = { lines: 0, amount: 0 })
    s.lines += 1
    s.amount += cost
  }
  return [...map.values()].sort((a, b) => a.country.localeCompare(b.country))
}

/**
 * Normalise the server summary (get_expense_cost_status_summary) for display.
 * Missing statuses read as zero lines; `solidShare` = ACTUAL amount / total, null when
 * the total is not positive (never a fake 100%).
 */
export function shapeExpenseStatusSummary(data) {
  if (!data || data.ok !== true || !Array.isArray(data.countries)) return { ok: false, countries: [] }
  const countries = data.countries.map((c) => {
    const statuses = {}
    for (const s of COST_STATUS_ORDER) {
      const v = c.statuses?.[s] || {}
      statuses[s] = {
        lines: num(v.lines) ?? 0,
        amount: num(v.amount) ?? 0,
        tyreLines: num(v.tyre_lines) ?? 0,
        tyreAmount: num(v.tyre_amount) ?? 0,
      }
    }
    const total = num(c.total)
    const actual = statuses.ACTUAL.amount
    return {
      country: c.country || 'Unknown',
      currency: c.currency || null,
      lines: num(c.lines) ?? 0,
      total,
      statuses,
      solidShare: total != null && total > 0 ? actual / total : null,
      estimatedAmount: statuses.ESTIMATED.amount,
      disputedAmount: statuses.DISPUTED.amount,
      copy: { lines: num(c.disputed?.cross_load_copy?.lines) ?? 0, amount: num(c.disputed?.cross_load_copy?.amount) ?? 0 },
      revision: { lines: num(c.disputed?.conflicting_revision?.lines) ?? 0, amount: num(c.disputed?.conflicting_revision?.amount) ?? 0 },
      credit: { lines: num(c.credit?.lines) ?? 0, amount: num(c.credit?.amount) ?? 0 },
      repair: { lines: num(c.repair?.lines) ?? 0, amount: num(c.repair?.amount) ?? 0 },
      retread: { lines: num(c.retread?.lines) ?? 0, amount: num(c.retread?.amount) ?? 0 },
      multiQtyLines: num(c.multi_qty_lines) ?? 0,
    }
  })
  return { ok: true, countries }
}

/** Rows for an Excel export of the status split (one row per country and status). */
export function expenseStatusExportRows(shaped) {
  const out = []
  for (const c of shaped?.countries || []) {
    for (const s of COST_STATUS_ORDER) {
      out.push({
        country: c.country,
        currency: c.currency || '',
        status: COST_STATUS_LABEL[s],
        lines: c.statuses[s].lines,
        amount: Math.round(c.statuses[s].amount * 100) / 100,
        tyre_lines: c.statuses[s].tyreLines,
        tyre_amount: Math.round(c.statuses[s].tyreAmount * 100) / 100,
      })
    }
  }
  return out
}
