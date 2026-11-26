import {
  Boxes, AlertTriangle, ClipboardCheck, Scale, CircleDot, FileCheck2, PackageX, Coins, CheckCircle2, CircleSlash, HelpCircle,
} from 'lucide-react'
import { Kpi } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { overviewCounts, loadBalanceSnapshot, probeInventorySetup, CORE_OBJECTS } from '../../lib/api/inventory'
import { summarizeBalances } from '../../lib/inventory/balanceView'
import { sumByCurrency, balanceValue, isOwned, formatTotals } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, Note, SectionCard, ExplainedKpi } from './InvUi'

export default function OverviewSection({ scope, can, onNavigate }) {
  const { t } = useLanguage()
  const counts = useInvQuery(() => overviewCounts(scope), [scope.country, scope.site])
  const snap = useInvQuery(() => loadBalanceSnapshot(scope), [scope.country, scope.site])
  const setup = useInvQuery(() => probeInventorySetup(), [])

  const rows = snap.data?.rows || []
  const bal = summarizeBalances(rows)
  const value = sumByCurrency(rows.filter(isOwned), balanceValue, (r) => r.currency)
  const c = counts.data || {}
  const loading = counts.loading && !counts.data
  const snapLoading = snap.loading && !snap.data
  const installed = setup.data ? CORE_OBJECTS.filter((o) => setup.data[o] === true).length : null

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {counts.error && <ErrorNote error={counts.error} onRetry={counts.retry} />}
      {snap.error && <ErrorNote error={snap.error} onRetry={snap.retry} />}
      {snap.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}

      <div className="inv-kpis">
        <Kpi icon={Boxes} tone="t-green" loading={snapLoading} value={snap.data?.status === 'ok' ? bal.lines : null}
          label={t('inventory.overview.balanceLines')} onClick={() => onNavigate('register')} />
        <Kpi icon={PackageX} tone="t-amber" loading={snapLoading} value={snap.data?.status === 'ok' ? bal.belowReorder : null}
          label={t('inventory.overview.belowReorder')} onClick={() => onNavigate('planning')} />
        <Kpi icon={ClipboardCheck} tone="t-blue" loading={loading} value={c.openAudits}
          label={t('inventory.overview.openAudits')} onClick={() => onNavigate('audits')} />
        <ExplainedKpi metricId="inv_discrepancies" country={scope.country} icon={AlertTriangle} tone="t-red" loading={loading} value={c.openDiscrepancies}
          label={t('inventory.overview.openDiscrepancies')} onClick={() => onNavigate('discrepancies')} />
        <Kpi icon={Scale} tone="t-purple" loading={loading} value={c.pendingAdjustments}
          label={t('inventory.overview.pendingAdjustments')} onClick={() => onNavigate('discrepancies')} />
        <Kpi icon={CircleDot} tone="t-orange" loading={loading} value={c.openConflicts}
          label={t('inventory.overview.custodyConflicts')} onClick={() => onNavigate('tyres')} />
        <Kpi icon={FileCheck2} tone="t-blue" loading={loading} value={c.pendingBatches}
          label={t('inventory.overview.pendingBatches')} onClick={() => onNavigate('controls')} />
        {can('view_value') && (
          <ExplainedKpi metricId="inv_stock_value" country={scope.country} icon={Coins} tone="t-green" loading={snapLoading}
            display={snap.data?.status === 'ok' ? formatTotals(value.totals) : t('wmsfloor.common.na')}
            label={t('inventory.overview.ownedValue')} onClick={() => onNavigate('valuation')} />
        )}
      </div>
      <p className="cc-card-sub">{t('inventory.overview.naHint')}</p>

      <div className="inv-cols-2">
        <SectionCard title={t('inventory.overview.setupTitle')}
          sub={installed === null ? t('inventory.overview.setupChecking') : t('inventory.overview.setupSub', { n: installed, total: CORE_OBJECTS.length })}>
          {setup.error ? <ErrorNote error={setup.error} onRetry={setup.retry} /> : (
            <ul className="inv-tree">
              {CORE_OBJECTS.map((o) => {
                const v = setup.data?.[o]
                const Icon = v === true ? CheckCircle2 : v === false ? CircleSlash : HelpCircle
                const tone = v === true ? 'var(--cc-green)' : v === false ? 'var(--cc-amber)' : 'var(--cc-ink-3)'
                return (
                  <li key={o} className="inv-tree-row">
                    <Icon size={16} style={{ color: tone }} aria-hidden="true" />
                    <span className="inv-tree-name">{t(`inventory.objects.${o}`)}</span>
                    <span className="cc-card-sub">{v === true ? t('inventory.overview.installed') : v === false ? t('inventory.overview.notInstalled') : t('inventory.overview.unknown')}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={t('inventory.overview.rulesTitle')} sub={t('inventory.overview.rulesSub')}>
          <ul className="inv-tree">
            {['noNegative', 'blind', 'segregation', 'ledger', 'erp', 'tyres', 'currency'].map((k) => (
              <li key={k} className="inv-tree-row"><span className="inv-tree-name">{t(`inventory.rules.${k}`)}</span></li>
            ))}
          </ul>
          {snap.data?.status === 'ok' && value.unvalued > 0 && can('view_value') && (
            <Note tone="warn">{t('inventory.valuation.unvaluedNote', { n: value.unvalued })}</Note>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
