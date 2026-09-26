/**
 * AssetDisposals (route /asset-disposals) - the disposal committee register.
 *
 * The committee proposes machines to scrap or sell. That proposal is where the
 * work STARTS, and this page exists because of the gap it leaves behind: most
 * of these machines are still marked Active in the fleet register, some are not
 * in the register at all, and several still have tyres bolted to them. Until
 * somebody acts, the fleet count is overstated and recoverable stock is about to
 * leave on the back of a lorry.
 *
 * So every row is shown beside its LIVE evidence - the register's own view of
 * the asset, its job cards and spend, and the tyres still fitted BY SERIAL - and
 * an elevated user can edit the row and record the decision here.
 *
 * All maths live in the pure `assetDisposal` engine; this file is orchestration
 * and presentation. Nothing is fabricated: a machine nobody valued reads "Not
 * valued", never SAR 0, and a failed read says so rather than showing an empty
 * register that reads as "there is nothing to dispose of".
 */
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Recycle, AlertTriangle, Truck, Upload, FileSpreadsheet, FileText, Presentation,
  Filter, X, Loader2, ExternalLink, CircleDot, Save, Wrench, Info, Search,
  Banknote, RefreshCw, Activity, History, Tag,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StudioBoundary from '../components/present/StudioBoundary'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getDisposalRegister, getDisposalReliability, getDisposalFleetBaseline,
  listReplacementBenchmarks,
  updateDisposal, setDisposalDecision,
  importDisposalRows, mapDisposalSheetRows,
} from '../lib/api/assetDisposals'
import {
  shapeReliability, mergeReliability, reliabilityExportRows,
  fleetReliability, shapeFleetBaseline, boardRecommendations,
} from '../lib/assetDisposalReliability'
import { shapeBenchmarks } from '../lib/assetReplacement'
import { listAssetBreakdowns } from '../lib/api/assetBreakdowns'
import {
  mergeBreakdowns, downtimeNote, repairLabel, disposalCandidatesFromBreakdowns,
} from '../lib/assetBreakdowns'
import {
  shapeDisposalRegister, filterDisposals, disposalSummary, assetEconomics,
  spendBaselines, byGroup, ageBands, disposalExportRows, disposalFindings,
  dispositionMeta, disposalStatusMeta, conditionMeta, regionMeta,
  DISPOSITIONS, DISPOSAL_STATUSES, CONDITIONS,
} from '../lib/assetDisposal'
import { parseWorkbook } from '../lib/import/parseWorkbook'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportSheetsToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { disposalWorkbookSheets, workbookNotes } from '../lib/assetDisposalWorkbook'
import { toUserMessage } from '../lib/safeError'
import {
  disposalFilterOptions, countActiveFilters, mergeExportModel, uploadPreviewCounts,
  downtimeSortValue, stillActiveShare, findingDotClass,
} from '../lib/assetDisposalsAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const DisposalDeckBuilder = lazy(() => import('../components/disposal/DisposalDeckBuilder'))
const ReliabilityPanel = lazy(() => import('../components/disposal/ReliabilityPanel'))
const ReplacementPanel = lazy(() => import('../components/disposal/ReplacementPanel'))
const AssetHistoryDrawer = lazy(() => import('../components/disposal/AssetHistoryDrawer'))

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const EMPTY_FILTERS = {
  search: '', disposition: '', region: '', assetType: '',
  status: '', condition: '', site: '', inRegister: 'all', downtime: '',
}

/** Tone -> the two classes every badge and finding on this page uses. */
const TONE_CLASS = {
  danger: 'bg-red-500/15 text-red-300 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  quiet: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

const fmtNum = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString())

/** Money is printed with its own currency, or withheld when the set is mixed. */
function fmtMoney(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency || ''}`.trim()
}

const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}

function Badge({ meta, className = '' }) {
  if (!meta) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${TONE_CLASS[meta.tone] || TONE_CLASS.quiet} ${className}`}>
      {meta.label}
    </span>
  )
}

/**
 * How long this machine has been standing still, from the breakdown register.
 *
 * A machine with no breakdown row prints "Not recorded", NEVER "0 days". The
 * breakdown register only began this month, so an absent row means nobody has
 * told us - not that the machine has never stopped - and on a page where the
 * decision is whether to scrap something, the difference between those two is
 * the whole argument.
 */
function DowntimeCell({ entry }) {
  if (!entry) return <span className="text-[var(--text-muted)] text-xs">Not recorded</span>
  const note = downtimeNote(entry)
  if (entry.open > 0) {
    const long = (entry.currentDays ?? 0) >= 30
    return (
      <span className="inline-flex flex-col gap-0.5">
        <Badge meta={{ label: note, tone: long ? 'danger' : 'warning' }} />
        {entry.repairLocation && (
          <span className="text-[10px] text-[var(--text-muted)]">{repairLabel(entry.repairLocation)}</span>
        )}
      </span>
    )
  }
  return <span className="text-[var(--text-secondary)] text-xs">{note || 'Back in service'}</span>
}

/**
 * A headline number. Clickable tiles apply a filter rather than just informing.
 *
 * `interactive` is what carries the clickable affordance now: it adds the
 * pointer cursor AND a focus-visible ring the hand-rolled version never had.
 *
 * The selected border is a `style` longhand rather than `border-blue-500`,
 * because Card sets `border`/`borderColor` INLINE and a plain utility class is
 * a normal declaration that loses to it - the class would render nothing. It is
 * only present when the tile is active: passing `borderColor: undefined` would
 * REMOVE Card's own value (React drops undefined style props) and leave the
 * border falling back to currentColor.
 *
 * `transition-colors` is gone because `.tp-card` already transitions
 * border-color and box-shadow, which is the only thing that moves here.
 */
function Tile({ label, value, sub, tone = 'quiet', onClick, active, icon: Icon }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Card
      as={Cmp}
      onClick={onClick}
      interactive={!!onClick}
      type={onClick ? 'button' : undefined}
      aria-pressed={onClick ? !!active : undefined}
      className="text-left w-full min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      style={active ? { borderColor: '#3b82f6' } : undefined}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-300' : tone === 'warning' ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </Card>
  )
}

const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 min-h-11'

const chartOpts = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, ...(extra.plugins || {}) },
  ...extra,
})

export default function AssetDisposals() {
  const { activeCountry, appSettings } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)
  const company = appSettings?.company_name || 'TyrePulse'

  const [register, setRegister] = useState(null)
  const [reliability, setReliability] = useState(null)
  // The list measured against the fleet it is leaving. Its own read, because a
  // missing baseline must cost two recommendation points and never the page.
  const [baseline, setBaseline] = useState(null)
  // Supplier quotations that price a whole asset class. Kept raw so the editor
  // can write them back; shaped below for every reader.
  const [benchmarkRows, setBenchmarkRows] = useState([])
  const [tab, setTab] = useState('register')
  const [history, setHistory] = useState(null)  // machine open in the history drawer
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const [detail, setDetail] = useState(null)   // row open in the drawer
  const [editing, setEditing] = useState(null) // row open in the editor
  const [deciding, setDeciding] = useState(null)
  const [upload, setUpload] = useState(null)
  const [breakdownRows, setBreakdownRows] = useState([])
  const [deckOpen, setDeckOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError('')
    try {
      // The reads are independent on purpose: a database without the
      // reliability RPC must still show the register, a register that fails
      // to load must not be reported as a fleet that never breaks down, and a
      // failed quotation read must cost only the replacement figures.
      const [reg, rel, base, bench, brk] = await Promise.allSettled([
        getDisposalRegister({ country: activeCountry }),
        getDisposalReliability({ country: activeCountry }),
        getDisposalFleetBaseline({ country: activeCountry }),
        listReplacementBenchmarks({ country: activeCountry }),
        listAssetBreakdowns({ country: activeCountry }),
      ])
      if (reg.status === 'fulfilled') {
        setRegister(shapeDisposalRegister(reg.value))
        setError('')
      } else {
        setRegister(null)
        setError(toUserMessage(reg.reason))
      }
      setReliability(shapeReliability(rel.status === 'fulfilled' ? rel.value : null))
      setBaseline(base.status === 'fulfilled' ? base.value : null)
      // A read that failed leaves NO quotations, so every machine reads as
      // unpriced with its reason. It never leaves a stale price on screen.
      setBenchmarkRows(bench.status === 'fulfilled' ? (bench.value?.rows || []) : [])
      // A failed breakdown read leaves NO downtime, so every machine reads
      // "Not recorded" with its reason - never a silent zero days down.
      setBreakdownRows(brk.status === 'fulfilled' ? (brk.value?.rows || []) : [])
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e))
      setRegister(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load(false) }, [load])

  // Memoised so the empty-array fallback does not mint a new identity on every
  // render and re-run every derived memo below it.
  // Reliability is merged onto the register rows BEFORE filtering, so a filtered
  // reliability table describes the same machines as the filtered register. If
  // the engine is unavailable the register rows pass through untouched and the
  // reliability surface reports that it could not measure anything.
  const baseRows = useMemo(() => {
    const base = register?.rows || []
    const assets = reliability?.ok ? (reliability.assets || []) : []
    if (!assets.length) return base
    const merged = mergeReliability(base, assets)
    return Array.isArray(merged) ? merged : base
  }, [register, reliability])
  // Downtime is merged BEFORE filtering, for the same reason reliability is:
  // a filtered table and a filtered downtime column must describe the same
  // machines. A machine with no breakdown row keeps breakdown null and reads
  // "Not recorded" rather than being claimed as never having stopped.
  const rows = useMemo(
    () => mergeBreakdowns(baseRows, breakdownRows, Date.now()),
    [baseRows, breakdownRows],
  )
  const filtered = useMemo(() => filterDisposals(rows, filters), [rows, filters])
  // Machines that are down long enough to be worth a committee look but are not
  // on the register. Derived from the FULL register, not the filtered view: a
  // machine is either on the list or it is not, and a filter must never make it
  // look like it is missing.
  const missingCandidates = useMemo(
    () => disposalCandidatesFromBreakdowns(breakdownRows, baseRows, { now: Date.now() }),
    [breakdownRows, baseRows],
  )
  // Totals follow the FILTERED rows: a filtered table under register-wide
  // headlines is how a reader ends up quoting a number that is not on screen.
  const totals = useMemo(() => disposalSummary(filtered), [filtered])
  const findings = useMemo(() => disposalFindings(filtered, totals), [filtered, totals])
  const baselines = useMemo(() => spendBaselines(rows), [rows])
  // Shaped once: inactive rows dropped, the newest quotation per class winning,
  // and the older one kept visible as superseded rather than silently gone.
  const benchmarks = useMemo(() => shapeBenchmarks(benchmarkRows, { now: Date.now() }), [benchmarkRows])


  const options = useMemo(() => disposalFilterOptions(rows), [rows])
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])
  const activeShare = useMemo(() => stillActiveShare(totals), [totals])
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const currency = totals.mixedCurrency ? '' : (totals.currency || '')

  // Computed ONCE here and handed to the reliability panel, so the points on
  // screen and the points in the workbook are the same objects rather than two
  // calls that agree today and drift the first time either gains an argument.
  const shapedBaseline = useMemo(() => shapeFleetBaseline(baseline), [baseline])
  const boardPoints = useMemo(() => {
    const fleet = fleetReliability(filtered)
    return boardRecommendations(filtered, fleet, {
      now: Date.now(),
      currency: fleet.mixedCurrency ? 'SAR' : (currency || fleet.currency || 'SAR'),
      fleetBaseline: shapedBaseline,
    })
  }, [filtered, currency, shapedBaseline])

  // ── charts (palette follows the super-admin report theme) ──────────────────
  const byType = useMemo(() => byGroup(filtered, 'asset_type'), [filtered])
  const byRegion = useMemo(() => byGroup(filtered, 'region'), [filtered])
  const byCondition = useMemo(() => byGroup(filtered, 'condition'), [filtered])
  const ages = useMemo(() => ageBands(filtered), [filtered])

  const barData = (list, label) => ({
    labels: list.map((g) => g.label),
    datasets: [{
      label,
      data: list.map((g) => g.count),
      backgroundColor: list.map((_, i) => withAlpha(colorAt(i), 0.75)),
      borderColor: list.map((_, i) => colorAt(i)),
      borderWidth: 1,
    }],
  })

  const spendByTypeData = useMemo(() => {
    const priced = byType.filter((g) => g.spend != null && g.spend > 0)
    return {
      hasData: priced.length > 0,
      data: {
        labels: priced.map((g) => g.label),
        datasets: [{
          label: `Lifetime spend ${currency}`.trim(),
          data: priced.map((g) => g.spend),
          backgroundColor: priced.map((_, i) => withAlpha(colorAt(i), 0.75)),
          borderColor: priced.map((_, i) => colorAt(i)),
          borderWidth: 1,
        }],
      },
    }
  }, [byType, currency])

  const conditionData = useMemo(() => ({
    labels: byCondition.map((g) => g.label),
    datasets: [{
      data: byCondition.map((g) => g.count),
      backgroundColor: categorical(byCondition.length),
      borderWidth: 0,
    }],
  }), [byCondition])

  // ── tables ─────────────────────────────────────────────────────────────────
  // Economics computed once per row so sort keys and cells read the same numbers.
  const registerRows = useMemo(
    () => filtered.map((r) => ({ row: r, e: assetEconomics(r, { peerSpendPerYear: baselines[r?.asset_type] }) })),
    [filtered, baselines],
  )
  const registerColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (x) => x.row.asset_no, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{row.original.row.asset_no}</span> },
    { id: 'type', header: 'Type', accessorFn: (x) => x.row.asset_type || 'N/A' },
    { id: 'where', header: 'Region / Site', accessorFn: (x) => `${regionMeta(x.row.region).label} / ${x.row.site || 'N/A'}`, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{regionMeta(row.original.row.region).label}<span className="text-[var(--text-muted)]"> / {row.original.row.site || 'N/A'}</span></span> },
    { id: 'disposition', header: 'Disposition', accessorFn: (x) => dispositionMeta(x.row.disposition).label, cell: ({ row }) => <Badge meta={dispositionMeta(row.original.row.disposition)} /> },
    { id: 'condition', header: 'Condition', accessorFn: (x) => conditionMeta(x.row.condition).label, cell: ({ row }) => <Badge meta={conditionMeta(row.original.row.condition)} /> },
    { id: 'register', header: 'Fleet register', accessorFn: (x) => (x.e.inRegister ? (x.e.fleetStatus || 'Listed') : 'Not in register'), cell: ({ row }) => (row.original.e.inRegister ? <span className="text-[var(--text-secondary)]">{row.original.e.fleetStatus || 'Listed'}</span> : <Badge meta={{ label: 'Not in register', tone: 'warning' }} />) },
    { id: 'downtime', header: 'Downtime', accessorFn: (x) => downtimeSortValue(x.row.breakdown) ?? undefined, sortUndefined: 'last', sortingFn: 'basic', meta: { exportValue: (x) => (x.row.breakdown ? downtimeNote(x.row.breakdown) || 'Back in service' : 'Not recorded') }, cell: ({ row }) => <DowntimeCell entry={row.original.row.breakdown} /> },
    { id: 'jobCards', header: 'Job cards', accessorFn: (x) => x.e.jobCards ?? undefined, sortUndefined: 'last', sortingFn: 'basic', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.e.jobCards)}</span> },
    { id: 'spend', header: 'Spend', accessorFn: (x) => (x.e.spend == null ? undefined : Number(x.e.spend)), sortUndefined: 'last', sortingFn: 'basic', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtMoney(row.original.e.spend, row.original.e.currency)}</span> },
    { id: 'tyres', header: 'Tyres fitted', accessorFn: (x) => x.e.tyresActive ?? 0, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.e.tyresActive || ''}</span> },
    { id: 'status', header: 'Status', accessorFn: (x) => disposalStatusMeta(x.row.status).label, cell: ({ row }) => <Badge meta={disposalStatusMeta(row.original.row.status)} /> },
    {
      id: 'history', header: 'History', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(ev) => { ev.stopPropagation(); setHistory(row.original.row) }}
          className="text-blue-400 hover:underline inline-flex items-center gap-1 text-xs min-h-11 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          aria-label={`Open the history of ${row.original.row.asset_no}`}
        >
          <History size={13} aria-hidden="true" /> History
        </button>
      ),
    },
  ], [])
  const candidateColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (c) => c.asset_no, cell: ({ row }) => <Link to={`/asset-management/${encodeURIComponent(row.original.asset_no)}`} className="text-blue-400 hover:underline font-medium whitespace-nowrap">{row.original.asset_no}</Link> },
    { id: 'days', header: 'Days down', accessorFn: (c) => (c.currentDays != null && Number.isFinite(Number(c.currentDays)) ? Number(c.currentDays) : undefined), sortUndefined: 'last', sortingFn: 'basic', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-amber-300">{fmtNum(row.original.currentDays)}</span> },
    { id: 'fault', header: 'Fault', accessorFn: (c) => c.fault || 'Not recorded' },
    { id: 'repair', header: 'Repaired at', accessorFn: (c) => repairLabel(c.repairLocation) },
  ], [])

  // ── exports ────────────────────────────────────────────────────────────────
  /**
   * One export, both halves. The committee columns and the reliability columns
   * are produced by their own engines over the SAME filtered array in the same
   * order, so they are zipped by index. A duplicated key keeps the register's
   * version. When reliability is unavailable the export is the register alone
   * rather than a sheet of blank reliability columns.
   */
  const exportModel = useCallback(() => {
    const base = disposalExportRows(filtered)
    return reliability?.ok ? mergeExportModel(base, reliabilityExportRows(filtered)) : base
  }, [filtered, reliability])
  const [exportError, setExportError] = useState('')
  // Every export goes through here so a failed file says so instead of the
  // button appearing to do nothing.
  const runExport = async (fn) => {
    setExportError('')
    try { await fn() } catch (e) { setExportError(toUserMessage(e, 'The export could not be created.')) }
  }

  const doExportExcel = async () => {
    const { columns, rows: objects, head } = exportModel()
    const name = reportFileName('Asset Disposals', reportDateLabel())
    await exportToExcel(objects, columns, head, name, 'Disposals', {
      title: 'Asset Disposal Register', company, currency: currency || 'SAR',
    })
  }

  /**
   * Everything the module knows, in one workbook.
   *
   * The register, the reliability history, the replacement prices, the
   * quotations behind them, the board points and the fleet comparison are the
   * SAME figures the screen shows - built from the same export builders, so a
   * forwarded spreadsheet can never disagree with the page it came from. It
   * exports what is on screen, filters included, and the Contents sheet records
   * the basis each figure rests on.
   */
  const doExportWorkbook = async () => {
    const sheets = disposalWorkbookSheets({
      rows: filtered,
      totals,
      reliabilityTotals: reliability?.totals || null,
      benchmarks,
      recommendations: boardPoints,
      baseline,
      currency: currency || 'SAR',
      now: Date.now(),
    })
    await exportSheetsToExcel(sheets, reportFileName('Asset Disposals full', reportDateLabel()), {
      title: 'Asset Disposal - complete record',
      company,
      meta: {
        Country: activeCountry || 'All countries',
        'Machines exported': filtered.length,
      },
      notes: workbookNotes({ rows: filtered, benchmarks, baseline, now: Date.now() }),
    })
  }
  const doExportPdf = async () => {
    const { columns, rows: objects, head } = exportModel()
    const name = reportFileName('Asset Disposals', reportDateLabel())
    await exportToPdf(
      objects,
      columns.map((k, i) => ({ key: k, header: head[i] })),
      'Asset Disposal Register',
      name,
      'landscape',
      company,
      { currency: currency || 'SAR' },
    )
  }

  // ── write paths ────────────────────────────────────────────────────────────
  const saveEdit = async (patch) => {
    setBusy(true)
    try {
      await updateDisposal(editing.id, patch)
      setEditing(null)
      setDetail(null)
      await load(true)
    } catch (e) {
      setError(toUserMessage(e))
    } finally { setBusy(false) }
  }

  const saveDecision = async (decision) => {
    setBusy(true)
    try {
      await setDisposalDecision(deciding.id, decision)
      setDeciding(null)
      setDetail(null)
      await load(true)
    } catch (e) {
      setError(toUserMessage(e))
    } finally { setBusy(false) }
  }

  const notProvisioned = register && register.ok === false && register.reason === 'not_provisioned'
  const readFailed = register && register.ok === false && !notProvisioned

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset Disposal"
        subtitle="Machines the disposal committee has proposed to scrap or sell, shown beside what the fleet register, the job card ledger and the tyre records still say about them."
        icon={Recycle}
        onRefresh={() => load(true)}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <button onClick={() => setUpload({ stage: 'pick' })} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Upload size={14} /> Upload sheet
              </button>
            )}
            <button onClick={() => setDeckOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <Presentation size={14} /> Build deck
            </button>
            {/* The whole module in one workbook. Kept beside the single-sheet
                export rather than replacing it: somebody who wants only the
                register should not have to open a six-sheet file to find it. */}
            <button
              onClick={() => runExport(doExportWorkbook)}
              className="btn-secondary text-sm inline-flex items-center gap-1.5"
              disabled={!filtered.length}
              title="Register, reliability, replacement prices, quotations, board points and the fleet comparison, in one workbook"
            >
              <FileSpreadsheet size={14} /> Download everything
            </button>
            <button onClick={() => runExport(doExportExcel)} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Register only
            </button>
            <button onClick={() => runExport(doExportPdf)} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        )}
      />

      {exportError && (
        <Card tone="crit" role="alert" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-300 flex-1">{exportError}</p>
          <button type="button" onClick={() => setExportError('')} className="btn-secondary text-sm min-h-11" aria-label="Dismiss export error"><X size={14} aria-hidden="true" /></button>
        </Card>
      )}

      {notProvisioned && (
        // The amber tint comes from `tone`, not `border border-amber-800/50`:
        // Card sets `border`/`borderColor` INLINE and a plain utility loses to
        // that, so the class would render nothing. And Card is `flex flex-col`
        // - Tailwind emits .flex-col after .flex-row, so the row direction goes
        // in `style`, which Card spreads last.
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Asset Disposal is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">The disposal register has not been created here. Nothing is missing from your data.</p>
          </div>
        </Card>
      )}

      {(readFailed || error) && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">The disposal register could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              {error || 'We could not read the register, so this page is not showing an empty list - it is showing nothing at all.'}
            </p>
          </div>
          <button onClick={() => load(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Retry
          </button>
        </Card>
      )}

      {loading && (
        <Card className="items-center gap-[var(--space-2)] text-[var(--text-muted)]" style={{ flexDirection: 'row' }}>
          <Loader2 size={16} className="animate-spin" /> Loading the disposal register...
        </Card>
      )}

      {!loading && register?.ok && rows.length === 0 && (
        <Card className="text-[var(--text-muted)]">
          <p className="text-[var(--text-primary)] font-medium">No machines are on the disposal list.</p>
          <p className="text-sm mt-1">The register was read successfully and it is empty. Upload a committee sheet to start one.</p>
        </Card>
      )}

      {!loading && register?.ok && rows.length > 0 && (
        <>
          {/* ── Headline strip ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Tile label="On the list" value={fmtNum(totals.assets)} icon={Recycle}
              sub={filtered.length !== rows.length ? `of ${rows.length} in the register` : null} />
            <Tile label="To scrap" value={fmtNum(totals.toScrap)} icon={Wrench}
              onClick={() => setFilter('disposition', filters.disposition === 'scrap' ? '' : 'scrap')}
              active={filters.disposition === 'scrap'} />
            <Tile label="To sell" value={fmtNum(totals.toSell)} icon={Banknote}
              onClick={() => setFilter('disposition', filters.disposition === 'sell' ? '' : 'sell')}
              active={filters.disposition === 'sell'} />
            <Tile
              label="Still Active in the register"
              value={fmtNum(totals.stillActive)}
              tone={totals.stillActive > 0 ? 'danger' : 'quiet'}
              sub={activeShare == null ? 'Counted as available fleet' : `${activeShare}% of this list, counted as available fleet`}
              icon={Truck}
              onClick={() => setFilter('inRegister', filters.inRegister === 'yes' ? 'all' : 'yes')}
              active={filters.inRegister === 'yes'}
            />
            <Tile label="Not in the register" value={fmtNum(totals.notInRegister)}
              tone={totals.notInRegister > 0 ? 'warning' : 'quiet'} icon={AlertTriangle}
              onClick={() => setFilter('inRegister', filters.inRegister === 'no' ? 'all' : 'no')}
              active={filters.inRegister === 'no'} />
            <Tile label="Lifetime spend"
              value={totals.mixedCurrency ? 'Mixed currencies' : fmtMoney(totals.lifetimeSpend, currency)}
              sub={totals.mixedCurrency ? 'Not summed across currencies' : `${fmtNum(totals.jobCards)} job cards`}
              icon={Banknote} />
            <Tile label="Tyres still fitted" value={fmtNum(totals.activeTyres)}
              tone={totals.activeTyres > 0 ? 'warning' : 'quiet'} sub="Recover before disposal" icon={CircleDot} />
          </div>

          {/* ── Findings ─────────────────────────────────────────────────── */}
          {findings.length > 0 && (
            <Card className="space-y-2">
              <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                <Info size={15} /> <span className="text-sm font-medium">What this list says</span>
              </div>
              <ul className="space-y-1.5">
                {findings.map((f) => (
                  <li key={f.key} className="flex items-start gap-2 text-sm">
                    <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${findingDotClass(f.tone)}`} />
                    <span className="text-[var(--text-secondary)]">{f.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ── Filters (shared by both tabs) ──────────────────────────────
              Deliberately NOT `clip`: eight native <select> dropdowns live in
              here. A native select paints its option list as an OS-level popup
              outside the page's overflow context so clipping could not reach
              it either way, but there is nothing here to crop. */}
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={filters.search}
                  onChange={(e) => setFilter('search', e.target.value)}
                  placeholder="Search asset, brand, type, site or tyre serial"
                  className={`${inputCls} pl-9`}
                  aria-label="Search the disposal register"
                />
              </div>
              <button type="button" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-11">
                <Filter size={14} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </button>
              {activeFilterCount > 0 && (
                <button onClick={() => setFilters(EMPTY_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                  <X size={14} /> Clear
                </button>
              )}
            </div>
            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Disposition</span>
                  <select value={filters.disposition} onChange={(e) => setFilter('disposition', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    {Object.values(DISPOSITIONS).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Status</span>
                  <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    {Object.values(DISPOSAL_STATUSES).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Region</span>
                  <select value={filters.region} onChange={(e) => setFilter('region', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    {options.regions.map((r) => <option key={r} value={r}>{regionMeta(r).label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Asset type</span>
                  <select value={filters.assetType} onChange={(e) => setFilter('assetType', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    {options.assetTypes.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Condition</span>
                  <select value={filters.condition} onChange={(e) => setFilter('condition', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    {Object.values(CONDITIONS).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Site</span>
                  <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Fleet register</span>
                  <select value={filters.inRegister} onChange={(e) => setFilter('inRegister', e.target.value)} className={inputCls}>
                    <option value="all">All</option>
                    <option value="yes">In the register</option>
                    <option value="no">Not in the register</option>
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)] space-y-1">
                  <span>Downtime</span>
                  <select value={filters.downtime} onChange={(e) => setFilter('downtime', e.target.value)} className={inputCls}>
                    <option value="">All</option>
                    <option value="down">Down right now</option>
                    <option value="long">Down over 30 days</option>
                    {/* Its own choice, not folded into "never broken down" - no
                        record is not the same as no breakdown. */}
                    <option value="unknown">No breakdown on record</option>
                  </select>
                </label>
              </div>
            )}
          </Card>

          {/* ── Tabs ─────────────────────────────────────────────────────── */}
          <div role="tablist" aria-label="Disposal views" className="flex flex-wrap items-center gap-2 border-b border-[var(--input-border)]">
            {[
              { key: 'register', label: 'Register', icon: Recycle },
              { key: 'reliability', label: 'Reliability and board view', icon: Activity },
              { key: 'replacement', label: 'Replacement', icon: Tag },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-11 text-sm border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t ${tab === t.key ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'reliability' && (
            <StudioBoundary>
              <Suspense fallback={<Card className="text-[var(--text-muted)]">Loading the reliability view...</Card>}>
                <ReliabilityPanel
                  rows={filtered}
                  reliability={reliability}
                  baseline={baseline}
                  recommendations={boardPoints}
                  currency={currency}
                  loading={loading}
                  onRetry={() => load(true)}
                  onOpenAsset={(r) => setHistory(r)}
                />
              </Suspense>
            </StudioBoundary>
          )}

          {tab === 'replacement' && (
            <StudioBoundary>
              <Suspense fallback={<Card className="text-[var(--text-muted)]">Loading the replacement view...</Card>}>
                <ReplacementPanel
                  rows={filtered}
                  benchmarks={benchmarks}
                  benchmarksRaw={benchmarkRows}
                  currency={currency}
                  canEdit={canWrite}
                  onSaved={() => load(true)}
                />
              </Suspense>
            </StudioBoundary>
          )}

          {tab === 'register' && (
          <>
          {/* ── Charts ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
            <Card>
              <CardHeader level={3} title="Machines by asset type" />
              <CardBody style={{ height: '16rem' }}>{byType.length ? <Bar data={barData(byType, 'Machines')} options={chartOpts()} /> : <p className="text-sm text-[var(--text-muted)]">Nothing to chart for this selection.</p>}</CardBody>
            </Card>
            <Card>
              <CardHeader level={3} title="Machines by region" />
              <CardBody style={{ height: '16rem' }}>{byRegion.length ? <Bar data={barData(byRegion, 'Machines')} options={chartOpts()} /> : <p className="text-sm text-[var(--text-muted)]">Nothing to chart for this selection.</p>}</CardBody>
            </Card>
            <Card>
              <CardHeader level={3} title="Condition" />
              <CardBody style={{ height: '16rem' }}>
                {byCondition.length
                  ? <Doughnut data={conditionData} options={chartOpts({ plugins: { legend: { display: true, position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } } })} />
                  : <p className="text-sm text-[var(--text-muted)]">Nothing to chart for this selection.</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                level={3}
                title={<>Lifetime spend by asset type {currency && <span className="text-[var(--text-muted)]">({currency})</span>}</>}
              />
              <CardBody style={{ height: '16rem' }}>
                {totals.mixedCurrency
                  ? <p className="text-sm text-[var(--text-muted)]">This selection carries more than one currency, so spend is not charted as a single total.</p>
                  : spendByTypeData.hasData
                    ? <Bar data={spendByTypeData.data} options={chartOpts()} />
                    : <p className="text-sm text-[var(--text-muted)]">No spend is recorded against these machines.</p>}
              </CardBody>
            </Card>
          </div>

          {/* Age bands read as a strip rather than a chart: five buckets do not
              need axes, and "Year not recorded" has to stay visible. */}
          <Card>
            <CardHeader level={3} title="Age" />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-[var(--space-3)]">
              {ages.map((b) => (
                <div key={b.key} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                  <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmtNum(b.count)}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{b.label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Age is worked out from the model year. {fmtNum(totals.agedKnown)} of {fmtNum(totals.assets)} machines carry one.
            </p>
          </Card>

          {/* ── Down long enough to consider ─────────────────────────────
              The link between the two registers that actually carries value.
              Renders NOTHING when there is nothing to propose - a panel that is
              always on screen is a panel nobody reads. It proposes only; adding
              a machine to the disposal list stays the committee's decision. */}
          {missingCandidates.length > 0 && (
            // `p-4` and `border border-amber-500/30` would BOTH be dead against
            // Card's inline padding and border. `pad="tight"` is the exact same
            // 1rem at default density (--pad-card-tight = --space-4) and, unlike
            // the literal, it also compresses under compact density; the tint
            // comes from `tone`.
            //
            // Not `clip`: the table's page-size control is a native <select>.
            <Card pad="tight" tone="warn">
              <div className="flex items-center gap-2 mb-1">
                <Wrench size={15} className="text-amber-300 shrink-0" />
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  Down long enough to consider ({missingCandidates.length})
                </h3>
                <Link to="/asset-breakdowns" className="ml-auto text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
                  Breakdown register <ExternalLink size={12} />
                </Link>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                These machines have been out of service for over 30 days and are not on the disposal
                register. That is not a recommendation to scrap them - it is the list the committee has
                not seen.
              </p>
              <EnterpriseTable
                columns={candidateColumns}
                data={missingCandidates}
                getRowId={(c) => String(c.asset_no)}
                enableColumnFilters={false}
                searchPlaceholder="Search these machines"
                initialPageSize={25}
                exportFileName={reportFileName('Disposal candidates from breakdowns', reportDateLabel())}
                reportMeta={{ title: 'Down long enough to consider', company }}
                emptyMessage="No machine has been down long enough to consider."
              />
            </Card>
          )}

          {/* ── Register table ─────────────────────────────────────────────
              EnterpriseTable over the FULL filtered list, so a sort orders every
              machine, not just the page on screen. Its own search and export are
              off: the page's search box above drives both tabs, and the page's
              three exports carry the reliability columns the table does not.
              Composite cells keep their Badge pills and the DowntimeCell, whose
              "Not recorded" is a deliberate distinction from zero days (it sorts
              last, never as 0). Enter on a focused row opens the detail. */}
          <Card pad="none" clip>
            <EnterpriseTable
              columns={registerColumns}
              data={registerRows}
              getRowId={(r) => String(r.row.id || r.row.asset_no)}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              onRowClick={(r) => setDetail(r.row)}
              emptyMessage="No machines match these filters."
            />
          </Card>
          </>
          )}
        </>
      )}

      {/* ── History drawer ─────────────────────────────────────────────── */}
      {history && (
        <StudioBoundary>
          <Suspense fallback={null}>
            <AssetHistoryDrawer
              row={history}
              rows={filtered}
              currency={currency}
              onClose={() => setHistory(null)}
            />
          </Suspense>
        </StudioBoundary>
      )}

      {/* ── Detail drawer ──────────────────────────────────────────────── */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="xl"
        title={detail ? `${detail.asset_no} - ${detail.asset_type || 'Asset'}` : ''}
        subtitle={detail ? `${dispositionMeta(detail.disposition).label} - ${disposalStatusMeta(detail.status).label}` : ''}
        footer={canWrite && detail && (
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => setEditing(detail)} className="btn-secondary text-sm">Edit details</button>
            <button onClick={() => setDeciding(detail)} className="btn-primary text-sm">Record decision</button>
          </div>
        )}
      >
        {detail && <DisposalDetail row={detail} baselines={baselines} />}
      </Modal>

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      {editing && (
        <DisposalEditor
          row={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}

      {/* ── Decision ───────────────────────────────────────────────────── */}
      {deciding && (
        <DecisionModal
          row={deciding}
          busy={busy}
          onClose={() => setDeciding(null)}
          onSave={saveDecision}
        />
      )}

      {/* ── Upload ─────────────────────────────────────────────────────── */}
      {upload && (
        <UploadModal
          country={activeCountry}
          existing={rows}
          onClose={() => setUpload(null)}
          onDone={async () => { setUpload(null); await load(true) }}
        />
      )}

      {/* The deck builder is another agent's surface: it is lazily loaded and
          boundaried so a failure inside it cannot take this page down. */}
      {deckOpen && (
        <StudioBoundary>
          <Suspense fallback={null}>
            <DisposalDeckBuilder
              rows={filtered}
              totals={totals}
              benchmarks={benchmarks}
              // Without this the "against the rest of the fleet" slide always
              // resolved to "baseline was not supplied" while the page had it
              // loaded all along - a slide that silently says nothing reads as
              // a comparison nobody could make, rather than one nobody wired.
              fleetBaseline={baseline}
              country={activeCountry}
              company={company}
              onClose={() => setDeckOpen(false)}
            />
          </Suspense>
        </StudioBoundary>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Detail drawer - the committee's claim beside the system's evidence
 * ------------------------------------------------------------------ */

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="text-sm text-[var(--text-primary)] mt-0.5">{children ?? 'N/A'}</div>
    </div>
  )
}

// Serial first: that is what somebody carries to the yard to find the tyre.
const TYRE_COLUMNS = [
  {
    id: 'serial', header: 'Serial', accessorFn: (t) => t?.serial || 'Not recorded',
    cell: ({ row }) => (row.original?.serial
      ? <Link to={`/tyre-passport/${encodeURIComponent(row.original.serial)}`} className="text-blue-400 hover:underline">{row.original.serial}</Link>
      : <span className="text-[var(--text-muted)]">Not recorded</span>),
  },
  { id: 'position', header: 'Position', accessorFn: (t) => t?.position || 'N/A' },
  { id: 'brand', header: 'Brand', accessorFn: (t) => t?.brand || 'N/A' },
  { id: 'size', header: 'Size', accessorFn: (t) => t?.size || 'N/A' },
  { id: 'fitted', header: 'Fitted', accessorFn: (t) => t?.fitted || undefined, sortUndefined: 'last', cell: ({ row }) => fmtDate(row.original?.fitted) },
  { id: 'km', header: 'Km', accessorFn: (t) => (t?.km != null && Number.isFinite(Number(t.km)) ? Number(t.km) : undefined), sortUndefined: 'last', sortingFn: 'basic', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original?.km)}</span> },
]

const UPLOAD_COLUMNS = [
  { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no },
  { id: 'type', header: 'Type', accessorFn: (r) => r.asset_type || 'N/A' },
  { id: 'disposition', header: 'Disposition', accessorFn: (r) => dispositionMeta(r.disposition).label },
  { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A' },
  { id: 'remarks', header: 'Remarks', accessorFn: (r) => r.remarks || '', cell: ({ getValue }) => <span className="block truncate max-w-xs text-[var(--text-muted)]" title={getValue()}>{getValue()}</span> },
]

function DisposalDetail({ row, baselines }) {
  const e = assetEconomics(row, { peerSpendPerYear: baselines?.[row?.asset_type] })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge meta={{ label: e.verdictLabel, tone: e.verdictTone }} />
        {!e.inRegister && <Badge meta={{ label: 'Not in the fleet register', tone: 'warning' }} />}
        {e.fleetStatus === 'Active' && <Badge meta={{ label: 'Still Active in the register', tone: 'danger' }} />}
        <Link to={`/asset-management/${encodeURIComponent(row.asset_no)}`} className="ml-auto text-sm text-blue-400 hover:underline inline-flex items-center gap-1">
          Open asset <ExternalLink size={13} />
        </Link>
      </div>

      {/* The committee's own words, verbatim. */}
      <section>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Committee record</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Disposition">{dispositionMeta(row.disposition).label}</Field>
          <Field label="Condition">{conditionMeta(row.condition).label}</Field>
          <Field label="Region">{regionMeta(row.region).label}</Field>
          <Field label="Site">{row.site || 'N/A'}</Field>
          <Field label="Brand">{row.brand || 'N/A'}</Field>
          <Field label="Model year">{e.modelYear ?? 'N/A'}</Field>
          <Field label="Meter as written">{e.meterText || 'N/A'}</Field>
          <Field label="Major repair done">{row.major_repair_done == null ? 'N/A' : row.major_repair_done ? 'Yes' : 'No'}</Field>
        </div>
        {row.remarks && (
          <p className="mt-3 text-sm text-[var(--text-secondary)] whitespace-pre-line border-l-2 border-[var(--input-border)] pl-3">{row.remarks}</p>
        )}
        {row.description && <p className="mt-2 text-sm text-[var(--text-muted)]">{row.description}</p>}
      </section>

      {/* What the register itself says today. */}
      <section>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Fleet register</h4>
        {e.inRegister ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Status">{e.fleetStatus || 'N/A'}</Field>
            <Field label="Site">{row.fleet_site || 'N/A'}</Field>
            <Field label="Type">{row.fleet_vehicle_type || 'N/A'}</Field>
            <Field label="Make and model">{[row.fleet_make, row.fleet_model].filter(Boolean).join(' ') || 'N/A'}</Field>
            <Field label="Chassis">{row.chassis_no || 'N/A'}</Field>
            <Field label="Plate">{row.registration_no || 'N/A'}</Field>
            <Field label="Current km">{fmtNum(row.fleet_current_km)}</Field>
            <Field label="Model year">{row.fleet_model_year ?? 'N/A'}</Field>
          </div>
        ) : (
          <p className="text-sm text-amber-300">
            This machine is not in the fleet register, so there is no maintenance history, no meter and no plate recorded for it here.
          </p>
        )}
      </section>

      {/* Downtime, from the breakdown register. Shown only when there is
          something on record: a "Not recorded" panel on most of the fleet is
          noise, and the table column already states the gap per row. */}
      {row.breakdown && (
        <section>
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Downtime</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="State">{row.breakdown.open > 0 ? 'Down now' : 'Back in service'}</Field>
            <Field label="Days down">{row.breakdown.open > 0 ? (row.breakdown.currentDays ?? 'N/A') : 'N/A'}</Field>
            <Field label="Breakdowns on record">{row.breakdown.breakdowns}</Field>
            <Field label="Repaired at">{repairLabel(row.breakdown.repairLocation)}</Field>
          </div>
          {row.breakdown.open > 0 && row.breakdown.fault && (
            <p className="mt-3 text-sm text-[var(--text-secondary)] border-l-2 border-amber-500/40 pl-3">{row.breakdown.fault}</p>
          )}
          {row.breakdown.overdue && (
            <p className="mt-2 text-sm text-amber-300">
              This machine is past the date it was promised back. A promise that slipped is exactly what the breakdown register exists to surface.
            </p>
          )}
          <Link to="/asset-breakdowns" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-400 hover:underline">
            Open the breakdown register <ExternalLink size={13} />
          </Link>
        </section>
      )}

      {/* Cost, with the basis stated so nobody quotes a rate we did not measure. */}
      <section>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Cost and use</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Job cards">{fmtNum(e.jobCards)}</Field>
          <Field label="First job card">{fmtDate(e.firstJobCard)}</Field>
          <Field label="Last job card">{fmtDate(e.lastJobCard)}</Field>
          <Field label="Days since last">{e.daysSinceJobCard == null ? 'N/A' : fmtNum(e.daysSinceJobCard)}</Field>
          <Field label="Lifetime spend">{fmtMoney(e.spend, e.currency)}</Field>
          <Field label="Spend per year">{e.spendPerYear == null ? 'N/A' : fmtMoney(e.spendPerYear, e.currency)}</Field>
          <Field label="Spend per km">{e.spendPerKm == null ? 'N/A' : `${e.spendPerKm} ${e.currency}`}</Field>
          <Field label="Spend per hour">{e.spendPerHour == null ? 'N/A' : `${e.spendPerHour} ${e.currency}`}</Field>
          <Field label="Estimated value">{e.estimatedValue == null ? 'Not valued' : fmtMoney(e.estimatedValue, e.currency)}</Field>
          <Field label="Sale proceeds">{e.saleProceeds == null ? 'Not recorded' : fmtMoney(e.saleProceeds, e.currency)}</Field>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2">{e.basis}</p>
      </section>

      {/* The recoverable stock. Serial first: that is what somebody carries to
          the yard to find the tyre. */}
      <section>
        <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
          Tyres still fitted {e.tyresActive > 0 && <span className="text-amber-300">({e.tyresActive})</span>}
        </h4>
        {e.costRecoveryNote && <p className="text-sm text-amber-300 mb-2">{e.costRecoveryNote}</p>}
        {e.serials.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No tyre is recorded as fitted to this machine. That means none is on record here, which is not the same as none being on the axles.
          </p>
        ) : (
          <EnterpriseTable
            columns={TYRE_COLUMNS}
            data={e.serials.map((t, i) => ({ ...t, _key: `${t?.serial || 'n'}-${i}` }))}
            getRowId={(t) => t._key}
            enableColumnFilters={false}
            enableColumnVisibility={false}
            searchPlaceholder="Search serial, brand or size"
            initialPageSize={25}
            exportFileName={reportFileName(`Tyres still fitted ${row.asset_no}`, reportDateLabel())}
            reportMeta={{ title: `Tyres still fitted to ${row.asset_no}` }}
            emptyMessage="No tyre is recorded as fitted to this machine."
          />
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

function DisposalEditor({ row, busy, onClose, onSave }) {
  const [form, setForm] = useState({
    disposition: row.disposition || 'undecided',
    condition: row.condition || '',
    site: row.site || '',
    estimated_value: row.estimated_value ?? '',
    sale_proceeds: row.sale_proceeds ?? '',
    remarks: row.remarks || '',
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    onSave({
      ...form,
      // An empty box means "nobody has entered a value", which is a different
      // statement from zero, so it is sent as null and prints "Not valued".
      estimated_value: form.estimated_value === '' ? null : form.estimated_value,
      sale_proceeds: form.sale_proceeds === '' ? null : form.sale_proceeds,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Edit ${row.asset_no}`}
      subtitle="Committee record only. The fleet register, job cards and tyre records are read from their own modules and are not edited here."
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Disposition</span>
          <select value={form.disposition} onChange={(e) => set('disposition', e.target.value)} className={inputCls}>
            {Object.values(DISPOSITIONS).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Condition</span>
          <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className={inputCls}>
            <option value="">Not recorded</option>
            {Object.values(CONDITIONS).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Site</span>
          <input value={form.site} onChange={(e) => set('site', e.target.value)} className={inputCls} placeholder="Where the machine sits" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Estimated value</span>
          <input type="number" value={form.estimated_value} onChange={(e) => set('estimated_value', e.target.value)} className={inputCls} placeholder="Leave blank if not valued" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Sale proceeds</span>
          <input type="number" value={form.sale_proceeds} onChange={(e) => set('sale_proceeds', e.target.value)} className={inputCls} placeholder="Leave blank until sold" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
          <span>Remarks</span>
          <textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} rows={3} className={inputCls} />
        </label>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Decision
 * ------------------------------------------------------------------ */

function DecisionModal({ row, busy, onClose, onSave }) {
  const [status, setStatus] = useState(row.status === 'proposed' ? 'approved' : row.status || 'approved')
  const [note, setNote] = useState('')
  const [ref, setRef] = useState(row.disposal_ref || '')

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Record a decision on ${row.asset_no}`}
      subtitle="The decision is stamped with your name and the time. It does not change the fleet register; retiring the asset there is a separate step."
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button
            onClick={() => onSave({ status, decision_note: note, disposal_ref: ref })}
            className="btn-primary text-sm inline-flex items-center gap-1.5"
            disabled={busy}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Record
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <label className="text-xs text-[var(--text-muted)] space-y-1 block">
          <span>Decision</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {Object.values(DISPOSAL_STATUSES).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-[var(--text-muted)]">{disposalStatusMeta(status).note}</p>
        {status === 'disposed' && (
          <label className="text-xs text-[var(--text-muted)] space-y-1 block">
            <span>Disposal reference</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} placeholder="Scrap note, sale invoice or gate pass number" />
          </label>
        )}
        <label className="text-xs text-[var(--text-muted)] space-y-1 block">
          <span>Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls} placeholder="Why the committee decided this" />
        </label>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Upload - preview first, then upsert on the natural key
 * ------------------------------------------------------------------ */

function UploadModal({ country, existing, onClose, onDone }) {
  const [state, setState] = useState({ phase: 'pick', rows: [], fileName: '', error: '', progress: null, result: null })


  const pick = async (file) => {
    if (!file) return
    setState((s) => ({ ...s, phase: 'reading', error: '', fileName: file.name }))
    try {
      const parsed = await parseWorkbook(file)
      const sheet = (parsed?.sheets || [])[0]
      const mapped = mapDisposalSheetRows(sheet?.rows || [], { country, sourceFile: file.name })
      if (!mapped.length) {
        setState((s) => ({
          ...s,
          phase: 'pick',
          error: 'No asset codes were found in that file. Check that the sheet has an Asset column.',
        }))
        return
      }
      setState((s) => ({ ...s, phase: 'preview', rows: mapped }))
    } catch (e) {
      setState((s) => ({ ...s, phase: 'pick', error: toUserMessage(e) }))
    }
  }

  const commit = async () => {
    setState((s) => ({ ...s, phase: 'writing' }))
    try {
      const result = await importDisposalRows(state.rows, (p) => setState((s) => ({ ...s, progress: p })))
      setState((s) => ({ ...s, phase: 'done', result }))
      if (!result.failed) await onDone()
    } catch (e) {
      setState((s) => ({ ...s, phase: 'preview', error: toUserMessage(e) }))
    }
  }

  const { added, refreshed } = useMemo(() => uploadPreviewCounts(state.rows, existing), [state.rows, existing])

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Upload a committee sheet"
      subtitle="A machine already on the list is REFRESHED in place, not added again, so the same sheet can be uploaded as many times as it is revised."
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
          {state.phase === 'preview' && (
            <button onClick={commit} className="btn-primary text-sm">Write {state.rows.length} rows</button>
          )}
        </div>
      )}
    >
      <div className="space-y-3">
        {state.error && (
          <div role="alert" className="text-sm text-red-300 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {state.error}
          </div>
        )}

        {(state.phase === 'pick' || state.phase === 'reading') && (
          <label className="block rounded-lg border border-dashed border-[var(--input-border)] px-4 py-8 text-center cursor-pointer hover:border-blue-600/50 focus-within:ring-2 focus-within:ring-blue-500">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              aria-label="Choose a committee sheet to upload"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {state.phase === 'reading'
              ? <span className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Reading {state.fileName}...</span>
              : <span className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-2"><Upload size={15} /> Choose an Excel or CSV file</span>}
          </label>
        )}

        {state.phase === 'preview' && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                <div className="text-lg font-semibold text-[var(--text-primary)]">{state.rows.length}</div>
                <div className="text-[11px] text-[var(--text-muted)]">Rows read</div>
              </div>
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                <div className="text-lg font-semibold text-emerald-300">{added}</div>
                <div className="text-[11px] text-[var(--text-muted)]">New to the list</div>
              </div>
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                <div className="text-lg font-semibold text-sky-300">{refreshed}</div>
                <div className="text-[11px] text-[var(--text-muted)]">Already listed, will refresh</div>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Nothing has been written yet. Every row is stamped country {country || 'from your scope'} and keyed on its asset code.
            </p>
            <EnterpriseTable
              columns={UPLOAD_COLUMNS}
              data={state.rows.map((r, i) => ({ ...r, _key: `${r.asset_no}-${i}` }))}
              getRowId={(r) => r._key}
              enableColumnFilters={false}
              enableExport={false}
              enableColumnVisibility={false}
              searchPlaceholder="Search the rows read"
              initialPageSize={25}
              emptyMessage="No rows were read from the file."
            />
          </>
        )}

        {state.phase === 'writing' && (
          <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" />
            Writing {state.progress ? `${state.progress.done} of ${state.progress.total}` : ''}...
          </p>
        )}

        {state.phase === 'done' && state.result && (
          <div className="text-sm space-y-1">
            <p className="text-[var(--text-primary)]">{state.result.written} rows written.</p>
            {state.result.skipped > 0 && (
              <p className="text-[var(--text-muted)]">{state.result.skipped} rows carried no asset code and were left out.</p>
            )}
            {state.result.failed > 0 && (
              <p className="text-red-300">{state.result.failed} rows could not be written: {state.result.errors.join('; ')}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
