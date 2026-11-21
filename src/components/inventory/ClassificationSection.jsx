/**
 * ABC (consumption value), FSN (movement frequency) and VED (criticality)
 * classification of the stocked items in scope.
 *
 * The classes come from the tested engine (src/lib/inventory/classification.js)
 * through src/lib/inventory/kpiPanel.js. An item that cannot be measured is
 * 'unclassified' / 'unassessed' with its reason, never silently C, N or D.
 * ABC ranks money, so it is shown only with stock:view_value, and only inside
 * one currency (the engine never ranks across currencies).
 */
import { useMemo, useState } from 'react'
import { Download, FileText, Lock } from 'lucide-react'
import { Tabs, KitTable } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { loadStockHistory } from '../../lib/api/inventoryKpi'
import { classifyForScreen, ABC_CLASSES, FSN_CLASSES, VED_CLASSES } from '../../lib/inventory/kpiPanel'
import { DEFAULT_THRESHOLDS } from '../../lib/inventory/classification'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, Note, NotSetUp, SectionCard, SearchBox, StatusPill, alignNumeric, useHubTab, Denied } from './InvUi'
import { scopeLabel } from './KpiCatalogueSection'

const AXES = ['abc', 'fsn', 'ved']
const CLASSES = { abc: ABC_CLASSES, fsn: FSN_CLASSES, ved: VED_CLASSES }
const TONE = { A: 'bad', B: 'warn', C: 'muted', F: 'good', S: 'warn', N: 'bad', V: 'bad', E: 'warn', D: 'muted' }
const pct = (v) => (v === null || v === undefined ? 'N/A' : `${(v * 100).toFixed(1)}%`)

export default function ClassificationSection({ scope, can, tab: linkedTab, onTab }) {
  const { t } = useLanguage()
  const { appSettings } = useSettings()
  const [axis, setAxis] = useHubTab(linkedTab, onTab, AXES, 'abc')
  const [cls, setCls] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)
  const canValue = !!can('view_value')
  const canExport = !!can('export')
  const now = useMemo(() => new Date(), [])

  const q = useInvQuery(() => {
    const from = new Date(now)
    from.setUTCMonth(from.getUTCMonth() - 13)
    return loadStockHistory({ ...scope, historyFrom: from })
  }, [scope.country, scope.site])
  const data = q.data
  const result = useMemo(() => (data ? classifyForScreen(data, { now }) : { rows: [], counts: { abc: {}, fsn: {}, ved: {}, disposition: {} } }), [data, now])
  const sources = data ? [data.valuation, data.movements, data.items] : []
  const failed = sources.find((s) => s?.status === 'error')
  const notSetUp = sources.length > 0 && sources.every((s) => s?.status === 'not_provisioned')
  const truncated = sources.some((s) => s?.truncated)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return result.rows.filter((r) => (cls === 'all' || r[axis] === cls)
      && (!term || `${r.item_code || ''} ${r.item_name || ''} ${r.category || ''}`.toLowerCase().includes(term)))
  }, [result.rows, axis, cls, search])

  const changeAxis = (a) => { setAxis(a); setCls('all') }
  const reasonText = (r) => {
    const reason = r[`${axis}Reason`]
    return reason ? t(`inventory.classify.reason.${reason}`) : ''
  }

  const columns = useMemo(() => {
    const base = [
      { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || <span className="cc-na">N/A</span> },
      { key: 'item_name', header: t('inventory.classify.col.name'), cell: (r) => r.item_name || <span className="cc-na">N/A</span> },
      { key: 'category', header: t('inventory.classify.col.category'), cell: (r) => r.category || <span className="cc-na">N/A</span> },
      { key: axis, header: t(`inventory.classify.axis.${axis}`), cell: (r) => <StatusPill value={r[axis]} tone={TONE[r[axis]] || 'muted'} label={t(`inventory.classify.class.${axis}.${r[axis]}`)} /> },
    ]
    const extra = {
      abc: [
        { key: 'consumptionValue', header: t('inventory.classify.col.consumption'), numeric: true, sortValue: (r) => r.consumptionValue ?? -1, cell: (r) => (r.consumptionValue === null ? 'N/A' : formatMoney(r.consumptionValue, r.currency)) },
        { key: 'share', header: t('inventory.classify.col.share'), numeric: true, sortValue: (r) => r.share ?? -1, cell: (r) => pct(r.share) },
        { key: 'cumulativeShare', header: t('inventory.classify.col.cumulative'), numeric: true, sortValue: (r) => r.cumulativeShare ?? -1, cell: (r) => pct(r.cumulativeShare) },
      ],
      fsn: [
        { key: 'issues', header: t('inventory.classify.col.issues'), numeric: true, cell: (r) => formatQty(r.issues) },
        { key: 'activeMonths', header: t('inventory.classify.col.activeMonths'), numeric: true, sortValue: (r) => r.activeMonths ?? -1, cell: (r) => (r.activeMonths === null ? 'N/A' : formatQty(r.activeMonths)) },
      ],
      ved: [
        { key: 'criticality', header: t('inventory.classify.col.criticality'), cell: (r) => r.criticality || <span className="cc-na">{t('inventory.classify.notRecorded')}</span> },
      ],
    }[axis]
    return alignNumeric([
      ...base,
      ...extra,
      { key: 'onHand', header: t('inventory.classify.col.onHand'), numeric: true, cell: (r) => formatQty(r.onHand) },
      { key: 'disposition', header: t('inventory.classify.col.disposition'), cell: (r) => t(`inventory.classify.disposition.${r.disposition}`) },
      { key: 'reason', header: t('inventory.classify.col.reason'), sortValue: (r) => r[`${axis}Reason`] || '', cell: (r) => reasonText(r) || <span className="cc-na">-</span> },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, t])

  const doExport = async (kind) => {
    setBusy(kind)
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../../lib/exportUtils')
      const keys = ['item_code', 'item_name', 'category', 'class', ...(axis === 'abc' ? ['consumption', 'currency', 'share'] : axis === 'fsn' ? ['activeMonths'] : ['criticality']), 'onHand', 'disposition', 'reason']
      const headers = keys.map((k) => t(`inventory.classify.export.${k}`))
      const rows = filtered.map((r) => ({
        item_code: r.item_code || '', item_name: r.item_name || '', category: r.category || '',
        class: t(`inventory.classify.class.${axis}.${r[axis]}`),
        consumption: r.consumptionValue, currency: r.currency || '', share: pct(r.share),
        activeMonths: r.activeMonths, criticality: r.criticality || '', onHand: r.onHand,
        disposition: t(`inventory.classify.disposition.${r.disposition}`), reason: reasonText(r),
      }))
      const title = `${t('inventory.classify.title')} - ${t(`inventory.classify.axis.${axis}`)}`
      const name = reportFileName(t('inventory.classify.title'), axis.toUpperCase(), scopeLabel(t, scope))
      if (kind === 'excel') await exportToExcel(rows, keys, headers, name, axis.toUpperCase())
      else await exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), title, name, 'landscape', appSettings?.company_name || '')
    } finally {
      setBusy(null)
    }
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (notSetUp) return <NotSetUp what={t('inventory.objects.stock_records')} />
  const loading = q.loading && !q.data
  const counts = result.counts[axis] || {}
  const blocked = axis === 'abc' && !canValue

  return (
    <div className="inv-hub">
      <Tabs variant="line" label={t('inventory.classify.axesLabel')} value={axis} onChange={changeAxis}
        tabs={AXES.map((a) => ({ key: a, label: t(`inventory.classify.axis.${a}`) }))} />
      <p className="cc-card-sub">{t(`inventory.classify.method.${axis}`, {
        a: Math.round(DEFAULT_THRESHOLDS.abc.a * 100), b: Math.round(DEFAULT_THRESHOLDS.abc.b * 100),
        fast: DEFAULT_THRESHOLDS.fsn.fastMonths, window: DEFAULT_THRESHOLDS.fsn.windowMonths,
      })}</p>
      {failed && <ErrorNote error={failed.error || t('inventory.kpis.state.loadFailed')} onRetry={q.retry} />}
      {truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}

      {blocked ? <Denied capLabel={t('inventory.caps.view_value')} /> : (
        <>
          <div className="inv-kpis" role="group" aria-label={t('inventory.classify.summaryLabel')}>
            {CLASSES[axis].map((c) => (
              <button key={c} type="button" className={`cc-card cc-kpi inv-class-tile ${cls === c ? 'active' : ''}`} aria-pressed={cls === c}
                onClick={() => setCls(cls === c ? 'all' : c)}>
                <div className="cc-kpi-body">
                  <div className="cc-kpi-val inv-num">{loading ? '...' : formatQty(counts[c] || 0)}</div>
                  <div className="cc-kpi-label">{t(`inventory.classify.class.${axis}.${c}`)}</div>
                </div>
              </button>
            ))}
          </div>

          <SectionCard title={t('inventory.classify.tableTitle', { axis: t(`inventory.classify.axis.${axis}`) })}
            sub={t('inventory.classify.tableSub', { n: filtered.length, total: result.rows.length })}>
            <div className="inv-toolbar">
              <SearchBox value={search} onChange={setSearch} placeholder={t('inventory.classify.search')} label={t('inventory.classify.search')} />
              <label className="cc-field">
                <span>{t('inventory.classify.classFilter')}</span>
                <select className="cc-select" value={cls} onChange={(e) => setCls(e.target.value)}>
                  <option value="all">{t('inventory.classify.allClasses')}</option>
                  {CLASSES[axis].map((c) => <option key={c} value={c}>{t(`inventory.classify.class.${axis}.${c}`)}</option>)}
                </select>
              </label>
              {canExport && (
                <div className="inv-actions">
                  <button type="button" className="cc-btn-ghost" disabled={!filtered.length || !!busy} onClick={() => doExport('excel')}>
                    <Download size={14} aria-hidden="true" /> {t('inventory.kpis.exportExcel')}
                  </button>
                  <button type="button" className="cc-btn-ghost" disabled={!filtered.length || !!busy} onClick={() => doExport('pdf')}>
                    <FileText size={14} aria-hidden="true" /> {t('inventory.kpis.exportPdf')}
                  </button>
                </div>
              )}
            </div>
            {!loading && result.rows.length === 0 ? (
              <Note>{t('inventory.classify.empty', { scope: scopeLabel(t, scope) })}</Note>
            ) : (
              <div className="inv-scroll">
                <KitTable columns={columns} rows={filtered} loading={loading} empty={t('inventory.classify.noMatch')} />
              </div>
            )}
          </SectionCard>
        </>
      )}
      {axis !== 'abc' && !canValue && <Note tone="warn" icon={Lock}>{t('inventory.classify.valueHidden')}</Note>}
    </div>
  )
}
