/**
 * expenseImportAnalytics - pure preview maths for the Expense Import page
 * (/expense-import). Classification is the single rule in
 * `src/lib/partsExpense.js` (classifyLine); this module only applies it to the
 * parsed rows for the preview, filters the preview, and totals what is on
 * screen. The IMPORT itself always sends the original full parsed row array,
 * never a filtered/paged subset, so nothing here can change what is written.
 * No I/O.
 */
import { classifyLine } from './partsExpense'

export const CATEGORY_LABEL = { tyre: 'Tyres', spare: 'Spare', oil: 'Oil' }

/** Attach the client-side category + line cost to each parsed row. */
export function classifyPreview(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r, sourceIndex) => {
    const c = classifyLine({
      description: r?.item_description, value: r?.value_amount, spare: r?.spare_parts_amount,
      tyre: r?.tyre_amount, oil: r?.oil_amount, total: r?.total_amount,
    })
    return { r, category: c.category, lineCost: c.lineCost, sourceIndex }
  })
}

/** Filter classified preview rows by search / category / txn-date window. */
export function filterPreview(classified = [], { q = '', category = '', from = '', to = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return (Array.isArray(classified) ? classified : []).filter(({ r, category: cat }) => {
    const haystack = [r?.item_description, r?.item_code, r?.work_order_no, r?.issue_number, r?.asset_code, r?.store_code, r?.cost_center]
      .map((v) => (v == null ? '' : String(v))).join(' ').toLowerCase()
    const date = String(r?.txn_date || '').slice(0, 10)
    return (!needle || haystack.includes(needle))
      && (!category || cat === category)
      && (!from || (date && date >= from))
      && (!to || (date && date <= to))
  })
}

/** Totals for the rows currently shown (the filtered preview). */
export function previewTotals(classified = []) {
  const t = { rows: 0, total: 0, tyre: 0, spare: 0, oil: 0, tyreLines: 0, spareLines: 0, oilLines: 0, zeroCost: 0 }
  for (const s of Array.isArray(classified) ? classified : []) {
    const v = Number(s?.lineCost) || 0
    t.rows += 1
    t.total += v
    if (s.category in CATEGORY_LABEL) {
      t[s.category] += v
      t[`${s.category}Lines`] += 1
    }
    if (v === 0) t.zeroCost += 1
  }
  return t
}

export const PREVIEW_EXPORT_COLUMNS = [
  { key: 'txn_date', header: 'Date' },
  { key: 'work_order_no', header: 'Work order' },
  { key: 'asset_code', header: 'Asset' },
  { key: 'item_code', header: 'Item code' },
  { key: 'item_description', header: 'Item description' },
  { key: 'store_code', header: 'Store' },
  { key: 'amount', header: 'Amount' },
  { key: 'category', header: 'Category' },
]

/** Export rows for the filtered preview. */
export function previewExportRows(classified = []) {
  return (Array.isArray(classified) ? classified : []).map(({ r, category, lineCost }) => ({
    txn_date: String(r?.txn_date || '').slice(0, 10),
    work_order_no: r?.work_order_no || '',
    asset_code: r?.asset_code || '',
    item_code: r?.item_code || '',
    item_description: r?.item_description || '',
    store_code: r?.store_code || '',
    amount: Number(lineCost) || 0,
    category: CATEGORY_LABEL[category] || category || '',
  }))
}
