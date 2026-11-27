/**
 * TyreLifecycle (route /tyre-lifecycle) - Tyre Lifecycle Tracker on the
 * Command Center kit.
 *
 * Register of every tyre record in scope (paged read, bounded, country scoped
 * on the server), joined to the running-life view for active tyres so the
 * table can show current km and life used with the SAME bands as Running and
 * Remaining (measureFor). A tyre whose life cannot be measured reads N/A.
 *
 * Capabilities kept from the earlier page: search, brand, site, category,
 * stage and date filters; the lifecycle stage funnel, brand life, spend by
 * category and km-band charts (Analytics tab); per-serial history; PDF, Excel
 * and email export of the whole filtered set; consumption, Running and
 * Remaining, and tyre change tracking sections.
 *
 * Money is never added across currencies: priced spend and average prices need
 * one country in scope.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CircleDot, Activity, Truck, AlertTriangle, Archive, Search, FileText, FileSpreadsheet,
  RefreshCw, Eye, Pencil, ExternalLink, SlidersHorizontal, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { getTyreRunningLife } from '../lib/api/tyreRunningLife'
import { shapeRunningLife } from '../lib/tyreRunningLife'
import { CATEGORIES, lifecycleKpis } from '../lib/tyreLifecycleAnalytics'
import {
  indexRunningLife, buildRows, viewKpis, tabRows, filterViewRows, filterOptions, TABS,
  STATUSES, STATUS_META, lifeProgression, removalReasons, topBrandsByLife,
  viewExportRows, VIEW_EXPORT_COLS, VIEW_EXPORT_HEADERS,
} from '../lib/tyreLifecycleView'
import { Card, Kpi, KitTable, PageHero, Tabs, VehicleThumb, Donut, fmtInt, useCard } from '../components/commandCenter/kit'
import EmailPdfButton from '../components/EmailPdfButton'
import TyreRunningLife from '../components/tyre/TyreRunningLife'
import TyreConsumptionSection from '../components/tyre/TyreConsumptionSection'
import TyreChangeTracking from '../components/tyre/TyreChangeTracking'
import LifecycleAnalytics from '../components/tyreLifecycle/LifecycleAnalytics'
import TyreHistoryPanel from '../components/tyreLifecycle/TyreHistoryPanel'
import { LifeProgressionChart, TopBrandsBars } from '../components/tyreLifecycle/LifecycleCharts'
import { statusLabels, categoryLabels } from '../lib/tyreLifecycleLabels'
import './TyreLifecycle.css'

const ROW_CAP = 50000
const REASON_COLORS = ['var(--cc-green)', 'var(--cc-blue)', 'var(--cc-amber)', 'var(--cc-red)', 'var(--cc-purple)', 'var(--cc-ink-3)']
const BAND_COLOR = { overdue: 'var(--cc-red)', 'due-soon': 'var(--cc-amber)', 'mid-life': 'var(--cc-blue)', healthy: 'var(--cc-green)' }
const EMPTY_FILTERS = { search: '', vehicleType: 'All', brand: 'All', position: 'All', status: 'All', site: 'All', category: 'All', from: '', to: '' }

// Export header label keys, in VIEW_EXPORT_COLS order.
function exportHeaders(t) {
  const map = {
    serial_number: t('tyrelifecycle.export.headers.serial'),
    brand: t('tyrelifecycle.export.headers.brand'),
    size: t('tyrelifecycle.export.headers.size'),
    position: t('tyrelifecycle.export.headers.position'),
    asset_no: t('tyrelifecycle.export.headers.asset'),
    site: t('tyrelifecycle.export.headers.site'),
    issue_date: t('tyrelifecycle.export.headers.fitmentDate'),
    removal_date: t('tyrelifecycle.export.headers.removalDate'),
    km_run: t('tyrelifecycle.export.headers.kmRun'),
    category: t('tyrelifecycle.export.headers.category'),
    cost: t('tyrelifecycle.export.headers.cost'),
    cpk: t('tyrelifecycle.export.headers.cpk'),
    stage: t('tyrelifecycle.export.headers.stage'),
    status: t('tyrelifecycle.export.headers.status'),
    life_used: t('tyrelifecycle.export.headers.lifeUsed'),
  }
  return VIEW_EXPORT_COLS.map((k, i) => map[k] || VIEW_EXPORT_HEADERS[i])
}

function LifeBar({ row }) {
  const { t } = useLanguage()
  if (row._lifePct == null) {
    return <span className="cc-na" title={row._stage === 'In Service' ? t('tyrelifecycle.table.noRunningLife') : t('tyrelifecycle.table.removedTyre')}>{t('tyrelifecycle.na')}</span>
  }
  const v = Math.round(row._lifePct)
  return (
    <span className="cc-meter" title={row._lifeDim === 'hours' ? t('tyrelifecycle.table.judgedHours') : t('tyrelifecycle.table.judgedDistance')}>
      <b>{v}%</b>
      <span className="cc-meter-track"><span style={{ width: `${Math.min(100, v)}%`, background: BAND_COLOR[row._band] || 'var(--cc-ink-3)' }} /></span>
    </span>
  )
}

export default function TyreLifecycle() {
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
  const na = <span className="cc-na">{t('tyrelifecycle.na')}</span>
  const STATUS_LABEL = statusLabels(t)
  const STATUS_NOTE = { 'Near End': t('tyrelifecycle.status.noteNearEnd'), Normal: t('tyrelifecycle.status.noteNormal'), 'In Service': t('tyrelifecycle.status.noteInService') }
  const CATEGORY_LABEL = categoryLabels(t)
  const TAB_LABEL = { all: t('tyrelifecycle.tabs.all'), inService: t('tyrelifecycle.tabs.inService'), removed: t('tyrelifecycle.tabs.removed'), history: t('tyrelifecycle.tabs.history'), analytics: t('tyrelifecycle.tabs.analytics') }
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [capped, setCapped] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [tab, setTab] = useState('all')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [moreOpen, setMoreOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [historySerial, setHistorySerial] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const latest = useLatestRequest()

  useEffect(() => {
    const stale = latest.begin()
    setLoading(true)
    setError(null)
    fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('id,asset_no,serial_number:serial_no,position,brand,size,tread_depth,cost_per_tyre,qty,issue_date,removal_date,km_at_fitment,km_at_removal,risk_level,site,country,category,vehicle_type,removal_reason,status,total_km')
        .order('issue_date', { ascending: false })
        .order('id', { ascending: false })
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      return q.range(from, to)
    }, { max: ROW_CAP }).then(({ data, error: err, truncated }) => {
      if (stale()) return
      if (err) {
        setError(toUserMessage(err, t('tyrelifecycle.errors.load')))
        setRecords([]); setCapped(false)
      } else {
        setRecords(data || []); setCapped(Boolean(truncated))
      }
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, refreshKey, latest])

  const rl = useCard(async () => {
    const payload = await getTyreRunningLife({ country: activeCountry, maxAgeMs: refreshKey ? 0 : 60000 })
    if (!payload || payload.ok === false) throw new Error(payload?.reason || t('tyrelifecycle.errors.runningLife'))
    return shapeRunningLife(payload).rows
  }, [activeCountry, refreshKey])

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])
  const rlIndex = useMemo(() => indexRunningLife(rl.data || []), [rl.data])
  const rows = useMemo(() => buildRows(records, rlIndex), [records, rlIndex])
  const options = useMemo(() => filterOptions(rows), [rows])
  const filtered = useMemo(() => filterViewRows(rows, filters), [rows, filters])
  const shown = useMemo(() => tabRows(filtered, tab), [filtered, tab])
  const kpis = useMemo(() => viewKpis(filtered), [filtered])
  const life = useMemo(() => lifecycleKpis(filtered), [filtered])
  const progression = useMemo(() => lifeProgression(filtered), [filtered])
  const reasons = useMemo(() => removalReasons(filtered), [filtered])
  const brands = useMemo(() => topBrandsByLife(filtered), [filtered])

  const hasFilter = Object.keys(EMPTY_FILTERS).some((k) => filters[k] !== EMPTY_FILTERS[k])
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  const clearFilters = () => setFilters(EMPTY_FILTERS)
  const singleCurrency = activeCountry !== 'All' ? activeCurrency : null
  const rlPending = rl.loading && !rl.data
  const statusOf = (r) => (rlPending && r._stage === 'In Service' ? null : r._status)

  // Export the whole filtered set on the active tab, never one page.
  const scope = [filters.from && t('tyrelifecycle.export.scopeFrom', { date: filters.from }), filters.to && t('tyrelifecycle.export.scopeTo', { date: filters.to }), ...['vehicleType', 'brand', 'position', 'status', 'site', 'category'].map((k) => (filters[k] !== 'All' ? (k === 'status' ? STATUS_LABEL[filters[k]] || filters[k] : k === 'category' ? CATEGORY_LABEL[filters[k]] || filters[k] : filters[k]) : null))].filter(Boolean).join(' | ')
  const fileName = reportFileName('TyrePulse Tyre Lifecycle', activeCountry !== 'All' ? activeCountry : null)
  const exportSet = tab === 'inService' || tab === 'removed' ? shown : filtered
  const headers = exportHeaders(t)
  function handlePdf(opts = {}) {
    return exportToPdf(
      viewExportRows(exportSet),
      VIEW_EXPORT_COLS.map((k, i) => ({ key: k, header: headers[i] })),
      `${t('tyrelifecycle.export.reportTitle')}${scope ? ` (${scope})` : ''}`,
      fileName, 'landscape', '', opts,
    )
  }
  const handleExcel = () => exportToExcel(viewExportRows(exportSet), VIEW_EXPORT_COLS, headers, fileName, 'Lifecycle')

  function onStage(stage) {
    setFilters((f) => ({ ...f, status: stage === 'In Service' ? 'All' : stage }))
    setTab(stage === 'In Service' ? 'inService' : 'removed')
  }

  const columns = [
    { key: 'serial', header: t('tyrelifecycle.table.serial'), sortValue: (r) => r.serial_number || '', cell: (r) => (r.serial_number
      ? <Link className="tlc-serial" to={`/tyre-passport/${encodeURIComponent(r.serial_number)}`} onClick={(e) => e.stopPropagation()}>{r.serial_number}</Link>
      : na) },
    { key: 'asset', header: t('tyrelifecycle.table.asset'), sortValue: (r) => r.asset_no || '', cell: (r) => (
      <span className="cc-vehicle"><VehicleThumb row={{ asset_no: r.asset_no, vehicle_type: r.vehicle_type }} size="sm" />
        <span><b>{r.asset_no || t('tyrelifecycle.na')}</b><span className="cc-sub">{r.site || r.vehicle_type || t('tyrelifecycle.table.siteNotRecorded')}</span></span></span>
    ) },
    { key: 'brand', header: t('tyrelifecycle.table.brand'), cell: (r) => r.brand || na },
    { key: 'size', header: t('tyrelifecycle.table.size'), cell: (r) => r.size || na },
    { key: 'position', header: t('tyrelifecycle.table.position'), cell: (r) => r.position || na },
    { key: 'issue_date', header: t('tyrelifecycle.table.fitmentDate'), cell: (r) => r.issue_date || na },
    { key: 'km', header: t('tyrelifecycle.table.currentKm'), numeric: true, sortValue: (r) => r._currentKm ?? r.km_at_removal ?? -1, cell: (r) => {
      if (r._currentKm != null) return fmtInt(r._currentKm)
      if (r._stage !== 'In Service' && r.km_at_removal != null) return <span title={t('tyrelifecycle.table.kmAtRemovalHint')}>{fmtInt(r.km_at_removal)}<span className="cc-sub">{t('tyrelifecycle.table.atRemoval')}</span></span>
      return na
    } },
    { key: 'life', header: t('tyrelifecycle.table.lifePct'), sortValue: (r) => r._lifePct ?? -1, cell: (r) => <LifeBar row={r} /> },
    { key: 'status', header: t('tyrelifecycle.table.status'), sortValue: (r) => r._status, cell: (r) => {
      const s = statusOf(r)
      return s ? <span className={`cc-pill ${STATUS_META[s]?.tone || 'muted'}`} title={STATUS_NOTE[s]}>{STATUS_LABEL[s] || s}</span> : <span className="cc-na">{t('tyrelifecycle.status.checking')}</span>
    } },
    { key: 'actions', header: t('tyrelifecycle.table.actions'), sortable: false, cell: (r) => (
      <span className="tlc-actions" onClick={(e) => e.stopPropagation()} role="presentation">
        <button type="button" className="cc-icon-btn" aria-label={t('tyrelifecycle.table.viewTyreAria', { id: r.serial_number || r.id })} title={t('tyrelifecycle.table.viewHistory')} disabled={!r.serial_number} onClick={() => setSelected(r)}><Eye size={14} /></button>
        <Link className="cc-icon-btn" to={`/tyre-records${r.serial_number ? `?search=${encodeURIComponent(r.serial_number)}` : ''}`} aria-label={t('tyrelifecycle.table.editAria')} title={t('tyrelifecycle.table.editTitle')}><Pencil size={14} /></Link>
        {r.asset_no && <Link className="cc-icon-btn" to={`/asset-management/${encodeURIComponent(r.asset_no)}`} aria-label={t('tyrelifecycle.table.openAssetAria', { asset: r.asset_no })} title={t('tyrelifecycle.table.openAsset')}><ExternalLink size={14} /></Link>}
      </span>
    ) },
  ]

  const naText = t('tyrelifecycle.na')
  const kpiNA = error ? naText : undefined
  const nearEndDisplay = error ? naText : rl.error ? naText : undefined
  const tabsWithCounts = TABS.map((tb0) => {
    const tb = { ...tb0, label: TAB_LABEL[tb0.key] || tb0.label }
    return tb.key === 'all' ? { ...tb, count: loading ? null : fmtInt(filtered.length) }
      : tb.key === 'inService' ? { ...tb, count: loading ? null : fmtInt(kpis.active) }
        : tb.key === 'removed' ? { ...tb, count: loading ? null : fmtInt(kpis.removed) } : tb
  })

  return (
    <div className="cc tlc-page">
      <PageHero
        hello={t('tyrelifecycle.hero.hello')}
        title={t('tyrelifecycle.hero.title')}
        lead={t('tyrelifecycle.hero.lead')}
        imgLight="/dashboard/hero-lifecycle-light.webp"
        imgDark="/dashboard/hero-lifecycle-dark.webp"
        stat={{ value: loading || error || life.avgLifeKm == null ? naText : t('tyrelifecycle.hero.statKm', { value: fmtInt(Math.round(life.avgLifeKm)) }), lines: [t('tyrelifecycle.hero.statLine1'), t('tyrelifecycle.hero.statLine2', { count: fmtInt(life.measuredLife) })] }}
      />

      {error && <div className="cc-card tlc-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>{error}</div><button type="button" className="cc-btn" onClick={reload}>{t('tyrelifecycle.common.retry')}</button></div>}
      {capped && <div className="cc-card tlc-banner" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>{t('tyrelifecycle.banner.capped', { count: ROW_CAP.toLocaleString() })}</div></div>}
      {rl.error && <div className="cc-card tlc-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>{t('tyrelifecycle.errors.runningLifeBanner', { detail: rl.error })}</div><button type="button" className="cc-btn" onClick={rl.retry}>{t('tyrelifecycle.common.retry')}</button></div>}

      <div className="cc-kpis tlc-kpis">
        <Kpi icon={CircleDot} tone="t-green" value={kpis.total} display={kpiNA} label={t('tyrelifecycle.kpi.total')} loading={loading} onClick={() => setTab('all')} title={t('tyrelifecycle.kpi.totalHint')} />
        <Kpi icon={Activity} tone="t-blue" value={kpis.active} display={kpiNA} label={t('tyrelifecycle.kpi.active')} loading={loading} onClick={() => setTab('inService')} title={t('tyrelifecycle.kpi.activeHint')} />
        <Kpi icon={Truck} tone="t-green" value={kpis.inService} display={nearEndDisplay} label={t('tyrelifecycle.kpi.inService')} loading={loading || rlPending} onClick={() => { setTab('inService'); setFilters((f) => ({ ...f, status: 'Normal' })) }} title={t('tyrelifecycle.kpi.inServiceHint')} />
        <Kpi icon={AlertTriangle} tone="t-red" value={kpis.nearEnd} display={nearEndDisplay} label={t('tyrelifecycle.kpi.nearEnd')} loading={loading || rlPending} onClick={() => { setTab('inService'); setFilters((f) => ({ ...f, status: 'Near End' })) }} title={t('tyrelifecycle.kpi.nearEndHint')} />
        <Kpi icon={Archive} tone="t-orange" value={kpis.removed} display={kpiNA} label={t('tyrelifecycle.kpi.removed')} loading={loading} onClick={() => setTab('removed')} title={t('tyrelifecycle.kpi.removedHint')} />
      </div>

      <Card className="tlc-main">
        <Tabs tabs={tabsWithCounts} value={tab} onChange={setTab} label={t('tyrelifecycle.tabs.label')} />

        {(tab === 'all' || tab === 'inService' || tab === 'removed') && (
          <>
            <div className="cc-filters tlc-filters">
              <label className="cc-field"><span>{t('tyrelifecycle.filters.vehicleType')}</span>
                <select className="cc-select" value={filters.vehicleType} onChange={setF('vehicleType')}><option value="All">{t('tyrelifecycle.filters.allVehicleTypes')}</option>{options.vehicleTypes.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field"><span>{t('tyrelifecycle.filters.brand')}</span>
                <select className="cc-select" value={filters.brand} onChange={setF('brand')}><option value="All">{t('tyrelifecycle.filters.allBrands')}</option>{options.brands.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field"><span>{t('tyrelifecycle.filters.position')}</span>
                <select className="cc-select" value={filters.position} onChange={setF('position')}><option value="All">{t('tyrelifecycle.filters.allPositions')}</option>{options.positions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field"><span>{t('tyrelifecycle.filters.status')}</span>
                <select className="cc-select" value={filters.status} onChange={setF('status')}><option value="All">{t('tyrelifecycle.filters.allStatus')}</option>{STATUSES.map((o) => <option key={o} value={o}>{STATUS_LABEL[o] || o}</option>)}</select>
              </label>
              <label className="cc-field tlc-date"><span>{t('tyrelifecycle.filters.fittedFrom')}</span><input type="date" className="tlc-input" value={filters.from} onChange={setF('from')} /></label>
              <label className="cc-field tlc-date"><span>{t('tyrelifecycle.filters.fittedTo')}</span><input type="date" className="tlc-input" value={filters.to} onChange={setF('to')} /></label>
              <div className="cc-search"><Search size={15} aria-hidden="true" /><input type="search" value={filters.search} onChange={setF('search')} placeholder={t('tyrelifecycle.filters.searchPlaceholder')} aria-label={t('tyrelifecycle.filters.searchAria')} /></div>
              <button type="button" className="cc-btn-ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}><SlidersHorizontal size={14} aria-hidden="true" /> {t('tyrelifecycle.filters.more')}</button>
              {hasFilter && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> {t('tyrelifecycle.filters.clear')}</button>}
              <span className="tlc-export">
                <button type="button" className="cc-btn-ghost" onClick={() => handlePdf()} disabled={loading || !exportSet.length}><FileText size={14} aria-hidden="true" /> {t('tyrelifecycle.export.pdf')}</button>
                <button type="button" className="cc-btn-ghost" onClick={handleExcel} disabled={loading || !exportSet.length}><FileSpreadsheet size={14} aria-hidden="true" /> {t('tyrelifecycle.export.excel')}</button>
                <EmailPdfButton
                  className="cc-btn-ghost"
                  getPdf={async () => ({ base64: await handlePdf({ returnBase64: true }), filename: `${fileName}.pdf`, subject: t('tyrelifecycle.export.emailSubject'), bodyHtml: `<p>${t('tyrelifecycle.export.emailBody')}</p>` })}
                />
                <button type="button" className="cc-icon-btn" onClick={reload} aria-label={t('tyrelifecycle.common.refreshAria')} title={t('tyrelifecycle.common.refresh')}><RefreshCw size={14} /></button>
              </span>
            </div>
            {moreOpen && (
              <div className="cc-filters tlc-filters">
                <label className="cc-field"><span>{t('tyrelifecycle.filters.site')}</span>
                  <select className="cc-select" value={filters.site} onChange={setF('site')}><option value="All">{t('tyrelifecycle.filters.allSites')}</option>{options.sites.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                </label>
                <label className="cc-field"><span>{t('tyrelifecycle.filters.category')}</span>
                  <select className="cc-select" value={filters.category} onChange={setF('category')}><option value="All">{t('tyrelifecycle.filters.allCategories')}</option>{CATEGORIES.map((o) => <option key={o} value={o}>{CATEGORY_LABEL[o] || o}</option>)}</select>
                </label>
              </div>
            )}
            <p className="tlc-count" aria-live="polite">{t('tyrelifecycle.table.count', { shown: fmtInt(shown.length), total: fmtInt(rows.length) })}</p>
            <div className="tlc-scroll">
              <KitTable
                columns={columns} rows={shown} loading={loading} error={error} onRetry={reload}
                getRowId={(r) => String(r.id)} onRowClick={(r) => r.serial_number && setSelected(r)} initialPageSize={25}
                empty={rows.length ? t('tyrelifecycle.table.emptyFiltered') : t('tyrelifecycle.table.emptyNone')}
              />
            </div>
          </>
        )}

        {tab === 'history' && (
          <div className="tlc-history">
            <form className="cc-filters" onSubmit={(e) => { e.preventDefault(); setHistorySerial(historyQuery.trim()) }}>
              <div className="cc-search"><Search size={15} aria-hidden="true" /><input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder={t('tyrelifecycle.history.serialPlaceholder')} aria-label={t('tyrelifecycle.history.serialAria')} /></div>
              <button type="submit" className="cc-btn-primary" disabled={!historyQuery.trim()}>{t('tyrelifecycle.history.show')}</button>
            </form>
            {historySerial
              ? <TyreHistoryPanel key={historySerial} serial={historySerial} row={rows.find((r) => (r.serial_number || '').toUpperCase() === historySerial.toUpperCase())} />
              : <div className="cc-empty">{t('tyrelifecycle.history.empty')}</div>}
            <TyreChangeTracking />
          </div>
        )}

        {tab === 'analytics' && (
          error ? <div className="cc-empty" role="alert"><div>{t('tyrelifecycle.errors.load')}<br /><button type="button" className="cc-btn" onClick={reload}>{t('tyrelifecycle.common.retry')}</button></div></div>
            : loading ? <div className="cc-skel" style={{ height: 240 }} />
              : <LifecycleAnalytics records={filtered} currency={singleCurrency} onStage={onStage} />
        )}
      </Card>

      {selected && (tab === 'all' || tab === 'inService' || tab === 'removed') && (
        <TyreHistoryPanel key={selected.id} serial={selected.serial_number} row={selected} onClose={() => setSelected(null)} />
      )}

      <div className="tlc-bottom">
        <Card title={t('tyrelifecycle.bottom.progressionTitle')} sub={t('tyrelifecycle.bottom.progressionSub', { count: fmtInt(progression.sample) })}>
          {rl.error ? <div className="cc-empty">{t('tyrelifecycle.errors.runningLife')}</div>
            : (loading || rlPending) ? <div className="cc-skel" style={{ height: 200 }} />
              : progression.sample === 0 ? <div className="cc-empty">{t('tyrelifecycle.bottom.progressionEmpty')}</div>
                : <LifeProgressionChart data={progression} />}
        </Card>
        <Card title={t('tyrelifecycle.bottom.reasonsTitle')} sub={reasons.unrecorded ? t('tyrelifecycle.bottom.reasonsSubUnrecorded', { unrecorded: fmtInt(reasons.unrecorded), removed: fmtInt(reasons.removed) }) : t('tyrelifecycle.bottom.reasonsSub')}>
          {loading ? <div className="cc-skel" style={{ height: 200 }} />
            : error ? <div className="cc-empty">{t('tyrelifecycle.errors.load')}</div>
              : reasons.recorded === 0 ? <div className="cc-empty">{t('tyrelifecycle.bottom.reasonsEmpty')}</div>
                : <Donut segments={reasons.segments.map((s, i) => ({ ...s, label: s.label === 'OTHER' ? t('tyrelifecycle.bottom.other') : s.label, color: REASON_COLORS[i % REASON_COLORS.length] }))} total={reasons.recorded} centerLabel={t('tyrelifecycle.bottom.reasonsCenter')} />}
        </Card>
        <Card title={t('tyrelifecycle.bottom.brandsTitle')} sub={t('tyrelifecycle.bottom.brandsSub')}>
          {loading ? <div className="cc-skel" style={{ height: 200 }} />
            : error ? <div className="cc-empty">{t('tyrelifecycle.errors.load')}</div>
              : brands.length === 0 ? <div className="cc-empty">{t('tyrelifecycle.bottom.brandsEmpty')}</div>
                : <TopBrandsBars brands={brands} />}
        </Card>
      </div>

      <TyreConsumptionSection />
      <TyreRunningLife />
    </div>
  )
}
