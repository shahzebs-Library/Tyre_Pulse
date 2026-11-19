/**
 * Valuation and Planning & simulation.
 *
 * Valuation shows the OWNED stock value per currency, as computed server-side
 * (weighted average cost per item; serialised tyres at their own price).
 * Consignment and supplier-owned stock is excluded. A line with no cost is
 * "unvalued" and counted, never priced at 0. Inventory value is never added
 * to the ERP expense grid (parts_consumption) and creates no posting.
 *
 * Planning flags lines at or below their reorder point and links to Stock
 * Replenishment, which owns the reorder engine. Simulation never presents a
 * hypothetical scenario as an actual saving, and with no validated
 * compatibility data it says so instead of guessing.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Coins, PackageX, Layers, ExternalLink, TrendingUp } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadBalanceSnapshot, compatibilityCounts } from '../../lib/api/inventory'
import { sumByCurrency, balanceValue, isOwned, formatMoney, formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import { reorderSignals, summarizeBalances } from '../../lib/inventory/balanceView'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, Denied, alignNumeric } from './InvUi'

function useSnapshot(scope) {
  return useInvQuery(() => loadBalanceSnapshot(scope), [scope.country, scope.site])
}

export function ValuationSection({ scope, can }) {
  const { t } = useLanguage()
  const q = useSnapshot(scope)
  const rows = useMemo(() => q.data?.rows || [], [q.data])
  const owned = useMemo(() => rows.filter(isOwned), [rows])
  const total = useMemo(() => sumByCurrency(owned, balanceValue, (r) => r.currency), [owned])
  const bySite = useMemo(() => {
    const m = new Map()
    for (const r of owned) {
      const k = `${r.site || 'N/A'}|${(r.currency || '').toUpperCase()}`
      const cur = m.get(k) || { key: k, site: r.site || 'N/A', currency: (r.currency || '').toUpperCase() || null, lines: 0, valued: 0, amount: 0, unvalued: 0 }
      cur.lines += 1
      const v = balanceValue(r)
      if (v === null) cur.unvalued += 1
      else { cur.valued += 1; cur.amount += v }
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  }, [owned])

  if (!can('view_value')) return <Denied capLabel={t('inventory.caps.view_value')} />
  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.objects.stock_records')} />
  const loading = q.loading && !q.data

  return (
    <div className="inv-hub">
      <div className="inv-kpis">
        <Kpi icon={Coins} tone="t-green" loading={loading} display={formatTotals(total.totals)} label={t('inventory.valuation.owned')} />
        <Kpi icon={PackageX} tone="t-amber" loading={loading} value={total.unvalued} label={t('inventory.valuation.unvalued')} />
        <Kpi icon={Layers} tone="t-blue" loading={loading} value={rows.length - owned.length} label={t('inventory.valuation.excluded')} />
      </div>
      {total.mixed && <Note>{t('inventory.valuation.mixed')}</Note>}
      {total.unvalued > 0 && <Note tone="warn">{t('inventory.valuation.unvaluedNote', { n: total.unvalued })}</Note>}
      {q.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      <Note>{t('inventory.valuation.method')}</Note>
      <SectionCard title={t('inventory.valuation.bySite')} sub={t('inventory.valuation.bySiteSub')}>
        <KitTable compact rows={bySite} loading={loading} empty={t('inventory.valuation.empty')} columns={alignNumeric([
          { key: 'site', header: t('inventory.scope.site') },
          { key: 'currency', header: t('inventory.common.currency'), cell: (r) => r.currency || <span className="cc-na">{t('inventory.valuation.noCurrency')}</span> },
          { key: 'lines', header: t('inventory.valuation.lines'), numeric: true },
          { key: 'unvalued', header: t('inventory.valuation.unvalued'), numeric: true },
          { key: 'amount', header: t('inventory.valuation.value'), numeric: true, cell: (r) => (r.valued ? formatMoney(r.amount, r.currency) : 'N/A') },
        ])} />
      </SectionCard>
    </div>
  )
}

export function PlanningSection({ scope }) {
  const { t } = useLanguage()
  const q = useSnapshot(scope)
  const compat = useInvQuery(() => compatibilityCounts(), [])
  const rows = useMemo(() => q.data?.rows || [], [q.data])
  const signals = useMemo(() => reorderSignals(rows), [rows])
  const sum = useMemo(() => summarizeBalances(rows), [rows])
  const validated = (compat.data?.oemReferences || 0) + (compat.data?.fitments || 0)

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.objects.stock_records')} />
  const loading = q.loading && !q.data

  return (
    <div className="inv-hub">
      <div className="inv-kpis">
        <Kpi icon={PackageX} tone="t-red" loading={loading} value={sum.belowReorder} label={t('inventory.overview.belowReorder')} />
        <Kpi icon={Layers} tone="t-amber" loading={loading} value={sum.noReorderPoint} label={t('inventory.planning.noReorderPoint')} />
        <Kpi icon={Coins} tone="t-blue" loading={loading} value={sum.zero} label={t('inventory.planning.zeroStock')} />
      </div>
      <div className="inv-links">
        <Link to="/stock-replenishment" className="inv-linkcard">
          <TrendingUp size={18} aria-hidden="true" style={{ color: 'var(--cc-green)' }} />
          <span style={{ flex: 1 }}>{t('inventory.links.replenishment')}<small>{t('inventory.planning.replenishmentSub')}</small></span>
          <ExternalLink size={14} aria-hidden="true" />
        </Link>
      </div>
      <SectionCard title={t('inventory.planning.signalsTitle')} sub={t('inventory.planning.signalsSub')}>
        <KitTable compact scroll rows={signals} loading={loading} empty={t('inventory.planning.noSignals')} columns={alignNumeric([
          { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || r.description || <span className="cc-na">N/A</span> },
          { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.location_code || r.site || <span className="cc-na">N/A</span> },
          { key: 'available', header: t('inventory.planning.available'), numeric: true, cell: (r) => formatQty(r.available) },
          { key: 'reorder_point', header: t('inventory.planning.reorderPoint'), numeric: true, cell: (r) => formatQty(r.reorder_point) },
          { key: 'gap', header: t('inventory.planning.gap'), numeric: true, cell: (r) => formatQty(r.gap) },
        ])} />
      </SectionCard>
      <SectionCard title={t('inventory.planning.simTitle')} sub={t('inventory.planning.simSub')}>
        {compat.error ? <ErrorNote error={compat.error} onRetry={compat.retry} /> : validated === 0
          ? <Note tone="warn" title={t('inventory.ident.noCompat')}>{t('inventory.planning.simNoData')}</Note>
          : <Note>{t('inventory.planning.simReady', { n: validated })}</Note>}
        <p className="cc-card-sub">{t('inventory.planning.simHonesty')}</p>
      </SectionCard>
    </div>
  )
}
