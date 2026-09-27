/**
 * CarbonTracker (route /carbon-tracker): fleet carbon intelligence.
 *
 * Two complementary views, switchable by tab:
 *
 *  - Lifecycle ESG (default). Scores the EMBEDDED / lifecycle carbon of the
 *    tyre estate (manufacturing, sea-freight to the UAE, end-of-life), the CO2
 *    AVOIDED by retreading, and the extra CO2 burned running under-inflated
 *    tyres, rolling up into a 0 to 100 ESG score with a certification-ready
 *    flag. Offsets and reduction initiatives are persisted, org-isolated
 *    records (V210). The view is split into section tabs (Overview, Emissions
 *    by class, Offsets, Initiatives) so the page is no longer one long wall.
 *
 *  - Fuel emissions. CO2 from distance travelled per tyre record times the
 *    IPCC diesel factor, aggregated by month, site and vehicle.
 *
 * All carbon maths lives in src/lib/carbon.js; what the page may honestly say
 * about it (measurability, filters, ledger roll-ups, exports) lives in the pure
 * src/lib/carbonTrackerAnalytics.js. A figure with no measurable basis renders
 * N/A, never a fabricated 0. A failed read renders an error with Retry, never
 * an empty ledger.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Leaf, Gauge, Fuel, Building2, Search, X, TreePine, FileSpreadsheet, FileText,
  AlertTriangle, Info, Truck, Award, Recycle, ShieldCheck, TrendingDown, Plus,
  Loader2, Trash2, Target, BarChart3, Factory, LayoutDashboard, RotateCcw, Scale,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import { Skeleton } from '../components/ui/Skeleton'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listFuelUsage, getLifecycleCarbonData,
  listOffsets, createOffset, deleteOffset,
  listInitiatives, createInitiative, deleteInitiative,
} from '../lib/api/carbon'
import {
  computeCarbon, treesToOffset, DIESEL_KG_PER_L,
  computeLifecycleCarbon, CO2_FACTORS, KG_CO2_PER_TREE_YEAR,
} from '../lib/carbon'
import {
  PERIODS, INITIATIVE_STATUSES, asTonnes, fmtNum, fmtTonnes, humanize,
  scopeRowsByPeriod, lifecycleKpis, esgBand, fuelKpis, vehicleRows,
  filterVehicleRows, siteOptions, offsetsSummary, netAfterOffsetsKg,
  initiativesSummary, filterOffsets, filterInitiatives, vehicleExportRows,
} from '../lib/carbonTrackerAnalytics'
import { colorAt, categorical } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const WRITE_ROLES = ['Admin', 'Manager', 'Director']
const GRID = 'rgba(148,163,184,0.14)'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1'

function chartTextColor() {
  if (typeof document === 'undefined') return '#9ca3af'
  return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#9ca3af'
}

// ── Shared local pieces ───────────────────────────────────────────────────────
function TabBar({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-[var(--input-border)]">
      {tabs.map((t) => {
        const Icon = t.icon
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${FOCUS} ${
              active ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon size={15} aria-hidden="true" /> {t.label}
            {t.count != null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)] tabular-nums">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

function KpiStrip({ loading, tiles, cols = 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6' }) {
  return (
    <div className={`grid ${cols} gap-[var(--gap-grid)]`}>
      {tiles.map((k, i) => (
        loading
          ? <div key={k.label} className="card !p-4 space-y-3"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-7 w-1/2" /><Skeleton className="h-2.5 w-3/4" /></div>
          : <StatTile key={k.label} index={i} {...k} />
      ))}
    </div>
  )
}

function ErrorBanner({ title, message, onRetry }) {
  return (
    <Card tone="crit" role="alert">
      <div className="flex flex-wrap items-start gap-[var(--space-3)]">
        <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-red-300 font-medium">{title}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{message}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}>
            <RotateCcw size={14} aria-hidden="true" /> Retry
          </button>
        )}
      </div>
    </Card>
  )
}

function EmptyChart({ empty = 'No data.' }) {
  return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">{empty}</div>
}

function Field({ label, id, children }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-[var(--text-muted)]">{label}</label>
      {children}
    </div>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────
export default function CarbonTracker() {
  const [view, setView] = useState('lifecycle')
  return (
    <div className="space-y-6">
      <TabBar
        label="Carbon view"
        value={view}
        onChange={setView}
        tabs={[
          { key: 'lifecycle', label: 'Lifecycle ESG', icon: Leaf },
          { key: 'fuel', label: 'Fuel emissions', icon: Fuel },
        ]}
      />
      {view === 'lifecycle' ? <LifecycleEsgView /> : <FuelEmissionsView />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE ESG VIEW
 * ═══════════════════════════════════════════════════════════════════════════ */
function LifecycleEsgView() {
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const canWrite = WRITE_ROLES.includes(profile?.role)

  const [data, setData] = useState(null) // { tyres, vehicles } | null = loading
  const [error, setError] = useState('')
  const [offsets, setOffsets] = useState(null)
  const [offsetsError, setOffsetsError] = useState('')
  const [initiatives, setInitiatives] = useState(null)
  const [initiativesError, setInitiativesError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [period, setPeriod] = useState(12)
  const [section, setSection] = useState('overview')

  const loadOffsets = useCallback(async () => {
    setOffsetsError('')
    try { setOffsets(await listOffsets({ country: activeCountry })) }
    catch (e) { setOffsets([]); setOffsetsError(toUserMessage(e, 'Could not load the offsets ledger.')) }
  }, [activeCountry])

  const loadInitiatives = useCallback(async () => {
    setInitiativesError('')
    try { setInitiatives(await listInitiatives({ country: activeCountry })) }
    catch (e) { setInitiatives([]); setInitiativesError(toUserMessage(e, 'Could not load reduction initiatives.')) }
  }, [activeCountry])

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const [d] = await Promise.allSettled([
        getLifecycleCarbonData({ country: activeCountry }),
        loadOffsets(),
        loadInitiatives(),
      ])
      if (d.status === 'fulfilled') setData(d.value)
      else { setData({ tyres: [], vehicles: [] }); setError(toUserMessage(d.reason, 'Could not load lifecycle carbon data.')) }
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry, loadOffsets, loadInitiatives])

  useEffect(() => { load() }, [load])

  const carbon = useMemo(
    () => computeLifecycleCarbon({
      tyres: data?.tyres || [],
      vehicles: data?.vehicles || [],
      periodDays: (period || 36) * 30, // 0 (all time) is a ~3 year window
    }),
    [data, period],
  )
  const k = useMemo(() => lifecycleKpis(carbon), [carbon])
  const off = useMemo(() => offsetsSummary(offsets), [offsets])
  const ini = useMemo(() => initiativesSummary(initiatives), [initiatives])
  const loading = data === null
  const failed = !!error
  const band = esgBand(k.esgScore)
  const netAfter = netAfterOffsetsKg(k.netCo2Kg, off.totalTonnes)

  const na = (v) => (failed ? 'N/A' : v)
  const tiles = [
    { label: 'Net lifecycle CO2', value: na(fmtTonnes(k.netCo2Kg)), sub: k.grossCo2Kg != null ? `${fmtNum(k.grossCo2Kg)} kg gross` : 'No lifecycle signal', icon: Factory, tone: 'crit' },
    { label: 'Saved by retreading', value: na(fmtTonnes(k.savedRetreadKg)), sub: `${fmtNum(k.retreads)} retreads`, icon: Recycle, tone: 'accent' },
    { label: 'Under-inflation CO2', value: na(fmtTonnes(k.underinflationKg)), sub: `${fmtNum(k.lowPressure)} low-pressure tyres`, icon: Gauge, tone: 'warn' },
    { label: 'Scrapped CO2', value: na(fmtTonnes(k.scrappedKg)), sub: `${fmtNum(k.scrapped)} scrapped tyres`, icon: TrendingDown, tone: 'info' },
    { label: 'ESG score', value: na(k.esgScore == null ? 'N/A' : `${k.esgScore}/100`), sub: band.label, icon: Award, tone: band.tone },
    { label: 'Net after offsets', value: na(fmtTonnes(netAfter)), sub: off.totalTonnes != null ? `${off.totalTonnes} t offset` : 'No offsets recorded', icon: Scale, tone: 'neutral' },
  ]

  // Charts
  const chartText = chartTextColor()
  const barOpts = (unit) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmtNum(c.raw)} ${unit}` } } },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: GRID } },
      y: { ticks: { color: chartText }, grid: { color: GRID }, title: { display: true, text: unit, color: chartText } },
    },
  })
  const classBar = {
    labels: carbon.tyreBreakdown.map((r) => humanize(r.applicationClass)),
    datasets: [{ data: carbon.tyreBreakdown.map((r) => r.totalCo2Kg), backgroundColor: colorAt(0), borderRadius: 4 }],
  }
  const trendBar = {
    labels: carbon.monthlyTrend.map((m) => m.label),
    datasets: [{ data: carbon.monthlyTrend.map((m) => m.estimatedCo2Kg), backgroundColor: colorAt(1), borderRadius: 4 }],
  }

  // Export (every section in one workbook-friendly shape)
  const EXPORT_COLS = ['applicationClass', 'count', 'co2PerTyreKg', 'totalCo2Kg']
  const EXPORT_HEADERS = ['Vehicle class', 'New tyres', 'CO2 per tyre (kg)', 'Total CO2 (kg)']
  const exportRows = carbon.tyreBreakdown.map((r) => ({ ...r, applicationClass: humanize(r.applicationClass) }))
  const fileBase = reportFileName('Carbon Lifecycle ESG', activeCountry !== 'All' ? activeCountry : '')
  const periodLabel = PERIODS.find((p) => p.value === period)?.label || ''
  const doExcel = async () => {
    try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Embedded CO2', { title: 'Carbon Lifecycle ESG', dateRange: periodLabel }) }
    catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const pdfCols = EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] }))
  const doPdf = async () => {
    try { await exportToPdf(exportRows, pdfCols, 'Carbon Lifecycle ESG', fileBase, 'landscape') }
    catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const classColumns = useMemo(() => [
    { id: 'cls', header: 'Vehicle class', accessorFn: (r) => humanize(r.applicationClass), cell: ({ getValue }) => <span className="font-semibold text-[var(--text-primary)] capitalize">{getValue()}</span> },
    { id: 'vehicles', header: 'Vehicles', accessorFn: (r) => r.vehicles, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    { id: 'km', header: 'Total km', accessorFn: (r) => r.km, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    { id: 'factor', header: 'Factor (kg/km)', accessorFn: (r) => r.emissionsFactor, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-muted)]">{getValue()}</span> },
    { id: 'co2', header: 'CO2 (kg)', accessorFn: (r) => r.co2Kg, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    { id: 'co2t', header: 'CO2 (t)', accessorFn: (r) => r.co2Tonnes, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{getValue()}</span> },
  ], [])

  const tyreColumns = useMemo(() => [
    { id: 'cls', header: 'Vehicle class', accessorFn: (r) => humanize(r.applicationClass), cell: ({ getValue }) => <span className="capitalize">{getValue()}</span> },
    { id: 'count', header: 'New tyres', accessorFn: (r) => r.count, meta: { align: 'right' } },
    { id: 'each', header: 'CO2 per tyre (kg)', accessorFn: (r) => r.co2PerTyreKg, meta: { align: 'right' } },
    { id: 'total', header: 'Total CO2 (kg)', accessorFn: (r) => r.totalCo2Kg, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums font-semibold">{fmtNum(getValue())}</span> },
  ], [])

  const SECTIONS = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'classes', label: 'Emissions by class', icon: BarChart3, count: loading ? null : carbon.byClassEmissions.length },
    { key: 'offsets', label: 'Offsets', icon: TreePine, count: offsets ? offsets.length : null },
    { key: 'initiatives', label: 'Initiatives', icon: Target, count: initiatives ? initiatives.length : null },
  ]

  return (
    <>
      <PageHeader
        title="Carbon Tracker: Lifecycle ESG"
        subtitle="Embedded tyre-lifecycle CO2, retread savings and an ESG score for GCC sustainability reporting."
        icon={Leaf}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ct-life-period" className="sr-only">Period</label>
            <select id="ct-life-period" className={`input min-h-[44px] ${FOCUS}`} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button type="button" onClick={doExcel} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!exportRows.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!exportRows.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              disabled={!exportRows.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
              getPdf={async () => ({
                base64: await exportToPdf(exportRows, pdfCols, 'Carbon Lifecycle ESG', fileBase, 'landscape', '', { returnBase64: true }),
                filename: `${fileBase}.pdf`,
                subject: 'Carbon Lifecycle ESG',
                bodyHtml: '<p>Attached is the Carbon Lifecycle ESG report.</p>',
              })}
            />
          </div>
        }
      />

      {error && <ErrorBanner title="Could not load carbon data." message={error} onRetry={load} />}

      <KpiStrip loading={loading} tiles={tiles} />

      <TabBar label="Lifecycle sections" value={section} onChange={setSection} tabs={SECTIONS} />

      {section === 'overview' && (
        <div className="space-y-[var(--gap-grid)]">
          <Card tone="warn">
            <div className="flex items-start gap-[var(--space-3)]">
              <Info size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                <span className="font-semibold text-[var(--text-primary)]">Lifecycle model.</span>{' '}
                Embedded CO2 per new tyre = manufacturing (by vehicle class) + {CO2_FACTORS.transport_to_uae} kg transport to the UAE + {CO2_FACTORS.end_of_life} kg end of life.
                Retreading saves {CO2_FACTORS.retread_saving} kg per tyre; under-inflation adds {CO2_FACTORS.underinflation_per_10k_km} kg per 10,000 km. Vehicle class comes from
                joining each tyre's asset to <span className="font-mono text-xs">vehicle_fleet.vehicle_type</span>. Trees: about 1 per {KG_CO2_PER_TREE_YEAR} kg CO2 per year.
              </p>
            </div>
          </Card>

          {carbon.retreadFromTextOnly && (
            <Card tone="warn">
              <div className="flex items-start gap-[var(--space-3)]">
                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-sm text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-primary)]">Retread signal derived from text.</span>{' '}
                  No explicit retread category was found; retread counts are inferred from free-text removal reasons and are indicative only.
                </p>
              </div>
            </Card>
          )}

          {!loading && !k.hasData && !failed && (
            <Card className="text-center" style={{ paddingTop: 'var(--space-12)', paddingBottom: 'var(--space-12)' }}>
              <Leaf size={28} className="mx-auto mb-2 text-[var(--text-muted)] opacity-60" aria-hidden="true" />
              <p className="text-[var(--text-secondary)] font-medium">No lifecycle carbon signal for this scope.</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Add tyre records and fleet vehicles, or widen the period, to populate the ESG model.</p>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
            <Card>
              <CardHeader level={2} icon={Award} title="ESG score" />
              {loading ? <Skeleton className="h-24 w-full" /> : (
                <>
                  <p className="text-4xl font-bold text-[var(--text-primary)] tabular-nums">{k.esgScore == null ? 'N/A' : k.esgScore}<span className="text-lg text-[var(--text-muted)]">/100</span></p>
                  <div className="mt-2 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" role="img" aria-label={`ESG score ${k.esgScore == null ? 'not measured' : `${k.esgScore} of 100`}`}>
                    {k.esgScore != null && <div className={`h-full rounded-full ${k.esgScore >= 70 ? 'bg-green-500' : k.esgScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(0, Math.min(100, k.esgScore))}%` }} />}
                  </div>
                  <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)]">
                    {k.certificationReady ? <ShieldCheck size={15} className="text-green-400" aria-hidden="true" /> : <AlertTriangle size={15} className="text-amber-400" aria-hidden="true" />}
                    {k.certificationReady == null ? 'Not measured for this scope' : k.certificationReady ? 'Certification-ready (70 or above)' : 'Below certification threshold (70)'}
                  </p>
                </>
              )}
            </Card>

            <Card>
              <CardHeader level={2} icon={Gauge} title="ESG components" />
              <ComponentRow label="Retread rate" value={k.retreadRatePct == null ? 'N/A' : `${k.retreadRatePct}%`} band={k.retreadRatePct == null ? 'No retread or scrap events' : carbon.retreadBand.label} />
              <ComponentRow label="Pressure compliance" value={k.pressureCompliancePct == null ? 'N/A' : `${k.pressureCompliancePct}%`} band={k.pressureCompliancePct == null ? 'No active fleet' : null} />
              <ComponentRow label="Fleet intensity" value={carbon.intensity.fleetIntensityKgPerKm != null ? `${carbon.intensity.fleetIntensityKgPerKm} kg/km` : 'N/A'} band={carbon.intensity.band.band !== 'unknown' ? carbon.intensity.band.label : 'No fleet km data'} last />
            </Card>

            <Card>
              <CardHeader level={2} icon={TrendingDown} title="Reduction vs prior period" />
              <p className="text-3xl font-bold text-[var(--text-primary)] tabular-nums">{carbon.reductionVsPriorPct != null ? `${carbon.reductionVsPriorPct}%` : 'N/A'}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Last 6 months vs the prior 6 months (new-tyre embedded CO2).</p>
              <dl className="mt-3 pt-3 border-t border-[var(--input-border)] grid grid-cols-3 gap-2 text-center">
                <Equiv value={k.hasData ? fmtNum(carbon.equivalents.treesEmitted) : 'N/A'} label="trees emitted" />
                <Equiv value={k.hasData ? fmtNum(carbon.equivalents.treesSavedRetreading) : 'N/A'} label="trees saved" />
                <Equiv value={k.hasData ? fmtNum(carbon.equivalents.drivingEquivalentKm) : 'N/A'} label="km driving equivalent" />
              </dl>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
            <Card>
              <CardHeader level={2} title="Embedded CO2 by vehicle class" description="kg CO2 from new tyres fitted in the period" />
              <div className="h-64" role="img" aria-label={`Embedded CO2 by vehicle class, ${carbon.tyreBreakdown.length} classes`}>
                {loading ? <Skeleton className="w-full h-full" />
                  : carbon.tyreBreakdown.length ? <Bar data={classBar} options={barOpts('kg CO2')} />
                    : <EmptyChart empty={failed ? 'Could not load this chart.' : 'No new tyres in this period.'} />}
              </div>
            </Card>
            <Card>
              <CardHeader level={2} title="Monthly embedded CO2" description="Last 12 months, kg CO2" />
              <div className="h-64" role="img" aria-label="Monthly embedded CO2 over the last 12 months">
                {loading ? <Skeleton className="w-full h-full" />
                  : carbon.monthlyTrend.some((m) => m.estimatedCo2Kg > 0) ? <Bar data={trendBar} options={barOpts('kg CO2')} />
                    : <EmptyChart empty={failed ? 'Could not load this chart.' : 'No dated tyre issues to trend.'} />}
              </div>
            </Card>
          </div>
        </div>
      )}

      {section === 'classes' && (
        <div className="space-y-[var(--gap-grid)]">
          <Card>
            <CardHeader level={2} icon={BarChart3} title="Operational emissions by class" description="Lifetime odometer times the per-km emission factor for each active vehicle class." />
            <EnterpriseTable
              columns={classColumns}
              data={carbon.byClassEmissions}
              getRowId={(r) => r.applicationClass}
              loading={loading}
              error={failed ? error : null}
              onRetry={load}
              emptyMessage="No active vehicles with odometer data."
              emptyIcon={<Truck size={22} className="opacity-60" />}
              exportFileName={reportFileName('Carbon Operational Emissions')}
              reportMeta={{ title: 'Operational emissions by class' }}
              initialPageSize={25}
            />
          </Card>
          <Card>
            <CardHeader level={2} icon={Factory} title="Embedded CO2 of new tyres" description={`New tyres fitted in the selected period (${periodLabel}).`} />
            <EnterpriseTable
              columns={tyreColumns}
              data={carbon.tyreBreakdown}
              getRowId={(r) => r.applicationClass}
              loading={loading}
              error={failed ? error : null}
              onRetry={load}
              emptyMessage="No new tyres in this period."
              exportFileName={reportFileName('Carbon Embedded CO2')}
              reportMeta={{ title: 'Embedded CO2 of new tyres', dateRange: periodLabel }}
              initialPageSize={25}
            />
          </Card>
        </div>
      )}

      {section === 'offsets' && (
        <OffsetsPanel
          offsets={offsets}
          summary={off}
          error={offsetsError}
          canWrite={canWrite}
          activeCountry={activeCountry}
          onReload={loadOffsets}
        />
      )}

      {section === 'initiatives' && (
        <InitiativesPanel
          initiatives={initiatives}
          summary={ini}
          error={initiativesError}
          canWrite={canWrite}
          activeCountry={activeCountry}
          onReload={loadInitiatives}
        />
      )}
    </>
  )
}

function ComponentRow({ label, value, band, last }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 py-2 ${last ? '' : 'border-b border-[var(--input-border)]'}`}>
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="ml-auto text-sm font-semibold text-[var(--text-primary)] tabular-nums">{value}</span>
      {band && <span className="w-full text-[11px] text-[var(--text-muted)] text-right">{band}</span>}
    </div>
  )
}

function Equiv({ value, label }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-sm font-bold text-[var(--text-primary)] tabular-nums">{value}</dd>
      <p className="text-[11px] text-[var(--text-muted)] leading-tight" aria-hidden="true">{label}</p>
    </div>
  )
}

// ── Offsets panel ─────────────────────────────────────────────────────────────
function OffsetsPanel({ offsets, summary, error, canWrite, activeCountry, onReload }) {
  const [form, setForm] = useState({ provider: '', project: '', tonnes: '', aed_cost: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState(null)
  const loading = offsets === null
  const rows = useMemo(() => filterOffsets(offsets || [], search), [offsets, search])

  const submit = async (e) => {
    e.preventDefault(); setMsg('')
    if (!form.tonnes || Number(form.tonnes) <= 0) { setMsg('Tonnes must be greater than zero.'); return }
    setBusy(true)
    try {
      await createOffset({ ...form, country: activeCountry !== 'All' ? activeCountry : undefined })
      setForm({ provider: '', project: '', tonnes: '', aed_cost: '' })
      await onReload()
    } catch (err) {
      setMsg(toUserMessage(err, 'Could not add the offset.'))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm) return
    setBusy(true); setMsg('')
    try { await deleteOffset(confirm.id); setConfirm(null); await onReload() }
    catch (err) { setMsg(toUserMessage(err, 'Could not remove the offset.')) }
    finally { setBusy(false) }
  }

  const columns = useMemo(() => [
    { id: 'provider', header: 'Provider', accessorFn: (o) => o.provider || 'N/A', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'project', header: 'Project', accessorFn: (o) => o.project || 'N/A' },
    { id: 'date', header: 'Purchased', accessorFn: (o) => (o.purchased_at || '').slice(0, 10) || 'N/A' },
    { id: 'tonnes', header: 'Tonnes', accessorFn: (o) => (o.tonnes == null ? null : Number(o.tonnes)), meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums font-semibold">{getValue() == null ? 'N/A' : `${getValue().toFixed(2)} t`}</span> },
    { id: 'cost', header: 'Cost (AED)', accessorFn: (o) => (o.aed_cost == null || o.aed_cost === '' ? null : Number(o.aed_cost)), meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    ...(canWrite ? [{
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" onClick={() => setConfirm(row.original)} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Remove offset ${row.original.provider || ''}`.trim()} disabled={busy}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      ),
    }] : []),
  ], [canWrite, busy])

  return (
    <div className="space-y-[var(--gap-grid)]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[var(--gap-grid)]">
        <StatTile label="Offsets recorded" value={loading ? '...' : fmtNum(summary.count)} icon={TreePine} />
        <StatTile label="Tonnes offset" value={summary.totalTonnes == null ? 'N/A' : `${summary.totalTonnes} t`} icon={Leaf} tone="accent" />
        <StatTile label="Total cost" value={summary.totalCost == null ? 'N/A' : `AED ${fmtNum(summary.totalCost)}`} sub={summary.count ? `${summary.costedCount} of ${summary.count} costed` : ''} icon={Scale} />
        <StatTile label="Cost per tonne" value={summary.avgCostPerTonne == null ? 'N/A' : `AED ${summary.avgCostPerTonne}`} sub={`${summary.providers} providers`} icon={BarChart3} />
      </div>

      <Card>
        <CardHeader level={2} icon={TreePine} title="Carbon offsets ledger" />
        {canWrite ? (
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4 items-end">
            <Field label="Provider" id="off-provider"><input id="off-provider" className="input min-h-[44px]" placeholder="e.g. Verra" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} /></Field>
            <Field label="Project" id="off-project"><input id="off-project" className="input min-h-[44px]" value={form.project} onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))} /></Field>
            <Field label="Tonnes (required)" id="off-tonnes"><input id="off-tonnes" className="input min-h-[44px]" type="number" min="0.1" step="0.1" value={form.tonnes} onChange={(e) => setForm((f) => ({ ...f, tonnes: e.target.value }))} required /></Field>
            <Field label="Cost in AED (optional)" id="off-cost"><input id="off-cost" className="input min-h-[44px]" type="number" min="0" step="1" value={form.aed_cost} onChange={(e) => setForm((f) => ({ ...f, aed_cost: e.target.value }))} /></Field>
            <button type="submit" className={`btn-primary text-sm inline-flex items-center justify-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add offset
            </button>
          </form>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mb-3">Offsets are added by Admin, Manager or Director roles.</p>
        )}
        {msg && <p role="alert" className="text-sm text-red-400 mb-3">{msg}</p>}
        <div className="mb-3 relative max-w-md">
          <label htmlFor="off-search" className="sr-only">Search offsets</label>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <input id="off-search" className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder="Search provider or project" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <EnterpriseTable
          columns={columns}
          data={rows}
          getRowId={(o) => String(o.id)}
          loading={loading}
          error={error || null}
          onRetry={onReload}
          enableGlobalFilter={false}
          emptyMessage={search ? 'No offsets match this search.' : 'No offset purchases recorded yet.'}
          exportFileName={reportFileName('Carbon Offsets Ledger')}
          reportMeta={{ title: 'Carbon offsets ledger', currency: 'AED' }}
          initialPageSize={25}
        />
      </Card>

      {confirm && (
        <Modal
          open
          size="sm"
          onClose={() => { if (!busy) setConfirm(null) }}
          title="Remove this offset?"
          footer={(
            <>
              <button type="button" onClick={() => setConfirm(null)} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
              <button type="button" onClick={remove} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={busy}>
                <Trash2 size={14} aria-hidden="true" /> {busy ? 'Removing...' : 'Remove'}
              </button>
            </>
          )}
        >
          <p className="text-sm text-[var(--text-secondary)]">
            {confirm.provider || 'Offset'}: {confirm.tonnes} t. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}

// ── Initiatives panel ─────────────────────────────────────────────────────────
function InitiativesPanel({ initiatives, summary, error, canWrite, activeCountry, onReload }) {
  const [form, setForm] = useState({ name: '', description: '', claimed_savings_kg: '', owner: '', status: 'active' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState(null)
  const loading = initiatives === null
  const rows = useMemo(() => filterInitiatives(initiatives || [], { status, search }), [initiatives, status, search])

  const submit = async (e) => {
    e.preventDefault(); setMsg('')
    if (!form.name.trim()) { setMsg('An initiative name is required.'); return }
    setBusy(true)
    try {
      await createInitiative({ ...form, country: activeCountry !== 'All' ? activeCountry : undefined })
      setForm({ name: '', description: '', claimed_savings_kg: '', owner: '', status: 'active' })
      await onReload()
    } catch (err) {
      setMsg(toUserMessage(err, 'Could not add the initiative.'))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm) return
    setBusy(true); setMsg('')
    try { await deleteInitiative(confirm.id); setConfirm(null); await onReload() }
    catch (err) { setMsg(toUserMessage(err, 'Could not remove the initiative.')) }
    finally { setBusy(false) }
  }

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Initiative', accessorFn: (i) => i.name || '',
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[26rem]">
          <p className="font-medium text-[var(--text-primary)]">{row.original.name}</p>
          {row.original.description && <p className="text-xs text-[var(--text-muted)] line-clamp-2">{row.original.description}</p>}
        </div>
      ),
    },
    { id: 'owner', header: 'Owner', accessorFn: (i) => i.owner || 'N/A' },
    { id: 'status', header: 'Status', accessorFn: (i) => humanize(i.status) || 'N/A', cell: ({ getValue }) => <span className="text-[11px] px-2 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-secondary)] capitalize">{getValue()}</span> },
    { id: 'saving', header: 'Claimed saving', accessorFn: (i) => (i.claimed_savings_kg == null || i.claimed_savings_kg === '' ? null : Number(i.claimed_savings_kg)), meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums font-semibold">{fmtTonnes(getValue())}</span> },
    { id: 'created', header: 'Added', accessorFn: (i) => (i.created_at || '').slice(0, 10) || 'N/A' },
    ...(canWrite ? [{
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" onClick={() => setConfirm(row.original)} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Remove initiative ${row.original.name}`} disabled={busy}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      ),
    }] : []),
  ], [canWrite, busy])

  return (
    <div className="space-y-[var(--gap-grid)]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[var(--gap-grid)]">
        <StatTile label="Initiatives" value={loading ? '...' : fmtNum(summary.count)} icon={Target} />
        <StatTile label="Live (active or pilot)" value={loading ? '...' : fmtNum(summary.live)} icon={Leaf} tone="accent" />
        <StatTile label="Completed" value={loading ? '...' : fmtNum(summary.completed)} icon={ShieldCheck} tone="info" />
        <StatTile label="Claimed savings" value={fmtTonnes(summary.totalSavingsKg)} sub={summary.count ? `${summary.claimedCount} of ${summary.count} quantified` : ''} icon={TrendingDown} />
      </div>

      <Card>
        <CardHeader level={2} icon={Target} title="Reduction initiatives" />
        {canWrite ? (
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4 items-end">
            <div className="lg:col-span-2"><Field label="Initiative name (required)" id="ini-name"><input id="ini-name" className="input min-h-[44px]" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></Field></div>
            <Field label="Owner" id="ini-owner"><input id="ini-owner" className="input min-h-[44px]" value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} /></Field>
            <Field label="Saving (kg)" id="ini-saving"><input id="ini-saving" className="input min-h-[44px]" type="number" min="0" step="1" value={form.claimed_savings_kg} onChange={(e) => setForm((f) => ({ ...f, claimed_savings_kg: e.target.value }))} /></Field>
            <Field label="Status" id="ini-status">
              <select id="ini-status" className="input min-h-[44px]" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {INITIATIVE_STATUSES.map((st) => <option key={st} value={st}>{humanize(st)}</option>)}
              </select>
            </Field>
            <button type="submit" className={`btn-primary text-sm inline-flex items-center justify-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add
            </button>
            <div className="sm:col-span-2 lg:col-span-6"><Field label="Description (optional)" id="ini-desc"><input id="ini-desc" className="input min-h-[44px]" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field></div>
          </form>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mb-3">Initiatives are added by Admin, Manager or Director roles.</p>
        )}
        {msg && <p role="alert" className="text-sm text-red-400 mb-3">{msg}</p>}
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="relative flex-1 min-w-[12rem]">
            <label htmlFor="ini-search" className="sr-only">Search initiatives</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="ini-search" className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder="Search name, owner or description" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label htmlFor="ini-status-filter" className="sr-only">Status</label>
          <select id="ini-status-filter" className={`input min-h-[44px] ${FOCUS}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {INITIATIVE_STATUSES.map((st) => <option key={st} value={st}>{humanize(st)}</option>)}
          </select>
          {(search || status) && (
            <button type="button" onClick={() => { setSearch(''); setStatus('') }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}>
              <X size={14} aria-hidden="true" /> Clear
            </button>
          )}
        </div>
        <EnterpriseTable
          columns={columns}
          data={rows}
          getRowId={(i) => String(i.id)}
          loading={loading}
          error={error || null}
          onRetry={onReload}
          enableGlobalFilter={false}
          emptyMessage={search || status ? 'No initiatives match these filters.' : 'No reduction initiatives recorded yet.'}
          exportFileName={reportFileName('Carbon Reduction Initiatives')}
          reportMeta={{ title: 'Reduction initiatives' }}
          initialPageSize={25}
        />
      </Card>

      {confirm && (
        <Modal
          open
          size="sm"
          onClose={() => { if (!busy) setConfirm(null) }}
          title="Remove this initiative?"
          footer={(
            <>
              <button type="button" onClick={() => setConfirm(null)} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
              <button type="button" onClick={remove} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={busy}>
                <Trash2 size={14} aria-hidden="true" /> {busy ? 'Removing...' : 'Remove'}
              </button>
            </>
          )}
        >
          <p className="text-sm text-[var(--text-secondary)]">{confirm.name}. This cannot be undone.</p>
        </Modal>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FUEL EMISSIONS VIEW
 * ═══════════════════════════════════════════════════════════════════════════ */
function FuelEmissionsView() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null) // null = never loaded (skeleton)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [period, setPeriod] = useState(12)
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listFuelUsage({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fuel usage data.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const scopedRows = useMemo(() => scopeRowsByPeriod(rows || [], period, new Date()), [rows, period])
  const carbon = useMemo(() => computeCarbon(scopedRows), [scopedRows])
  const k = useMemo(() => fuelKpis(carbon), [carbon])
  const allVehicles = useMemo(() => vehicleRows(carbon), [carbon])
  const sites = useMemo(() => siteOptions(carbon), [carbon])
  const filtered = useMemo(() => filterVehicleRows(allVehicles, { site: siteFilter, search }), [allVehicles, siteFilter, search])
  const loading = rows === null
  const failed = !!error
  const trees = k.totalCo2Kg != null ? treesToOffset(k.totalCo2Kg) : null

  const tiles = [
    { label: 'Total CO2', value: failed ? 'N/A' : fmtTonnes(k.totalCo2Kg), sub: k.totalCo2Kg != null ? `${fmtNum(k.totalCo2Kg)} kg` : 'No fuel usage in period', icon: Leaf, tone: 'crit' },
    { label: 'CO2 per vehicle', value: failed ? 'N/A' : fmtTonnes(k.co2PerVehicleKg), sub: `${fmtNum(k.vehicles)} vehicles`, icon: Gauge, tone: 'warn' },
    { label: 'Diesel', value: failed || k.litres == null ? 'N/A' : `${fmtNum(k.litres)} L`, sub: k.distanceKm != null ? `${fmtNum(k.distanceKm)} km driven` : '', icon: Fuel, tone: 'info' },
    { label: 'Top-emitting site', value: failed ? 'N/A' : (k.topSite || 'N/A'), sub: k.topSiteSharePct != null ? `${k.topSiteSharePct}% of CO2` : 'No sites', icon: Building2, tone: 'neutral' },
    { label: 'Trees to offset', value: failed || trees == null ? 'N/A' : trees.toLocaleString(), sub: 'One year of absorption', icon: TreePine, tone: 'accent' },
    { label: 'Sites emitting', value: failed ? 'N/A' : fmtNum(k.sites), sub: `${fmtNum(filtered.length)} vehicles shown`, icon: Truck, tone: 'neutral' },
  ]

  const chartText = chartTextColor()
  const monthBar = {
    labels: carbon.byMonth.map((m) => m.label),
    datasets: [{ label: 'CO2 (kg)', data: carbon.byMonth.map((m) => m.co2), backgroundColor: colorAt(0), borderRadius: 4 }],
  }
  const topSites = carbon.bySite.slice(0, 10)
  const siteDoughnut = {
    labels: topSites.map((s) => s.site),
    datasets: [{ data: topSites.map((s) => s.co2), backgroundColor: categorical(topSites.length), borderWidth: 0 }],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmtNum(c.raw)} kg CO2` } } },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: GRID } },
      y: { ticks: { color: chartText }, grid: { color: GRID }, title: { display: true, text: 'kg CO2', color: chartText } },
    },
  }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${asTonnes(c.raw)} t` } },
    },
  }

  const EXPORT_COLS = ['vehicle', 'site', 'litres', 'co2Kg', 'co2Tonnes', 'sharePct']
  const EXPORT_HEADERS = ['Vehicle', 'Site', 'Diesel (L)', 'CO2 (kg)', 'CO2 (t)', 'Share (%)']
  const exportRows = vehicleExportRows(filtered)
  const fileBase = reportFileName('Carbon Fuel Emissions', activeCountry !== 'All' ? activeCountry : '')
  const periodLabel = PERIODS.find((p) => p.value === period)?.label || ''
  const pdfCols = EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] }))

  const columns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: (v) => v.rank, meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-muted)]">{getValue()}</span> },
    { id: 'vehicle', header: 'Vehicle', accessorFn: (v) => v.vehicle, cell: ({ getValue }) => <span className="font-semibold text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorFn: (v) => v.site },
    { id: 'litres', header: 'Diesel (L)', accessorFn: (v) => v.litres, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    { id: 'co2', header: 'CO2 (kg)', accessorFn: (v) => v.co2Kg, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    { id: 'co2t', header: 'CO2 (t)', accessorFn: (v) => v.co2Tonnes, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{getValue() == null ? 'N/A' : getValue()}</span> },
    { id: 'share', header: 'Share', accessorFn: (v) => v.sharePct, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-muted)]">{getValue() == null ? 'N/A' : `${getValue()}%`}</span> },
  ], [])

  const hasFilters = siteFilter || search

  return (
    <>
      <PageHeader
        title="Carbon Tracker: Fuel emissions"
        subtitle="Fleet CO2 from real fuel usage with the IPCC diesel factor, aggregated by month, site and vehicle."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ct-fuel-period" className="sr-only">Period</label>
            <select id="ct-fuel-period" className={`input min-h-[44px] ${FOCUS}`} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button type="button" onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Vehicles', { title: 'Carbon Fuel Emissions', dateRange: periodLabel }) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={async () => { try { await exportToPdf(exportRows, pdfCols, 'Carbon Fuel Emissions', fileBase, 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              disabled={!filtered.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
              getPdf={async () => ({
                base64: await exportToPdf(exportRows, pdfCols, 'Carbon Fuel Emissions', fileBase, 'landscape', '', { returnBase64: true }),
                filename: `${fileBase}.pdf`,
                subject: 'Carbon Fuel Emissions',
                bodyHtml: '<p>Attached is the Carbon Fuel Emissions report.</p>',
              })}
            />
          </div>
        }
      />

      {error && <ErrorBanner title="Could not load fuel usage." message={error} onRetry={load} />}

      <Card tone="warn">
        <div className="flex items-start gap-[var(--space-3)]">
          <Info size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            <span className="font-semibold text-[var(--text-primary)]">Estimate.</span>{' '}
            CO2 is derived from distance travelled per tyre record and the IPCC diesel factor of{' '}
            <span className="font-semibold">{DIESEL_KG_PER_L} kg/L</span>. Distance is real fleet data; the litres-per-km conversion uses a fleet-average consumption assumption.
          </p>
        </div>
      </Card>

      <KpiStrip loading={loading} tiles={tiles} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
        <Card>
          <CardHeader level={2} title="Monthly CO2 emissions" description="kg CO2 per month in the selected period" />
          <div className="h-64" role="img" aria-label={`Monthly CO2 emissions, ${carbon.byMonth.length} months`}>
            {loading ? <Skeleton className="w-full h-full" />
              : carbon.byMonth.length ? <Bar data={monthBar} options={barOpts} />
                : <EmptyChart empty={failed ? 'Could not load this chart.' : 'No dated fuel usage in this period.'} />}
          </div>
        </Card>
        <Card>
          <CardHeader level={2} title="CO2 by site" description="Top 10 sites" />
          <div className="h-64" role="img" aria-label={`CO2 by site, top ${topSites.length} sites`}>
            {loading ? <Skeleton className="w-full h-full" />
              : topSites.length ? <Doughnut data={siteDoughnut} options={doughnutOpts} />
                : <EmptyChart empty={failed ? 'Could not load this chart.' : 'No site emissions to show.'} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader level={2} icon={Truck} title="Vehicle emissions register" />
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="relative flex-1 min-w-[12rem]">
            <label htmlFor="fuel-search" className="sr-only">Search vehicle or site</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="fuel-search" className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder="Search vehicle or site" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label htmlFor="fuel-site" className="sr-only">Site</label>
          <select id="fuel-site" className={`input min-h-[44px] ${FOCUS}`} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && (
            <button type="button" onClick={() => { setSiteFilter(''); setSearch('') }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}>
              <X size={14} aria-hidden="true" /> Clear
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {allVehicles.length} vehicles</span>
        </div>
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(v) => String(v.vehicle)}
          loading={loading}
          error={failed ? error : null}
          onRetry={load}
          enableGlobalFilter={false}
          enableExport={false}
          viewKey="carbon-fuel-vehicles"
          emptyMessage={hasFilters ? 'No vehicles match these filters.' : 'No fuel usage data for the selected period.'}
          initialPageSize={25}
        />
      </Card>
    </>
  )
}
