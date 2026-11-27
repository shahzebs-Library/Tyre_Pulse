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
import { useLanguage } from '../../contexts/LanguageContext'
import { warmFloorText } from '../../lib/inventory/floorText'

const WINDOWS = [3, 6, 12]

export default function FinanceReconcilePanel({ scope, can }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`wmsfloor.finance.${k}`, v)
  warmFloorText(t)
  const finding = (r) => reconFinding(r, t) || ''
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
    if (!showValue || hidden) return <span className="cc-na">{p('hidden')}</span>
    return v === null || v === undefined ? <span className="cc-na">{p('none')}</span> : formatMoney(v, cur)
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={p('what')} />

  const trunc = q.data?.truncated || {}

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="cc-card-sub">{p('period')}</span>
        {WINDOWS.map((w) => (
          <button key={w} type="button" className={months === w ? 'cc-btn' : 'cc-btn-ghost'} aria-pressed={months === w} onClick={() => setMonths(w)}>
            {p('lastMonths', { n: w })}
          </button>
        ))}
      </div>

      {(trunc.erp || trunc.receipts || trunc.valuation) && (
        <Note tone="warn" title={p('truncTitle')}>{p('truncBody')}</Note>
      )}
      {noCurrency > 0 && <Note tone="warn">{p('noCurrency', { count: noCurrency })}</Note>}

      <div className="inv-kpis">
        {totals.length === 0 && !loading && <Kpi icon={Coins} tone="t-blue" value={null} display={p('none')} label={p('kpiErpPeriod')} />}
        {totals.map((x) => (
          <Kpi key={`erp-${x.currency}`} icon={PackageMinus} tone="t-orange" loading={loading}
            display={money(x.erpValue, x.currency)} label={p('kpiErp', { currency: x.currency, lines: x.erpLines.toLocaleString('en-US') })} />
        ))}
        {totals.map((x) => (
          <Kpi key={`rcv-${x.currency}`} icon={Receipt} tone="t-green" loading={loading}
            display={money(x.receiptValue, x.currency)} label={p('kpiReceipts', { currency: x.currency })} />
        ))}
        <Kpi icon={PackageX} tone="t-amber" loading={loading} display={formatQty(stockUnvalued)}
          label={p('kpiUnvalued', { onHand: formatQty(stockOnHand) })} />
      </div>

      <SectionCard title={p('stockTitle')} sub={p('stockSub')}>
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={stock} empty={p('stockEmpty')}
            columns={alignNumeric([
              { key: 'site', header: p('colSite'), cell: (r) => r.site || p('noSite') },
              { key: 'currency', header: p('colCurrency'), cell: (r) => r.currency || <span className="cc-na">{p('notSet')}</span> },
              { key: 'lines', header: p('colLines'), numeric: true },
              { key: 'qtyOnHand', header: p('colOnHand'), numeric: true, cell: (r) => formatQty(r.qtyOnHand) },
              { key: 'valuedQty', header: p('colValuedQty'), numeric: true, cell: (r) => formatQty(r.valuedQty) },
              { key: 'unvaluedQty', header: p('colUnvaluedQty'), numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
              { key: 'valuedAmount', header: p('colKnownValue'), numeric: true, cell: (r) => money(r.valuedAmount, r.currency, r.valueHidden) },
            ])} />
        </div>
      </SectionCard>

      <SectionCard title={p('flowTitle')} sub={p('flowSub')}>
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={rows} empty={p('flowEmpty')}
            columns={alignNumeric([
              { key: 'month', header: p('colMonth') },
              { key: 'site', header: p('colSite'), cell: (r) => r.site || p('noSite') },
              { key: 'currency', header: p('colCurrency'), cell: (r) => r.currency || <span className="cc-na">{p('notSet')}</span> },
              { key: 'erpLines', header: p('colErpLines'), numeric: true },
              { key: 'erpQty', header: p('colErpQty'), numeric: true, cell: (r) => formatQty(r.erpQty) },
              { key: 'erpValue', header: p('colErpCost'), numeric: true, cell: (r) => money(r.erpValue, r.currency) },
              { key: 'invIssueQty', header: p('colStoreQty'), numeric: true, cell: (r) => formatQty(r.invIssueQty) },
              { key: 'invIssueValue', header: p('colStoreValue'), numeric: true, cell: (r) => money(r.invIssueValue, r.currency, r.invIssueValueHidden) },
              { key: 'invIssueUnvaluedQty', header: p('colUnknownCost'), numeric: true, cell: (r) => formatQty(r.invIssueUnvaluedQty) },
              { key: 'receiptQty', header: p('colReceivedQty'), numeric: true, cell: (r) => formatQty(r.receiptQty) },
              { key: 'receiptValue', header: p('colReceivedValue'), numeric: true, cell: (r) => money(r.receiptValue, r.currency) },
              { key: 'finding', header: p('colFinding'), sortable: false, cell: (r) => finding(r) },
            ])} />
        </div>
        <p className="cc-card-sub">
          {p('footer')}
        </p>
      </SectionCard>
    </div>
  )
}
