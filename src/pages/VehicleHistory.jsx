import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import * as vehicleHistoryApi from '../lib/api/vehicleHistory'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import { useSettings } from '../contexts/SettingsContext'
import { computeAssetMetrics, bucketByMonth, countBy, sum } from '../lib/analyticsEngine'
import { detectAnomalies } from '../lib/anomalyEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { Search, AlertTriangle, X, FileText, Car, TrendingUp, History } from 'lucide-react'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { categorical, withAlpha, colorAt } from '../lib/reportColors'
import {
  windowRecords, groupByAsset, sitesOf, buildVehicleRows, scopeVehicleRows,
  filterVehicleRows, summarizeVehicles, misuseBand, timelineRows,
} from '../lib/vehicleHistoryAnalytics'
import { listAssetOptions } from '../lib/api/assetHistory'
import { canonAssetNo } from '../lib/assetHistory'
// The unified per-asset timeline lives in its own seam because Asset Detail
// renders it too. A page importing it from ANOTHER page would make one route
// depend on another's module graph.
import AssetFullHistory from '../components/asset/AssetFullHistory'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

// This page draws bars and doughnuts only. The line-chart elements the meter
// panel needs are registered by AssetFullHistory itself, so it stays correct
// wherever it is mounted rather than depending on its host.
ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

// ── Shared badge helpers ──────────────────────────────────────────────────────

const RISK_BADGE = {
  Critical: 'bg-red-900/50 text-red-300 border-red-700/50',
  High:     'bg-orange-900/50 text-orange-300 border-orange-700/50',
  Medium:   'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
  Low:      'bg-green-900/50 text-green-300 border-green-700/50',
  Unknown:  'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

function riskBadgeClass(level) {
  return RISK_BADGE[level] || RISK_BADGE.Unknown
}

function misuseBadgeClass(score) {
  if (score <= 25)  return 'bg-green-900/40 text-green-400 border-green-700/50'
  if (score <= 50)  return 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50'
  if (score <= 75)  return 'bg-orange-900/40 text-orange-400 border-orange-700/50'
  return 'bg-red-900/40 text-red-400 border-red-700/50'
}

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' } },
  },
}

const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: 'var(--text-muted)', font: { size: 11 }, padding: 10 } },
  },
}


// ── Flag type metadata ────────────────────────────────────────────────────────

const FLAG_META = {
  SHORT_INTERVAL:    { labelKey: 'shortInterval',    color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/40' },
  SAME_DAY_BURST:    { labelKey: 'sameDayBurst',      color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
  RAPID_RECURRENCE:  { labelKey: 'rapidRecurrence',   color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  COST_SPIKE:        { labelKey: 'costSpike',         color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
  SERIAL_REUSE:      { labelKey: 'serialReuse',       color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  DUPLICATE_ENTRY:   { labelKey: 'duplicateEntry',    color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/40' },
  LOW_KM_USAGE:      { labelKey: 'lowKmUsage',        color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
  INCONSISTENT_KM:   { labelKey: 'inconsistentKm',    color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  BUDGET_BREACH:     { labelKey: 'budgetBreach',      color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700/40' },
  LOW_KM_VS_POLICY:  { labelKey: 'lowKmVsPolicy',     color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/40' },
}

function getFlagMeta(type) {
  return FLAG_META[type] || { labelKey: null, label: type, color: 'text-muted', bg: 'bg-[var(--input-bg)] border-[var(--input-border)]' }
}

// ── Table column definitions ──────────────────────────────────────────────────

const NA = 'N/A'

function Count({ value, tone }) {
  if (!value) return <span className="text-dim text-xs">0</span>
  return <span className={`text-xs px-2 py-0.5 rounded-full ${tone}`}>{value}</span>
}

function vehicleTableColumns(t, currency) {
  return [
    {
      accessorKey: 'assetNo',
      header: t('vehiclehistory.table.assetNo'),
      cell: ({ getValue }) => <span className="font-mono text-xs text-blue-400 font-medium">{getValue()}</span>,
    },
    { accessorKey: 'count', header: t('vehiclehistory.table.replacements'), meta: { align: 'right' } },
    {
      accessorKey: 'totalCost',
      header: `${t('vehiclehistory.table.totalCost')} (${currency})`,
      meta: { align: 'right', exportValue: r => (r.totalCost == null ? '' : Math.round(r.totalCost)) },
      cell: ({ getValue }) => {
        const v = getValue()
        return v == null ? NA : Number(v).toLocaleString('en-SA', { maximumFractionDigits: 0 })
      },
    },
    {
      accessorKey: 'highRiskCount',
      header: t('vehiclehistory.table.highRisk'),
      meta: { align: 'right' },
      cell: ({ getValue }) => <Count value={getValue()} tone="bg-red-900/40 text-red-400" />,
    },
    {
      id: 'anomalyCount',
      accessorFn: r => r.anomalies.length,
      header: t('vehiclehistory.table.anomalies'),
      meta: { align: 'right' },
      cell: ({ getValue }) => <Count value={getValue()} tone="bg-orange-900/40 text-orange-400" />,
    },
    {
      accessorKey: 'avgDays',
      header: t('vehiclehistory.table.avgDaysRepl'),
      meta: { align: 'right', exportValue: r => (r.avgDays == null ? '' : r.avgDays) },
      cell: ({ getValue }) => (getValue() == null ? NA : `${getValue()}d`),
    },
    {
      accessorKey: 'lastSeen',
      header: t('vehiclehistory.table.lastReplacement'),
      cell: ({ getValue }) => getValue() || NA,
    },
    {
      accessorKey: 'misuseScore',
      header: t('vehiclehistory.table.misuseScore'),
      meta: { align: 'center', exportValue: r => `${r.misuseScore} (${misuseBand(r.misuseScore)?.label || ''})` },
      cell: ({ getValue }) => {
        const v = getValue()
        const band = misuseBand(v)
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${misuseBadgeClass(v)}`} title={band ? `${band.label} misuse risk` : undefined}>
            {v}<span className="sr-only"> {band?.label} misuse risk</span>
          </span>
        )
      },
    },
    {
      id: 'redFlags',
      accessorFn: r => r.allFlags.map(f => f.type).join(', '),
      header: t('vehiclehistory.table.redFlags'),
      enableSorting: false,
      cell: ({ row }) => {
        const flags = row.original.allFlags
        if (!flags.length) return <span className="text-dim text-xs">None</span>
        return (
          <div className="flex flex-wrap gap-1">
            {flags.slice(0, 3).map((f, i) => {
              const meta = getFlagMeta(f.type)
              return (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.bg} ${meta.color}`}>
                  {meta.labelKey ? t(`vehiclehistory.flagLabels.${meta.labelKey}`) : meta.label}
                </span>
              )
            })}
            {flags.length > 3 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[var(--input-bg)] text-muted border-[var(--input-border)]">
                +{flags.length - 3}
              </span>
            )}
          </div>
        )
      },
    },
  ]
}

function timelineColumns(t, currency) {
  return [
    {
      accessorKey: 'issue_date',
      header: t('vehiclehistory.timeline.columns.date'),
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.flagged && (
            <><AlertTriangle size={10} className="inline text-red-400 mr-1" aria-hidden="true" /><span className="sr-only">Flagged record: </span></>
          )}
          {row.original.issue_date || NA}
        </span>
      ),
    },
    { accessorKey: 'brand', header: t('vehiclehistory.timeline.columns.brand'), cell: ({ getValue }) => getValue() || NA },
    {
      accessorKey: 'description',
      header: t('vehiclehistory.timeline.columns.description'),
      cell: ({ getValue }) => <span className="block max-w-[180px] truncate" title={getValue() || ''}>{getValue() || NA}</span>,
    },
    { accessorKey: 'category', header: t('vehiclehistory.timeline.columns.category'), cell: ({ getValue }) => getValue() || NA },
    {
      accessorKey: 'risk_level',
      header: t('vehiclehistory.timeline.columns.risk'),
      cell: ({ getValue }) => (
        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${riskBadgeClass(getValue())}`}>{getValue() || 'Not rated'}</span>
      ),
    },
    {
      accessorKey: 'cost',
      header: `${t('vehiclehistory.timeline.columns.cost')} (${currency})`,
      meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? NA : Number(getValue()).toLocaleString()),
    },
    {
      accessorKey: 'km_run',
      header: t('vehiclehistory.timeline.columns.km'),
      meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? NA : `${Number(getValue()).toLocaleString()} km`),
    },
    { accessorKey: 'qty', header: t('vehiclehistory.timeline.columns.qty'), meta: { align: 'right' } },
    { accessorKey: 'site', header: t('vehiclehistory.timeline.columns.site'), cell: ({ getValue }) => getValue() || NA },
    {
      accessorKey: 'remarks',
      header: t('vehiclehistory.timeline.columns.remarks'),
      cell: ({ getValue }) => <span className="block max-w-[200px] truncate" title={getValue() || ''}>{getValue() || NA}</span>,
    },
  ]
}

// ── Detail Panel Tabs ─────────────────────────────────────────────────────────

// `fullHistory` leads deliberately: it is the ONLY tab that shows every record
// that ever touched the machine. The four that follow it are the pre-existing
// tyre-record views, which cover one source of sixteen.
const DETAIL_TABS = [
  { key: 'fullHistory',    labelKey: 'fullHistory',    label: 'Full history' },
  { key: 'timeline',       labelKey: 'timeline' },
  { key: 'analysis',       labelKey: 'analysis' },
  { key: 'redFlags',       labelKey: 'redFlags' },
  { key: 'relatedRecords', labelKey: 'relatedRecords' },
  { key: 'forecast',       labelKey: 'forecast' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────────────────

export default function VehicleHistory() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  // Actual cost only - records without a cost contribute 0, never a default.
  const dc = 0

  const [allRecords, setAllRecords]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [sites, setSites]             = useState([])
  const [selected, setSelected]       = useState(null)   // asset_no string
  // An asset opened from the FLEET-WIDE search. The table below lists only
  // assets that carry a tyre record (557 of the 1,377 in the register), so
  // without this the other 820 machines could not be opened from this page at
  // all and their history was unreachable.
  const [directAsset, setDirectAsset] = useState(null)

  // Fleet master data
  const [fleetMap, setFleetMap] = useState({})   // asset_no -> vehicle_fleet row

  // Authoritative tyre spend from the expense grid. costTyreTotal = fleet/country
  // total (loadCostSplit.tyre, legacy-fallback baked in). gridByAsset = per-asset
  // map for reconciling each row's Total Cost; null when the grid is unavailable.
  const [costTyreTotal, setCostTyreTotal] = useState(null)
  const [gridByAsset, setGridByAsset]     = useState(null)

  // Filters
  const [search, setSearch]               = useState('')
  const [siteFilter, setSiteFilter]       = useState('')
  // Client-side issue_date range windowing the per-vehicle roll-ups. Anomalies
  // always evaluate FULL history regardless of this range.
  const [fromDate, setFromDate]           = useState('')
  const [toDate, setToDate]               = useState('')
  const [anomalyFilter, setAnomalyFilter] = useState('all')  // 'all' | 'has' | 'clean'
  const [sortBy, setSortBy]               = useState('misuse') // 'misuse' | 'cost' | 'count' | 'date'

  // Related records state
  const [relatedActions, setRelatedActions]         = useState([])
  const [relatedRca, setRelatedRca]                 = useState([])
  const [relatedInspections, setRelatedInspections] = useState([])

  // Tyre positions for SVG diagram
  const [tyrePositions, setTyrePositions] = useState([])

  // Bump to re-run the loader (Retry).
  const [reloadKey, setReloadKey] = useState(0)

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data } = await vehicleHistoryApi.listFleetTyreRecords({ country: activeCountry })
        if (cancelled) return
        const rows = data || []
        setAllRecords(rows)
        setSites(sitesOf(rows))

        // Load fleet master data
        const { data: fleetData } = await vehicleHistoryApi.getVehicleFleet()
        if (cancelled) return
        const map = {}
        ;(fleetData || []).forEach(v => { map[v.asset_no] = v })
        setFleetMap(map)

        // Authoritative tyre spend (fleet total + per-asset) from the expense grid.
        // Both helpers never throw and fall back internally; scoped to the country.
        const [splitRes, gridRes] = await Promise.all([
          loadGovernedCostSplit({ country: activeCountry, maxAgeMs: COST_SPLIT_TTL_MS }).catch(() => null),
          loadGridTyreByAsset({ country: activeCountry }).catch(() => null),
        ])
        if (cancelled) return
        setCostTyreTotal(splitRes ? splitRes.tyre : null)
        setGridByAsset(gridRes)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Could not load vehicle history.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry, reloadKey])

  // ── Detect anomalies across full fleet ───────────────────────────────────────
  // Deliberately over the FULL unfiltered history: the date range below only
  // windows the per-vehicle roll-up numbers, never the anomaly evaluation.
  const allAnomalies = useMemo(() => {
    if (!allRecords.length) return []
    return detectAnomalies(allRecords)
  }, [allRecords])

  // ── Date-range window (string-safe on 'YYYY-MM-DD' prefixes) ────────────────
  const rangeActive = Boolean(fromDate || toDate)
  const windowedRecords = useMemo(() => windowRecords(allRecords, fromDate, toDate), [allRecords, fromDate, toDate])

  // Full-history records per asset, so red-flag evaluation is never windowed.
  const fullRecordsByAsset = useMemo(() => groupByAsset(allRecords), [allRecords])

  // ── Compute asset metrics (windowed roll-ups: count, km, cost) ──────────────
  const assetMetrics = useMemo(() => computeAssetMetrics(windowedRecords, dc), [windowedRecords, dc])

  // ── Build per-asset enriched rows (engine: src/lib/vehicleHistoryAnalytics) ─
  const vehicleRows = useMemo(() => buildVehicleRows({
    assetMetrics, anomalies: allAnomalies, fleetMap, gridByAsset, fullRecordsByAsset, rangeActive,
  }), [assetMetrics, allAnomalies, fleetMap, gridByAsset, fullRecordsByAsset, rangeActive])

  // `scopedRows` applies the POPULATION filters (search, site); the summary
  // strip computes over it. The anomaly select is held out on purpose: two of
  // the tiles ARE the anomaly dimension, and filtering them by it would only
  // echo the table back.
  const scopedRows = useMemo(() => scopeVehicleRows(vehicleRows, { search, site: siteFilter }), [vehicleRows, search, siteFilter])
  const scopeActive = Boolean(search || siteFilter)
  const filteredRows = useMemo(() => filterVehicleRows(scopedRows, { anomaly: anomalyFilter, sortBy }), [scopedRows, anomalyFilter, sortBy])
  const summary = useMemo(() => summarizeVehicles(scopedRows, { costTotal: costTyreTotal, rangeActive, scopeActive }), [scopedRows, costTyreTotal, rangeActive, scopeActive])

  const vehicleColumns = useMemo(() => vehicleTableColumns(t, activeCurrency), [t, activeCurrency])

  const selectedRow = selected ? vehicleRows.find(r => r.assetNo === selected) : null

  // ── Load related records when asset selected ─────────────────────────────────
  useEffect(() => {
    if (!selected) {
      setRelatedActions([])
      setRelatedRca([])
      setRelatedInspections([])
      setTyrePositions([])
      return
    }
    let cancelled = false
    async function loadRelated() {
      const [actRes, rcaRes, insRes, tyreRes] = await Promise.all([
        vehicleHistoryApi.listAssetActions(selected, { country: activeCountry }),
        vehicleHistoryApi.listAssetRca(selected, { country: activeCountry }),
        vehicleHistoryApi.listAssetInspections(selected, { country: activeCountry }),
        vehicleHistoryApi.listAssetTyreRecords(selected, { country: activeCountry }),
      ])
      if (cancelled) return
      const failed = [actRes, rcaRes, insRes, tyreRes].find(r => r.error)
      if (failed) setError(toUserMessage(failed.error, 'Some related asset history could not be loaded.'))
      setRelatedActions(actRes.data || [])
      setRelatedRca(rcaRes.data || [])
      setRelatedInspections(insRes.data || [])

      const rows = tyreRes.data || []
      const latestPerPosition = Object.values(
        rows.reduce((acc, r) => {
          if (r.position && !acc[r.position]) acc[r.position] = r
          return acc
        }, {})
      )
      setTyrePositions(latestPerPosition)
    }
    setRelatedActions([]); setRelatedRca([]); setRelatedInspections([]); setTyrePositions([])
    loadRelated().catch(err => { if (!cancelled) setError(toUserMessage(err, 'Could not load related asset history.')) })
    return () => { cancelled = true }
  }, [selected, activeCountry])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <div className="text-center">
          <Car size={40} className="mx-auto mb-3 opacity-40" />
          <p>{t('vehiclehistory.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('vehiclehistory.header.title')}
        subtitle={t('vehiclehistory.header.subtitle')}
        icon={Car}
      />

      {error && (
        <div className="card border border-red-500/30 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300 flex-1">{error}</p>
          <button onClick={() => setReloadKey(k => k + 1)} className="btn-secondary text-xs px-3 py-1.5 min-h-[44px]">Retry</button>
        </div>
      )}

      {/* Open ANY asset in the register, not only the ones with tyre records */}
      <AssetOpener
        country={activeCountry}
        onOpen={(assetNo) => {
          const code = canonAssetNo(assetNo)
          // Prefer the full analysis panel when the asset also has tyre
          // records; otherwise open the history-only panel rather than
          // selecting a row that does not exist.
          const known = vehicleRows.some(r => canonAssetNo(r.assetNo) === code)
          if (known) { setSelected(assetNo); setDirectAsset(null) }
          else { setDirectAsset(assetNo); setSelected(null) }
        }}
      />

      {directAsset && (
        <DirectAssetPanel
          assetNo={directAsset}
          country={activeCountry}
          onClose={() => setDirectAsset(null)}
        />
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('vehiclehistory.summary.totalVehicles'),  value: summary.vehicles.toLocaleString(),      color: 'text-blue-400' },
          { label: t('vehiclehistory.summary.withAnomalies'),  value: summary.withAnomalies.toLocaleString(), color: 'text-orange-400' },
          { label: t('vehiclehistory.summary.highMisuseRisk'), value: summary.highMisuse.toLocaleString(),    color: 'text-red-400' },
          {
            label: t('vehiclehistory.summary.totalFleetCost'),
            // Authoritative fleet tyre spend from the expense grid when the view
            // is the whole unwindowed fleet; otherwise the sum of the rows shown.
            value: summary.totalCost == null ? 'N/A' : `${activeCurrency} ${Math.round(summary.totalCost).toLocaleString()}`,
            color: 'text-green-400',
            hint: summary.costBasis === 'grid' ? 'From the expense grid' : 'From tyre records in scope',
          },
        ].map(({ label, value, color, hint }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="card text-center"
          >
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-muted text-sm mt-1">{label}</p>
            {hint && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{hint}</p>}
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-0 basis-full sm:basis-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              aria-label={t('vehiclehistory.filters.searchPlaceholder')}
              placeholder={t('vehiclehistory.filters.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select aria-label="Site" className="input w-full sm:w-40" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
            <option value="">{t('vehiclehistory.filters.allSites')}</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Anomaly filter" className="input w-full sm:w-44" value={anomalyFilter} onChange={e => setAnomalyFilter(e.target.value)}>
            <option value="all">{t('vehiclehistory.filters.allVehicles')}</option>
            <option value="has">{t('vehiclehistory.filters.hasAnomalies')}</option>
            <option value="clean">{t('vehiclehistory.filters.clean')}</option>
          </select>
          <select aria-label="Sort vehicles by" className="input w-full sm:w-52" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="misuse">{t('vehiclehistory.filters.sortMisuse')}</option>
            <option value="cost">{t('vehiclehistory.filters.sortCost')}</option>
            <option value="count">{t('vehiclehistory.filters.sortCount')}</option>
            <option value="date">{t('vehiclehistory.filters.sortDate')}</option>
          </select>
          <DateField className="text-sm w-40" value={fromDate} onChange={setFromDate} placeholder="From date" ariaLabel="From date" />
          <DateField className="text-sm w-40" value={toDate} onChange={setToDate} placeholder="To date" ariaLabel="To date" min={fromDate || undefined} />
          {rangeActive && (
            <button
              onClick={() => { setFromDate(''); setToDate('') }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline self-center min-h-[44px] px-2 focus-visible:outline focus-visible:outline-2"
            >
              Clear dates
            </button>
          )}
        </div>
        {(rangeActive || scopeActive || anomalyFilter !== 'all') && (
          <p className="text-[11px] text-[var(--text-muted)] mt-2">
            {rangeActive && 'Date range windows the per-vehicle roll-ups (tyre counts, km and cost from tyre records). Anomalies always evaluate full history; the expense-grid cost total is not applied inside a range. '}
            {scopeActive && `The summary above covers the ${scopedRows.length} of ${vehicleRows.length} vehicles matching the search and site filters. `}
            {anomalyFilter !== 'all' && 'The anomaly filter shapes the table only, so the summary still states how many vehicles are flagged overall in this scope.'}
          </p>
        )}
      </div>

      {/* Vehicle fleet table */}
      <EnterpriseTable
        columns={vehicleColumns}
        data={filteredRows}
        getRowId={r => r.assetNo}
        loading={loading}
        error={allRecords.length === 0 ? error : null}
        onRetry={() => setReloadKey(k => k + 1)}
        emptyMessage={t('vehiclehistory.table.noMatch')}
        searchPlaceholder="Search this table"
        onRowClick={row => setSelected(selected === row.assetNo ? null : row.assetNo)}
        viewKey="vehicle-history"
        exportFileName={`Vehicle History ${new Date().toISOString().slice(0, 10)}`}
        reportMeta={{ title: 'Vehicle History', currency: activeCurrency, dateRange: rangeActive ? `${fromDate || 'start'} to ${toDate || 'today'}` : undefined }}
      />

      {/* Vehicle detail panel */}
      {selectedRow && (
        <VehicleDetailPanel
          row={selectedRow}
          currency={activeCurrency}
          defaultCost={dc}
          onClose={() => setSelected(null)}
          relatedActions={relatedActions}
          relatedRca={relatedRca}
          relatedInspections={relatedInspections}
          fleetRecord={selectedRow.fleetRecord}
          tyrePositions={tyrePositions}
          country={activeCountry}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle Detail Panel
// ─────────────────────────────────────────────────────────────────────────────

function VehicleDetailPanel({ row, currency, defaultCost, onClose, relatedActions, relatedRca, relatedInspections, fleetRecord, tyrePositions, country }) {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState('fullHistory')

  // Build set of flagged record IDs for highlighting in timeline
  const flaggedIds = useMemo(() => {
    const ids = new Set()
    row.allFlags.forEach(f => f.record_ids?.forEach(id => ids.add(id)))
    return ids
  }, [row.allFlags])

  // Sorted records oldest-first for timeline
  const timelineRecords = useMemo(() =>
    [...row.records].sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date)),
    [row.records]
  )

  // Analysis data
  const monthlyBuckets = useMemo(() =>
    bucketByMonth(row.records, r => r.issue_date, r => (r.cost_per_tyre || defaultCost) * (r.qty || 1)),
    [row.records, defaultCost]
  )

  const categoryBreakdown = useMemo(() =>
    countBy(row.records.filter(r => r.category), r => r.category),
    [row.records]
  )

  const brandBreakdown = useMemo(() =>
    countBy(row.records.filter(r => r.brand), r => r.brand),
    [row.records]
  )

  const totalCost   = row.totalCost
  const avgCostTyre = row.count > 0 ? totalCost / row.count : 0
  const highRiskPct = row.count > 0 ? (row.highRiskCount / row.count) * 100 : 0

  const kmValues = row.records
    .map(r => (r.km_at_removal != null && r.km_at_fitment != null)
      ? +r.km_at_removal - +r.km_at_fitment : null)
    .filter(v => v !== null && v > 0)
  const avgKm = kmValues.length ? Math.round(kmValues.reduce((s, v) => s + v, 0) / kmValues.length) : null

  // PDF export
  async function handleExportPdf() {
    const { exportToPdf } = await loadExportUtils()
    const cols = [
      { key: 'issue_date',      header: 'Date',             width: 22 },
      { key: 'brand',           header: 'Brand',            width: 24 },
      { key: 'serial_no',       header: 'Serial No',        width: 28 },
      { key: 'category',        header: 'Category',         width: 30 },
      { key: 'risk_level',      header: 'Risk',             width: 18 },
      { key: 'cost_display',    header: `Cost (${currency})`, width: 22 },
      { key: 'site',            header: 'Site',             width: 26 },
      { key: 'remarks_cleaned', header: 'Remarks',          width: 40 },
    ]
    const pdfRows = timelineRecords.map(r => ({
      ...r,
      cost_display: ((r.cost_per_tyre || defaultCost) * (r.qty || 1)).toLocaleString(),
    }))
    exportToPdf(
      pdfRows, cols,
      `Vehicle Asset History: ${row.assetNo} (${row.count} records, Misuse Score: ${row.misuseScore})`,
      `VehicleHistory_${row.assetNo}_${new Date().toISOString().slice(0, 10)}`
    )
  }

  return (
    <div className="card border border-blue-500/30 space-y-5">
      {/* Panel header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[var(--text-primary)] font-bold text-xl font-mono">{row.assetNo}</h2>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${misuseBadgeClass(row.misuseScore)}`}>
              {t('vehiclehistory.detail.misuseRisk', { score: row.misuseScore })}
            </span>
            {row.allFlags.length > 0 && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/40">
                <AlertTriangle size={11} /> {t('vehiclehistory.detail.redFlagCount', { count: row.allFlags.length })}
              </span>
            )}
          </div>
          <p className="text-muted text-sm mt-1.5">
            {row.sites.slice(0, 3).join(' · ')}
            {row.lastSeen ? ` · ${t('vehiclehistory.detail.lastReplaced', { date: row.lastSeen })}` : ''}
          </p>
          <p className="text-muted text-xs mt-0.5">
            {t('vehiclehistory.detail.replacementsSummary', { count: row.count, currency, cost: totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 }) })}
            {row.firstSeen ? ` · ${t('vehiclehistory.detail.since', { date: row.firstSeen })}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportPdf} className="btn-secondary flex items-center gap-2 text-xs">
            <FileText size={13} className="text-red-400" /> {t('vehiclehistory.detail.exportPdf')}
          </button>
          <button onClick={onClose} className="btn-secondary flex items-center gap-1.5 text-xs">
            <X size={13} /> {t('vehiclehistory.detail.close')}
          </button>
        </div>
      </div>

      {/* Vehicle Specs row */}
      {fleetRecord ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted mr-1">{t('vehiclehistory.detail.vehicleSpecs')}</span>
          {fleetRecord.make && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 border border-blue-700/40 text-blue-300">
              <span className="text-muted mr-1">{t('vehiclehistory.detail.make')}</span>{fleetRecord.make}
            </span>
          )}
          {fleetRecord.model && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 border border-blue-700/40 text-blue-300">
              <span className="text-muted mr-1">{t('vehiclehistory.detail.model')}</span>{fleetRecord.model}
            </span>
          )}
          {fleetRecord.year && (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-secondary">
              <span className="text-muted mr-1">{t('vehiclehistory.detail.year')}</span>{fleetRecord.year}
            </span>
          )}
          {fleetRecord.vehicle_type && (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-secondary">
              <span className="text-muted mr-1">{t('vehiclehistory.detail.type')}</span>{fleetRecord.vehicle_type}
            </span>
          )}
          {fleetRecord.operator_name && (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-secondary">
              <span className="text-muted mr-1">{t('vehiclehistory.detail.operator')}</span>{fleetRecord.operator_name}
            </span>
          )}
          {fleetRecord.current_km != null && fleetRecord.current_km !== '' && (
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/30 border border-emerald-700/40 text-emerald-300">
              <span className="text-muted mr-1">{t('vehiclehistory.detail.currentKm')}</span>{Number(fleetRecord.current_km).toLocaleString()} km
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-dim">
          {t('vehiclehistory.detail.noFleetRecord')}{' '}
          <a href="/fleet-master" className="text-blue-500 hover:text-blue-400 underline">
            {t('vehiclehistory.detail.addInFleetMaster')}
          </a>
        </p>
      )}

      {/* Tyre Position Overview */}
      {fleetRecord?.vehicle_type && (
        <div className="card">
          <p className="text-sm font-semibold text-secondary mb-4">{t('vehiclehistory.detail.tyrePositionOverview')}</p>
          <div className="flex flex-wrap gap-8 items-start">
            <VehicleTyreDiagram
              positions={tyrePositions}
              vehicleType={fleetRecord.vehicle_type}
            />
            <div className="flex-1 min-w-48">
              <p className="text-xs text-muted mb-3">{t('vehiclehistory.detail.riskLevelByPosition')}</p>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: t('vehiclehistory.detail.riskLow'),      color: '#16a34a', isNoData: false },
                  { label: t('vehiclehistory.detail.riskMedium'),   color: '#ca8a04', isNoData: false },
                  { label: t('vehiclehistory.detail.riskHigh'),     color: '#ea580c', isNoData: false },
                  { label: t('vehiclehistory.detail.riskCritical'), color: '#dc2626', isNoData: false },
                  { label: t('vehiclehistory.detail.noData'),       color: 'var(--text-dim)', isNoData: true },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color, opacity: item.isNoData ? 0.4 : 1 }}
                    />
                    <span className="text-xs text-muted">{item.label}</span>
                  </div>
                ))}
              </div>
              {tyrePositions.length > 0 && (
                <div className="mt-4 space-y-1">
                  <p className="text-xs text-muted mb-2">{t('vehiclehistory.detail.currentTyreData')}</p>
                  {tyrePositions.filter(p => p.risk_level).map(p => (
                    <div key={p.position} className="flex items-center gap-2 text-xs">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }[p.risk_level] ?? 'var(--text-dim)' }}
                      />
                      <span className="font-mono text-muted w-16">{p.position}</span>
                      <span className="text-muted">{p.brand || 'N/A'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Red flags alert box */}
      {row.allFlags.length > 0 && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-red-400 font-semibold text-sm">{t('vehiclehistory.detail.redFlagsDetected')}</p>
          </div>
          <div className="space-y-2">
            {row.allFlags.map((flag, i) => {
              const meta = getFlagMeta(flag.type)
              const flagLabel = meta.labelKey ? t(`vehiclehistory.flagLabels.${meta.labelKey}`) : meta.label
              return (
                <div key={i} className={`rounded p-2.5 border text-xs ${meta.bg}`}>
                  <span className={`font-semibold ${meta.color}`}>[{flagLabel}]</span>
                  <span className="text-secondary ml-2">{flag.message}</span>
                  {flag.detail && <p className="text-muted mt-0.5 text-[11px]">{flag.detail}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs. Keyed by tab KEY, not index: an index-keyed switch silently
          renders the wrong panel the moment a tab is inserted. */}
      <div className="flex border-b border-[var(--input-border)] gap-1 flex-wrap">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-muted hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.key === 'forecast' && <TrendingUp size={13} />}
            {tab.key === 'fullHistory' && <History size={13} />}
            {tab.label || t(`vehiclehistory.tabs.${tab.labelKey}`)}
            {tab.key === 'redFlags' && row.allFlags.length > 0 && (
              <span className="ml-1.5 text-xs bg-red-600 text-white rounded-full px-1.5 py-0.5 font-bold">
                {row.allFlags.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Full history - every source, one timeline */}
      {activeTab === 'fullHistory' && (
        <AssetFullHistory assetNo={row.assetNo} country={country} />
      )}

      {/* Tab: Timeline */}
      {activeTab === 'timeline' && (
        <TimelineTab
          records={timelineRecords}
          flaggedIds={flaggedIds}
          currency={currency}
          assetNo={row.assetNo}
        />
      )}

      {/* Tab: Analysis */}
      {activeTab === 'analysis' && (
        <AnalysisTab
          monthlyBuckets={monthlyBuckets}
          categoryBreakdown={categoryBreakdown}
          brandBreakdown={brandBreakdown}
          totalCost={totalCost}
          avgCostTyre={avgCostTyre}
          highRiskPct={highRiskPct}
          avgKm={avgKm}
          currency={currency}
        />
      )}

      {/* Tab: Red Flags */}
      {activeTab === 'redFlags' && (
        <RedFlagsTab flags={row.allFlags} />
      )}

      {/* Tab: Related Records */}
      {activeTab === 'relatedRecords' && (
        <RelatedTab
          assetNo={row.assetNo}
          actions={relatedActions}
          rca={relatedRca}
          inspections={relatedInspections}
        />
      )}

      {/* Tab: Forecast */}
      {activeTab === 'forecast' && (
        <ForecastTab
          row={row}
          tyrePositions={tyrePositions}
          currency={currency}
          defaultCost={defaultCost}
          fleetRecord={fleetRecord}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Timeline
// ─────────────────────────────────────────────────────────────────────────────

function TimelineTab({ records, flaggedIds, currency, assetNo }) {
  const { t } = useLanguage()
  const rows = useMemo(() => timelineRows(records, flaggedIds), [records, flaggedIds])
  const columns = useMemo(() => timelineColumns(t, currency), [t, currency])
  return (
    <EnterpriseTable
      columns={columns}
      data={rows}
      getRowId={r => r.id}
      emptyMessage={t('vehiclehistory.timeline.noRecords')}
      searchPlaceholder="Search this timeline"
      initialPageSize={25}
      exportFileName={`Vehicle Timeline ${assetNo || ''} ${new Date().toISOString().slice(0, 10)}`.trim()}
      reportMeta={{ title: `Tyre timeline ${assetNo || ''}`.trim(), currency }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Analysis
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisTab({ monthlyBuckets, categoryBreakdown, brandBreakdown, totalCost, avgCostTyre, highRiskPct, avgKm, currency }) {
  const { t } = useLanguage()
  const costByMonth = {
    labels: monthlyBuckets.map(b => b.month),
    datasets: [{
      label: t('vehiclehistory.analysis.costSeries', { currency }),
      data: monthlyBuckets.map(b => Math.round(b.total)),
      backgroundColor: withAlpha(colorAt(0), 0.7),
      borderRadius: 4,
    }],
  }

  const catData = {
    labels: categoryBreakdown.slice(0, 8).map(c => c.key),
    datasets: [{
      data: categoryBreakdown.slice(0, 8).map(c => c.count),
      backgroundColor: categorical(Math.min(8, categoryBreakdown.length)),
    }],
  }

  const brandData = {
    labels: brandBreakdown.slice(0, 8).map(b => b.key),
    datasets: [{
      label: t('vehiclehistory.analysis.usageCount'),
      data: brandBreakdown.slice(0, 8).map(b => b.count),
      backgroundColor: withAlpha(colorAt(1), 0.7),
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('vehiclehistory.analysis.stats.totalCost'),      value: `${currency} ${Math.round(totalCost).toLocaleString()}`,    color: 'text-blue-400' },
          { label: t('vehiclehistory.analysis.stats.avgCostTyre'),   value: `${currency} ${Math.round(avgCostTyre).toLocaleString()}`,  color: 'text-green-400' },
          { label: t('vehiclehistory.analysis.stats.highRiskPct'),     value: `${highRiskPct.toFixed(1)}%`,                               color: highRiskPct > 30 ? 'text-red-400' : 'text-yellow-400' },
          { label: avgKm !== null ? t('vehiclehistory.analysis.stats.avgKmTyre') : t('vehiclehistory.analysis.stats.kmData'), value: avgKm !== null ? `${avgKm.toLocaleString()} km` : t('vehiclehistory.analysis.stats.na'), color: 'text-purple-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg p-4 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-muted text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-muted mb-2">{t('vehiclehistory.analysis.costByMonth', { currency })}</p>
          {monthlyBuckets.length > 0 ? (
            <div style={{ height: 200 }}>
              <Bar data={costByMonth} options={BAR_OPTS} />
            </div>
          ) : (
            <p className="text-dim text-xs text-center py-10">{t('vehiclehistory.analysis.noMonthlyData')}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted mb-2">{t('vehiclehistory.analysis.failureCategoryBreakdown')}</p>
          {categoryBreakdown.length > 0 ? (
            <div style={{ height: 200 }}>
              <Doughnut data={catData} options={DOUGHNUT_OPTS} />
            </div>
          ) : (
            <p className="text-dim text-xs text-center py-10">{t('vehiclehistory.analysis.noCategoryData')}</p>
          )}
        </div>
      </div>

      {/* Brand chart */}
      <div>
        <p className="text-xs text-muted mb-2">{t('vehiclehistory.analysis.brandUsageFrequency')}</p>
        {brandBreakdown.length > 0 ? (
          <div style={{ height: 180 }}>
            <Bar data={brandData} options={BAR_OPTS} />
          </div>
        ) : (
          <p className="text-dim text-xs text-center py-10">{t('vehiclehistory.analysis.noBrandData')}</p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Red Flags
// ─────────────────────────────────────────────────────────────────────────────

const FLAG_RECOMMENDATION_KEYS = {
  SERIAL_REUSE:     'serialReuse',
  DUPLICATE_ENTRY:  'duplicateEntry',
  SHORT_INTERVAL:   'shortInterval',
  SAME_DAY_BURST:   'sameDayBurst',
  RAPID_RECURRENCE: 'rapidRecurrence',
  COST_SPIKE:       'costSpike',
  LOW_KM_USAGE:     'lowKmUsage',
  INCONSISTENT_KM:  'inconsistentKm',
  BUDGET_BREACH:    'budgetBreach',
  LOW_KM_VS_POLICY: 'lowKmVsPolicy',
}

function RedFlagsTab({ flags }) {
  const { t } = useLanguage()
  if (flags.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center gap-2 text-green-400 bg-green-900/20 border border-green-700/30 rounded-full px-4 py-2 text-sm">
          {t('vehiclehistory.redFlagsTab.none')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {flags.map((flag, i) => {
        const meta     = getFlagMeta(flag.type)
        const flagLabel = meta.labelKey ? t(`vehiclehistory.flagLabels.${meta.labelKey}`) : meta.label
        const recKey   = FLAG_RECOMMENDATION_KEYS[flag.type] || 'default'
        const rec      = t(`vehiclehistory.recommendations.${recKey}`)
        const sevLabel = flag.severity === 'high' ? t('vehiclehistory.redFlagsTab.severityHigh') : flag.severity === 'medium' ? t('vehiclehistory.redFlagsTab.severityMedium') : t('vehiclehistory.redFlagsTab.severityLow')
        const sevClass = flag.severity === 'high'
          ? 'bg-red-900/40 text-red-400 border-red-700/50'
          : flag.severity === 'medium'
          ? 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50'
          : 'bg-green-900/40 text-green-400 border-green-700/50'

        return (
          <div key={i} className={`rounded-lg border p-4 space-y-2 ${meta.bg}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${sevClass}`}>{sevLabel}</span>
              <span className={`font-semibold text-sm ${meta.color}`}>{flagLabel}</span>
            </div>
            <p className="text-secondary text-sm">{flag.message}</p>
            {flag.detail && <p className="text-muted text-xs">{flag.detail}</p>}
            {flag.records && flag.records.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] text-dim">{t('vehiclehistory.redFlagsTab.affectedRecords')}</span>
                {flag.records.slice(0, 5).map(r => (
                  <span key={r.id} className="text-[10px] font-mono text-muted bg-[var(--input-bg)] px-1.5 py-0.5 rounded">
                    {r.issue_date || r.id?.slice(0, 8)}
                  </span>
                ))}
              </div>
            )}
            <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs text-muted">
                <span className="text-dim font-medium">{t('vehiclehistory.redFlagsTab.recommendation')}</span>{rec}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Related Records
// ─────────────────────────────────────────────────────────────────────────────

function RelatedTab({ assetNo, actions, rca, inspections }) {
  const { t } = useLanguage()
  const hasAny = actions.length > 0 || rca.length > 0 || inspections.length > 0

  if (!hasAny) {
    return (
      <div className="text-center py-10 text-muted text-sm">
        {t('vehiclehistory.related.noneFound')}{' '}
        <span className="font-mono text-muted">{assetNo}</span>.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Corrective Actions */}
      {actions.length > 0 && (
        <div>
          <p className="text-sm font-medium text-secondary mb-3">{t('vehiclehistory.related.correctiveActions', { count: actions.length })}</p>
          <div className="space-y-2">
            {actions.map(a => (
              <div key={a.id} className="flex items-center gap-3 bg-[var(--input-bg)] rounded-lg px-4 py-2.5 text-sm flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  a.status === 'Closed'
                    ? 'bg-green-900/30 text-green-400 border-green-700/40'
                    : 'bg-yellow-900/30 text-yellow-400 border-yellow-700/40'
                }`}>{a.status || 'N/A'}</span>
                <span className="text-secondary flex-1">{a.title || t('vehiclehistory.related.noTitle')}</span>
                {a.site && <span className="text-muted text-xs">{a.site}</span>}
                {a.priority && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${riskBadgeClass(a.priority)}`}>
                    {a.priority}
                  </span>
                )}
                {a.due_date && <span className="text-dim text-xs">{a.due_date}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RCA Records */}
      {rca.length > 0 && (
        <div>
          <p className="text-sm font-medium text-secondary mb-3">{t('vehiclehistory.related.rootCauseAnalysis', { count: rca.length })}</p>
          <div className="space-y-2">
            {rca.map(r => (
              <div key={r.id} className="flex items-center gap-3 bg-[var(--input-bg)] rounded-lg px-4 py-2.5 text-sm flex-wrap">
                <span className="font-mono text-xs text-blue-400">{r.tyre_serial || 'N/A'}</span>
                <span className="text-secondary flex-1">{r.root_cause || t('vehiclehistory.related.noRootCause')}</span>
                {r.brand && <span className="text-muted text-xs">{r.brand}</span>}
                {r.site  && <span className="text-muted text-xs">{r.site}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inspections */}
      {inspections.length > 0 && (
        <div>
          <p className="text-sm font-medium text-secondary mb-3">{t('vehiclehistory.related.inspections', { count: inspections.length })}</p>
          <div className="space-y-2">
            {inspections.map(r => (
              <div key={r.id} className="flex items-center gap-3 bg-[var(--input-bg)] rounded-lg px-4 py-2.5 text-sm flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  r.status === 'Completed'
                    ? 'bg-green-900/30 text-green-400 border-green-700/40'
                    : 'bg-blue-900/30 text-blue-400 border-blue-700/40'
                }`}>{r.status || 'N/A'}</span>
                <span className="text-secondary flex-1 font-mono text-xs">{r.id?.slice(0, 12)}...</span>
                {r.site && <span className="text-muted text-xs">{r.site}</span>}
                <span className="text-dim text-xs">{r.created_at?.slice(0, 10) || 'N/A'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Forecast
// ─────────────────────────────────────────────────────────────────────────────

function computeHealthScore(position) {
  let score = 100

  // Risk level deduction
  const riskDeductions = { Critical: -40, High: -25, Medium: -10, Low: 0 }
  score += riskDeductions[position.risk_level] ?? 0

  // Age deduction: each 30 days past 180 days = -5, capped at -30
  if (position.issue_date) {
    const daysSince = Math.floor((Date.now() - new Date(position.issue_date).getTime()) / (1000 * 60 * 60 * 24))
    if (daysSince > 180) {
      const periodsOver = Math.floor((daysSince - 180) / 30)
      score += Math.max(-30, periodsOver * -5)
    }
  }

  return Math.max(0, Math.min(100, score))
}

function healthScoreColor(score) {
  if (score <= 25) return { bar: 'bg-red-500', text: 'text-red-400', border: 'border-red-700/50', bg: 'bg-red-900/20' }
  if (score <= 50) return { bar: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-700/50', bg: 'bg-orange-900/20' }
  if (score <= 75) return { bar: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-700/50', bg: 'bg-yellow-900/20' }
  return { bar: 'bg-green-500', text: 'text-green-400', border: 'border-green-700/50', bg: 'bg-green-900/20' }
}

function urgencyFromHealth(score) {
  if (score < 25) return { labelKey: 'urgentLabel', cls: 'bg-red-900/50 text-red-300 border-red-700/50' }
  if (score <= 50) return { labelKey: 'soonLabel', cls: 'bg-orange-900/50 text-orange-300 border-orange-700/50' }
  return { labelKey: 'monitorLabel', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/40' }
}

function replacementReasonKey(position, healthScore) {
  if (position.risk_level === 'Critical') return 'reasonCritical'
  if (position.risk_level === 'High') return 'reasonHigh'
  if (healthScore < 25) return 'reasonLowHealth'
  if (healthScore <= 50) return 'reasonDeclining'
  return 'reasonMonitor'
}

function ForecastTab({ row, tyrePositions, currency, defaultCost, fleetRecord }) {
  const { t } = useLanguage()
  // Derive avgKm from records with km data
  const kmValues = row.records
    .map(r => (r.km_at_removal != null && r.km_at_fitment != null)
      ? +r.km_at_removal - +r.km_at_fitment : null)
    .filter(v => v !== null && v > 0)
  const avgKm = kmValues.length
    ? Math.round(kmValues.reduce((s, v) => s + v, 0) / kmValues.length)
    : null

  const spanMonths = row.spanMonths > 0 ? row.spanMonths : null
  const avgMonthlyKm = avgKm !== null && spanMonths ? avgKm / spanMonths : null

  const expectedKmPerTyre = fleetRecord?.expected_km_per_tyre
    ? +fleetRecord.expected_km_per_tyre
    : 60000

  // Per-position health scores
  const positionScores = tyrePositions.map(p => ({
    ...p,
    healthScore: computeHealthScore(p),
  }))

  // Monthly cost average
  const avgMonthlyCost = spanMonths && row.totalCost > 0
    ? Math.round(row.totalCost / spanMonths)
    : null

  const monthlyBudget = fleetRecord?.monthly_tyre_budget
    ? +fleetRecord.monthly_tyre_budget
    : null

  // Top 3 action recommendations
  const actionItems = positionScores
    .map(p => {
      const flagCount = row.allFlags.filter(f =>
        f.records?.some(r => r.position === p.position)
      ).length
      const priorityScore = (100 - p.healthScore) + flagCount * 10
      return { ...p, priorityScore, flagCount }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3)

  const hasPositions = positionScores.length > 0

  return (
    <div className="space-y-6">

      {/* ── Section 1: Tyre Health Score ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-blue-400" />
          <p className="text-sm font-semibold text-secondary">{t('vehiclehistory.forecast.healthScoreTitle')}</p>
        </div>

        {!hasPositions ? (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-6 text-center text-muted text-sm">
            {t('vehiclehistory.forecast.noPositionData')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {positionScores.map(p => {
              const colors = healthScoreColor(p.healthScore)
              return (
                <div
                  key={p.position}
                  className={`rounded-lg border p-4 ${colors.border} ${colors.bg}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-mono text-sm font-semibold text-secondary">{p.position}</span>
                      {p.brand && (
                        <span className="ml-2 text-xs text-muted">{p.brand}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {p.risk_level && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${riskBadgeClass(p.risk_level)}`}>
                          {p.risk_level}
                        </span>
                      )}
                      <span className={`text-lg font-bold ${colors.text}`}>{p.healthScore}</span>
                    </div>
                  </div>
                  {/* Health bar */}
                  <div className="h-2 rounded-full bg-[var(--input-border)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${colors.bar}`}
                      style={{ width: `${p.healthScore}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-dim">0</span>
                    <span className={`text-[10px] font-medium ${colors.text}`}>{p.healthScore}/100</span>
                    <span className="text-[10px] text-dim">100</span>
                  </div>
                  {p.issue_date && (
                    <p className="text-[10px] text-dim mt-1.5">{t('vehiclehistory.forecast.lastRecorded', { date: p.issue_date })}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section 2: Replacement Forecast ──────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-purple-400" />
          <p className="text-sm font-semibold text-secondary">{t('vehiclehistory.forecast.replacementForecastTitle')}</p>
        </div>

        {!hasPositions ? (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-6 text-center text-muted text-sm">
            {t('vehiclehistory.forecast.noForecastData')}
          </div>
        ) : (
          <div className="space-y-2">
            {positionScores.map(p => {
              let forecastText = null
              let forecastClass = 'text-muted'
              let isDueSoon = false

              if (avgMonthlyKm && avgMonthlyKm > 0 && avgKm !== null) {
                const remaining = expectedKmPerTyre - avgKm
                const monthsRemaining = remaining > 0 ? Math.round(remaining / avgMonthlyKm) : 0
                isDueSoon = monthsRemaining < 2
                forecastText = isDueSoon
                  ? t('vehiclehistory.forecast.dueSoon')
                  : t('vehiclehistory.forecast.estMonthsRemaining', { months: monthsRemaining })
                forecastClass = isDueSoon ? 'text-red-400' : monthsRemaining <= 3 ? 'text-orange-400' : 'text-green-400'
              } else if (row.avgDays) {
                const daysSinceIssue = p.issue_date
                  ? Math.floor((Date.now() - new Date(p.issue_date).getTime()) / (1000 * 60 * 60 * 24))
                  : null
                if (daysSinceIssue !== null) {
                  const daysLeft = row.avgDays - daysSinceIssue
                  const monthsLeft = Math.round(daysLeft / 30)
                  isDueSoon = daysLeft < 60
                  forecastText = isDueSoon
                    ? t('vehiclehistory.forecast.dueSoonInterval')
                    : t('vehiclehistory.forecast.estMonthsRemainingInterval', { months: Math.max(0, monthsLeft) })
                  forecastClass = isDueSoon ? 'text-red-400' : monthsLeft <= 2 ? 'text-orange-400' : 'text-blue-400'
                } else {
                  forecastText = t('vehiclehistory.forecast.insufficientForecastData')
                  forecastClass = 'text-muted'
                }
              } else {
                forecastText = t('vehiclehistory.forecast.noKmData')
                forecastClass = 'text-muted'
              }

              return (
                <div
                  key={p.position}
                  className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
                    isDueSoon
                      ? 'bg-red-950/20 border-red-800/40'
                      : 'bg-[var(--input-bg)] border-[var(--input-border)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-secondary w-20">{p.position}</span>
                    {p.brand && <span className="text-xs text-muted">{p.brand}</span>}
                    {/* serial_no disabled - re-enable when ready
                    {p.serial_no && (
                      <span className="text-[10px] font-mono text-dim">{p.serial_no}</span>
                    )} */}
                  </div>
                  <span className={`text-xs font-medium ${forecastClass}`}>{forecastText}</span>
                </div>
              )
            })}
            <p className="text-[10px] text-dim mt-2 pl-1">
              {t('vehiclehistory.forecast.expectedKmPerTyre', { km: expectedKmPerTyre.toLocaleString() })}
              {' '}{fleetRecord?.expected_km_per_tyre ? t('vehiclehistory.forecast.fromFleetMaster') : t('vehiclehistory.forecast.defaultSource')}
              {avgMonthlyKm ? t('vehiclehistory.forecast.avgMonthlyKm', { km: Math.round(avgMonthlyKm).toLocaleString() }) : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── Section 3: Top 3 Action Recommendations ───────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={15} className="text-orange-400" />
          <p className="text-sm font-semibold text-secondary">{t('vehiclehistory.forecast.topActionsTitle')}</p>
        </div>

        {actionItems.length === 0 ? (
          <div className="rounded-lg border border-green-700/30 bg-green-900/10 p-5 text-center">
            <p className="text-green-400 text-sm">{t('vehiclehistory.forecast.allWithinRange')}</p>
            <p className="text-muted text-xs mt-1">{t('vehiclehistory.forecast.noActionRequired')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {actionItems.map((p, idx) => {
              const urgency = urgencyFromHealth(p.healthScore)
              const reasonKey = replacementReasonKey(p, p.healthScore)
              return (
                <div
                  key={p.position}
                  className="flex items-start gap-4 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--input-bg)] text-secondary text-xs font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-secondary">
                        {p.position}{p.brand ? ` · ${p.brand}` : ''}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${urgency.cls}`}>
                        {t(`vehiclehistory.forecast.${urgency.labelKey}`)}
                      </span>
                      <span className={`text-[10px] font-medium ${healthScoreColor(p.healthScore).text}`}>
                        {t('vehiclehistory.forecast.healthLabel', { score: p.healthScore })}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{t(`vehiclehistory.forecast.${reasonKey}`)}</p>
                    {p.flagCount > 0 && (
                      <p className="text-[10px] text-orange-400 mt-0.5">{t('vehiclehistory.forecast.associatedFlags', { count: p.flagCount })}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section 4: 3-Month Cost Projection ───────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={15} className="text-green-400" />
          <p className="text-sm font-semibold text-secondary">{t('vehiclehistory.forecast.costProjectionTitle')}</p>
        </div>

        {avgMonthlyCost === null ? (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-6 text-center text-muted text-sm">
            {t('vehiclehistory.forecast.insufficientCostData')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
              {[1, 2, 3].map(offset => {
                const projectedDate = new Date()
                projectedDate.setMonth(projectedDate.getMonth() + offset)
                const monthLabel = projectedDate.toLocaleString('default', { month: 'short', year: 'numeric' })
                const isOverBudget = monthlyBudget !== null && avgMonthlyCost > monthlyBudget
                return (
                  <div
                    key={offset}
                    className={`rounded-lg border p-4 text-center ${
                      isOverBudget
                        ? 'bg-red-950/20 border-red-800/40'
                        : 'bg-[var(--input-bg)] border-[var(--input-border)]'
                    }`}
                  >
                    <p className="text-xs text-muted mb-1">{monthLabel}</p>
                    <p className={`text-lg font-bold ${isOverBudget ? 'text-red-400' : 'text-green-400'}`}>
                      {currency} {avgMonthlyCost.toLocaleString()}
                    </p>
                    {monthlyBudget !== null && (
                      <p className={`text-[10px] mt-1 font-medium ${isOverBudget ? 'text-red-500' : 'text-green-500'}`}>
                        {isOverBudget
                          ? t('vehiclehistory.forecast.overBudget', { amount: (avgMonthlyCost - monthlyBudget).toLocaleString() })
                          : t('vehiclehistory.forecast.withinBudget')
                        }
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3">
              <p className="text-xs text-muted">
                {t('vehiclehistory.forecast.basedOnAverageLead')}{' '}
                <span className="text-[var(--text-primary)] font-semibold">{currency} {avgMonthlyCost.toLocaleString()}</span>
                {t('vehiclehistory.forecast.basedOnAverageTail', { months: Math.round(spanMonths) })}
                {monthlyBudget !== null && (
                  <span className="ml-1">
                    {t('vehiclehistory.forecast.fleetMasterBudgetLead')}{' '}
                    <span className={`font-semibold ${avgMonthlyCost > monthlyBudget ? 'text-red-400' : 'text-green-400'}`}>
                      {currency} {monthlyBudget.toLocaleString()}
                    </span>
                    {t('vehiclehistory.forecast.fleetMasterBudgetTail')}
                  </span>
                )}
              </p>
            </div>
          </>
        )}
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Fleet-wide asset opener
//
// The register table above lists only assets that carry a TYRE RECORD: 557 of
// the 1,377 codes in the fleet. So 820 machines could not be opened from this
// page at all and their history was unreachable. This search covers the WHOLE
// register, and it PAGES - PostgREST caps a response at 1,000 rows whatever
// .limit() claims, so an unpaged picker silently hides several hundred assets
// and the reader concludes the machine is not in the system.
// ─────────────────────────────────────────────────────────────────────────────

function AssetOpener({ country, onOpen }) {
  const [options, setOptions] = useState([])
  const [state, setState]     = useState('loading') // loading | ready | error
  const [query, setQuery]     = useState('')

  useEffect(() => {
    let cancelled = false
    async function run() {
      setState('loading')
      const res = await listAssetOptions({ country })
      if (cancelled) return
      if (!res.ok) { setState('error'); setOptions([]); return }
      setOptions(res.rows)
      setState('ready')
    }
    run()
    return () => { cancelled = true }
  }, [country])

  const matches = useMemo(() => {
    const q = canonAssetNo(query)
    if (!q) return []
    return options.filter(o => canonAssetNo(o.asset_no).includes(q)).slice(0, 12)
  }, [query, options])

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <History size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="input pl-9"
            placeholder="Open the full history of any asset in the register"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          {state === 'loading' && 'Loading the register'}
          {state === 'error' && 'The register could not be read, so this search is unavailable.'}
          {state === 'ready' && `${options.length.toLocaleString('en-US')} assets in the register`}
        </p>
      </div>

      {query && state === 'ready' && (
        <div className="mt-3">
          {matches.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No asset in the register matches that code
              {country && country !== 'All' ? ` in ${country}` : ''}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {matches.map(o => (
                <button
                  key={`${o.country}:${o.asset_no}`}
                  onClick={() => { onOpen(o.asset_no); setQuery('') }}
                  className="text-xs px-2.5 py-1.5 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] hover:border-blue-600/50 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                >
                  <span className="font-mono text-blue-400">{o.asset_no}</span>
                  <span className="text-[var(--text-dim)] ml-2">
                    {[o.country, o.vehicle_type, o.site].filter(Boolean).join(' | ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-[var(--text-dim)] mt-2">
        The table below lists assets that carry a tyre record. This search covers every asset in the
        register, including machines that have never had a tyre recorded against them.
      </p>
    </div>
  )
}

/**
 * Standalone panel for an asset opened from the register search that carries no
 * tyre records, so no row for it exists in the table above.
 */
function DirectAssetPanel({ assetNo, country, onClose }) {
  return (
    <div className="card border border-blue-500/30 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[var(--text-primary)] font-bold text-xl font-mono">{assetNo}</h2>
            <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--input-border)] text-[var(--text-muted)]">
              {country && country !== 'All' ? country : 'All countries'}
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Opened from the register search. This asset carries no tyre record, so the tyre analysis
            tabs do not apply to it. Everything recorded against it is below.
          </p>
        </div>
        <button onClick={onClose} className="btn-secondary flex items-center gap-1.5 text-xs">
          <X size={13} /> Close
        </button>
      </div>
      <AssetFullHistory assetNo={assetNo} country={country} />
    </div>
  )
}
