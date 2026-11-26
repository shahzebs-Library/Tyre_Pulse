/**
 * Planning & simulation. (Valuation lives in ValuationPanels.jsx.)
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
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { reorderSignals, summarizeBalances } from '../../lib/inventory/balanceView'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, alignNumeric } from './InvUi'
import StrategyScenarioPanel from './StrategyScenarioPanel'

const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

function useSnapshot(scope) {
  return useInvQuery(() => loadBalanceSnapshot(scope), [scope.country, scope.site])
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
          { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || r.description || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
          { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.location_code || r.site || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
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
      <SectionCard title={t('inventory.planning.sim.title')} sub={t('inventory.planning.sim.sub')}>
        <StrategyScenarioPanel defaultCurrency={COUNTRY_CURRENCY[scope.country] || ''} />
      </SectionCard>
    </div>
  )
}
