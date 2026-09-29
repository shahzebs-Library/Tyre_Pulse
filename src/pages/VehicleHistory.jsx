/**
 * VehicleHistory (route /vehicle-history) - the complete lifecycle, service,
 * inspection and operational history of one asset, rebuilt on the shared page
 * kit to the owner's light reference design.
 *
 * Layout: hero and actions, an asset finder that covers the whole register,
 * then for the opened asset a header card, six KPIs and tabs (Timeline,
 * Service, Movement, Inspection, Documents, Cost, plus the tyre analysis tabs
 * and the full source-by-source history the page always had). Below sits the
 * register of assets that carry tyre history, with its misuse scoring, red
 * flags, filters and export, kept from the previous page.
 *
 * Data: the per-asset history comes from the same loader Asset Detail uses
 * (loadAssetHistory + buildTimeline); the view blocks are shaped by the pure
 * engine src/lib/vehicleHistoryView.js. Money is shown in the currency each
 * record carries and never blended. Anything unmeasurable reads N/A.
 */
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as vehicleHistoryApi from '../lib/api/vehicleHistory'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import { useSettings } from '../contexts/SettingsContext'
import { computeAssetMetrics, bucketByMonth, countBy } from '../lib/analyticsEngine'
import { detectAnomalies } from '../lib/anomalyEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  LineElement, PointElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Search, AlertTriangle, X, FileText, Car, TrendingUp, History, Eye, CalendarPlus,
  Download, FileSpreadsheet, Gauge, CalendarDays, Wrench, CircleDot, ShieldAlert, Clock,
  MapPin, User, Activity, RefreshCw, ArrowRight, ChevronDown,
} from 'lucide-react'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import DateField from '../components/ui/DateField'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { categorical, withAlpha, colorAt } from '../lib/reportColors'
import {
  windowRecords, groupByAsset, sitesOf, buildVehicleRows, scopeVehicleRows,
  filterVehicleRows, summarizeVehicles, misuseBand, timelineRows,
} from '../lib/vehicleHistoryAnalytics'
import { listAssetOptions, loadAssetHistory } from '../lib/api/assetHistory'
import { canonAssetNo, buildTimeline, meterHistory, downtimeEpisodes } from '../lib/assetHistory'
import {
  EVENT_TYPES, PERIODS, COST_CATEGORIES, buildViewTimeline, filterViewEvents, typeCounts,
  tabEvents, documentRows, chartMonths, costByMonth, costCurrencies, downtimeByMonth,
  historyKpis, assetHeader, historyViewExportRows, HISTORY_VIEW_EXPORT_COLUMNS,
} from '../lib/vehicleHistoryView'
import {
  Card, CardState, Kpi, PageHero, Tabs, VehicleThumb, KitTable, fmtInt, useCard,
} from '../components/commandCenter/kit'
// The unified per-asset timeline lives in its own seam because Asset Detail
// renders it too. A page importing it from ANOTHER page would make one route
// depend on another's module graph.
import AssetFullHistory from '../components/asset/AssetFullHistory'
import './vehicleHistory.css'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

// Bars and doughnuts for the tyre analysis tab, plus the line the downtime
// trend draws. register() is idempotent, so AssetFullHistory registering its
// own elements is unaffected.
ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement, Filler, Title, Tooltip, Legend)

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


// ── Detail tabs ───────────────────────────────────────────────────────────────
// The first six are the mockup's; the tyre tabs follow only when the asset has
// tyre records, and the full source-by-source history is always last.
const HISTORY_TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'service', label: 'Service history' },
  { key: 'movement', label: 'Movement history' },
  { key: 'inspection', label: 'Inspection history' },
  { key: 'documents', label: 'Documents' },
  { key: 'cost', label: 'Cost history' },
]
const TYRE_TABS = [
  { key: 'tyres', labelKey: 'timeline', label: 'Tyre records' },
  { key: 'analysis', labelKey: 'analysis', label: 'Tyre analysis' },
  { key: 'redFlags', labelKey: 'redFlags', label: 'Red flags' },
  { key: 'relatedRecords', labelKey: 'relatedRecords', label: 'Related records' },
  { key: 'forecast', labelKey: 'forecast', label: 'Forecast' },
]
const FULL_TAB = { key: 'full', label: 'All sources' }

const TONE_PILL = { good: 'good', info: 'info', warn: 'warn', bad: 'bad', orange: 'orange', purple: 'vh-purple', muted: 'muted' }
const TONE_DOT = {
  good: 'var(--cc-green)', info: 'var(--cc-blue)', warn: 'var(--cc-amber)', bad: 'var(--cc-red)',
  orange: 'var(--cc-orange)', purple: 'var(--cc-purple)', muted: 'var(--cc-ink-3)',
}

const fmtKm = (v) => (v == null ? 'N/A' : `${fmtInt(Math.round(v))} km`)
const fmtHrs = (v) => (v == null ? 'N/A' : `${fmtInt(Math.round(v))} hrs`)
const fmtMoney = (v, cur) => (v == null || !cur ? 'N/A' : `${cur} ${fmtInt(Math.round(v))}`)
const fmtDays = (v) => (v == null ? 'N/A' : `${v} ${v === 1 ? 'day' : 'days'}`)
const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return key
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + (m === 1 ? ` ${String(y).slice(2)}` : '')
}

function TypePill({ event }) {
  return <span className={`cc-pill ${TONE_PILL[event.tone] || 'muted'}`}>{event.typeLabel}</span>
}

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
  const [selected, setSelected]       = useState(null)   // asset_no with tyre records
  // An asset opened from the FLEET-WIDE search. The register table lists only
  // assets that carry a tyre record, so without this the machines that never
  // had one could not be opened from this page at all.
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
  const [relatedError, setRelatedError]             = useState(null)

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
  const activeAsset = selected || directAsset

  // ── Load related records when an asset with tyre records is selected ─────────
  useEffect(() => {
    setRelatedActions([]); setRelatedRca([]); setRelatedInspections([]); setTyrePositions([]); setRelatedError(null)
    if (!selected) return undefined
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
      if (failed) setRelatedError(toUserMessage(failed.error, 'Some related asset history could not be loaded.'))
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
    loadRelated().catch(err => { if (!cancelled) setRelatedError(toUserMessage(err, 'Could not load related asset history.')) })
    return () => { cancelled = true }
  }, [selected, activeCountry])

  // ── Per-asset unified history (the same loader Asset Detail uses) ───────────
  const history = useCard(
    () => (activeAsset ? loadAssetHistory(activeAsset, { country: activeCountry }) : null),
    [activeAsset, activeCountry],
  )

  const openAsset = (assetNo) => {
    const code = canonAssetNo(assetNo)
    // Prefer the tyre analysis tabs when the asset also has tyre records.
    const known = vehicleRows.find(r => canonAssetNo(r.assetNo) === code)
    if (known) { setSelected(known.assetNo); setDirectAsset(null) }
    else { setDirectAsset(assetNo); setSelected(null) }
  }
  const closeAsset = () => { setSelected(null); setDirectAsset(null) }

  return (
    <div className="cc vh-page">
      <PageHero
        title="Vehicle History"
        lead="Complete lifecycle, service, inspection and operational history for your fleet assets."
        imgLight="/dashboard/hero-history-light.webp"
        imgDark="/dashboard/hero-history-dark.webp"
      />

      <AssetOpener country={activeCountry} activeAsset={activeAsset} onOpen={openAsset} />

      {activeAsset ? (
        <AssetHistoryView
          key={`${activeAsset}|${activeCountry}`}
          assetNo={activeAsset}
          country={activeCountry}
          history={history}
          registerRow={fleetMap[activeAsset] || null}
          row={selectedRow}
          currency={activeCurrency}
          defaultCost={dc}
          relatedActions={relatedActions}
          relatedRca={relatedRca}
          relatedInspections={relatedInspections}
          relatedError={relatedError}
          tyrePositions={tyrePositions}
          onClose={closeAsset}
        />
      ) : (
        <Card title="No asset open" sub="Search the register above, or pick an asset from the table below.">
          <div className="cc-empty">Open an asset to see its timeline, service, movement, inspection, document and cost history.</div>
        </Card>
      )}

      {/* Register of assets that carry tyre history */}
      <Card
        title={t('vehiclehistory.header.title')}
        sub="Assets that carry tyre records, scored for misuse and red flags. Select a row to open its history."
      >
        {error && (
          <div className="vh-banner" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="cc-btn-ghost" onClick={() => setReloadKey(k => k + 1)}><RefreshCw size={13} aria-hidden="true" /> Retry</button>
          </div>
        )}

        <div className="cc-kpis vh-summary">
          <Kpi icon={Car} tone="t-blue" loading={loading} value={summary.vehicles} label={t('vehiclehistory.summary.totalVehicles')} />
          <Kpi icon={AlertTriangle} tone="t-orange" loading={loading} value={summary.withAnomalies} label={t('vehiclehistory.summary.withAnomalies')} />
          <Kpi icon={ShieldAlert} tone="t-red" loading={loading} value={summary.highMisuse} label={t('vehiclehistory.summary.highMisuseRisk')} />
          <Kpi
            icon={Wrench} tone="t-green" loading={loading}
            // Authoritative fleet tyre spend from the expense grid when the view
            // is the whole unwindowed fleet; otherwise the sum of the rows shown.
            display={summary.totalCost == null ? 'N/A' : `${activeCurrency} ${Math.round(summary.totalCost).toLocaleString()}`}
            label={`${t('vehiclehistory.summary.totalFleetCost')} (${summary.costBasis === 'grid' ? 'expense grid' : 'tyre records in scope'})`}
          />
        </div>

        <div className="cc-filters vh-filters">
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label={t('vehiclehistory.filters.searchPlaceholder')}
              placeholder={t('vehiclehistory.filters.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select aria-label="Site" className="cc-select" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
            <option value="">{t('vehiclehistory.filters.allSites')}</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Anomaly filter" className="cc-select" value={anomalyFilter} onChange={e => setAnomalyFilter(e.target.value)}>
            <option value="all">{t('vehiclehistory.filters.allVehicles')}</option>
            <option value="has">{t('vehiclehistory.filters.hasAnomalies')}</option>
            <option value="clean">{t('vehiclehistory.filters.clean')}</option>
          </select>
          <select aria-label="Sort vehicles by" className="cc-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="misuse">{t('vehiclehistory.filters.sortMisuse')}</option>
            <option value="cost">{t('vehiclehistory.filters.sortCost')}</option>
            <option value="count">{t('vehiclehistory.filters.sortCount')}</option>
            <option value="date">{t('vehiclehistory.filters.sortDate')}</option>
          </select>
          <DateField className="text-sm w-40" value={fromDate} onChange={setFromDate} placeholder="From date" ariaLabel="From date" />
          <DateField className="text-sm w-40" value={toDate} onChange={setToDate} placeholder="To date" ariaLabel="To date" min={fromDate || undefined} />
          {rangeActive && (
            <button type="button" className="cc-btn-ghost" onClick={() => { setFromDate(''); setToDate('') }}>
              <X size={13} aria-hidden="true" /> Clear dates
            </button>
          )}
        </div>
        {(rangeActive || scopeActive || anomalyFilter !== 'all') && (
          <p className="vh-note">
            {rangeActive && 'Date range windows the per-vehicle roll-ups (tyre counts, km and cost from tyre records). Anomalies always evaluate full history; the expense-grid cost total is not applied inside a range. '}
            {scopeActive && `The summary above covers the ${scopedRows.length} of ${vehicleRows.length} vehicles matching the search and site filters. `}
            {anomalyFilter !== 'all' && 'The anomaly filter shapes the table only, so the summary still states how many vehicles are flagged overall in this scope.'}
          </p>
        )}

        <EnterpriseTable
          className="cc-et"
          columns={vehicleColumns}
          data={filteredRows}
          getRowId={r => r.assetNo}
          loading={loading}
          error={allRecords.length === 0 ? error : null}
          onRetry={() => setReloadKey(k => k + 1)}
          emptyMessage={t('vehiclehistory.table.noMatch')}
          searchPlaceholder="Search this table"
          onRowClick={row => {
            if (selected === row.assetNo) { setSelected(null) } else { setSelected(row.assetNo); setDirectAsset(null) }
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          viewKey="vehicle-history"
          exportFileName={`Vehicle History ${new Date().toISOString().slice(0, 10)}`}
          reportMeta={{ title: 'Vehicle History', currency: activeCurrency, dateRange: rangeActive ? `${fromDate || 'start'} to ${toDate || 'today'}` : undefined }}
        />
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// One asset: header, KPIs, tabs
// ─────────────────────────────────────────────────────────────────────────────

function AssetHistoryView({
  assetNo, country, history, registerRow, row, currency, defaultCost,
  relatedActions, relatedRca, relatedInspections, relatedError, tyrePositions, onClose,
}) {
  const { t } = useLanguage()
  const [tab, setTab] = useState('timeline')
  const [typeFilter, setTypeFilter] = useState('key')
  const [period, setPeriod] = useState('24')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(30)
  const [costCur, setCostCur] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)

  const data = history.data
  // Snapshot of "now" per load, so every figure on screen agrees on the date.
  const now = useMemo(() => Date.now(), [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const model = useMemo(() => {
    if (!data) return null
    const src = data.sources || {}
    const rowsOf = (k) => (src[k] && src[k].ok ? src[k].rows : [])
    // The per-asset register row is country-correct; the fleet-wide map adds
    // the document columns it does not select, but only for the same country.
    const hf = data.fleet
    const reg = registerRow && (!hf || !registerRow.country || registerRow.country === hf.country) ? registerRow : null
    const fleet = hf ? { ...(reg || {}), ...hf } : reg
    const timeline = buildTimeline(src, { now, country })
    const meters = meterHistory(rowsOf('odometer'), rowsOf('engine_hours'))
    const downtime = downtimeEpisodes(rowsOf('job_card'), rowsOf('breakdown'), { now })
    const events = buildViewTimeline({ timeline, fleet, meters, downtime, now })
    return {
      fleet, timeline, meters, downtime, events,
      kpis: historyKpis({ fleet, events, meters, downtime, now }),
      header: assetHeader(fleet, events),
      currencies: costCurrencies(events),
      unreadable: timeline.unreadable,
      truncated: data.truncated || [],
      crossCountry: data.crossCountry,
    }
  }, [data, registerRow, now, country])

  const months = PERIODS.find(p => p.key === period)?.months ?? null
  const filtered = useMemo(
    () => (model ? filterViewEvents(model.events, { type: typeFilter, months, search: q, now }) : []),
    [model, typeFilter, months, q, now],
  )
  const counts = useMemo(() => (model ? typeCounts(model.events) : {}), [model])
  const axis = useMemo(() => (model ? chartMonths(months, model.events, now) : []), [model, months, now])
  const cur = costCur && model?.currencies.includes(costCur) ? costCur : (model?.currencies[0] || null)
  const cost = useMemo(() => (model ? costByMonth(model.events, { currency: cur, months: axis }) : null), [model, cur, axis])
  const down = useMemo(() => (model ? downtimeByMonth(model.downtime.episodes, { months: axis }) : null), [model, axis])

  const tabs = [
    ...HISTORY_TABS.map(x => ({ ...x, count: x.key === 'timeline' || x.key === 'documents' ? undefined : tabEvents(filtered, x.key).length })),
    ...(row ? TYRE_TABS.map(x => ({
      key: x.key,
      label: x.key === 'tyres' ? x.label : t(`vehiclehistory.tabs.${x.labelKey}`) || x.label,
      count: x.key === 'redFlags' && row.allFlags.length ? row.allFlags.length : undefined,
      countTone: 'bad',
    })) : []),
    FULL_TAB,
  ]

  async function exportHistory(kind) {
    setExportOpen(false)
    const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
    const rows = historyViewExportRows(filtered)
    const name = reportFileName('Vehicle History', assetNo)
    if (kind === 'xlsx') {
      await exportToExcel(rows, HISTORY_VIEW_EXPORT_COLUMNS.map(c => c.key), HISTORY_VIEW_EXPORT_COLUMNS.map(c => c.header), name)
    } else {
      await exportToPdf(rows, HISTORY_VIEW_EXPORT_COLUMNS, `Vehicle history: ${assetNo}`, name)
    }
  }

  const h = model?.header
  const k = model?.kpis
  const statusTone = /inactive|retired|dispos/i.test(h?.status || '') ? 'muted' : 'good'

  return (
    <>
      <div className="vh-actions">
        <Link className="cc-btn-ghost" to={`/assets/${encodeURIComponent(assetNo)}`}><Eye size={14} aria-hidden="true" /> View Asset</Link>
        <Link className="cc-btn-ghost" to="/pm-programs"><CalendarPlus size={14} aria-hidden="true" /> Schedule Service</Link>
        <div className="vh-menu">
          <button type="button" className="cc-btn-primary" aria-haspopup="menu" aria-expanded={exportOpen}
            disabled={!filtered.length} onClick={() => setExportOpen(o => !o)}>
            <Download size={14} aria-hidden="true" /> Export History <ChevronDown size={13} aria-hidden="true" />
          </button>
          {exportOpen && (
            <div className="vh-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => exportHistory('xlsx')}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
              <button type="button" role="menuitem" onClick={() => exportHistory('pdf')}><FileText size={14} aria-hidden="true" /> PDF</button>
            </div>
          )}
        </div>
        <button type="button" className="cc-icon-btn vh-close" aria-label="Close this asset" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Asset header */}
      <section className="cc-card vh-head" aria-label={`Asset ${assetNo}`}>
        <VehicleThumb row={model?.fleet || { asset_no: assetNo }} size="lg" />
        <div className="vh-id">
          {h?.status && <span className={`cc-pill ${statusTone}`}><span className="cc-dot" style={{ background: 'currentColor' }} />{h.status}</span>}
          <h2>{assetNo}</h2>
          <p>{[h?.make, h?.model].filter(Boolean).join(' ') || 'Make and model not recorded'}</p>
          <p className="vh-sub">{h?.category || 'Category not recorded'}{country && country !== 'All' ? ` | ${country}` : ''}</p>
        </div>
        <div className="vh-facts">
          <Fact label="Make / Model" value={[h?.make, h?.model].filter(Boolean).join(' ') || null} />
          <Fact label="Year" value={h?.year ? String(h.year) : null} />
          <Fact label="Site" icon={MapPin} value={h?.site} />
          {h?.operator && <Fact label="Operator" icon={User} value={h.operator} />}
          <Fact label="Current status" value={h?.opsStatus ? <span className="cc-pill info">{h.opsStatus}</span> : null} />
          <Fact label="Utilization" icon={Activity} value={h?.utilizationPct != null ? `${Math.round(h.utilizationPct)}%` : null}
            sub={h?.utilizationAt ? `Telematics ${h.utilizationAt}` : null} />
          <Fact label="Last service" icon={Wrench} value={h?.lastServiceAt}
            sub={h?.lastServiceKm != null && k?.totalKm != null && k.totalKm >= h.lastServiceKm ? `${fmtInt(Math.round(k.totalKm - h.lastServiceKm))} km ago` : null} />
        </div>
      </section>

      {history.error && (
        <div className="cc-card vh-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{history.error}</span>
          <button type="button" className="cc-btn-ghost" onClick={history.retry}><RefreshCw size={13} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {model?.crossCountry && (
        <p className="vh-note">This asset code also exists in another country. It is usually a different machine, so only the {country && country !== 'All' ? country : 'matching'} record is shown.</p>
      )}
      {model && (model.unreadable.length > 0 || model.truncated.length > 0) && (
        <p className="vh-note">
          {model.unreadable.length > 0 && `Some sources could not be read (${model.unreadable.join(', ')}), so their events are missing here. `}
          {model.truncated.length > 0 && `Some sources hit their read limit (${model.truncated.join(', ')}), so older events may be missing.`}
        </p>
      )}

      {/* KPIs */}
      <div className="cc-kpis">
        <Kpi icon={Gauge} tone="t-green" loading={history.loading} display={fmtKm(k?.totalKm)} label="Total kilometres" title={k?.kmBasis} />
        <Kpi icon={CalendarDays} tone="t-green" loading={history.loading} display={k?.activeYears == null ? 'N/A' : `${k.activeYears} years`} label="Active years" title={k?.yearsBasis} />
        <Kpi icon={Wrench} tone="t-amber" loading={history.loading} value={k?.maintenanceEvents} label="Maintenance events" title="Job cards and preventive maintenance services" />
        <Kpi icon={CircleDot} tone="t-green" loading={history.loading} value={k?.tyreChanges} label="Tyre changes" title="Tyre fitments recorded against this asset" />
        <Kpi icon={ShieldAlert} tone="t-red" loading={history.loading} value={k?.incidents} label="Incidents"
          title={k ? `${k.accidents} accidents, ${k.breakdowns} breakdowns` : undefined} />
        <Kpi icon={Clock} tone="t-red" loading={history.loading} display={fmtDays(k?.downtimeDays)} label="Downtime days" title={k?.downtimeBasis} />
      </div>

      {/* Tabs and filters */}
      <div className="cc-card vh-tabbar">
        <Tabs tabs={tabs} value={tab} onChange={(key) => { setTab(key); setShown(30) }} label="History views" variant="line" />
        {HISTORY_TABS.some(x => x.key === tab) && tab !== 'documents' && (
          <div className="cc-filters vh-tab-filters">
            <select className="cc-select" aria-label="Event type" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setShown(30) }}>
              <option value="key">Key events</option>
              <option value="all">All event types</option>
              {EVENT_TYPES.filter(x => counts[x.key]).map(x => <option key={x.key} value={x.key}>{x.label} ({counts[x.key]})</option>)}
            </select>
            <select className="cc-select" aria-label="Period" value={period} onChange={e => { setPeriod(e.target.value); setShown(30) }}>
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <div className="cc-search">
              <Search size={15} aria-hidden="true" />
              <input aria-label="Search events" placeholder="Search events, notes..." value={q} onChange={e => { setQ(e.target.value); setShown(30) }} />
            </div>
          </div>
        )}
      </div>

      {tab === 'timeline' && (
        <div className="vh-grid">
          <Card title="Timeline" sub="Chronological history of all events for this vehicle." className="vh-tl-card"
            action={<span className="cc-pill good">Latest first</span>}>
            <CardState state={history} lines={8} empty={model && !filtered.length ? 'No events match these filters.' : null}>
              {model && (
                <ol className="vh-tl">
                  {filtered.slice(0, shown).map(e => <TimelineItem key={e.id} e={e} />)}
                </ol>
              )}
              {filtered.length > shown && (
                <button type="button" className="cc-btn vh-more" onClick={() => setShown(s => s + 30)}>
                  Show more ({fmtInt(filtered.length - shown)} left)
                </button>
              )}
            </CardState>
          </Card>
          <div className="vh-side">
            <CostChartCard state={history} cost={cost} currencies={model?.currencies || []} cur={cur} onCur={setCostCur} />
            <DowntimeCard state={history} down={down} />
            <Card title="Recent history summary" sub="The latest events in the current filter.">
              <CardState state={history} lines={5} empty={model && !filtered.length ? 'No events match these filters.' : null}>
                <EventTable rows={filtered.slice(0, 8)} compact />
              </CardState>
            </Card>
          </div>
        </div>
      )}

      {['service', 'movement', 'inspection'].includes(tab) && (
        <Card
          title={HISTORY_TABS.find(x => x.key === tab).label}
          sub={tab === 'movement'
            ? 'Inferred from the site recorded on job cards, inspections, tyre fitments and meter readings. There is no dedicated transfer register, and store issues are left out because their site is the issuing store.'
            : tab === 'service' ? 'Job cards, preventive maintenance services and washes.' : 'Inspections and checklist sheets.'}
        >
          <CardState state={history} lines={6}>
            <EventTable rows={tabEvents(filtered, tab)} empty={`No ${tab} events match these filters.`} />
          </CardState>
        </Card>
      )}

      {tab === 'documents' && (
        <Card title="Documents" sub="Registration, insurance, permit and card details held on the asset register.">
          <CardState state={history} lines={4}
            empty={model && !documentRows(model.fleet, { now }).length ? 'The register holds no document details for this asset.' : null}>
            {model && <DocumentTable rows={documentRows(model.fleet, { now })} />}
          </CardState>
        </Card>
      )}

      {tab === 'cost' && (
        <div className="vh-grid vh-grid-cost">
          <CostChartCard state={history} cost={cost} currencies={model?.currencies || []} cur={cur} onCur={setCostCur} />
          <Card title="Cost lines" sub="Store issues from the classified expense grid, and repair delay penalties. Job card and tyre amounts are shown on their own events and never added again here.">
            <CardState state={history} lines={6}>
              <EventTable rows={tabEvents(filterViewEvents(model?.events || [], { type: 'all', months, search: q, now }), 'cost')} empty="No cost lines in this period." />
            </CardState>
          </Card>
        </div>
      )}

      {row && tab === 'tyres' && (
        <Card title="Tyre records" sub="Every tyre record for this asset, oldest first. Flagged records are marked."
          action={<TyrePdfButton row={row} currency={currency} defaultCost={defaultCost} />}>
          <TimelineTab
            records={[...row.records].sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date))}
            flaggedIds={new Set(row.allFlags.flatMap(f => f.record_ids || []))}
            currency={currency}
            assetNo={row.assetNo}
          />
        </Card>
      )}

      {row && tab === 'analysis' && (
        <TyreAnalysisCard row={row} currency={currency} defaultCost={defaultCost} fleetRecord={row.fleetRecord} tyrePositions={tyrePositions} />
      )}

      {row && tab === 'redFlags' && (
        <Card title={t('vehiclehistory.tabs.redFlags')}><RedFlagsTab flags={row.allFlags} /></Card>
      )}

      {row && tab === 'relatedRecords' && (
        <Card title={t('vehiclehistory.tabs.relatedRecords')}>
          {relatedError && <p className="vh-note" role="alert">{relatedError}</p>}
          <RelatedTab assetNo={row.assetNo} actions={relatedActions} rca={relatedRca} inspections={relatedInspections} />
        </Card>
      )}

      {row && tab === 'forecast' && (
        <Card title={t('vehiclehistory.tabs.forecast')}>
          <ForecastTab row={row} tyrePositions={tyrePositions} currency={currency} defaultCost={defaultCost} fleetRecord={row.fleetRecord} />
        </Card>
      )}

      {tab === 'full' && (
        <Card title="All sources" sub="Every record that ever touched this machine, source by source, with the document chain and its own export.">
          <AssetFullHistory assetNo={assetNo} country={country} />
        </Card>
      )}
    </>
  )
}

function Fact({ label, value, icon: Icon, sub }) {
  return (
    <div className="vh-fact">
      <span className="vh-fact-label">{label}</span>
      <span className="vh-fact-val">
        {Icon && value != null && <Icon size={14} aria-hidden="true" />}
        {value == null || value === '' ? <span className="cc-na">N/A</span> : value}
      </span>
      {sub && <span className="vh-fact-sub">{sub}</span>}
    </div>
  )
}

function MeterLine({ value, own, fmt, label }) {
  if (value == null) return null
  return <span title={own ? `${label} on this record` : `Latest ${label.toLowerCase()} logged on or before this date`}>{own ? '' : '~'}{fmt(value)}</span>
}

function TimelineItem({ e }) {
  const body = (
    <>
      <span className="vh-tl-dot" style={{ background: TONE_DOT[e.tone] || TONE_DOT.muted }} aria-hidden="true" />
      <span className="vh-tl-date">{e.undated ? 'Undated' : e.day}</span>
      <span className="vh-tl-main">
        <b>{e.title}</b>
        {e.detail && <span>{e.detail}</span>}
      </span>
      <TypePill event={e} />
      <span className="vh-tl-meter">
        <MeterLine value={e.km} own={e.kmOwn} fmt={fmtKm} label="Odometer" />
        <MeterLine value={e.hours} own={e.hoursOwn} fmt={fmtHrs} label="Hour meter" />
      </span>
    </>
  )
  return (
    <li className="vh-tl-item">
      {e.link ? <Link to={e.link} className="vh-tl-row">{body}</Link> : <div className="vh-tl-row">{body}</div>}
    </li>
  )
}

function EventTable({ rows, compact = false, empty = 'No events' }) {
  const columns = [
    { key: 'day', header: 'Date', sortValue: r => r.atMs ?? 0, cell: r => (r.undated ? 'Undated' : r.day) },
    { key: 'type', header: 'Event type', sortValue: r => r.typeLabel, cell: r => <TypePill event={r} /> },
    { key: 'title', header: 'Description', cell: r => <span className="vh-desc" title={r.detail || r.title}>{r.title}</span> },
    ...(compact ? [] : [{ key: 'site', header: 'Site', cell: r => r.site || <span className="cc-na">N/A</span> }]),
    { key: 'km', header: 'Odometer', align: 'right', cell: r => (r.km == null ? <span className="cc-na">N/A</span> : fmtKm(r.km)) },
    { key: 'hours', header: 'Hours', align: 'right', cell: r => (r.hours == null ? <span className="cc-na">N/A</span> : fmtInt(Math.round(r.hours))) },
    { key: 'value', header: 'Cost', align: 'right', sortValue: r => (r.currency ? Number(r.value) || 0 : 0),
      cell: r => (r.value == null || !r.currency ? <span className="cc-na">N/A</span> : fmtMoney(Number(r.value), r.currency)) },
    { key: 'downtimeDays', header: 'Downtime', align: 'right',
      cell: r => (r.downtimeDays == null ? <span className="cc-na">N/A</span> : <span className={r.downtimeDays > 0 ? 'vh-warn' : ''}>{fmtDays(r.downtimeDays)}</span>) },
    { key: 'link', header: 'Actions', sortable: false,
      cell: r => (r.link ? <Link className="cc-link" to={r.link} aria-label={`Open ${r.title}`}>Open <ArrowRight size={12} aria-hidden="true" /></Link> : <span className="cc-na">N/A</span>) },
  ]
  return <KitTable columns={columns} rows={rows} compact={compact} empty={empty} getRowId={r => r.id} />
}

function DocumentTable({ rows }) {
  const columns = [
    { key: 'label', header: 'Document' },
    { key: 'ref', header: 'Reference', cell: r => r.ref || <span className="cc-na">N/A</span> },
    { key: 'issued', header: 'Issued', cell: r => r.issued || <span className="cc-na">N/A</span> },
    { key: 'expires', header: 'Expires', cell: r => r.expires || <span className="cc-na">N/A</span> },
    { key: 'state', header: 'Status', sortable: false,
      cell: r => (r.state ? <span className={`cc-pill ${r.state.tone}`}>{r.state.label}</span> : <span className="cc-na">No expiry recorded</span>) },
  ]
  return <KitTable columns={columns} rows={rows} compact getRowId={r => r.key} />
}

const CHART_TEXT = 'var(--text-muted)'
const CHART_GRID = 'var(--panel-2)'

function CostChartCard({ state, cost, currencies, cur, onCur }) {
  const data = cost && {
    labels: cost.months.map(monthLabel),
    datasets: COST_CATEGORIES.map((c, i) => ({
      label: c.label, data: cost.series[c.key], backgroundColor: colorAt(i), borderRadius: 3, stack: 'cost',
    })),
  }
  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${cur} ${fmtInt(Math.round(ctx.raw))}` } } },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: CHART_TEXT, font: { size: 10 } } },
      y: { stacked: true, beginAtZero: true, grid: { color: CHART_GRID }, ticks: { color: CHART_TEXT, font: { size: 10 } } },
    },
  }
  return (
    <Card title="Maintenance cost over time"
      sub={cur ? `Classified expense grid, ${cur}. Buckets are the grid's own tyre, spare and oil split.` : 'Classified expense grid.'}
      action={currencies.length > 1 && (
        <select className="cc-select" aria-label="Cost currency" value={cur || ''} onChange={e => onCur(e.target.value)}>
          {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}>
      <CardState state={state} lines={5} empty={cost && !cost.lines ? 'No classified expense lines for this asset in this period.' : null}>
        {cost && (
          <div className="vh-chart-row">
            <div className="vh-chart"><Bar data={data} options={opts} /></div>
            <ul className="vh-legend">
              {COST_CATEGORIES.map((c, i) => (
                <li key={c.key}><i style={{ background: colorAt(i) }} aria-hidden="true" /><span>{c.label}</span><b>{fmtMoney(cost.totals[c.key], cur)}</b></li>
              ))}
              <li className="vh-legend-total"><span>Total</span><b>{fmtMoney(cost.total, cur)}</b></li>
            </ul>
          </div>
        )}
      </CardState>
      {currencies.length > 1 && <p className="vh-note">This asset carries spend in more than one currency. Each is charted on its own and never added together.</p>}
    </Card>
  )
}

function DowntimeCard({ state, down }) {
  const data = down && {
    labels: down.months.map(monthLabel),
    datasets: [{
      label: 'Downtime days', data: down.days, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.12)',
      fill: true, tension: 0.3, pointRadius: 3, spanGaps: false,
    }],
  }
  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => (ctx.raw == null ? ' Not measurable' : ` ${ctx.raw} days`) } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: CHART_TEXT, font: { size: 10 } } },
      y: { beginAtZero: true, grid: { color: CHART_GRID }, ticks: { color: CHART_TEXT, font: { size: 10 } } },
    },
  }
  return (
    <Card title="Downtime trend" sub="Job card time out of production (production out to production in), by the month the asset went out.">
      <CardState state={state} lines={4} empty={down && !down.cards ? 'No job cards in this period, so there is no downtime to chart.' : null}>
        {down && (
          <div className="vh-chart-row">
            <div className="vh-chart vh-chart-sm"><Line data={data} options={opts} /></div>
            <div className="vh-down-total">
              <b>{fmtDays(down.total)}</b>
              <span>in this period</span>
            </div>
          </div>
        )}
      </CardState>
    </Card>
  )
}

function TyrePdfButton({ row, currency, defaultCost }) {
  const { t } = useLanguage()
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
    const pdfRows = [...row.records]
      .sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date))
      .map(r => ({ ...r, cost_display: ((r.cost_per_tyre || defaultCost) * (r.qty || 1)).toLocaleString() }))
    exportToPdf(
      pdfRows, cols,
      `Vehicle Asset History: ${row.assetNo} (${row.count} records, Misuse Score: ${row.misuseScore})`,
      `VehicleHistory_${row.assetNo}_${new Date().toISOString().slice(0, 10)}`
    )
  }
  return (
    <button type="button" onClick={handleExportPdf} className="cc-btn-ghost">
      <FileText size={13} aria-hidden="true" /> {t('vehiclehistory.detail.exportPdf')}
    </button>
  )
}

/** Tyre analysis: misuse score, red flags, the tyre position diagram and charts. */
function TyreAnalysisCard({ row, currency, defaultCost, fleetRecord, tyrePositions }) {
  const { t } = useLanguage()
  const monthlyBuckets = useMemo(() =>
    bucketByMonth(row.records, r => r.issue_date, r => (r.cost_per_tyre || defaultCost) * (r.qty || 1)),
  [row.records, defaultCost])
  const categoryBreakdown = useMemo(() => countBy(row.records.filter(r => r.category), r => r.category), [row.records])
  const brandBreakdown = useMemo(() => countBy(row.records.filter(r => r.brand), r => r.brand), [row.records])
  const totalCost   = row.totalCost
  const avgCostTyre = row.count > 0 ? totalCost / row.count : 0
  const highRiskPct = row.count > 0 ? (row.highRiskCount / row.count) * 100 : 0
  const kmValues = row.records
    .map(r => (r.km_at_removal != null && r.km_at_fitment != null) ? +r.km_at_removal - +r.km_at_fitment : null)
    .filter(v => v !== null && v > 0)
  const avgKm = kmValues.length ? Math.round(kmValues.reduce((s, v) => s + v, 0) / kmValues.length) : null

  return (
    <Card
      title={t('vehiclehistory.tabs.analysis')}
      sub={`${t('vehiclehistory.detail.replacementsSummary', { count: row.count, currency, cost: (totalCost || 0).toLocaleString('en-SA', { maximumFractionDigits: 0 }) })}${row.firstSeen ? ` | ${t('vehiclehistory.detail.since', { date: row.firstSeen })}` : ''}`}
      action={
        <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${misuseBadgeClass(row.misuseScore)}`}>
          {t('vehiclehistory.detail.misuseRisk', { score: row.misuseScore })}
        </span>
      }
    >
      <div className="space-y-5">
        {fleetRecord?.vehicle_type ? (
          <div>
            <p className="vh-h3">{t('vehiclehistory.detail.tyrePositionOverview')}</p>
            <div className="flex flex-wrap gap-8 items-start">
              <VehicleTyreDiagram positions={tyrePositions} vehicleType={fleetRecord.vehicle_type} />
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
                      <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color, opacity: item.isNoData ? 0.4 : 1 }} />
                      <span className="text-xs text-muted">{item.label}</span>
                    </div>
                  ))}
                </div>
                {tyrePositions.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-xs text-muted mb-2">{t('vehiclehistory.detail.currentTyreData')}</p>
                    {tyrePositions.filter(p => p.risk_level).map(p => (
                      <div key={p.position} className="flex items-center gap-2 text-xs">
                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }[p.risk_level] ?? 'var(--text-dim)' }} />
                        <span className="font-mono text-muted w-16">{p.position}</span>
                        <span className="text-muted">{p.brand || 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="vh-note">
            {t('vehiclehistory.detail.noFleetRecord')}{' '}
            <Link to="/fleet-master" className="cc-link">{t('vehiclehistory.detail.addInFleetMaster')}</Link>
          </p>
        )}

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
      </div>
    </Card>
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
// The register table lists only assets that carry a TYRE RECORD, so machines
// without one could not be opened from this page at all. This search covers
// the WHOLE register, and it PAGES - PostgREST caps a response at 1,000 rows
// whatever .limit() claims, so an unpaged picker silently hides several hundred
// assets and the reader concludes the machine is not in the system.
// ─────────────────────────────────────────────────────────────────────────────

function AssetOpener({ country, activeAsset, onOpen }) {
  const [options, setOptions] = useState([])
  const [state, setState]     = useState('loading') // loading | ready | error
  const [query, setQuery]     = useState('')
  const [nonce, setNonce]     = useState(0)

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
    run().catch(() => { if (!cancelled) { setState('error'); setOptions([]) } })
    return () => { cancelled = true }
  }, [country, nonce])

  const matches = useMemo(() => {
    const q = canonAssetNo(query)
    if (!q) return []
    return options.filter(o => canonAssetNo(o.asset_no).includes(q)).slice(0, 12)
  }, [query, options])

  return (
    <Card
      className="vh-opener"
      title="Find an asset"
      sub={
        state === 'loading' ? 'Loading the register'
          : state === 'error' ? 'The register could not be read, so this search is unavailable.'
            : `${options.length.toLocaleString('en-US')} assets in the register, including machines that have never had a tyre recorded against them.`
      }
      action={state === 'error' && <button type="button" className="cc-btn-ghost" onClick={() => setNonce(n => n + 1)}><RefreshCw size={13} aria-hidden="true" /> Retry</button>}
    >
      <div className="cc-search">
        <History size={15} aria-hidden="true" />
        <input
          aria-label="Search the register by asset number"
          placeholder="Search by asset number to open its full history"
          value={query}
          onChange={e => setQuery(e.target.value)}
          disabled={state !== 'ready'}
        />
      </div>

      {query && state === 'ready' && (
        <div className="vh-matches">
          {matches.length === 0 ? (
            <p className="vh-note">
              No asset in the register matches that code
              {country && country !== 'All' ? ` in ${country}` : ''}.
            </p>
          ) : matches.map(o => (
            <button
              type="button"
              key={`${o.country}:${o.asset_no}`}
              onClick={() => { onOpen(o.asset_no); setQuery('') }}
              className={`vh-match ${canonAssetNo(o.asset_no) === canonAssetNo(activeAsset) ? 'is-active' : ''}`}
            >
              <VehicleThumb row={o} size="sm" />
              <span>
                <b>{o.asset_no}</b>
                <small>{[o.country, o.vehicle_type, o.site].filter(Boolean).join(' | ')}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}
