/**
 * The four headline tiles of the Inventory Control Center: items identified,
 * unidentified items, pending corrections and audit completion with a per-store
 * line. Figures come from inv_pi_dashboard and inventory_audits only; anything
 * the server could not report prints N/A, never a made-up zero.
 */
import { CheckCircle2, HelpCircle, FileWarning } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadDashboard } from '../../lib/api/physicalInventory'
import { listAudits } from '../../lib/api/inventory'
import { inventoryKpis, auditCompletion } from '../../lib/inventory/materialMasterView'
import { useInvQuery } from './InvUi'

function Ring({ pct, label }) {
  const r = 22
  const c = 2 * Math.PI * r
  const v = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <svg className="inv-ring" viewBox="0 0 56 56" role="img" aria-label={label}>
      <circle cx="28" cy="28" r={r} className="inv-ring-track" />
      {v > 0 && <circle cx="28" cy="28" r={r} className="inv-ring-bar" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 28 28)" />}
      <text x="28" y="32" textAnchor="middle">{pct === null || pct === undefined ? 'N/A' : `${pct}%`}</text>
    </svg>
  )
}

function Tile({ icon: Icon, value, label, sub, loading, onClick }) {
  const body = (
    <>
      <span className="inv-kpi-tile-icon"><Icon size={20} aria-hidden="true" /></span>
      <span className="inv-kpi-tile-text">
        <b>{loading ? '...' : (value === null || value === undefined ? 'N/A' : value.toLocaleString('en-US'))}</b>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </>
  )
  return onClick
    ? <button type="button" className="inv-kpi-tile" onClick={onClick}>{body}</button>
    : <div className="inv-kpi-tile">{body}</div>
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

  return (
    <div className="inv-kpi-row" aria-label={t('inventory.ui.kpi.label')}>
      <Tile icon={CheckCircle2} loading={loading} value={k.identified} label={t('inventory.ui.kpi.identified')}
        sub={k.captures !== null ? t('inventory.ui.kpi.ofCaptured', { n: k.captures }) : null} onClick={() => onNavigate('physical', 'dashboard')} />
      <Tile icon={HelpCircle} loading={loading} value={k.unidentified} label={t('inventory.ui.kpi.unidentified')}
        sub={t('inventory.ui.kpi.awaitingReview')} onClick={() => onNavigate('physical', 'review')} />
      <Tile icon={FileWarning} loading={loading} value={k.pendingCorrections} label={t('inventory.ui.kpi.pendingCorrections')}
        sub={t('inventory.ui.kpi.needDecision')} onClick={() => onNavigate('corrections')} />
      <button type="button" className="inv-kpi-tile" onClick={() => onNavigate('audits')}>
        <Ring pct={done?.pct ?? null} label={t('inventory.ui.kpi.auditCompletion')} />
        <span className="inv-kpi-tile-text">
          <span>{t('inventory.ui.kpi.auditCompletion')}</span>
          <small>{audits.loading && !audits.data ? '...' : sitesLine}</small>
        </span>
      </button>
    </div>
  )
}
