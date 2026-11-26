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
import { Download, FileText, Lock, Check, X, RotateCcw } from 'lucide-react'
import { Tabs, KitTable } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { loadStockHistory } from '../../lib/api/inventoryKpi'
import { classifyForScreen, ABC_CLASSES, FSN_CLASSES, VED_CLASSES } from '../../lib/inventory/kpiPanel'
import { DEFAULT_THRESHOLDS } from '../../lib/inventory/classification'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, Note, NotSetUp, SectionCard, SearchBox, StatusPill, alignNumeric, useHubTab, Denied } from './InvUi'
import { scopeLabel } from './KpiCatalogueSection'
import { loadVariantReview, acceptProposal, acceptProposalsBulk, loadHiddenProposals, saveHiddenProposals } from '../../lib/api/variantReview'
import { filterProposals, isBulkEligible, RULES } from '../../lib/inventory/variantClassify'

const AXES = ['abc', 'fsn', 'ved']
// The brand / part-type review queue sits beside the three classification axes.
const TABS = [...AXES, 'review']
const CLASSES = { abc: ABC_CLASSES, fsn: FSN_CLASSES, ved: VED_CLASSES }
const TONE = { A: 'bad', B: 'warn', C: 'muted', F: 'good', S: 'warn', N: 'bad', V: 'bad', E: 'warn', D: 'muted' }
const pct = (v, na = 'N/A') => (v === null || v === undefined ? na : `${(v * 100).toFixed(1)}%`)

export default function ClassificationSection({ scope, can, tab: linkedTab, onTab }) {
  const { t } = useLanguage()
  const { appSettings } = useSettings()
  const [axis, setAxis] = useHubTab(linkedTab, onTab, TABS, 'abc')
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
      { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || <span className="cc-na">{t('wmsparts.common.na')}</span> },
      { key: 'item_name', header: t('inventory.classify.col.name'), cell: (r) => r.item_name || <span className="cc-na">{t('wmsparts.common.na')}</span> },
      { key: 'category', header: t('inventory.classify.col.category'), cell: (r) => r.category || <span className="cc-na">{t('wmsparts.common.na')}</span> },
      { key: axis, header: t(`inventory.classify.axis.${axis}`), cell: (r) => <StatusPill value={r[axis]} tone={TONE[r[axis]] || 'muted'} label={t(`inventory.classify.class.${axis}.${r[axis]}`)} /> },
    ]
    const extra = {
      abc: [
        { key: 'consumptionValue', header: t('inventory.classify.col.consumption'), numeric: true, sortValue: (r) => r.consumptionValue ?? -1, cell: (r) => (r.consumptionValue === null ? t('wmsparts.common.na') : formatMoney(r.consumptionValue, r.currency)) },
        { key: 'share', header: t('inventory.classify.col.share'), numeric: true, sortValue: (r) => r.share ?? -1, cell: (r) => pct(r.share, t('wmsparts.common.na')) },
        { key: 'cumulativeShare', header: t('inventory.classify.col.cumulative'), numeric: true, sortValue: (r) => r.cumulativeShare ?? -1, cell: (r) => pct(r.cumulativeShare, t('wmsparts.common.na')) },
      ],
      fsn: [
        { key: 'issues', header: t('inventory.classify.col.issues'), numeric: true, cell: (r) => formatQty(r.issues) },
        { key: 'activeMonths', header: t('inventory.classify.col.activeMonths'), numeric: true, sortValue: (r) => r.activeMonths ?? -1, cell: (r) => (r.activeMonths === null ? t('wmsparts.common.na') : formatQty(r.activeMonths)) },
      ],
      ved: [
        { key: 'criticality', header: t('inventory.classify.col.criticality'), cell: (r) => r.criticality || <span className="cc-na">{t('inventory.classify.notRecorded')}</span> },
      ],
    }[axis] || []
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
        consumption: r.consumptionValue, currency: r.currency || '', share: pct(r.share, t('wmsparts.common.na')),
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

  const tabBar = (
    <Tabs variant="line" label={t('inventory.classify.axesLabel')} value={axis} onChange={changeAxis}
      tabs={TABS.map((a) => ({ key: a, label: t(`inventory.classify.axis.${a}`) }))} />
  )
  if (axis === 'review') {
    return <div className="inv-hub">{tabBar}<VariantReviewPanel can={can} /></div>
  }
  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (notSetUp) return <NotSetUp what={t('inventory.objects.stock_records')} />
  const loading = q.loading && !q.data
  const counts = result.counts[axis] || {}
  const blocked = axis === 'abc' && !canValue

  return (
    <div className="inv-hub">
      {tabBar}
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

const CONF_TONE = { high: 'good', medium: 'warn', none: 'muted' }
const RULE_KEYS = [RULES.original, RULES.oes, RULES.local, RULES.origin_country, RULES.aftermarket_word, RULES.brand_alias, RULES.brand_recorded, RULES.brand_tyre, RULES.conflict]

/**
 * Brand and part-type proposals for Material Master items that lack them.
 * Nothing is applied here: "Send for approval" files the change through the existing
 * correction request / variant proposal, and a second person decides it.
 * "Reject" hides a proposal on this device only (it never existed on the server).
 */
function VariantReviewPanel({ can }) {
  const { t } = useLanguage()
  const q = useInvQuery(() => loadVariantReview(), [])
  const [field, setField] = useState('all')
  const [rule, setRule] = useState('all')
  const [confidence, setConfidence] = useState('all')
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState(() => loadHiddenProposals())
  const [sent, setSent] = useState(() => new Set())
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const canSend = !!(can('count') || can('adjustment_approve'))
  const data = q.data
  const all = useMemo(() => data?.rows || [], [data])
  const rows = useMemo(() => filterProposals(all, { field, rule, confidence, search, hidden }), [all, field, rule, confidence, search, hidden])
  const bulk = useMemo(() => rows.filter((r) => isBulkEligible(r) && !sent.has(`${r.canonicalId}:partType`)), [rows, sent])

  const hide = (id) => {
    const next = new Set(hidden)
    next.add(id)
    setHidden(next)
    saveHiddenProposals(next)
  }
  const unhideAll = () => { const next = new Set(); setHidden(next); saveHiddenProposals(next) }

  const send = async (row, f) => {
    const key = `${row.canonicalId}:${f}`
    setBusy(key)
    setMsg(null)
    try {
      await acceptProposal(row, f)
      setSent((s) => new Set(s).add(key))
      setMsg({ tone: 'good', text: t('inventory.classify.review.sentOne', { sku: row.sku || '' }) })
    } catch (err) {
      setMsg({ tone: 'bad', text: err?.message || t('inventory.classify.review.failed') })
    } finally {
      setBusy(null)
    }
  }

  const sendBulk = async () => {
    if (!bulk.length) return
    setBusy('bulk')
    setMsg(null)
    const res = await acceptProposalsBulk(bulk, 'partType', { onProgress: (n, total) => setMsg({ tone: 'info', text: t('inventory.classify.review.progress', { n, total }) }) })
    setSent((s) => {
      const next = new Set(s)
      const failedIds = new Set(res.failed.map((f) => f.canonicalId))
      for (const r of bulk) if (!failedIds.has(r.canonicalId)) next.add(`${r.canonicalId}:partType`)
      return next
    })
    setMsg({
      tone: res.failed.length ? 'warn' : 'good',
      text: t('inventory.classify.review.bulkDone', { sent: res.sent, failed: res.failed.length })
        + (res.failed.length ? ` ${res.failed.slice(0, 3).map((f) => `${f.sku || ''}: ${f.message}`).join('; ')}` : ''),
    })
    setBusy(null)
  }

  const proposalCell = (r, f) => {
    const p = f === 'brand' ? r.brand : r.partType
    if (!p) return <span className="cc-na">-</span>
    const key = `${r.canonicalId}:${f}`
    const label = p.value
      ? (f === 'brand' ? p.value : t(`inventory.classify.review.type.${p.value}`)) + (p.country ? ` (${p.country})` : '')
      : t('inventory.classify.review.conflict', { found: (p.matches || []).join(', ') })
    return (
      <div className="inv-actions" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <span><StatusPill value={p.confidence} tone={CONF_TONE[p.confidence] || 'muted'} label={label} /></span>
        <span className="cc-card-sub">{t(`inventory.classify.review.rule.${p.rule}`)}: <b>{p.evidence}</b></span>
        {sent.has(key) ? <span className="cc-pill good">{t('inventory.classify.review.sent')}</span>
          : p.blocked ? <span className="cc-card-sub">{t(`inventory.classify.review.blocked.${p.blocked}`)}</span>
            : canSend && (
              <button type="button" className="cc-btn-ghost" disabled={!!busy} onClick={() => send(r, f)}
                aria-label={t('inventory.classify.review.sendAria', { sku: r.sku || '' })}>
                <Check size={14} aria-hidden="true" /> {busy === key ? '...' : t('inventory.classify.review.send')}
              </button>
            )}
      </div>
    )
  }

  const columns = [
    { key: 'sku', header: t('inventory.common.item'), cell: (r) => r.sku || <span className="cc-na">{t('wmsparts.common.na')}</span> },
    { key: 'description', header: t('inventory.classify.review.col.description'), cell: (r) => r.description },
    { key: 'brand', header: t('inventory.classify.review.col.brand'), sortValue: (r) => r.brand?.value || '', cell: (r) => proposalCell(r, 'brand') },
    { key: 'partType', header: t('inventory.classify.review.col.partType'), sortValue: (r) => r.partType?.value || '', cell: (r) => proposalCell(r, 'partType') },
    {
      key: 'reject', header: t('inventory.classify.review.col.action'), sortable: false,
      cell: (r) => (
        <button type="button" className="cc-btn-ghost" onClick={() => hide(r.canonicalId)} aria-label={t('inventory.classify.review.rejectAria', { sku: r.sku || '' })}>
          <X size={14} aria-hidden="true" /> {t('inventory.classify.review.reject')}
        </button>
      ),
    },
  ]

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.classify.review.what')} />
  const loading = q.loading && !data
  const c = data?.counts || { brand: {}, partType: {}, total: 0, highConfidence: 0 }
  const brandTotal = Object.entries(c.brand).filter(([k]) => k !== RULES.conflict).reduce((s, [, n]) => s + n, 0)
  const typeTotal = Object.entries(c.partType).filter(([k]) => k !== RULES.conflict).reduce((s, [, n]) => s + n, 0)

  return (
    <>
      <p className="cc-card-sub">{t('inventory.classify.review.method')}</p>
      {data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      <div className="inv-kpis" role="group" aria-label={t('inventory.classify.review.summaryLabel')}>
        {[
          ['withoutBrand', data?.totals?.withoutBrand],
          ['brandProposals', brandTotal],
          ['typeProposals', typeTotal],
          ['alreadyProposed', data?.alreadyProposed],
        ].map(([k, v]) => (
          <div key={k} className="cc-card cc-kpi">
            <div className="cc-kpi-body">
              <div className="cc-kpi-val inv-num">{loading ? '...' : formatQty(v ?? 0)}</div>
              <div className="cc-kpi-label">{t(`inventory.classify.review.kpi.${k}`)}</div>
            </div>
          </div>
        ))}
      </div>
      {!canSend && <Note tone="warn" icon={Lock}>{t('inventory.classify.review.readOnly')}</Note>}
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}

      <SectionCard title={t('inventory.classify.review.title')} sub={t('inventory.classify.review.sub', { n: rows.length, total: all.length })}>
        <div className="inv-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder={t('inventory.classify.review.search')} label={t('inventory.classify.review.search')} />
          <label className="cc-field">
            <span>{t('inventory.classify.review.fieldFilter')}</span>
            <select className="cc-select" value={field} onChange={(e) => setField(e.target.value)}>
              {['all', 'brand', 'partType'].map((k) => <option key={k} value={k}>{t(`inventory.classify.review.field.${k}`)}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>{t('inventory.classify.review.ruleFilter')}</span>
            <select className="cc-select" value={rule} onChange={(e) => setRule(e.target.value)}>
              <option value="all">{t('inventory.classify.review.allRules')}</option>
              {RULE_KEYS.map((k) => <option key={k} value={k}>{t(`inventory.classify.review.rule.${k}`)}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>{t('inventory.classify.review.confFilter')}</span>
            <select className="cc-select" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              {['all', 'high', 'medium'].map((k) => <option key={k} value={k}>{t(`inventory.classify.review.conf.${k}`)}</option>)}
            </select>
          </label>
          <div className="inv-actions">
            {canSend && (
              <button type="button" className="cc-btn-primary" disabled={!bulk.length || !!busy} onClick={sendBulk}>
                <Check size={14} aria-hidden="true" /> {t('inventory.classify.review.bulk', { n: bulk.length })}
              </button>
            )}
            {hidden.size > 0 && (
              <button type="button" className="cc-btn-ghost" onClick={unhideAll}>
                <RotateCcw size={14} aria-hidden="true" /> {t('inventory.classify.review.unhide', { n: hidden.size })}
              </button>
            )}
          </div>
        </div>
        {!loading && all.length === 0 ? (
          <Note>{t('inventory.classify.review.empty')}</Note>
        ) : (
          <div className="inv-scroll">
            <KitTable columns={columns} rows={rows} loading={loading} empty={t('inventory.classify.review.noMatch')} />
          </div>
        )}
        <p className="cc-card-sub">{t('inventory.classify.review.footnote')}</p>
      </SectionCard>
    </>
  )
}
