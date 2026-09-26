import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  AlertOctagon, Download, FileText, AlertTriangle, TrendingUp, Coins, Activity,
  Filter, BarChart2, ShieldAlert, Layers, RefreshCw, Search, X, ExternalLink, Gauge,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SectionTabs, { RCA_TABS } from '../components/ui/SectionTabs'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  ROOT_CAUSES, DATE_PRESETS, RISK_LEVELS, presetCutoff, resolveCurrency, filterRecords,
  classifyAll, computeCauseStats, sortCauses, summarize, buildHeatmap, heatBand, deepDive,
  worstVehicles, recordExportRows, causeSummaryRows, RECORD_EXPORT_COLS, lineCost, kmLife,
  findingsText, pct,
} from '../lib/rootCauseEngineAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// exportUtils is heavy and only needed on click.
const loadExportUtils = () => import('../lib/exportUtils')

const ROW_CEILING = 50000
const TOP_CAUSES_HEATMAP = 8
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const SELECT_CLS = `min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg px-3 ${FOCUS}`

// Semantic risk tones: colour is paired with the level text, never alone.
const RISK_TONE = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#16a34a',
}
// Heat map intensity: one hue, alpha steps, the count is always printed.
const HEAT_HUE = '#ef4444'

const AXIS = { color: 'var(--text-muted)', font: { size: 11 } }
const GRID = { color: 'var(--panel-2)' }

function RiskPill({ level }) {
  const lvl = String(level || '').trim()
  const tone = RISK_TONE[lvl]
  if (!tone) return <span className="text-xs text-[var(--text-muted)]">{lvl || 'N/A'}</span>
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[11px] font-semibold"
      style={{ backgroundColor: withAlpha(tone, 0.16), color: tone, border: `1px solid ${withAlpha(tone, 0.4)}` }}
    >{lvl}</span>
  )
}

function StateCard({ icon: Icon, title, body, action }) {
  return (
    <div className="card p-8 text-center" role="status">
      <Icon size={28} className="text-[var(--text-dim)] mx-auto mb-3" aria-hidden="true" />
      <p className="text-[var(--text-primary)] font-semibold mb-1">{title}</p>
      {body && <p className="text-[var(--text-muted)] text-sm max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function RankList({ title, items, mono }) {
  return (
    <div className="bg-[var(--input-bg)] rounded-lg p-3">
      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2 font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="text-[var(--text-dim)] text-xs">No records</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((a, i) => (
            <li key={a.name} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] text-[var(--text-dim)] w-4 tabular-nums">{i + 1}.</span>
                <span className={`text-[var(--text-secondary)] text-xs truncate ${mono ? 'font-mono' : ''}`}>{a.name}</span>
              </span>
              <span className="text-xs font-bold text-[var(--text-primary)] tabular-nums">{a.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function RootCauseEngine() {
  const { activeCurrency, activeCountry } = useSettings()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [datePreset, setDatePreset] = useState('All Time')
  const [siteFilter, setSiteFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [minRecords, setMinRecords] = useState(1)
  const [search, setSearch] = useState('')
  const [activeCause, setActiveCause] = useState(ROOT_CAUSES[0])

  const dateCutoff = useMemo(() => presetCutoff(datePreset, new Date()), [datePreset])

  // A superseded read (preset moved while paging) must not paint its rows.
  const latestLoad = useLatestRequest()

  useEffect(() => {
    const stale = latestLoad.begin()
    setLoading(true)
    setError(null)
    fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select(
          'id,asset_no,site,country,brand,tyre_serial,category,risk_level,findings,description,remarks,' +
          'tread_depth,pressure_reading,km_at_fitment,km_at_removal,cost_per_tyre,qty,' +
          'issue_date,removal_reason,position',
        )
        .order('issue_date', { ascending: false })
        .order('id', { ascending: true })
      if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
      // Server-side window that mirrors the client filter (undated rows kept).
      if (dateCutoff) q = q.or(`issue_date.is.null,issue_date.gte.${dateCutoff}`)
      return q.range(from, to)
    }, { max: ROW_CEILING }).then(({ data, error: err, truncated: trunc }) => {
      if (stale()) return
      if (err) {
        setError(toUserMessage(err, 'Could not load root cause data.'))
        setRecords([])
      } else {
        setRecords(data || [])
        setTruncated(!!trunc)
      }
      setLoading(false)
    })
  }, [activeCountry, dateCutoff, latestLoad, reloadKey])

  const retry = useCallback(() => setReloadKey(k => k + 1), [])

  // Money is only stated when every loaded row shares one currency.
  const currency = useMemo(
    () => resolveCurrency(records, activeCountry, activeCurrency),
    [records, activeCountry, activeCurrency],
  )
  const moneyOk = !!currency
  const fmtMoney = useCallback((n) => {
    if (!moneyOk || n === null || n === undefined || !Number.isFinite(n)) return 'N/A'
    return `${currency} ${Math.round(n).toLocaleString()}`
  }, [moneyOk, currency])
  const fmtCpk = useCallback((n) => {
    if (!moneyOk || n === null || n === undefined) return 'N/A'
    return `${currency} ${n.toFixed(4)}`
  }, [moneyOk, currency])

  const allSites = useMemo(
    () => [...new Set(records.map(r => r.site).filter(Boolean))].sort(),
    [records],
  )

  const filtered = useMemo(
    () => filterRecords(records, { cutoff: dateCutoff, site: siteFilter, risk: riskFilter, search }),
    [records, dateCutoff, siteFilter, riskFilter, search],
  )
  const classified = useMemo(() => classifyAll(filtered), [filtered])
  const causeStats = useMemo(() => computeCauseStats(classified), [classified])
  const sorted = useMemo(() => sortCauses(causeStats, minRecords), [causeStats, minRecords])
  const summary = useMemo(() => summarize(classified, sorted), [classified, sorted])
  const heatmap = useMemo(() => buildHeatmap(classified, sorted, TOP_CAUSES_HEATMAP), [classified, sorted])
  const dive = useMemo(() => deepDive(causeStats[activeCause], filtered.length), [causeStats, activeCause, filtered.length])
  const worst = useMemo(() => worstVehicles(classified, 15), [classified])

  const filtersActive = datePreset !== 'All Time' || siteFilter !== 'all' || riskFilter !== 'all' || minRecords > 1 || search.trim() !== ''
  const clearFilters = () => {
    setDatePreset('All Time'); setSiteFilter('all'); setRiskFilter('all'); setMinRecords(1); setSearch('')
  }

  // ── Charts ──────────────────────────────────────────────────────────────────
  const freqChart = useMemo(() => ({
    labels: sorted.map(c => c.cause),
    datasets: [{
      label: 'Records',
      data: sorted.map(c => c.count),
      backgroundColor: sorted.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderRadius: 4,
    }],
  }), [sorted])

  const costRanked = useMemo(
    () => sorted.filter(c => c.totalCost !== null).sort((a, b) => b.totalCost - a.totalCost),
    [sorted],
  )
  const costChart = useMemo(() => ({
    labels: costRanked.map(c => c.cause),
    datasets: [{
      label: 'Cost',
      data: costRanked.map(c => Math.round(c.totalCost)),
      backgroundColor: costRanked.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderRadius: 4,
    }],
  }), [costRanked])

  const barOpts = useCallback((valueLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: valueLabel } },
    },
    scales: {
      x: { grid: GRID, ticks: AXIS, beginAtZero: true },
      y: { grid: { display: false }, ticks: { ...AXIS, color: 'var(--text-secondary)' } },
    },
  }), [])

  // ── Tables ──────────────────────────────────────────────────────────────────
  const heatColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: r => r.site, size: 160 },
    ...heatmap.topCauses.map(c => ({
      id: c,
      header: c,
      accessorFn: r => r[c],
      size: 110,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const count = row.original[c]
        const band = heatBand(count, heatmap.maxVal)
        if (!count) return <span className="text-[var(--text-dim)]" aria-label="none">0</span>
        return (
          <span
            className="inline-block min-w-[2rem] px-1.5 py-0.5 rounded font-semibold tabular-nums text-[var(--text-primary)]"
            style={{ backgroundColor: withAlpha(HEAT_HUE, 0.12 + band * 0.14) }}
            title={`${count} records, intensity ${band} of 4`}
          >{count}</span>
        )
      },
    })),
    { id: 'total', header: 'Total', accessorFn: r => r.total, size: 90, meta: { align: 'right' } },
  ], [heatmap])

  const recordColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset No', accessorFn: r => r.asset_no || '', size: 110,
      cell: ({ row }) => <span className="font-mono">{row.original.asset_no || 'N/A'}</span> },
    { id: 'site', header: 'Site', accessorFn: r => r.site || '', size: 120 },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand || '', size: 120 },
    { id: 'issue_date', header: 'Date', accessorFn: r => (r.issue_date ? String(r.issue_date).slice(0, 10) : ''), size: 110 },
    { id: 'risk_level', header: 'Risk', accessorFn: r => r.risk_level || '', size: 100,
      cell: ({ row }) => <RiskPill level={row.original.risk_level} /> },
    { id: 'cost', header: 'Cost', accessorFn: r => (moneyOk ? lineCost(r) : null), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(lineCost(row.original))}</span> },
    { id: 'km_life', header: 'Km life', accessorFn: r => kmLife(r), size: 100, meta: { align: 'right' },
      cell: ({ row }) => { const k = kmLife(row.original); return <span className="tabular-nums">{k === null ? 'N/A' : Math.round(k).toLocaleString()}</span> } },
    { id: 'findings', header: 'Findings', accessorFn: r => findingsText(r), size: 320,
      cell: ({ row }) => {
        const f = findingsText(row.original)
        return <span className="block truncate max-w-[320px]" title={f}>{f || 'N/A'}</span>
      } },
  ], [fmtMoney, moneyOk])

  const worstColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset No', accessorFn: r => r.asset_no, size: 110,
      cell: ({ row }) => <span className="font-mono font-semibold">{row.original.asset_no}</span> },
    { id: 'site', header: 'Site', accessorFn: r => r.site || '', size: 120,
      cell: ({ row }) => row.original.site || 'N/A' },
    { id: 'incidents', header: 'Cause matches', accessorFn: r => r.incidents, size: 120, meta: { align: 'right' } },
    { id: 'records', header: 'Records', accessorFn: r => r.records, size: 90, meta: { align: 'right' } },
    { id: 'topCause', header: 'Top cause', accessorFn: r => r.topCause || '', size: 170 },
    { id: 'totalCost', header: 'Cost', accessorFn: r => (moneyOk ? r.totalCost : null), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(row.original.totalCost)}</span> },
    { id: 'avgCPK', header: 'CPK', accessorFn: r => (moneyOk ? r.avgCPK : null), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCpk(row.original.avgCPK)}</span> },
    { id: 'history', header: '', enableSorting: false, size: 90, meta: { export: false },
      cell: ({ row }) => (
        <Link
          to={`/vehicle-history?q=${encodeURIComponent(row.original.asset_no)}`}
          className={`inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-[var(--accent)] hover:underline rounded ${FOCUS}`}
          aria-label={`View history for ${row.original.asset_no}`}
        >
          <ExternalLink size={12} aria-hidden="true" /> History
        </Link>
      ) },
  ], [fmtMoney, fmtCpk, moneyOk])

  // ── Exports (full filtered set, never a visible page) ───────────────────────
  const [exporting, setExporting] = useState(false)
  async function handleExcelExport() {
    setExporting(true)
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      const costHeader = moneyOk ? `Cost (${currency})` : 'Cost (mixed currencies, withheld)'
      const rows = recordExportRows(classified).map(r => (moneyOk ? r : { ...r, cost: '' }))
      await exportToExcel(
        rows,
        RECORD_EXPORT_COLS,
        ['Asset No', 'Site', 'Brand', 'Date', 'Risk Level', 'Root Causes', costHeader, 'Km Life', 'Findings'],
        reportFileName('TyrePulse Root Cause Records', activeCountry, datePreset),
        'Root Causes',
      )
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    } finally { setExporting(false) }
  }
  async function handlePdfExport() {
    setExporting(true)
    try {
      const { exportToPdf, reportFileName } = await loadExportUtils()
      const rows = causeSummaryRows(sorted, filtered.length)
        .map(r => (moneyOk ? r : { ...r, total_cost: 'N/A', cpk: 'N/A' }))
      await exportToPdf(
        rows,
        [
          { key: 'cause', header: 'Root Cause' },
          { key: 'count', header: 'Records' },
          { key: 'pct', header: '% of Total' },
          { key: 'total_cost', header: moneyOk ? `Cost (${currency})` : 'Cost' },
          { key: 'cpk', header: moneyOk ? `CPK (${currency})` : 'CPK' },
          { key: 'top_asset', header: 'Top Asset' },
        ],
        'Root Cause Intelligence Summary',
        reportFileName('TyrePulse Root Cause Summary', activeCountry, datePreset),
        'landscape',
        '',
        { currency: currency || undefined, subtitleNote: `${filtered.length.toLocaleString()} records in scope` },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    } finally { setExporting(false) }
  }

  const noData = !loading && !error && records.length === 0 && !dateCutoff

  return (
    <div className="space-y-6">
      <SectionTabs tabs={RCA_TABS} />
      <PageHeader
        title="Root Cause Intelligence Engine"
        subtitle="Rule-based classification of 14 engineering root causes across the fleet"
        icon={AlertOctagon}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={retry} disabled={loading}
              className={`btn-secondary min-h-[44px] flex items-center gap-2 text-sm disabled:opacity-50 ${FOCUS}`}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={handleExcelExport} disabled={loading || exporting || classified.length === 0}
              className={`btn-secondary min-h-[44px] flex items-center gap-2 text-sm disabled:opacity-50 ${FOCUS}`}>
              <Download size={15} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={handlePdfExport} disabled={loading || exporting || sorted.length === 0}
              className={`btn-secondary min-h-[44px] flex items-center gap-2 text-sm disabled:opacity-50 ${FOCUS}`}>
              <FileText size={15} aria-hidden="true" /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
          <AlertOctagon size={18} className="text-red-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Root cause data could not be loaded</p>
            <p className="text-sm text-[var(--text-muted)]">{error}</p>
          </div>
          <button type="button" onClick={retry} className={`btn-secondary min-h-[44px] flex items-center gap-2 text-sm ${FOCUS}`}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {noData ? (
        <StateCard icon={Layers} title="No tyre records found"
          body="Upload tyre change records to enable root cause analysis." />
      ) : !error && (
        <>
          {/* ── Filters ── */}
          <section className="card p-4" aria-label="Filters">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
              <h2 className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-medium">Filters</h2>
              {filtersActive && (
                <button type="button" onClick={clearFilters}
                  className={`ml-auto min-h-[44px] inline-flex items-center gap-1 px-3 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg ${FOCUS}`}>
                  <X size={12} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs text-[var(--text-dim)] mb-1.5" id="rca-range-label">Date range</p>
                <div className="flex gap-1.5 flex-wrap" role="group" aria-labelledby="rca-range-label">
                  {DATE_PRESETS.map(p => (
                    <button key={p.label} type="button" onClick={() => setDatePreset(p.label)}
                      aria-pressed={datePreset === p.label}
                      className={`min-h-[44px] px-3 rounded-lg text-xs font-medium border transition-colors ${FOCUS} ${
                        datePreset === p.label
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                          : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}>{p.label}</button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Search</span>
                <span className="relative block">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Asset, brand, serial, findings"
                    className={`w-full pl-9 ${SELECT_CLS}`} />
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Site</span>
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`w-full ${SELECT_CLS}`}>
                  <option value="all">All sites</option>
                  {allSites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Risk level</span>
                <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} className={`w-full ${SELECT_CLS}`}>
                  <option value="all">All levels</option>
                  {RISK_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">
                  Minimum records per cause: <span className="text-[var(--text-secondary)] tabular-nums">{minRecords}</span>
                </span>
                <input type="range" min={1} max={50} value={minRecords}
                  onChange={e => setMinRecords(Number(e.target.value))}
                  className={`w-full min-h-[44px] accent-[var(--accent)] ${FOCUS}`} />
              </label>
            </div>
            <p className="mt-3 text-xs text-[var(--text-dim)]" aria-live="polite">
              {loading ? 'Loading records...' : `${filtered.length.toLocaleString()} records in view`}
            </p>
          </section>

          {truncated && (
            <div role="status" className="card p-3 flex items-start gap-2 border border-amber-500/40 text-xs text-[var(--text-secondary)]">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
              <span>
                Capped view: showing the newest {ROW_CEILING.toLocaleString()} records for this country and date window.
                Narrow the date range or country to analyse the full detail.
              </span>
            </div>
          )}

          {!moneyOk && !loading && records.length > 0 && (
            <div role="status" className="card p-3 flex items-start gap-2 border border-[var(--input-border)] text-xs text-[var(--text-secondary)]">
              <Coins size={16} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
              <span>
                These records span countries that report in different currencies, so cost and CPK are withheld
                rather than added together. Pick one country to see money figures.
              </span>
            </div>
          )}

          {/* ── KPI strip ── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile icon={Activity} label="Records in view" value={loading ? '...' : filtered.length.toLocaleString()}
              sub={`${summary.critical.toLocaleString()} rated Critical`} />
            <StatTile icon={ShieldAlert} label="Cause coverage"
              value={summary.coveragePct === null ? 'N/A' : `${summary.coveragePct.toFixed(1)}%`}
              sub={`${summary.classified.toLocaleString()} classified`} tone="info" />
            <StatTile icon={AlertTriangle} label="Unclassified" value={summary.unclassified.toLocaleString()}
              sub="No rule matched the record" tone={summary.unclassified > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={TrendingUp} label="Top root cause" value={summary.topCause ? summary.topCause.count.toLocaleString() : 'N/A'}
              sub={summary.topCause ? summary.topCause.cause : 'No cause meets the threshold'} tone="crit" />
            <StatTile icon={Coins} label="Classified cost" value={fmtMoney(summary.classifiedCost)}
              sub={summary.pricedShare === null ? 'No classified records' : `${summary.pricedShare.toFixed(0)}% of classified records priced`} />
            <StatTile icon={Gauge} label="Causes per record"
              value={summary.avgCausesPerRecord === null ? 'N/A' : summary.avgCausesPerRecord.toFixed(2)}
              sub={`${summary.causesActive} causes active`} />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-busy="true">
              {[0, 1].map(i => <div key={i} className="card h-72 animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <StateCard icon={Search} title="No records match these filters"
              body="Widen the date range or clear the site, risk and search filters."
              action={filtersActive && (
                <button type="button" onClick={clearFilters} className={`btn-secondary min-h-[44px] text-sm ${FOCUS}`}>Clear filters</button>
              )} />
          ) : (
            <>
              {/* ── Charts ── */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <section className="card p-4" aria-labelledby="rca-freq">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart2 size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
                    <h2 id="rca-freq" className="text-sm font-semibold text-[var(--text-primary)]">Root cause frequency</h2>
                  </div>
                  {sorted.length === 0 ? (
                    <p className="h-48 flex items-center justify-center text-[var(--text-dim)] text-sm">No cause meets the minimum records threshold</p>
                  ) : (
                    <div style={{ height: Math.max(sorted.length * 32, 200) }} role="img"
                      aria-label={`Bar chart of records per root cause. Highest: ${sorted[0].cause} with ${sorted[0].count} records.`}>
                      <Bar data={freqChart} options={barOpts(ctx => ` ${ctx.parsed.x.toLocaleString()} records (${(pct(ctx.parsed.x, filtered.length) ?? 0).toFixed(1)}%)`)} />
                    </div>
                  )}
                </section>

                <section className="card p-4" aria-labelledby="rca-cost">
                  <div className="flex items-center gap-2 mb-4">
                    <Coins size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
                    <h2 id="rca-cost" className="text-sm font-semibold text-[var(--text-primary)]">Financial impact by root cause</h2>
                    {moneyOk && <span className="text-xs text-[var(--text-dim)]">({currency})</span>}
                  </div>
                  {!moneyOk ? (
                    <p className="h-48 flex items-center justify-center text-center text-[var(--text-dim)] text-sm px-4">Cost is withheld: the records mix currencies. Pick one country.</p>
                  ) : costRanked.length === 0 ? (
                    <p className="h-48 flex items-center justify-center text-[var(--text-dim)] text-sm">No classified record carries a price</p>
                  ) : (
                    <div style={{ height: Math.max(costRanked.length * 32, 200) }} role="img"
                      aria-label={`Bar chart of cost per root cause. Highest: ${costRanked[0].cause}.`}>
                      <Bar data={costChart} options={barOpts(ctx => ` ${fmtMoney(ctx.parsed.x)}`)} />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-[var(--text-dim)]">A record matching several causes counts toward each of them.</p>
                </section>
              </div>

              {/* ── Heat map ── */}
              <section className="card p-4 space-y-3" aria-labelledby="rca-heat">
                <div className="flex items-center gap-2 flex-wrap">
                  <Layers size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
                  <h2 id="rca-heat" className="text-sm font-semibold text-[var(--text-primary)]">Site by root cause heat map</h2>
                  <span className="text-xs text-[var(--text-dim)]">(top {TOP_CAUSES_HEATMAP} causes, counts printed in each cell)</span>
                </div>
                <EnterpriseTable
                  columns={heatColumns}
                  data={heatmap.rows}
                  getRowId={r => r.site}
                  enableColumnFilters={false}
                  searchPlaceholder="Search sites"
                  initialPageSize={25}
                  exportFileName="root-cause-site-heatmap"
                  emptyMessage="No site carries a classified record"
                />
              </section>

              {/* ── Deep dive ── */}
              <section className="card p-4 space-y-4" aria-labelledby="rca-dive">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
                  <h2 id="rca-dive" className="text-sm font-semibold text-[var(--text-primary)]">Root cause deep dive</h2>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a root cause">
                  {ROOT_CAUSES.map(cause => {
                    const count = causeStats[cause]?.count || 0
                    const active = activeCause === cause
                    return (
                      <button key={cause} type="button" onClick={() => setActiveCause(cause)} aria-pressed={active}
                        className={`min-h-[44px] px-3 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors ${FOCUS} ${
                          active
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                            : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}>
                        {cause}
                        <span className="tabular-nums opacity-80">({count})</span>
                      </button>
                    )
                  })}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatTile label="Records" value={dive.count.toLocaleString()}
                    sub={dive.pct === null ? 'N/A of total' : `${dive.pct.toFixed(1)}% of records in view`} />
                  <StatTile label="Total cost" value={fmtMoney(dive.totalCost)}
                    sub={`${dive.pricedCount.toLocaleString()} of ${dive.count.toLocaleString()} priced`} />
                  <StatTile label="Cost per km" value={fmtCpk(dive.avgCPK)} sub="Priced tyres with a measured km life" />
                  <StatTile label="Top asset" value={dive.topAssets[0]?.name || 'N/A'}
                    sub={dive.topAssets[0] ? `${dive.topAssets[0].count} records` : 'No records'} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <RankList title="Top 5 affected assets" items={dive.topAssets} mono />
                  <RankList title="Top 5 affected brands" items={dive.topBrands} />
                  <RankList title="Top 5 affected sites" items={dive.topSites} />
                </div>

                {dive.prevention && (
                  <div className="rounded-lg p-3 flex gap-3 border border-amber-500/40 bg-[var(--input-bg)]">
                    <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Prevention recommendation</p>
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{dive.prevention}</p>
                    </div>
                  </div>
                )}

                <EnterpriseTable
                  columns={recordColumns}
                  data={dive.records}
                  getRowId={r => String(r.id)}
                  searchPlaceholder={`Search ${activeCause} records`}
                  initialPageSize={25}
                  exportFileName={`root-cause-${activeCause.toLowerCase().replace(/\s+/g, '-')}`}
                  emptyMessage={`No records classified under ${activeCause} with the current filters.`}
                />
              </section>

              {/* ── Worst vehicles ── */}
              <section className="card p-4 space-y-3" aria-labelledby="rca-worst">
                <div className="flex items-center gap-2">
                  <AlertOctagon size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
                  <h2 id="rca-worst" className="text-sm font-semibold text-[var(--text-primary)]">Worst vehicles by root cause matches</h2>
                  <span className="text-xs text-[var(--text-dim)]">(top 15)</span>
                </div>
                <EnterpriseTable
                  columns={worstColumns}
                  data={worst}
                  getRowId={r => r.asset_no}
                  enableColumnFilters={false}
                  searchPlaceholder="Search vehicles"
                  initialPageSize={25}
                  exportFileName="root-cause-worst-vehicles"
                  emptyMessage="No vehicle carries a classified record"
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
