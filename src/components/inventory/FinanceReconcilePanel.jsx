/**
 * Financial reconciliation per site, month and currency.
 *
 *  - Stock value today: v_inv_valuation (valued amount per currency, plus the
 *    quantity whose cost is unknown).
 *  - ERP issues: parts_consumption (and in-app issues the ERP has not seen), read
 *    through v_inv_erp_reconciliation.
 *  - Store issues: the in-app issue movements in the same view.
 *  - Receipts: receipt movements in the stock ledger.
 *
 * Each currency stands alone (SAR, AED, EGP are never added). Unknown cost is
 * shown as unvalued quantity, never as zero. A value the user may not see stays
 * hidden. This screen only reads.
 */
import { useMemo, useState } from 'react'
import { Coins, Receipt, PackageMinus, PackageX } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, Note, NotSetUp, SectionCard, alignNumeric } from './InvUi'
import { loadFinanceRecon } from '../../lib/api/warehouseAssets'
import { buildFinanceRecon, stockValueBySite, financeTotals, reconFinding, monthsAgoStart } from '../../lib/inventory/warehouseAssets'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'

const WINDOWS = [3, 6, 12]

export default function FinanceReconcilePanel({ scope, can }) {
  const [months, setMonths] = useState(6)
  const fromMonth = useMemo(() => monthsAgoStart(months - 1), [months])
  const q = useInvQuery(() => loadFinanceRecon({ ...scope, fromMonth }), [scope.country, scope.site, fromMonth])
  const showValue = can('view_value')

  const rows = useMemo(() => buildFinanceRecon({ erpRows: q.data?.erpRows, receipts: q.data?.receipts }), [q.data])
  const stock = useMemo(() => stockValueBySite(q.data?.valuation), [q.data])
  const { totals, noCurrency } = financeTotals(rows)
  const stockUnvalued = stock.reduce((a, r) => a + r.unvaluedQty, 0)
  const stockOnHand = stock.reduce((a, r) => a + r.qtyOnHand, 0)
  const loading = q.loading && !q.data
  const money = (v, cur, hidden) => {
    if (!showValue || hidden) return <span className="cc-na">Hidden</span>
    return v === null || v === undefined ? <span className="cc-na">None</span> : formatMoney(v, cur)
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what="ERP reconciliation" />

  const trunc = q.data?.truncated || {}

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="cc-card-sub">Period</span>
        {WINDOWS.map((w) => (
          <button key={w} type="button" className={months === w ? 'cc-btn' : 'cc-btn-ghost'} aria-pressed={months === w} onClick={() => setMonths(w)}>
            Last {w} months
          </button>
        ))}
      </div>

      {(trunc.erp || trunc.receipts || trunc.valuation) && (
        <Note tone="warn" title="Not every row was read">Choose a site or a shorter period so the totals cover everything.</Note>
      )}
      {noCurrency > 0 && <Note tone="warn">{noCurrency} site-month rows have no currency and are left out of the totals.</Note>}

      <div className="inv-kpis">
        {totals.length === 0 && !loading && <Kpi icon={Coins} tone="t-blue" value={null} display="None" label="ERP issue cost in the period" />}
        {totals.map((t) => (
          <Kpi key={`erp-${t.currency}`} icon={PackageMinus} tone="t-orange" loading={loading}
            display={money(t.erpValue, t.currency)} label={`ERP issue cost (${t.currency}), ${t.erpLines.toLocaleString('en-US')} lines`} />
        ))}
        {totals.map((t) => (
          <Kpi key={`rcv-${t.currency}`} icon={Receipt} tone="t-green" loading={loading}
            display={money(t.receiptValue, t.currency)} label={`Receipts into stock (${t.currency})`} />
        ))}
        <Kpi icon={PackageX} tone="t-amber" loading={loading} display={formatQty(stockUnvalued)}
          label={`Stock quantity with unknown cost, of ${formatQty(stockOnHand)} on hand`} />
      </div>

      <SectionCard title="Stock value today, by site" sub="Known value per currency. Quantity with no known cost is shown separately, never as zero cost.">
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={stock} empty="No stock in this scope."
            columns={alignNumeric([
              { key: 'site', header: 'Site', cell: (r) => r.site || 'No site' },
              { key: 'currency', header: 'Currency', cell: (r) => r.currency || <span className="cc-na">Not set</span> },
              { key: 'lines', header: 'Lines', numeric: true },
              { key: 'qtyOnHand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qtyOnHand) },
              { key: 'valuedQty', header: 'Valued qty', numeric: true, cell: (r) => formatQty(r.valuedQty) },
              { key: 'unvaluedQty', header: 'Unvalued qty', numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
              { key: 'valuedAmount', header: 'Known value', numeric: true, cell: (r) => money(r.valuedAmount, r.currency, r.valueHidden) },
            ])} />
        </div>
      </SectionCard>

      <SectionCard title="Issues and receipts by site and month" sub="ERP issue cost against what the store recorded. Each currency stands alone.">
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={rows} empty="No issues or receipts in this period."
            columns={alignNumeric([
              { key: 'month', header: 'Month' },
              { key: 'site', header: 'Site', cell: (r) => r.site || 'No site' },
              { key: 'currency', header: 'Currency', cell: (r) => r.currency || <span className="cc-na">Not set</span> },
              { key: 'erpLines', header: 'ERP lines', numeric: true },
              { key: 'erpQty', header: 'ERP qty', numeric: true, cell: (r) => formatQty(r.erpQty) },
              { key: 'erpValue', header: 'ERP cost', numeric: true, cell: (r) => money(r.erpValue, r.currency) },
              { key: 'invIssueQty', header: 'Store issue qty', numeric: true, cell: (r) => formatQty(r.invIssueQty) },
              { key: 'invIssueValue', header: 'Store issue value', numeric: true, cell: (r) => money(r.invIssueValue, r.currency, r.invIssueValueHidden) },
              { key: 'invIssueUnvaluedQty', header: 'Issued at unknown cost', numeric: true, cell: (r) => formatQty(r.invIssueUnvaluedQty) },
              { key: 'receiptQty', header: 'Received qty', numeric: true, cell: (r) => formatQty(r.receiptQty) },
              { key: 'receiptValue', header: 'Received value', numeric: true, cell: (r) => money(r.receiptValue, r.currency) },
              { key: 'finding', header: 'Finding', sortable: false, cell: (r) => reconFinding(r) || '' },
            ])} />
        </div>
        <p className="cc-card-sub">
          Item-level differences are in Valuation, ERP reconciliation. Most ERP issues have no matching store issue today
          because store issues are still recorded in the ERP, not in the app.
        </p>
      </SectionCard>
    </div>
  )
}
