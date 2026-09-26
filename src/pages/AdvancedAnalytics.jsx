import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, BarChart2, Calendar, MapPin,
  Globe, Building2, Truck, User, Tag, AlertTriangle,
  Download, FileSpreadsheet, Info, Award, Star, RefreshCw, Search,
} from 'lucide-react'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Bar, Line, Doughnut, Scatter } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { ANALYTICS_TABS } from '../components/ui/SectionTabs'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { fetchAllPages } from '../lib/fetchAll'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import {
  DATE_PRESETS, POSITIONS, cutoffDate, filterRecords, uniqueSites as listSites,
  summarizeKpis, buildTrend, buildSeasonal, buildGeo, buildCountry, buildBranch,
  buildVehicle, buildDriver, buildBrand, buildFailure, heatColor,
} from '../lib/advancedAnalyticsAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
)

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'trend',    label: 'Trend Analysis',       icon: TrendingUp },
  { id: 'seasonal', label: 'Seasonal Analysis',    icon: Calendar },
  { id: 'geo',      label: 'Geographic Analysis',  icon: MapPin },
  { id: 'country',  label: 'Country Comparison',   icon: Globe },
  { id: 'branch',   label: 'Branch Comparison',    icon: Building2 },
  { id: 'vehicle',  label: 'Vehicle Comparison',   icon: Truck },
  { id: 'driver',   label: 'Driver Comparison',    icon: User },
  { id: 'brand',    label: 'Brand Comparison',     icon: Tag },
  { id: 'failure',  label: 'Failure Patterns',     icon: AlertTriangle },
]

const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#06b6d4','#84cc16','#f97316','#a855f7',
  '#14b8a6','#eab308','#6366f1','#f43f5e','#0ea5e9',
]

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Scale guard: cap the row-level analytics pull so this page never streams a
// whole multi-million-row table into the browser. Country and the selected date
// preset are both pushed server-side; this cap bounds whatever remains. Beyond
// it the newest rows are used and a "capped view" note is shown.
const ROW_CAP = 50000

// ── Chart base options ────────────────────────────────────────────────────────

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280' } },
    y: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280' } },
  },
}

const NO_LEGEND_OPTS = {
  ...BASE_OPTS,
  plugins: { ...BASE_OPTS.plugins, legend: { display: false } },
}

const H_BAR_OPTS = {
  ...NO_LEGEND_OPTS,
  indexAxis: 'y',
}

// ── Formatters (N/A for anything not measured, never a fabricated 0) ─────────

const NA = 'N/A'

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return NA
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function fmtCur(n, currency) {
  if (n == null || Number.isNaN(Number(n))) return NA
  return formatCurrencyCompact(n, currency)
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return NA
  return `${Number(n).toFixed(1)}%`
}

function fmtCpk(n, currency) {
  if (n == null || Number.isNaN(Number(n))) return NA
  return `${currency} ${Number(n).toFixed(4)}/km`
}

function rateTone(v, hi = 20, mid = 10) {
  if (v == null) return 'text-[var(--text-muted)]'
  if (v > hi) return 'text-red-400'
  if (v > mid) return 'text-yellow-400'
  return 'text-emerald-400'
}

const TREND_CLS = {
  worsening: 'bg-red-900/40 text-red-400 border border-red-800',
  improving: 'bg-emerald-900/40 text-emerald-400 border border-emerald-800',
  stable:    'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
}
const TREND_ARROW = { worsening: '↑', improving: '↓', stable: '→' }

// Shared column helpers for EnterpriseTable.
const numCol = (id, header, get, render, extra = {}) => ({
  id, header,
  accessorFn: r => get(r) ?? undefined,
  sortUndefined: 'last',
  meta: { align: 'right', exportValue: r => get(r) ?? '' },
  cell: ({ row }) => render(get(row.original), row.original),
  ...extra,
})
const textCol = (id, header, get, extra = {}) => ({
  id, header,
  accessorFn: r => get(r) ?? '',
  cell: ({ getValue }) => getValue() || NA,
  ...extra,
})

// Compact embedded-table defaults: these are sub-tables inside tabs.
const SUB_TABLE = {
  enableColumnFilters: false,
  enableColumnVisibility: false,
  initialPageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>
}

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wide">{children}</h3>
}

function LoadingOverlay() {
  return (
    <div className="space-y-4">
      <SkeletonCards count={4} />
      <SkeletonChart />
    </div>
  )
}

function EmptyState({ message }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--text-muted)]">
      <BarChart2 size={32} className="opacity-30" />
      <p className="text-sm">{message || t('advancedanalytics.states.noData')}</p>
    </div>
  )
}

function ChartBox({ title, height = 260, children }) {
  return (
    <Card>
      {title && <SectionTitle>{title}</SectionTitle>}
      <div style={{ height }}>{children}</div>
    </Card>
  )
}

function MetricTile({ label, value, sub }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold text-[var(--text-primary)]">{value}</span>
      {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
    </Card>
  )
}

function HeatCell({ value, style, text }) {
  return (
    <span className="block -mx-2 -my-1 px-2 py-1 text-center text-[var(--text-secondary)]" style={style}>
      {text ?? (value == null ? NA : value)}
    </span>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdvancedAnalytics() {
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()

  const [records,        setRecords]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [exportError,    setExportError]    = useState(null)
  const [capped,         setCapped]         = useState(false)
  const [activeTab,      setActiveTab]      = useState('trend')
  const [datePreset,     setDatePreset]     = useState('1yr')
  const [siteFilter,     setSiteFilter]     = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [search,         setSearch]         = useState('')
  const [reloadKey,      setReloadKey]      = useState(0)

  // Changing the date preset refetches while the previous read is still paging.
  // If the earlier one finishes last it paints the PREVIOUS preset's records
  // under the new one, so every load is sequenced.
  const latestLoad = useLatestRequest()

  useEffect(() => {
    async function load() {
      const stale = latestLoad.begin()
      setLoading(true)
      setError(null)
      setCapped(false)
      try {
        // The preset is pushed server-side so a wide history is never pulled
        // whole; filterRecords re-applies the same cutoff client-side.
        const cutoff = cutoffDate(datePreset)
        const { data, error: err, truncated } = await fetchAllPages((from, to) => {
          let q = supabase
            .from('tyre_records')
            .select('id,asset_no,site,brand,position,risk_level,category,findings,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,tread_depth,pressure_reading')
            .order('issue_date', { ascending: true })
            .order('id', { ascending: true })
          if (activeCountry !== 'All') q = q.eq('country', activeCountry)
          if (cutoff) q = q.gte('issue_date', cutoff)
          return q.range(from, to)
        }, { max: ROW_CAP })
        if (err) throw err
        if (stale()) return
        setRecords(data || [])
        setCapped(!!truncated)
      } catch (e) {
        if (!stale()) setError(toUserMessage(e, t('advancedanalytics.states.loadFailed')))
      } finally {
        if (!stale()) setLoading(false)
      }
    }
    load()
  }, [activeCountry, datePreset, latestLoad, t, reloadKey])

  const sites = useMemo(() => listSites(records), [records])

  const filtered = useMemo(
    () => filterRecords(records, { preset: datePreset, site: siteFilter, position: positionFilter, search }),
    [records, datePreset, siteFilter, positionFilter, search],
  )

  const kpis         = useMemo(() => summarizeKpis(filtered), [filtered])
  const trendData    = useMemo(() => buildTrend(filtered), [filtered])
  const seasonalData = useMemo(() => buildSeasonal(filtered), [filtered])
  const geoData      = useMemo(() => buildGeo(filtered), [filtered])
  const countryData  = useMemo(() => buildCountry(filtered), [filtered])
  const branchData   = useMemo(() => buildBranch(filtered), [filtered])
  const vehicleData  = useMemo(() => buildVehicle(filtered), [filtered])
  const driverData   = useMemo(() => buildDriver(filtered, vehicleData), [filtered, vehicleData])
  const brandData    = useMemo(() => buildBrand(filtered), [filtered])
  const failureData  = useMemo(() => buildFailure(filtered), [filtered])

  const filtersActive = siteFilter !== 'all' || positionFilter !== 'all' || search.trim() !== ''
  const tabLabel = TABS.find(x => x.id === activeTab)?.label || activeTab
  const presetLabel = DATE_PRESETS.find(p => p.id === datePreset)?.label || datePreset
  const exportBase = reportFileName('Advanced Analytics', tabLabel, presetLabel)

  function clearFilters() {
    setSiteFilter('all')
    setPositionFilter('all')
    setSearch('')
  }

  async function handleExportExcel() {
    setExportError(null)
    const cols = ['asset_no','site','brand','position','risk_level','category','km_at_fitment','km_at_removal','cost_per_tyre','issue_date']
    const hdrs = ['Asset No','Site','Brand','Position','Risk Level','Category','KM Fitment','KM Removal',`Cost/Tyre (${activeCurrency})`,'Issue Date']
    try {
      await exportToExcel(filtered, cols, hdrs, exportBase, 'Tyre Records', { currency: activeCurrency })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function handleExportPdf() {
    setExportError(null)
    const cols = [
      { key: 'asset_no', header: 'Asset No' },
      { key: 'site', header: 'Site' },
      { key: 'brand', header: 'Brand' },
      { key: 'position', header: 'Position' },
      { key: 'risk_level', header: 'Risk Level' },
      { key: 'category', header: 'Category' },
      { key: 'cost_per_tyre', header: `Cost (${activeCurrency})` },
      { key: 'issue_date', header: 'Date' },
    ]
    try {
      await exportToPdf(filtered, cols, `Advanced Analytics: ${tabLabel}`, exportBase)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const exportDisabled = loading || !!error || filtered.length === 0

  return (
    <div className="text-[var(--text-primary)] space-y-6">
      <SectionTabs tabs={ANALYTICS_TABS} />
      <div className="px-6 pt-6 pb-4 border-b border-[var(--input-border)]">
        <PageHeader
          title={t('advancedanalytics.title')}
          subtitle={t('advancedanalytics.subtitle', { records: fmt(filtered.length), sites: sites.length })}
          icon={BarChart2}
          actions={<>
            <button
              type="button"
              onClick={() => setReloadKey(k => k + 1)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exportDisabled}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] transition-colors disabled:opacity-50"
            >
              <FileSpreadsheet size={13} />
              {t('advancedanalytics.actions.excel')}
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportDisabled}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] transition-colors disabled:opacity-50"
            >
              <Download size={13} />
              {t('advancedanalytics.actions.pdf')}
            </button>
          </>}
        />

        {/* Global Filters */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-0.5">
            {DATE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDatePreset(p.id)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  datePreset === p.id
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t(`advancedanalytics.datePresets.${p.id}`)}
              </button>
            ))}
          </div>

          <select
            aria-label="Site"
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            className="text-xs bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-secondary)] focus:outline-none focus:border-blue-600"
          >
            <option value="all">{t('advancedanalytics.filters.allSites')}</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            aria-label="Position"
            value={positionFilter}
            onChange={e => setPositionFilter(e.target.value)}
            className="text-xs bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-secondary)] focus:outline-none focus:border-blue-600"
          >
            {POSITIONS.map(p => (
              <option key={p} value={p === 'All' ? 'all' : p}>{t(`advancedanalytics.positions.${p.toLowerCase()}`)}</option>
            ))}
          </select>

          <label className="relative">
            <span className="sr-only">Search records</span>
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search asset, brand, site, category"
              className="text-xs bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg pl-7 pr-2 py-1.5 w-60 text-[var(--text-secondary)] focus:outline-none focus:border-blue-600"
            />
          </label>

          {filtersActive && (
            <button type="button" onClick={clearFilters} className="text-xs text-blue-400 hover:text-blue-300">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {capped && (
        <div className="mx-6 flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Capped view: this country and period hold more than {fmt(ROW_CAP)} tyre records. Showing the first {fmt(ROW_CAP)} for performance. Narrow the date range or site for complete detail.
          </span>
        </div>
      )}

      {exportError && (
        <div role="alert" className="mx-6 flex items-start gap-2 rounded-lg border border-red-800/40 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {/* KPI strip: figures for the current filter set; unmeasured values read N/A. */}
      {!loading && !error && (
        <div className="px-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricTile label="Records" value={fmt(kpis.records)} sub={`${fmt(kpis.vehicles)} vehicles`} />
          <MetricTile label="Total tyre cost" value={fmtCur(kpis.totalCost, activeCurrency)} sub={presetLabel} />
          <MetricTile label="Avg cost per km" value={fmtCpk(kpis.avgCpk, activeCurrency)} sub="Measured tyres only" />
          <MetricTile label="Avg tyre life" value={kpis.avgLife == null ? NA : `${fmt(kpis.avgLife)} km`} sub="Fitment to removal" />
          <MetricTile label="Failure rate" value={fmtPct(kpis.failureRate)} sub={`${fmt(kpis.highRisk)} High or Critical`} />
          <MetricTile label="Sites" value={fmt(kpis.sites)} sub={activeCountry === 'All' ? 'All countries' : activeCountry} />
        </div>
      )}

      <div className="px-6 pt-4 pb-0 overflow-x-auto">
        <div role="tablist" className="flex gap-1 border-b border-[var(--input-border)] min-w-max">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Icon size={13} />
                {t(`advancedanalytics.tabs.${tab.id}`)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <LoadingOverlay />
        ) : error ? (
          <div role="alert" className="flex flex-col items-center justify-center h-48 gap-3 text-red-400">
            <div className="flex items-center gap-2">
              <AlertTriangle size={20} />
              <span className="text-sm">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setReloadKey(k => k + 1)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-red-800 rounded-lg text-xs text-red-300 hover:bg-red-900/30"
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <EmptyState message={filtersActive
              ? 'No tyre records match these filters.'
              : t('advancedanalytics.states.noData')} />
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="text-xs text-blue-400 hover:text-blue-300">Clear filters</button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {activeTab === 'trend'    && <TrendTab    data={trendData}    currency={activeCurrency} />}
              {activeTab === 'seasonal' && <SeasonalTab data={seasonalData} currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'geo'      && <GeoTab      data={geoData}      currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'country'  && <CountryTab  data={countryData}  currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'branch'   && <BranchTab   data={branchData}   currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'vehicle'  && <VehicleTab  data={vehicleData}  currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'driver'   && <DriverTab   data={driverData}   currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'brand'    && <BrandTab    data={brandData}    currency={activeCurrency} exportBase={exportBase} />}
              {activeTab === 'failure'  && <FailureTab  data={failureData}  exportBase={exportBase} />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tab 1: Trend Analysis ──────────────────────────────────────────────────────
function TrendTab({ data, currency }) {
  const { t } = useLanguage()
  if (!data) return <EmptyState />

  const { labels, fLabels, cpkVals, failRateVals, countVals,
          movAvgCpk, cpkForecast, failForecast, countForecast, directions } = data

  const badge = (dir, label) => ({
    text: `${t(`advancedanalytics.trend.${dir}`)} ${TREND_ARROW[dir]} ${label}`,
    cls: TREND_CLS[dir],
  })
  const badges = [
    badge(directions.cpk, t('advancedanalytics.trend.cpk')),
    badge(directions.fail, t('advancedanalytics.trend.failureRate')),
    badge(directions.count, t('advancedanalytics.trend.volume')),
  ]

  const allLabels = [...labels, ...fLabels]
  const pad = Array(fLabels.length).fill(null)
  const lead = Array(labels.length).fill(null)

  const cpkData = {
    labels: allLabels,
    datasets: [
      {
        label: t('advancedanalytics.trend.avgCpk'),
        data: [...cpkVals, ...pad],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3,
      },
      {
        label: t('advancedanalytics.trend.movingAvg'),
        data: [...movAvgCpk, ...pad],
        borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, tension: 0.3,
      },
      {
        label: t('advancedanalytics.trend.forecast'),
        data: [...lead, ...cpkForecast.forecast],
        borderColor: '#3b82f6', borderDash: [6, 4], borderWidth: 2,
        pointRadius: 4, pointStyle: 'triangle', tension: 0.3,
      },
    ],
  }

  const failData = {
    labels: allLabels,
    datasets: [
      {
        label: t('advancedanalytics.trend.failureRatePct'),
        data: [...failRateVals, ...pad],
        borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',
        borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3,
      },
      {
        label: t('advancedanalytics.trend.forecast'),
        data: [...lead, ...failForecast.forecast],
        borderColor: '#ef4444', borderDash: [6, 4], borderWidth: 2, pointRadius: 4, tension: 0.3,
      },
    ],
  }

  const countData = {
    labels: allLabels,
    datasets: [
      {
        label: t('advancedanalytics.trend.replacements'),
        data: [...countVals, ...pad],
        backgroundColor: 'rgba(139,92,246,0.7)', borderColor: '#8b5cf6', borderWidth: 1, borderRadius: 3,
      },
      {
        label: t('advancedanalytics.trend.forecast'),
        data: [...lead, ...countForecast.forecast],
        backgroundColor: 'rgba(139,92,246,0.3)', borderColor: '#8b5cf6',
        borderDash: [6, 4], borderWidth: 1.5, borderRadius: 3,
      },
    ],
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {badges.map((b, i) => (
          <span key={i} className={`text-xs px-3 py-1 rounded-full font-medium ${b.cls}`}>{b.text}</span>
        ))}
        <span className="text-xs px-3 py-1 rounded-full bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">
          {t('advancedanalytics.trend.forecastNote')}
        </span>
      </div>

      <ChartBox title={t('advancedanalytics.trend.cpkChart')} height={280}>
        <Line data={cpkData} options={{
          ...BASE_OPTS,
          plugins: { ...BASE_OPTS.plugins, legend: { labels: { color: '#9ca3af', font: { size: 10 } } } },
          scales: {
            ...BASE_OPTS.scales,
            y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => `${currency} ${Number(v).toFixed(4)}` } },
          },
        }} />
      </ChartBox>

      <ChartBox title={t('advancedanalytics.trend.failChart')} height={260}>
        <Line data={failData} options={{
          ...BASE_OPTS,
          scales: {
            ...BASE_OPTS.scales,
            y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => `${Number(v).toFixed(1)}%` } },
          },
        }} />
      </ChartBox>

      <ChartBox title={t('advancedanalytics.trend.volumeChart')} height={260}>
        <Bar data={countData} options={BASE_OPTS} />
      </ChartBox>
    </div>
  )
}

// ── Tab 2: Seasonal Analysis ───────────────────────────────────────────────────
function SeasonalTab({ data, currency, exportBase }) {
  const { t } = useLanguage()
  const columns = useMemo(() => {
    if (!data) return []
    const { maxCost, countMax } = data
    return [
      textCol('month', t('advancedanalytics.seasonal.month'), r => r.key, {
        cell: ({ row }) => <span className="font-medium">{row.original.month}</span>,
        meta: { exportValue: r => r.month },
      }),
      numCol('count', t('advancedanalytics.seasonal.count'), r => r.count,
        v => <HeatCell style={{ backgroundColor: heatColor(v, 0, countMax) }} text={fmt(v)} />),
      numCol('failPct', t('advancedanalytics.seasonal.failurePct'), r => r.failPct,
        v => <HeatCell style={v == null ? undefined : { backgroundColor: heatColor(v, 0, 30) }} text={fmtPct(v)} />),
      numCol('cost', t('advancedanalytics.seasonal.totalCost'), r => r.cost,
        v => <HeatCell style={{ backgroundColor: heatColor(v, 0, maxCost) }} text={fmtCur(v, currency)} />),
      numCol('avgCost', t('advancedanalytics.seasonal.avgCost'), r => r.avgCost, v => fmtCur(v, currency)),
      numCol('blowouts', t('advancedanalytics.seasonal.blowouts'), r => r.blowouts, v => fmt(v)),
    ]
  }, [data, t, currency])

  if (!data) return <EmptyState />
  const { seasons, cpkByMonth, worstCostMonth } = data
  const monthLabels = MONTH_LABELS.map(m => t(`advancedanalytics.months.${m.toLowerCase()}`))

  const cpkBar = {
    labels: monthLabels,
    datasets: [{
      label: t('advancedanalytics.seasonal.avgCpkCur', { currency }),
      data: cpkByMonth,
      backgroundColor: 'rgba(59,130,246,0.75)',
      borderColor: '#3b82f6', borderWidth: 1, borderRadius: 4,
    }],
  }

  const failBar = {
    labels: monthLabels,
    datasets: [{
      label: t('advancedanalytics.seasonal.failureRatePct'),
      data: seasons.map(s => s.failPct),
      backgroundColor: seasons.map(s => {
        const v = s.failPct ?? 0
        if (v > 20) return 'rgba(239,68,68,0.75)'
        if (v > 10) return 'rgba(245,158,11,0.75)'
        return 'rgba(16,185,129,0.75)'
      }),
      borderWidth: 0, borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      {worstCostMonth && (
        <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-800/40 rounded-xl px-4 py-3">
          <Info size={15} className="text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-300">
            <strong>{worstCostMonth.month}</strong> {t('advancedanalytics.seasonal.insight', { cost: fmtCur(worstCostMonth.cost, currency) })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title={t('advancedanalytics.seasonal.cpkChart')} height={250}>
          <Bar data={cpkBar} options={{
            ...NO_LEGEND_OPTS,
            scales: {
              ...NO_LEGEND_OPTS.scales,
              y: { ...NO_LEGEND_OPTS.scales.y, ticks: { ...NO_LEGEND_OPTS.scales.y.ticks, callback: v => `${currency} ${Number(v).toFixed(4)}` } },
            },
          }} />
        </ChartBox>
        <ChartBox title={t('advancedanalytics.seasonal.failChart')} height={250}>
          <Bar data={failBar} options={NO_LEGEND_OPTS} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>{t('advancedanalytics.seasonal.heatTitle')}</SectionTitle>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={columns}
          data={seasons}
          getRowId={r => r.key}
          enableGlobalFilter={false}
          exportFileName={reportFileName(exportBase, 'Seasonal')}
          emptyMessage="No seasonal data for these filters."
        />
      </Card>
    </div>
  )
}

// ── Tab 3: Geographic Analysis ─────────────────────────────────────────────────
function GeoTab({ data, currency, exportBase }) {
  const siteColumns = useMemo(() => [
    textCol('site', 'Site', r => r.site),
    numCol('count', 'Records', r => r.count, v => fmt(v)),
    numCol('totalCost', 'Total Cost', r => r.totalCost, v => fmtCur(v, currency)),
    numCol('avgCost', 'Avg Cost', r => r.avgCost, v => fmtCur(v, currency)),
    numCol('highRiskPct', 'High Risk %', r => r.highRiskPct,
      v => <span className={`font-medium ${rateTone(v)}`}>{fmtPct(v)}</span>),
    numCol('riskScore', 'Risk Score', r => r.riskScore, v => fmt(v, 2)),
    textCol('topCategory', 'Top Category', r => r.topCategory),
    textCol('topBrand', 'Top Brand', r => r.topBrand),
  ], [currency])

  const heatColumns = useMemo(() => {
    if (!data) return []
    const { allMonths, heatMin, heatMax } = data
    return [
      textCol('site', 'Site', r => r.site),
      ...allMonths.map((m, j) => numCol(`m_${m}`, m.slice(5), r => r.row[j],
        v => <HeatCell
          style={v != null ? { backgroundColor: heatColor(v, heatMin, heatMax) } : undefined}
          text={v != null ? `${v.toFixed(0)}%` : NA} />,
        { meta: { align: 'center', exportHeader: m, exportValue: r => r.row[j] ?? '' } })),
    ]
  }, [data])

  if (!data) return <EmptyState />
  const { sites, allMonths, heatmap } = data
  const top15 = sites.slice(0, 15)

  const costBar = {
    labels: top15.map(s => s.site),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: top15.map(s => s.totalCost),
      backgroundColor: PALETTE.map(c => c + 'bb'),
      borderColor: PALETTE, borderWidth: 1, borderRadius: 4,
    }],
  }

  const failBar = {
    labels: top15.map(s => s.site),
    datasets: [{
      label: 'High Risk %',
      data: top15.map(s => s.highRiskPct),
      backgroundColor: top15.map(s =>
        s.highRiskPct > 25 ? 'rgba(239,68,68,0.75)' :
        s.highRiskPct > 15 ? 'rgba(245,158,11,0.75)' : 'rgba(16,185,129,0.75)'
      ),
      borderWidth: 0, borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Total Cost by Site (Top 15)" height={280}>
          <Bar data={costBar} options={H_BAR_OPTS} />
        </ChartBox>
        <ChartBox title="High-Risk Rate % by Site" height={280}>
          <Bar data={failBar} options={{
            ...H_BAR_OPTS,
            scales: {
              ...H_BAR_OPTS.scales,
              x: { ...H_BAR_OPTS.scales.x, ticks: { ...H_BAR_OPTS.scales.x.ticks, callback: v => `${Number(v).toFixed(0)}%` } },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>Site Performance Summary</SectionTitle>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={siteColumns}
          data={sites}
          getRowId={r => r.site}
          searchPlaceholder="Search sites"
          exportFileName={reportFileName(exportBase, 'Sites')}
          emptyMessage="No site data for these filters."
        />
      </Card>

      {heatmap.length > 0 && allMonths.length > 0 && (
        <Card>
          <SectionTitle>Site by Month Failure Rate Heat Map (Last 12 Months)</SectionTitle>
          <EnterpriseTable
            {...SUB_TABLE}
            columns={heatColumns}
            data={heatmap}
            getRowId={r => r.site}
            enableGlobalFilter={false}
            stickyFirstColumn
            exportFileName={reportFileName(exportBase, 'Site Heat Map')}
            emptyMessage="No heat map data for these filters."
          />
        </Card>
      )}
    </div>
  )
}

// ── Tab 4: Country Comparison ──────────────────────────────────────────────────
function CountryTab({ data, currency, exportBase }) {
  const columns = useMemo(() => [
    textCol('region', 'Region', r => r.region),
    numCol('count', 'Records', r => r.count, v => fmt(v)),
    numCol('siteCount', 'Sites', r => r.siteCount, v => fmt(v)),
    numCol('totalCost', 'Total Cost', r => r.totalCost, v => fmtCur(v, currency)),
    numCol('avgCpk', 'Avg CPK', r => r.avgCpk, v => fmtCpk(v, currency)),
    numCol('failRate', 'Failure %', r => r.failRate,
      v => <span className={`font-medium ${rateTone(v)}`}>{fmtPct(v)}</span>),
    textCol('sites', 'Site list', r => r.sites, {
      cell: ({ getValue }) => <span className="block truncate max-w-[220px]" title={getValue()}>{getValue() || NA}</span>,
    }),
  ], [currency])

  if (!data?.regions?.length) return <EmptyState />
  const { regions } = data

  const costBar = {
    labels: regions.map(r => r.region),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: regions.map(r => r.totalCost),
      backgroundColor: PALETTE.map(c => c + 'bb'),
      borderColor: PALETTE, borderWidth: 1, borderRadius: 4,
    }],
  }

  const cpkBar = {
    labels: regions.map(r => r.region),
    datasets: [{
      label: 'Avg CPK',
      data: regions.map(r => r.avgCpk),
      backgroundColor: 'rgba(16,185,129,0.7)', borderColor: '#10b981', borderWidth: 1, borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Total Cost by Country/Region" height={260}>
          <Bar data={costBar} options={NO_LEGEND_OPTS} />
        </ChartBox>
        <ChartBox title="Average CPK by Country/Region" height={260}>
          <Bar data={cpkBar} options={{
            ...NO_LEGEND_OPTS,
            scales: {
              ...NO_LEGEND_OPTS.scales,
              y: { ...NO_LEGEND_OPTS.scales.y, ticks: { ...NO_LEGEND_OPTS.scales.y.ticks, callback: v => `${Number(v).toFixed(4)}` } },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>Full Metrics by Country/Region</SectionTitle>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={columns}
          data={regions}
          getRowId={r => r.region}
          searchPlaceholder="Search regions"
          exportFileName={reportFileName(exportBase, 'Regions')}
          emptyMessage="No region data for these filters."
        />
      </Card>
    </div>
  )
}

// ── Tab 5: Branch Comparison ───────────────────────────────────────────────────
const MEDALS = [
  { icon: <Award size={16} className="text-yellow-400" />, label: 'Gold', cls: 'border-yellow-700 bg-yellow-900/20' },
  { icon: <Award size={16} className="text-[var(--text-secondary)]" />, label: 'Silver', cls: 'border-gray-600 bg-[var(--input-bg)]/40' },
  { icon: <Award size={16} className="text-amber-700" />, label: 'Bronze', cls: 'border-amber-800 bg-amber-900/20' },
]

function BranchTab({ data, currency, exportBase }) {
  const columns = useMemo(() => [
    numCol('rank', '#', r => r.rank, v => v, { size: 50 }),
    textCol('site', 'Branch', r => r.site),
    numCol('compositeScore', 'Score', r => r.compositeScore,
      v => <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded text-xs font-bold">{v}</span>),
    numCol('count', 'Records', r => r.count, v => fmt(v)),
    numCol('totalCost', 'Total Cost', r => r.totalCost, v => fmtCur(v, currency)),
    numCol('avgCost', 'Avg Cost', r => r.avgCost, v => fmtCur(v, currency)),
    numCol('avgCpk', 'Avg CPK', r => r.avgCpk, v => fmtCpk(v, currency)),
    numCol('avgLife', 'Avg Life (km)', r => r.avgLife, v => fmt(v)),
    numCol('failRate', 'Failure %', r => r.failRate,
      v => <span className={`font-medium ${rateTone(v)}`}>{fmtPct(v)}</span>),
    numCol('highRiskCount', 'High Risk', r => r.highRiskCount, v => fmt(v)),
  ], [currency])

  if (!data?.branches?.length) return <EmptyState />
  const { branches } = data
  const top3 = branches.slice(0, 3)
  const top12 = branches.slice(0, 12)

  const scoreBar = {
    labels: top12.map(b => b.site),
    datasets: [{
      label: 'Composite Score',
      data: top12.map(b => b.compositeScore),
      backgroundColor: top12.map((_, i) =>
        i === 0 ? 'rgba(234,179,8,0.8)' : i === 1 ? 'rgba(156,163,175,0.7)' : i === 2 ? 'rgba(180,83,9,0.7)' : 'rgba(59,130,246,0.6)'
      ),
      borderWidth: 0, borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {top3.map((b, i) => (
          <Card key={b.site} className={`border ${MEDALS[i]?.cls ?? ''}`}>
            <div className="flex items-center gap-2 mb-2">
              {MEDALS[i]?.icon}
              <span className="text-xs text-[var(--text-muted)]">{MEDALS[i]?.label} · Rank #{i + 1}</span>
            </div>
            <div className="text-base font-bold text-[var(--text-primary)] mb-1">{b.site}</div>
            <div className="flex flex-wrap gap-3 mt-2">
              <div><span className="text-xs text-[var(--text-muted)]">Score</span><div className="text-sm font-bold text-blue-400">{b.compositeScore}</div></div>
              <div><span className="text-xs text-[var(--text-muted)]">Records</span><div className="text-sm font-semibold text-[var(--text-secondary)]">{fmt(b.count)}</div></div>
              <div><span className="text-xs text-[var(--text-muted)]">Fail %</span><div className={`text-sm font-semibold ${rateTone(b.failRate, 15, 15)}`}>{fmtPct(b.failRate)}</div></div>
              <div><span className="text-xs text-[var(--text-muted)]">Cost</span><div className="text-sm font-semibold text-[var(--text-secondary)]">{fmtCur(b.totalCost, currency)}</div></div>
            </div>
          </Card>
        ))}
      </div>

      <ChartBox title="Branch Composite Score (Top 12)" height={240}>
        <Bar data={scoreBar} options={H_BAR_OPTS} />
      </ChartBox>

      <Card>
        <SectionTitle>Full Branch Comparison Table</SectionTitle>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Score weights cost per km 40%, failure rate 30% and tyre life 30%. A component with no measurement takes the midpoint.
        </p>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={columns}
          data={branches}
          getRowId={r => r.site}
          searchPlaceholder="Search branches"
          exportFileName={reportFileName(exportBase, 'Branches')}
          emptyMessage="No branch data for these filters."
        />
      </Card>
    </div>
  )
}

// ── Tab 6: Vehicle Comparison ──────────────────────────────────────────────────
function VehicleTab({ data, currency, exportBase }) {
  const columns = useMemo(() => [
    textCol('assetNo', 'Asset No', r => r.assetNo),
    numCol('count', 'Records', r => r.count, v => fmt(v)),
    numCol('totalCost', 'Total Cost', r => r.totalCost, v => fmtCur(v, currency)),
    numCol('avgCpk', 'Avg CPK', r => r.avgCpk, v => fmtCpk(v, currency)),
    numCol('avgLife', 'Avg Life (km)', r => r.avgLife, v => fmt(v)),
    numCol('failCount', 'Failures', r => r.failCount,
      v => <span className={`font-medium ${v > 3 ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>{fmt(v)}</span>),
    textCol('lastSeen', 'Last Seen', r => r.lastSeen),
    textCol('outlier', 'Outlier', r => (r.isOutlier ? 'High CPK' : ''), {
      cell: ({ row }) => (row.original.isOutlier
        ? <span className="px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded text-xs">High CPK</span>
        : null),
    }),
  ], [currency])

  if (!data?.vehicles?.length) return <EmptyState />
  const { vehicles, top20Cost, cpkMean, outlierCount } = data

  const costBar = {
    labels: top20Cost.map(v => v.assetNo),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: top20Cost.map(v => v.totalCost),
      backgroundColor: top20Cost.map(v => v.isOutlier ? 'rgba(239,68,68,0.8)' : 'rgba(59,130,246,0.7)'),
      borderColor: top20Cost.map(v => v.isOutlier ? '#ef4444' : '#3b82f6'),
      borderWidth: 1, borderRadius: 3,
    }],
  }

  const scatterData = {
    datasets: [{
      label: 'Vehicles (size = replacements)',
      data: vehicles
        .filter(v => v.totalCost > 0 && v.avgCpk != null)
        .slice(0, 100)
        .map(v => ({ x: v.avgCpk, y: v.totalCost, r: Math.min(Math.max(3, v.count), 18) })),
      backgroundColor: 'rgba(139,92,246,0.55)', borderColor: '#8b5cf6', borderWidth: 1,
    }],
  }

  return (
    <div className="space-y-5">
      {outlierCount > 0 && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">
            <strong>{outlierCount} vehicle{outlierCount > 1 ? 's' : ''}</strong> flagged as CPK outliers
            (more than 2 standard deviations above the fleet average of {fmtCpk(cpkMean, currency)}). These vehicles are highlighted
            in red and require investigation.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Top 20 Vehicles by Total Tyre Cost (Red = CPK Outlier)" height={300}>
          <Bar data={costBar} options={H_BAR_OPTS} />
        </ChartBox>
        <ChartBox title="Total Cost vs Avg CPK Scatter (bubble = replacement count)" height={300}>
          <Scatter data={scatterData} options={{
            ...BASE_OPTS,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTS.plugins.tooltip,
                callbacks: {
                  label: ctx => {
                    const d = ctx.raw
                    return [`CPK: ${fmtCpk(d.x, currency)}`, `Cost: ${fmtCur(d.y, currency)}`, `Count: ${d.r}`]
                  },
                },
              },
            },
            scales: {
              x: { ...BASE_OPTS.scales.x, title: { display: true, text: 'Avg CPK', color: '#6b7280' } },
              y: { ...BASE_OPTS.scales.y, title: { display: true, text: `Total Cost (${currency})`, color: '#6b7280' } },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>All Vehicles: Tyre Cost Analysis</SectionTitle>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={columns}
          data={vehicles}
          getRowId={r => r.assetNo}
          searchPlaceholder="Search assets"
          exportFileName={reportFileName(exportBase, 'Vehicles')}
          emptyMessage="No vehicle data for these filters."
        />
      </Card>
    </div>
  )
}

// ── Tab 7: Driver Comparison ───────────────────────────────────────────────────
function DriverTab({ data, currency, exportBase }) {
  const columns = useMemo(() => [
    numCol('rank', 'Rank', r => r.rank, v => <span className="text-red-400 font-bold">{v}</span>, { size: 60 }),
    textCol('assetNo', 'Asset No', r => r.assetNo),
    numCol('count', 'Records', r => r.count, v => fmt(v)),
    numCol('totalCost', 'Total Cost', r => r.totalCost,
      v => <span className="font-semibold text-red-400">{fmtCur(v, currency)}</span>),
    numCol('highRiskCount', 'Fail Count', r => r.highRiskCount, v => fmt(v)),
    textCol('sites', 'Sites', r => (r.sites || []).slice(0, 2).join(', ')),
    textCol('categories', 'Categories', r => (r.categories || []).slice(0, 2).join(', ')),
  ], [currency])

  if (!data) return <EmptyState />
  const { worst10, best10, hasDriverData } = data

  const worstBar = {
    labels: worst10.map(v => v.assetNo),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: worst10.map(v => v.totalCost),
      backgroundColor: 'rgba(239,68,68,0.75)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 4,
    }],
  }

  const bestBar = {
    labels: best10.map(v => v.assetNo),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: best10.map(v => v.totalCost),
      backgroundColor: 'rgba(16,185,129,0.75)', borderColor: '#10b981', borderWidth: 1, borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-800/40 rounded-xl px-4 py-3">
        <Info size={15} className="text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-300">
          {hasDriverData
            ? 'Driver name patterns detected in findings. Analysis reflects both driver assignments and vehicle-level tyre consumption.'
            : 'Driver data is not available as a direct column. This analysis uses vehicle asset numbers as a proxy for driver performance, reflecting vehicle-level tyre consumption.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricTile label="Vehicles Analyzed" value={fmt(worst10.length + best10.length)} sub="sample shown" />
        <MetricTile label="Highest Cost Vehicle" value={worst10[0]?.assetNo ?? NA} sub={fmtCur(worst10[0]?.totalCost, currency)} />
        <MetricTile label="Lowest Cost Vehicle" value={best10[0]?.assetNo ?? NA} sub={fmtCur(best10[0]?.totalCost, currency)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <span className="text-sm font-semibold text-[var(--text-secondary)]">Top 10 Worst Performing Vehicles</span>
          </div>
          <ChartBox height={260}>
            <Bar data={worstBar} options={H_BAR_OPTS} />
          </ChartBox>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-sm font-semibold text-[var(--text-secondary)]">Top 10 Best Performing Vehicles</span>
          </div>
          <ChartBox height={260}>
            <Bar data={bestBar} options={H_BAR_OPTS} />
          </ChartBox>
        </div>
      </div>

      <Card>
        <SectionTitle>Worst Performing Vehicle Details</SectionTitle>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={columns}
          data={worst10}
          getRowId={r => r.assetNo}
          enableGlobalFilter={false}
          exportFileName={reportFileName(exportBase, 'Worst Vehicles')}
          emptyMessage="No vehicle data for these filters."
        />
      </Card>
    </div>
  )
}

// ── Tab 8: Brand Comparison ────────────────────────────────────────────────────
function BrandTab({ data, currency, exportBase }) {
  const columns = useMemo(() => [
    numCol('rank', 'Rank', r => r.rank,
      v => (v === 1 ? <Star size={12} className="text-yellow-400 inline" aria-label="Top brand" /> : v), { size: 60 }),
    textCol('brand', 'Brand', r => r.brand),
    numCol('score', 'Score', r => r.score, v => (
      <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${v >= 70 ? 'bg-emerald-900/50 text-emerald-400' : v >= 50 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400'}`}>{v}</span>
    )),
    numCol('count', 'Records', r => r.count, v => fmt(v)),
    numCol('avgCpk', 'Avg CPK', r => r.avgCpk, v => fmtCpk(v, currency)),
    numCol('avgLife', 'Avg Life (km)', r => r.avgLife, v => fmt(v)),
    numCol('failureRate', 'Failure %', r => r.failureRate,
      v => <span className={`font-medium ${rateTone(v)}`}>{fmtPct(v)}</span>),
    numCol('scrapRate', 'Scrap %', r => r.scrapRate, v => fmtPct(v)),
    numCol('totalCost', 'Total Cost', r => r.totalCost, v => fmtCur(v, currency)),
    textCol('topCategory', 'Top Category', r => r.topCategory),
  ], [currency])

  if (!data?.brands?.length) return <EmptyState />
  const { brands, allMonths, brandMonthly, hasYoY } = data

  const scatterData = {
    datasets: [{
      label: 'Brands (size = count)',
      data: brands
        .filter(b => b.avgCpk != null && b.avgLife != null)
        .map(b => ({ x: b.avgCpk, y: b.avgLife, r: Math.min(Math.max(5, Math.log1p(b.count) * 3), 20), label: b.brand })),
      backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1,
    }],
  }

  const monthlyBar = {
    labels: allMonths,
    datasets: brandMonthly.map((b, i) => ({
      label: b.brand,
      data: b.monthly,
      backgroundColor: PALETTE[i % PALETTE.length] + 'bb',
      borderColor: PALETTE[i % PALETTE.length],
      borderWidth: 1, borderRadius: 2, stack: 'cost',
    })),
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="CPK vs Tyre Life by Brand (size = count)" height={280}>
          <Scatter data={scatterData} options={{
            ...BASE_OPTS,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTS.plugins.tooltip,
                callbacks: {
                  label: ctx => {
                    const d = ctx.raw
                    return [d.label, `CPK: ${fmtCpk(d.x, currency)}`, `Life: ${fmt(d.y)} km`, `Count: ${d.r}`]
                  },
                },
              },
            },
            scales: {
              x: { ...BASE_OPTS.scales.x, title: { display: true, text: 'Avg CPK', color: '#6b7280' } },
              y: { ...BASE_OPTS.scales.y, title: { display: true, text: 'Avg Life (km)', color: '#6b7280' } },
            },
          }} />
        </ChartBox>
        <ChartBox title={`Monthly Cost by Brand (Last 12 Mo)${hasYoY ? ' · YoY data available' : ''}`} height={280}>
          <Bar data={monthlyBar} options={{
            ...BASE_OPTS,
            plugins: { ...BASE_OPTS.plugins, legend: { labels: { color: '#9ca3af', font: { size: 10 } } } },
            scales: {
              ...BASE_OPTS.scales,
              x: { ...BASE_OPTS.scales.x, stacked: true },
              y: { ...BASE_OPTS.scales.y, stacked: true },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>Brand Performance Ranking</SectionTitle>
        <EnterpriseTable
          {...SUB_TABLE}
          columns={columns}
          data={brands}
          getRowId={r => r.brand}
          searchPlaceholder="Search brands"
          exportFileName={reportFileName(exportBase, 'Brands')}
          emptyMessage="No brand data for these filters."
        />
      </Card>
    </div>
  )
}

// ── Tab 9: Failure Pattern Analysis ───────────────────────────────────────────
function FailureTab({ data, exportBase }) {
  const heatColumns = useMemo(() => {
    if (!data) return []
    const { months, heatMax } = data
    return [
      textCol('cat', 'Category', r => r.cat),
      ...months.map((m, j) => numCol(`m_${m}`, m.slice(5), r => r.row[j],
        v => <HeatCell
          style={v > 0 ? { backgroundColor: heatColor(v, 0, heatMax) } : undefined}
          text={v > 0 ? v : '0'} />,
        { meta: { align: 'center', exportHeader: m, exportValue: r => r.row[j] } })),
    ]
  }, [data])

  if (!data) return <EmptyState />
  const { catEntries, totalFailures, posRates, brandRates, siteRates, kmCounts, heatmap } = data
  if (!catEntries.length) return <EmptyState message="No high/critical risk records found in selected filters." />

  const doughnut = {
    labels: catEntries.slice(0, 8).map(([k]) => k),
    datasets: [{
      data: catEntries.slice(0, 8).map(([, v]) => v),
      backgroundColor: PALETTE.map(c => c + 'cc'),
      borderColor: PALETTE, borderWidth: 1,
    }],
  }

  const posBar = {
    labels: posRates.map(p => p.pos),
    datasets: [{
      label: 'Failure Rate %',
      data: posRates.map(p => p.rate),
      backgroundColor: posRates.map(p =>
        p.rate > 25 ? 'rgba(239,68,68,0.75)' : p.rate > 15 ? 'rgba(245,158,11,0.75)' : 'rgba(59,130,246,0.7)'
      ),
      borderWidth: 0, borderRadius: 4,
    }],
  }

  const brandFailBar = {
    labels: brandRates.map(b => b.brand),
    datasets: [{
      label: 'Failure Rate %',
      data: brandRates.map(b => b.rate),
      backgroundColor: brandRates.map((_, i) => PALETTE[i % PALETTE.length] + 'bb'),
      borderColor: brandRates.map((_, i) => PALETTE[i % PALETTE.length]),
      borderWidth: 1, borderRadius: 4,
    }],
  }

  const siteFailBar = {
    labels: siteRates.map(s => s.site),
    datasets: [{
      label: 'Failure Rate %',
      data: siteRates.map(s => s.rate),
      backgroundColor: siteRates.map(s =>
        s.rate > 30 ? 'rgba(239,68,68,0.8)' : s.rate > 15 ? 'rgba(245,158,11,0.75)' : 'rgba(59,130,246,0.7)'
      ),
      borderWidth: 0, borderRadius: 4,
    }],
  }

  const kmBar = {
    labels: kmCounts.map(b => b.label),
    datasets: [{
      label: 'Count',
      data: kmCounts.map(b => b.count),
      backgroundColor: [
        'rgba(239,68,68,0.75)', 'rgba(245,158,11,0.75)', 'rgba(59,130,246,0.7)',
        'rgba(16,185,129,0.7)', 'rgba(139,92,246,0.7)',
      ],
      borderWidth: 0, borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <MetricTile label="Total Failures" value={fmt(totalFailures)} sub="High + Critical records" />
        <MetricTile label="Top Failure Type" value={catEntries[0]?.[0] ?? NA} sub={`${fmt(catEntries[0]?.[1])} records`} />
        <MetricTile label="Highest Fail Position" value={posRates[0]?.pos ?? NA} sub={fmtPct(posRates[0]?.rate)} />
        <MetricTile label="Highest Fail Brand" value={brandRates[0]?.brand ?? NA} sub={fmtPct(brandRates[0]?.rate)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Failure Type Distribution" height={280}>
          <Doughnut data={doughnut} options={{
            ...BASE_OPTS,
            scales: undefined,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } },
            },
          }} />
        </ChartBox>
        <ChartBox title="Failure Rate % by Position" height={280}>
          <Bar data={posBar} options={NO_LEGEND_OPTS} />
        </ChartBox>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Failure Rate % by Brand (Top 10)" height={260}>
          <Bar data={brandFailBar} options={H_BAR_OPTS} />
        </ChartBox>
        <ChartBox title="Failure Rate % by Site" height={260}>
          <Bar data={siteFailBar} options={H_BAR_OPTS} />
        </ChartBox>
      </div>

      <ChartBox title="Tyre Life Distribution at Removal (km buckets)" height={220}>
        <Bar data={kmBar} options={NO_LEGEND_OPTS} />
      </ChartBox>

      {heatmap.length > 0 && (
        <Card>
          <SectionTitle>Failure Seasonality: Month by Category Heat Map</SectionTitle>
          <EnterpriseTable
            {...SUB_TABLE}
            columns={heatColumns}
            data={heatmap}
            getRowId={r => r.cat}
            enableGlobalFilter={false}
            stickyFirstColumn
            exportFileName={reportFileName(exportBase, 'Failure Heat Map')}
            emptyMessage="No failure heat map data for these filters."
          />
        </Card>
      )}
    </div>
  )
}
