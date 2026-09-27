/**
 * goodsReceiptAnalytics - pure presentation engine for the Goods Receipt
 * register (/goods-receipt). Line maths (shortfall, the status rollup) stays
 * in `src/lib/goodsReceipts.js`; this module owns what the PAGE derives:
 * enrichment, filters, the KPI strip, the supplier scorecard, the short
 * shipment worklist and the export shape. No I/O, no clock.
 *
 * Honesty rules:
 *   - fill rate is received / ordered over lines where BOTH quantities are
 *     recorded; with no such line it is null (N/A), never 0% or 100%;
 *   - a line with no order quantity has no shortfall (null), not zero.
 */
import {
  receiptShortfall, summarizeGoodsReceipts, GOODS_RECEIPT_STATUS_META,
} from './goodsReceipts'

export const CONDITION_LABEL = Object.freeze({ good: 'Good', damaged: 'Damaged', partial: 'Partial', rejected: 'Rejected' })

const text = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const day = (v) => {
  const s = text(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export const RECEIPT_FILTERS = Object.freeze({ status: 'all', supplier: '', condition: 'all', from: '', to: '', search: '' })

export function hasReceiptFilters(f = RECEIPT_FILTERS) {
  return (f.status && f.status !== 'all') || !!text(f.supplier) || (f.condition && f.condition !== 'all')
    || !!text(f.from) || !!text(f.to) || !!text(f.search)
}

/** Attach shortfall, the short flag and the resolved labels to every line. */
export function enrichReceipts(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const shortfall = receiptShortfall(r)
    return {
      ...r,
      _shortfall: shortfall,
      _isShort: shortfall != null && shortfall > 0,
      _isOver: shortfall != null && shortfall < 0,
      _statusLabel: GOODS_RECEIPT_STATUS_META[r?.status]?.label || text(r?.status) || 'N/A',
      _conditionLabel: CONDITION_LABEL[r?.condition] || text(r?.condition) || 'N/A',
      _date: day(r?.received_date),
    }
  })
}

export function receiptSupplierOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => text(r?.supplier)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

/** Filter by status, supplier, condition, inclusive received-date window and text. */
export function filterReceipts(rows = [], f = RECEIPT_FILTERS) {
  const q = text(f.search).toLowerCase()
  const from = day(f.from)
  const to = day(f.to)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.status && f.status !== 'all' && r?.status !== f.status) return false
    if (text(f.supplier) && text(r?.supplier) !== text(f.supplier)) return false
    if (f.condition && f.condition !== 'all' && r?.condition !== f.condition) return false
    if (from || to) {
      const d = day(r?.received_date)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    if (q) {
      const hay = `${r?.grn_no || ''} ${r?.po_ref || ''} ${r?.supplier || ''} ${r?.item || ''} ${r?.site || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Received / ordered over lines where both are recorded, rounded %, or null. */
export function fillRatePct(rows = []) {
  let ordered = 0
  let received = 0
  let n = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = num(r?.qty_ordered)
    const rc = num(r?.qty_received)
    if (o == null || rc == null || o <= 0) continue
    ordered += o
    received += Math.min(rc, o)
    n += 1
  }
  if (!n || ordered <= 0) return null
  return Math.round((received / ordered) * 1000) / 10
}

/** KPI strip over a set of lines. */
export function receiptKpis(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const base = summarizeGoodsReceipts(list)
  const suppliers = new Set(list.map((r) => text(r?.supplier)).filter(Boolean))
  const quality = list.filter((r) => r?.condition === 'damaged' || r?.condition === 'rejected').length
  const conditioned = list.filter((r) => text(r?.condition)).length
  return {
    total: base.total,
    received: base.byStatus.received,
    outstanding: base.outstanding,
    rejected: base.byStatus.rejected,
    byStatus: base.byStatus,
    shortfallUnits: base.shortfallUnits,
    shortLines: list.filter((r) => { const s = receiptShortfall(r); return s != null && s > 0 }).length,
    overLines: list.filter((r) => { const s = receiptShortfall(r); return s != null && s < 0 }).length,
    fillRatePct: fillRatePct(list),
    qualityIssues: quality,
    qualityIssuePct: conditioned ? Math.round((quality / conditioned) * 1000) / 10 : null,
    suppliers: suppliers.size,
  }
}

/**
 * Per-supplier scorecard: lines, fill rate (null when unmeasurable), short
 * lines, quality issues. Lines without a supplier group under
 * "Supplier not recorded". Worst fill rate first, unmeasured last.
 */
export function supplierScorecard(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const supplier = text(r?.supplier) || 'Supplier not recorded'
    if (!map.has(supplier)) map.set(supplier, [])
    map.get(supplier).push(r)
  }
  return [...map.entries()].map(([supplier, lines]) => {
    const k = receiptKpis(lines)
    return {
      supplier,
      lines: lines.length,
      fillRatePct: k.fillRatePct,
      shortLines: k.shortLines,
      shortfallUnits: k.shortfallUnits,
      qualityIssues: k.qualityIssues,
      outstanding: k.outstanding,
    }
  }).sort((a, b) => {
    if (a.fillRatePct == null && b.fillRatePct != null) return 1
    if (b.fillRatePct == null && a.fillRatePct != null) return -1
    return (a.fillRatePct ?? 0) - (b.fillRatePct ?? 0) || b.lines - a.lines || a.supplier.localeCompare(b.supplier)
  })
}

/** Short-shipped lines, biggest shortfall first. */
export function shortShipments(enriched = []) {
  return (Array.isArray(enriched) ? enriched : [])
    .filter((r) => r._isShort)
    .sort((a, b) => b._shortfall - a._shortfall)
}

export const RECEIPT_EXPORT_COLS = ['grn_no', 'po_ref', 'supplier', 'item', 'qty_ordered', 'qty_received', 'shortfall', 'condition', 'received_date', 'site', 'status']
export const RECEIPT_EXPORT_HEADERS = ['GRN No', 'PO Ref', 'Supplier', 'Item', 'Qty ordered', 'Qty received', 'Shortfall', 'Condition', 'Received', 'Site', 'Status']

export function receiptExportRows(enriched = []) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    grn_no: r.grn_no || '',
    po_ref: r.po_ref || '',
    supplier: r.supplier || '',
    item: r.item || '',
    qty_ordered: r.qty_ordered ?? '',
    qty_received: r.qty_received ?? '',
    shortfall: r._shortfall == null ? 'N/A' : r._shortfall,
    condition: r._conditionLabel,
    received_date: r._date || '',
    site: r.site || '',
    status: r._statusLabel,
  }))
}
