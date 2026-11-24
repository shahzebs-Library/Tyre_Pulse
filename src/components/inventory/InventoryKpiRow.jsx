/**
 * The four headline tiles of the Inventory Control Center: items identified,
 * unidentified items, pending corrections and audit completion with a per-store
 * line. Figures come from inv_pi_dashboard and inventory_audits only; anything
 * the server could not report prints N/A, never a made-up zero.
 *
 * Built from the kit's Kpi tile so it looks like every other kit page.
 */
import { CheckCircle2, HelpCircle, FileWarning, ClipboardCheck } from 'lucide-react'
import { Kpi } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadDashboard } from '../../lib/api/physicalInventory'
import { listAudits } from '../../lib/api/inventory'
import { inventoryKpis, auditCompletion } from '../../lib/inventory/materialMasterView'
import { useInvQuery } from './InvUi'

/** Label with the small context line underneath (the kit tile has one label slot). */
function Label({ text, sub }) {
  return (
    <>
      {text}
      {sub && <small className="inv-kpi-sub">{sub}</small>}
    </>
  )
}

export default function InventoryKpiRow({ scope, onNavigate }) {
  const { t } = useLanguage()
  const dash = useInvQuery(() => loadDashboard(scope), [scope.country, scope.site])
  const audits = useInvQuery(() => listAudits({ ...scope, pageSize: 200, status: 'all' }), [scope.country, scope.site])
  const k = inventoryKpis(dash.data)
  const done = audits.data?.status === 'ok' ? auditCompletion(audits.data.rows) : null
  const loading = dash.loading && !dash.data
  const sitesLine = done?.sites?.length
    ? done.sites.slice(0, 4).map((s) => `${s.site} ${s.pct ?? 'N/A'}%`).join(' · ')
    : t('inventory.ui.kpi.noAudits')
  const auditPct = done?.pct === null || done?.pct === undefined ? 'N/A' : `${done.pct}%`

  return (
    <div className="inv-kpis" role="group" aria-label={t('inventory.ui.kpi.label')}>
      <Kpi icon={CheckCircle2} emoji="check-mark-button" tone="t-green" loading={loading} value={k.identified}
        label={<Label text={t('inventory.ui.kpi.identified')} sub={k.captures !== null ? t('inventory.ui.kpi.ofCaptured', { n: k.captures }) : null} />}
        onClick={() => onNavigate('physical', 'dashboard')} />
      <Kpi icon={HelpCircle} emoji="detective" tone="t-amber" loading={loading} value={k.unidentified}
        label={<Label text={t('inventory.ui.kpi.unidentified')} sub={t('inventory.ui.kpi.awaitingReview')} />}
        onClick={() => onNavigate('physical', 'review')} />
      <Kpi icon={FileWarning} emoji="memo" tone="t-red" loading={loading} value={k.pendingCorrections}
        label={<Label text={t('inventory.ui.kpi.pendingCorrections')} sub={t('inventory.ui.kpi.needDecision')} />}
        onClick={() => onNavigate('corrections')} />
      <Kpi icon={ClipboardCheck} emoji="clipboard" tone="t-blue" loading={audits.loading && !audits.data} display={auditPct}
        label={<Label text={t('inventory.ui.kpi.auditCompletion')} sub={sitesLine} />}
        onClick={() => onNavigate('audits')} />
    </div>
  )
}
