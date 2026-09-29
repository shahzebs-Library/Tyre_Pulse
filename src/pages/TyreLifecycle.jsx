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
import './TyreLifecycle.css'

const ROW_CAP = 50000
const REASON_COLORS = ['var(--cc-green)', 'var(--cc-blue)', 'var(--cc-amber)', 'var(--cc-red)', 'var(--cc-purple)', 'var(--cc-ink-3)']
const BAND_COLOR = { overdue: 'var(--cc-red)', 'due-soon': 'var(--cc-amber)', 'mid-life': 'var(--cc-blue)', healthy: 'var(--cc-green)' }
const EMPTY_FILTERS = { search: '', vehicleType: 'All', brand: 'All', position: 'All', status: 'All', site: 'All', category: 'All', from: '', to: '' }

const na = <span className="cc-na">N/A</span>

function LifeBar({ row }) {
  if (row._lifePct == null) {
    return <span className="cc-na" title={row._stage === 'In Service' ? 'No running-life measure for this tyre' : 'Removed tyre'}>N/A</span>
  }
  const v = Math.round(row._lifePct)
  return (
    <span className="cc-meter" title={row._lifeDim === 'hours' ? 'Judged on engine hours' : 'Judged on distance'}>
      <b>{v}%</b>
      <span className="cc-meter-track"><span style={{ width: `${Math.min(100, v)}%`, background: BAND_COLOR[row._band] || 'var(--cc-ink-3)' }} /></span>
    </span>
  )
}

export default function TyreLifecycle() {
  const { activeCountry, activeCurrency } = useSettings()
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
        .select('id,asset_no,serial_number:serial_no,position,brand,size,tread_depth,cost_per_tyre,qty,issue_date,removal_date,km_at_fitment,km_at_removal,risk_level,site,country,category,vehicle_type,removal_reason')
        .order('issue_date', { ascending: false })
        .order('id', { ascending: false })
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      return q.range(from, to)
    }, { max: ROW_CAP }).then(({ data, error: err, truncated }) => {
      if (stale()) return
      if (err) {
        setError(toUserMessage(err, 'Could not load lifecycle data.'))
        setRecords([]); setCapped(false)
      } else {
        setRecords(data || []); setCapped(Boolean(truncated))
      }
      setLoading(false)
    })
  }, [activeCountry, refreshKey, latest])

  const rl = useCard(async () => {
    const payload = await getTyreRunningLife({ country: activeCountry, maxAgeMs: refreshKey ? 0 : 60000 })
    if (!payload || payload.ok === false) throw new Error(payload?.reason || 'Running life could not be read.')
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
  const scope = [filters.from && `from ${filters.from}`, filters.to && `to ${filters.to}`, ...['vehicleType', 'brand', 'position', 'status', 'site', 'category'].map((k) => (filters[k] !== 'All' ? filters[k] : null))].filter(Boolean).join(' | ')
  const fileName = reportFileName('TyrePulse Tyre Lifecycle', activeCountry !== 'All' ? activeCountry : null)
  const exportSet = tab === 'inService' || tab === 'removed' ? shown : filtered
  function handlePdf(opts = {}) {
    return exportToPdf(
      viewExportRows(exportSet),
      VIEW_EXPORT_COLS.map((k, i) => ({ key: k, header: VIEW_EXPORT_HEADERS[i] })),
      `Tyre Lifecycle Report${scope ? ` (${scope})` : ''}`,
      fileName, 'landscape', '', opts,
    )
  }
  const handleExcel = () => exportToExcel(viewExportRows(exportSet), VIEW_EXPORT_COLS, VIEW_EXPORT_HEADERS, fileName, 'Lifecycle')

  function onStage(stage) {
    setFilters((f) => ({ ...f, status: stage === 'In Service' ? 'All' : stage }))
    setTab(stage === 'In Service' ? 'inService' : 'removed')
  }

  const columns = [
    { key: 'serial', header: 'Serial Number', sortValue: (r) => r.serial_number || '', cell: (r) => (r.serial_number
      ? <Link className="tlc-serial" to={`/tyre-passport/${encodeURIComponent(r.serial_number)}`} onClick={(e) => e.stopPropagation()}>{r.serial_number}</Link>
      : na) },
    { key: 'asset', header: 'Vehicle / Asset', sortValue: (r) => r.asset_no || '', cell: (r) => (
      <span className="cc-vehicle"><VehicleThumb row={{ asset_no: r.asset_no, vehicle_type: r.vehicle_type }} size="sm" />
        <span><b>{r.asset_no || 'N/A'}</b><span className="cc-sub">{r.site || r.vehicle_type || 'Site not recorded'}</span></span></span>
    ) },
    { key: 'brand', header: 'Brand', cell: (r) => r.brand || na },
    { key: 'size', header: 'Size', cell: (r) => r.size || na },
    { key: 'position', header: 'Position', cell: (r) => r.position || na },
    { key: 'issue_date', header: 'Fitment Date', cell: (r) => r.issue_date || na },
    { key: 'km', header: 'Current KM', numeric: true, sortValue: (r) => r._currentKm ?? r.km_at_removal ?? -1, cell: (r) => {
      if (r._currentKm != null) return fmtInt(r._currentKm)
      if (r._stage !== 'In Service' && r.km_at_removal != null) return <span title="Odometer when the tyre came off">{fmtInt(r.km_at_removal)}<span className="cc-sub">at removal</span></span>
      return na
    } },
    { key: 'life', header: 'Life %', sortValue: (r) => r._lifePct ?? -1, cell: (r) => <LifeBar row={r} /> },
    { key: 'status', header: 'Status', sortValue: (r) => r._status, cell: (r) => {
      const s = statusOf(r)
      return s ? <span className={`cc-pill ${STATUS_META[s]?.tone || 'muted'}`} title={STATUS_META[s]?.note}>{s}</span> : <span className="cc-na">Checking</span>
    } },
    { key: 'actions', header: 'Actions', sortable: false, cell: (r) => (
      <span className="tlc-actions" onClick={(e) => e.stopPropagation()} role="presentation">
        <button type="button" className="cc-icon-btn" aria-label={`View tyre ${r.serial_number || r.id}`} title="View history" disabled={!r.serial_number} onClick={() => setSelected(r)}><Eye size={14} /></button>
        <Link className="cc-icon-btn" to={`/tyre-records${r.serial_number ? `?search=${encodeURIComponent(r.serial_number)}` : ''}`} aria-label="Edit in tyre records" title="Edit in Tyre Records"><Pencil size={14} /></Link>
        {r.asset_no && <Link className="cc-icon-btn" to={`/assets/${encodeURIComponent(r.asset_no)}`} aria-label={`Open asset ${r.asset_no}`} title="Open asset"><ExternalLink size={14} /></Link>}
      </span>
    ) },
  ]

  const kpiNA = error ? 'N/A' : undefined
  const nearEndDisplay = error ? 'N/A' : rl.error ? 'N/A' : undefined
  const tabsWithCounts = TABS.map((t) => (t.key === 'all' ? { ...t, count: loading ? null : fmtInt(filtered.length) }
    : t.key === 'inService' ? { ...t, count: loading ? null : fmtInt(kpis.active) }
      : t.key === 'removed' ? { ...t, count: loading ? null : fmtInt(kpis.removed) } : t))

  return (
    <div className="cc tlc-page">
      <PageHero
        hello="Tyre Management"
        title="Tyre Lifecycle Tracker"
        lead="Track complete tyre lifecycle from fitment to removal with real usage, performance, cost and condition."
        imgLight="/dashboard/hero-lifecycle-light.webp"
        imgDark="/dashboard/hero-lifecycle-dark.webp"
        stat={{ value: loading || error || life.avgLifeKm == null ? 'N/A' : `${fmtInt(Math.round(life.avgLifeKm))} km`, lines: ['Average tyre life', `${fmtInt(life.measuredLife)} tyres measured`] }}
      />

      {error && <div className="cc-card tlc-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>{error}</div><button type="button" className="cc-btn" onClick={reload}>Retry</button></div>}
      {capped && <div className="cc-card tlc-banner" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>Showing the most recent {ROW_CAP.toLocaleString()} tyre records. Narrow the country for a complete view.</div></div>}
      {rl.error && <div className="cc-card tlc-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>Running life could not be read, so life used and Near End read N/A. {rl.error}</div><button type="button" className="cc-btn" onClick={rl.retry}>Retry</button></div>}

      <div className="cc-kpis tlc-kpis">
        <Kpi icon={CircleDot} tone="t-green" value={kpis.total} display={kpiNA} label="Total Tyres" loading={loading} onClick={() => setTab('all')} title="Tyre records in scope" />
        <Kpi icon={Activity} tone="t-blue" value={kpis.active} display={kpiNA} label="Active" loading={loading} onClick={() => setTab('inService')} title="Records with no removal recorded" />
        <Kpi icon={Truck} tone="t-green" value={kpis.inService} display={nearEndDisplay} label="In Service" loading={loading || rlPending} onClick={() => { setTab('inService'); setFilters((f) => ({ ...f, status: 'Normal' })) }} title="Active tyres not near the end of their expected life" />
        <Kpi icon={AlertTriangle} tone="t-red" value={kpis.nearEnd} display={nearEndDisplay} label="Near End of Life" loading={loading || rlPending} onClick={() => { setTab('inService'); setFilters((f) => ({ ...f, status: 'Near End' })) }} title="Past or within the due-soon band of the expected life" />
        <Kpi icon={Archive} tone="t-orange" value={kpis.removed} display={kpiNA} label="Removed" loading={loading} onClick={() => setTab('removed')} title="Removed, retreaded or scrapped records" />
      </div>

      <Card className="tlc-main">
        <Tabs tabs={tabsWithCounts} value={tab} onChange={setTab} label="Tyre lifecycle views" />

        {(tab === 'all' || tab === 'inService' || tab === 'removed') && (
          <>
            <div className="cc-filters tlc-filters">
              <label className="cc-field"><span>Vehicle type</span>
                <select className="cc-select" value={filters.vehicleType} onChange={setF('vehicleType')}><option value="All">All Vehicle Types</option>{options.vehicleTypes.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field"><span>Brand</span>
                <select className="cc-select" value={filters.brand} onChange={setF('brand')}><option value="All">All Tyre Brands</option>{options.brands.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field"><span>Position</span>
                <select className="cc-select" value={filters.position} onChange={setF('position')}><option value="All">All Positions</option>{options.positions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field"><span>Status</span>
                <select className="cc-select" value={filters.status} onChange={setF('status')}><option value="All">All Status</option>{STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="cc-field tlc-date"><span>Fitted from</span><input type="date" className="tlc-input" value={filters.from} onChange={setF('from')} /></label>
              <label className="cc-field tlc-date"><span>Fitted to</span><input type="date" className="tlc-input" value={filters.to} onChange={setF('to')} /></label>
              <div className="cc-search"><Search size={15} aria-hidden="true" /><input type="search" value={filters.search} onChange={setF('search')} placeholder="Search by serial no, vehicle, brand" aria-label="Search tyres" /></div>
              <button type="button" className="cc-btn-ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}><SlidersHorizontal size={14} aria-hidden="true" /> More</button>
              {hasFilter && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
              <span className="tlc-export">
                <button type="button" className="cc-btn-ghost" onClick={() => handlePdf()} disabled={loading || !exportSet.length}><FileText size={14} aria-hidden="true" /> PDF</button>
                <button type="button" className="cc-btn-ghost" onClick={handleExcel} disabled={loading || !exportSet.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <EmailPdfButton
                  className="cc-btn-ghost"
                  getPdf={async () => ({ base64: await handlePdf({ returnBase64: true }), filename: `${fileName}.pdf`, subject: 'Tyre Lifecycle', bodyHtml: '<p>Attached is the Tyre Lifecycle report.</p>' })}
                />
                <button type="button" className="cc-icon-btn" onClick={reload} aria-label="Refresh lifecycle data" title="Refresh"><RefreshCw size={14} /></button>
              </span>
            </div>
            {moreOpen && (
              <div className="cc-filters tlc-filters">
                <label className="cc-field"><span>Site</span>
                  <select className="cc-select" value={filters.site} onChange={setF('site')}><option value="All">All sites</option>{options.sites.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                </label>
                <label className="cc-field"><span>Category</span>
                  <select className="cc-select" value={filters.category} onChange={setF('category')}><option value="All">All categories</option>{CATEGORIES.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                </label>
              </div>
            )}
            <p className="tlc-count" aria-live="polite">{fmtInt(shown.length)} of {fmtInt(rows.length)} records. Select a row to see where that tyre has been.</p>
            <div className="tlc-scroll">
              <KitTable
                columns={columns} rows={shown} loading={loading} error={error} onRetry={reload}
                getRowId={(r) => String(r.id)} onRowClick={(r) => r.serial_number && setSelected(r)} initialPageSize={25}
                empty={rows.length ? 'No tyres match these filters' : 'No tyre records for this country yet. Import tyre records to track each tyre from fitment to retirement.'}
              />
            </div>
          </>
        )}

        {tab === 'history' && (
          <div className="tlc-history">
            <form className="cc-filters" onSubmit={(e) => { e.preventDefault(); setHistorySerial(historyQuery.trim()) }}>
              <div className="cc-search"><Search size={15} aria-hidden="true" /><input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="Enter a tyre serial number" aria-label="Tyre serial number" /></div>
              <button type="submit" className="cc-btn-primary" disabled={!historyQuery.trim()}>Show history</button>
            </form>
            {historySerial
              ? <TyreHistoryPanel key={historySerial} serial={historySerial} row={rows.find((r) => (r.serial_number || '').toUpperCase() === historySerial.toUpperCase())} />
              : <div className="cc-empty">Enter a serial, or select a row on the All Tyres tab, to see every fitment and removal for that tyre.</div>}
            <TyreChangeTracking />
          </div>
        )}

        {tab === 'analytics' && (
          error ? <div className="cc-empty" role="alert"><div>Could not load lifecycle data.<br /><button type="button" className="cc-btn" onClick={reload}>Retry</button></div></div>
            : loading ? <div className="cc-skel" style={{ height: 240 }} />
              : <LifecycleAnalytics records={filtered} currency={singleCurrency} onStage={onStage} />
        )}
      </Card>

      {selected && (tab === 'all' || tab === 'inService' || tab === 'removed') && (
        <TyreHistoryPanel key={selected.id} serial={selected.serial_number} row={selected} onClose={() => setSelected(null)} />
      )}

      <div className="tlc-bottom">
        <Card title="Tyre Life Progression" sub={`Life used against distance run, active tyres by wheel corner (${fmtInt(progression.sample)} measured)`}>
          {rl.error ? <div className="cc-empty">Running life could not be read.</div>
            : (loading || rlPending) ? <div className="cc-skel" style={{ height: 200 }} />
              : progression.sample === 0 ? <div className="cc-empty">No active tyre in scope has a measured life on distance.</div>
                : <LifeProgressionChart data={progression} />}
        </Card>
        <Card title="Removal Reasons" sub={reasons.unrecorded ? `${fmtInt(reasons.unrecorded)} of ${fmtInt(reasons.removed)} removed tyres have no reason recorded` : 'Removed tyres in scope'}>
          {loading ? <div className="cc-skel" style={{ height: 200 }} />
            : error ? <div className="cc-empty">Could not load lifecycle data.</div>
              : reasons.recorded === 0 ? <div className="cc-empty">No removal reason is recorded in scope.</div>
                : <Donut segments={reasons.segments.map((s, i) => ({ ...s, label: s.label === 'OTHER' ? 'Other' : s.label, color: REASON_COLORS[i % REASON_COLORS.length] }))} total={reasons.recorded} centerLabel="Removed" />}
        </Card>
        <Card title="Top Tyre Brands (by Life)" sub="Average km run per removed tyre, brands with at least 5 measured">
          {loading ? <div className="cc-skel" style={{ height: 200 }} />
            : error ? <div className="cc-empty">Could not load lifecycle data.</div>
              : brands.length === 0 ? <div className="cc-empty">No brand has 5 tyres with a measured life in scope.</div>
                : <TopBrandsBars brands={brands} />}
        </Card>
      </div>

      <TyreConsumptionSection />
      <TyreRunningLife />
    </div>
  )
}
