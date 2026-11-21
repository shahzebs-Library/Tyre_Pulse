/**
 * KPI catalogue: the 23 inventory KPIs not already on the Overview tiles.
 *
 * Every figure comes from the tested engine (src/lib/inventory/kpi.js) through
 * the adapter in src/lib/inventory/kpiPanel.js. A tile shows its definition,
 * unit, period and, when it cannot be measured, the reason in plain words
 * (an empty source says WHICH source is empty for this scope). Money is per
 * currency and never summed; money KPIs are hidden without stock:view_value.
 */
import { useMemo, useState } from 'react'
import { Download, FileText, Lock } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { loadKpiSources } from '../../lib/api/inventoryKpi'
import { KPI_BY_ID } from '../../lib/inventory/kpi'
import {
  PANEL_GROUPS, PANEL_KPI_IDS, MONEY_KPIS, KPI_PERIOD, computeKpiPanel, kpiDisplay, KPI_REASONS,
} from '../../lib/inventory/kpiPanel'
import { useInvQuery, ErrorNote, Note, SectionCard, fmtDate } from './InvUi'
import ExplainThisNumber from '../trust/ExplainThisNumber'

const WINDOWS = [30, 90, 365]
const isoDay = (d) => d.toISOString().slice(0, 10)

export function scopeLabel(t, scope) {
  if (scope.site && scope.site !== 'all') return scope.site
  return scope.country || t('inventory.scope.allCountries')
}

/** The sentence under a tile that is not showing a figure. */
export function stateText(t, entry, { scopeText }) {
  if (!entry) return null
  if (entry.status === 'error') return t('inventory.kpis.state.loadFailed')
  if (entry.status === 'not_provisioned') return t('inventory.kpis.state.notSetUp')
  if (entry.empty) return t(`inventory.kpis.empty.${entry.empty}`, { scope: scopeText })
  const r = entry.result?.reason
  if (!r) return null
  return t(`inventory.kpis.reason.${KPI_REASONS.includes(r) ? r : 'not_measurable'}`)
}

function periodText(t, id, { from, to, today, audit }) {
  const kind = KPI_PERIOD[id]
  if (kind === 'asAt') return t('inventory.kpis.period.asAt', { date: fmtDate(today) })
  if (kind === 'year') return t('inventory.kpis.period.year', { date: fmtDate(today) })
  if (kind === 'count') return audit ? t('inventory.kpis.period.count', { ref: audit.ref || fmtDate(audit.created_at) }) : t('inventory.kpis.period.noCount')
  return t('inventory.kpis.period.window', { from: fmtDate(from), to: fmtDate(to) })
}

function KpiTile({ id, entry, canValue, scope, period, t }) {
  const hidden = MONEY_KPIS.has(id) && !canValue
  const d = kpiDisplay(id, entry?.result, { canValue })
  // An empty or unavailable source shows its sentence, never the engine's figure
  // over no rows (that would be a fabricated 0).
  const blank = !entry || entry.status !== 'ok' || !!entry.empty
  const showValue = !hidden && !blank && (d.primary !== null || d.perCurrency.length > 0)
  const note = hidden ? null : stateText(t, entry, { scopeText: scopeLabel(t, scope) })
  const label = t(`inventory.kpis.items.${id}.label`)
  return (
    <article className="inv-kpi-tile" aria-label={label} data-kpi={id}>
      <header className="inv-kpi-tile-head">
        <h3>{label}</h3>
        <ExplainThisNumber metricId={id} country={scope.country || null} value={d.primary} label={label} />
      </header>
      <div className="inv-kpi-tile-value">
        {hidden ? (
          <span className="inv-kpi-hidden"><Lock size={14} aria-hidden="true" /> {t('inventory.kpis.hidden')}</span>
        ) : showValue ? (
          <>
            {d.primary !== null && <strong className="inv-num">{d.primary}</strong>}
            {d.perCurrency.length > 0 && (
              <ul className="inv-kpi-cur">
                {d.perCurrency.map((c) => <li key={c.currency} className="inv-num">{c.text}</li>)}
              </ul>
            )}
          </>
        ) : (
          <span className="cc-na">{t('inventory.kpis.noFigure')}</span>
        )}
      </div>
      {note && <p className="inv-kpi-tile-note" role="note">{note}</p>}
      <p className="inv-kpi-tile-meta">
        <span>{t('inventory.kpis.unitLabel')}: {t(`inventory.kpis.unit.${unitKey(KPI_BY_ID[id].unit)}`)}</span>
        <span>{period}</span>
      </p>
      <details className="inv-kpi-tile-def">
        <summary>{t('inventory.kpis.definition')}</summary>
        <p>{t(`inventory.kpis.items.${id}.def`)}</p>
      </details>
    </article>
  )
}

const UNIT_KEYS = {
  '%': 'pct', 'qty and currency': 'qtyCurrency', currency: 'currency', 'lines / qty': 'lines', 'times': 'times', days: 'days',
  'currency / qty': 'currencyQty', 'qty / currency': 'qtyCurrency', 'times / %': 'timesPct', '% / currency (book value)': 'pctBook',
}
function unitKey(u) { return UNIT_KEYS[u] || 'count' }

export default function KpiCatalogueSection({ scope, can }) {
  const { t } = useLanguage()
  const { appSettings } = useSettings()
  const [days, setDays] = useState(365)
  const [busy, setBusy] = useState(null)
  const canValue = !!can('view_value')
  const canExport = !!can('export')
  const now = useMemo(() => new Date(), [])
  const range = useMemo(() => {
    const from = new Date(now)
    from.setUTCDate(from.getUTCDate() - days)
    return { from: isoDay(from), to: isoDay(now) }
  }, [days, now])

  const q = useInvQuery(() => loadKpiSources({ ...scope, ...range, now }), [scope.country, scope.site, range.from, range.to])
  const sources = q.data
  const panel = useMemo(() => (sources ? computeKpiPanel(sources, { now, ...range }) : null), [sources, now, range])
  const failed = sources ? Object.entries(sources).filter(([, s]) => s && typeof s === 'object' && s.status === 'error') : []
  const truncated = sources ? Object.values(sources).some((s) => s && s.truncated) : false
  const audit = sources?.audit || null

  const exportRows = () => PANEL_KPI_IDS.map((id) => {
    const entry = panel?.[id]
    const hidden = MONEY_KPIS.has(id) && !canValue
    const d = kpiDisplay(id, entry?.result, { canValue })
    const blank = !entry || entry.status !== 'ok' || !!entry.empty
    const value = hidden ? t('inventory.kpis.hidden') : blank ? t('inventory.kpis.noFigure') : [d.primary, ...d.perCurrency.map((c) => c.text)].filter(Boolean).join(' | ') || t('inventory.kpis.noFigure')
    return {
      group: t(`inventory.kpis.groups.${PANEL_GROUPS.find((g) => g.ids.includes(id)).key}`),
      kpi: t(`inventory.kpis.items.${id}.label`),
      value,
      period: periodText(t, id, { ...range, today: now, audit }),
      note: hidden ? '' : stateText(t, entry, { scopeText: scopeLabel(t, scope) }) || '',
      definition: t(`inventory.kpis.items.${id}.def`),
    }
  })

  const doExport = async (kind) => {
    setBusy(kind)
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../../lib/exportUtils')
      const rows = exportRows()
      const keys = ['group', 'kpi', 'value', 'period', 'note', 'definition']
      const headers = keys.map((k) => t(`inventory.kpis.col.${k}`))
      const name = reportFileName(t('inventory.kpis.title'), scopeLabel(t, scope))
      if (kind === 'excel') await exportToExcel(rows, keys, headers, name, 'KPIs')
      else await exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), t('inventory.kpis.title'), name, 'landscape', appSettings?.company_name || '')
    } finally {
      setBusy(null)
    }
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  const loading = q.loading && !q.data

  return (
    <div className="inv-hub">
      <div className="inv-toolbar">
        <label className="cc-field">
          <span>{t('inventory.kpis.window')}</span>
          <select className="cc-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOWS.map((w) => <option key={w} value={w}>{t('inventory.kpis.lastDays', { n: w })}</option>)}
          </select>
        </label>
        {canExport && (
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" disabled={!panel || !!busy} onClick={() => doExport('excel')}>
              <Download size={14} aria-hidden="true" /> {t('inventory.kpis.exportExcel')}
            </button>
            <button type="button" className="cc-btn-ghost" disabled={!panel || !!busy} onClick={() => doExport('pdf')}>
              <FileText size={14} aria-hidden="true" /> {t('inventory.kpis.exportPdf')}
            </button>
          </div>
        )}
      </div>
      <p className="cc-card-sub">{t('inventory.kpis.lead')}</p>

      {failed.length > 0 && (
        <ErrorNote load onRetry={q.retry} error={t('inventory.kpis.someFailed', { n: failed.length })} />
      )}
      {truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      {!canValue && <Note tone="warn" icon={Lock}>{t('inventory.kpis.valueHiddenNote')}</Note>}

      {loading ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true" aria-label={t('inventory.kpis.loading')}>
          {[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 120 }} />)}
        </div>
      ) : PANEL_GROUPS.map((g) => (
        <SectionCard key={g.key} title={t(`inventory.kpis.groups.${g.key}`)} sub={t(`inventory.kpis.groupSub.${g.key}`)}>
          <div className="inv-kpi-grid">
            {g.ids.map((id) => (
              <KpiTile key={id} id={id} entry={panel?.[id]} canValue={canValue} scope={scope} t={t}
                period={periodText(t, id, { ...range, today: now, audit })} />
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  )
}
