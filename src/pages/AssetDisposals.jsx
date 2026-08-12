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
} from '../lib/assetDisposalReliability'
import { shapeBenchmarks } from '../lib/assetReplacement'
import {
  shapeDisposalRegister, filterDisposals, disposalSummary, assetEconomics,
  spendBaselines, byGroup, ageBands, disposalExportRows, disposalFindings,
  dispositionMeta, disposalStatusMeta, conditionMeta, regionMeta,
  DISPOSITIONS, DISPOSAL_STATUSES, CONDITIONS,
} from '../lib/assetDisposal'
import { parseWorkbook } from '../lib/import/parseWorkbook'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const DisposalDeckBuilder = lazy(() => import('../components/disposal/DisposalDeckBuilder'))
const ReliabilityPanel = lazy(() => import('../components/disposal/ReliabilityPanel'))
const ReplacementPanel = lazy(() => import('../components/disposal/ReplacementPanel'))
const AssetHistoryDrawer = lazy(() => import('../components/disposal/AssetHistoryDrawer'))

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const EMPTY_FILTERS = {
  search: '', disposition: '', region: '', assetType: '',
  status: '', condition: '', site: '', inRegister: 'all',
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

/** A headline number. Clickable tiles apply a filter rather than just informing. */
function Tile({ label, value, sub, tone = 'quiet', onClick, active, icon: Icon }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      onClick={onClick}
      className={`card text-left w-full transition-colors ${onClick ? 'hover:border-blue-600/50 cursor-pointer' : ''} ${active ? 'border-blue-500' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-300' : tone === 'warning' ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </Cmp>
  )
}

const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

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
      const [reg, rel, base, bench] = await Promise.allSettled([
        getDisposalRegister({ country: activeCountry }),
        getDisposalReliability({ country: activeCountry }),
        getDisposalFleetBaseline({ country: activeCountry }),
        listReplacementBenchmarks({ country: activeCountry }),
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
  const rows = useMemo(() => {
    const base = register?.rows || []
    const assets = reliability?.ok ? (reliability.assets || []) : []
    if (!assets.length) return base
    const merged = mergeReliability(base, assets)
    return Array.isArray(merged) ? merged : base
  }, [register, reliability])
  const filtered = useMemo(() => filterDisposals(rows, filters), [rows, filters])
  // Totals follow the FILTERED rows: a filtered table under register-wide
  // headlines is how a reader ends up quoting a number that is not on screen.
  const totals = useMemo(() => disposalSummary(filtered), [filtered])
  const findings = useMemo(() => disposalFindings(filtered, totals), [filtered, totals])
  const baselines = useMemo(() => spendBaselines(rows), [rows])
  // Shaped once: inactive rows dropped, the newest quotation per class winning,
  // and the older one kept visible as superseded rather than silently gone.
  const benchmarks = useMemo(() => shapeBenchmarks(benchmarkRows, { now: Date.now() }), [benchmarkRows])

  const options = useMemo(() => {
    const uniq = (key) => [...new Set(rows.map((r) => r?.[key]).filter(Boolean))].sort()
    return {
      assetTypes: uniq('asset_type'),
      regions: uniq('region'),
      sites: uniq('site'),
    }
  }, [rows])

  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([k, v]) => (k === 'inRegister' ? v !== 'all' : !!v)).length,
    [filters],
  )
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const currency = totals.mixedCurrency ? '' : (totals.currency || '')

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
    if (!reliability?.ok) return base
    const rel = reliabilityExportRows(filtered)
    if (!rel || !Array.isArray(rel.columns) || !Array.isArray(rel.rows)) return base
    const extra = rel.columns
      .map((k, i) => ({ key: k, head: (rel.head || [])[i] || k }))
      .filter((c) => !base.columns.includes(c.key))
    return {
      columns: [...base.columns, ...extra.map((c) => c.key)],
      head: [...base.head, ...extra.map((c) => c.head)],
      rows: base.rows.map((o, i) => {
        const src = rel.rows[i] || {}
        const add = {}
        for (const c of extra) add[c.key] = src[c.key]
        return { ...o, ...add }
      }),
    }
  }, [filtered, reliability])

  const doExportExcel = async () => {
    const { columns, rows: objects, head } = exportModel()
    const name = reportFileName('Asset Disposals', reportDateLabel())
    await exportToExcel(objects, columns, head, name, 'Disposals', {
      title: 'Asset Disposal Register', company, currency: currency || 'SAR',
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
            <button onClick={doExportExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={doExportPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        )}
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Asset Disposal is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">The disposal register has not been created here. Nothing is missing from your data.</p>
          </div>
        </div>
      )}

      {(readFailed || error) && (
        <div className="card border border-red-800/50 flex items-start gap-3">
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
        </div>
      )}

      {loading && (
        <div className="card flex items-center gap-2 text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Loading the disposal register...
        </div>
      )}

      {!loading && register?.ok && rows.length === 0 && (
        <div className="card text-[var(--text-muted)]">
          <p className="text-[var(--text-primary)] font-medium">No machines are on the disposal list.</p>
          <p className="text-sm mt-1">The register was read successfully and it is empty. Upload a committee sheet to start one.</p>
        </div>
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
              sub="Counted as available fleet"
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
            <div className="card space-y-2">
              <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                <Info size={15} /> <span className="text-sm font-medium">What this list says</span>
              </div>
              <ul className="space-y-1.5">
                {findings.map((f) => (
                  <li key={f.key} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${f.tone === 'danger' ? 'bg-red-400' : f.tone === 'warning' ? 'bg-amber-400' : f.tone === 'info' ? 'bg-sky-400' : 'bg-slate-400'}`} />
                    <span className="text-[var(--text-secondary)]">{f.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Filters (shared by both tabs) ────────────────────────────── */}
          <div className="card space-y-3">
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
              <button onClick={() => setShowFilters((s) => !s)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
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
              </div>
            )}
          </div>

          {/* ── Tabs ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 border-b border-[var(--input-border)]">
            {[
              { key: 'register', label: 'Register', icon: Recycle },
              { key: 'reliability', label: 'Reliability and board view', icon: Activity },
              { key: 'replacement', label: 'Replacement', icon: Tag },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === t.key ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'reliability' && (
            <StudioBoundary>
              <Suspense fallback={<div className="card text-[var(--text-muted)]">Loading the reliability view...</div>}>
                <ReliabilityPanel
                  rows={filtered}
                  reliability={reliability}
                  baseline={baseline}
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
              <Suspense fallback={<div className="card text-[var(--text-muted)]">Loading the replacement view...</div>}>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Machines by asset type</h3>
              <div className="h-64">{byType.length ? <Bar data={barData(byType, 'Machines')} options={chartOpts()} /> : <p className="text-sm text-[var(--text-muted)]">Nothing to chart for this selection.</p>}</div>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Machines by region</h3>
              <div className="h-64">{byRegion.length ? <Bar data={barData(byRegion, 'Machines')} options={chartOpts()} /> : <p className="text-sm text-[var(--text-muted)]">Nothing to chart for this selection.</p>}</div>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Condition</h3>
              <div className="h-64">
                {byCondition.length
                  ? <Doughnut data={conditionData} options={chartOpts({ plugins: { legend: { display: true, position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } } })} />
                  : <p className="text-sm text-[var(--text-muted)]">Nothing to chart for this selection.</p>}
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Lifetime spend by asset type {currency && <span className="text-[var(--text-muted)]">({currency})</span>}
              </h3>
              <div className="h-64">
                {totals.mixedCurrency
                  ? <p className="text-sm text-[var(--text-muted)]">This selection carries more than one currency, so spend is not charted as a single total.</p>
                  : spendByTypeData.hasData
                    ? <Bar data={spendByTypeData.data} options={chartOpts()} />
                    : <p className="text-sm text-[var(--text-muted)]">No spend is recorded against these machines.</p>}
              </div>
            </div>
          </div>

          {/* Age bands read as a strip rather than a chart: five buckets do not
              need axes, and "Year not recorded" has to stay visible. */}
          <div className="card">
            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Age</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
          </div>

          {/* ── Register table ───────────────────────────────────────────── */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--input-bg)] text-[var(--text-muted)]">
                  <tr>
                    {['Asset', 'Type', 'Region / Site', 'Disposition', 'Condition', 'Fleet register', 'Job cards', 'Spend', 'Tyres fitted', 'Status', 'History'].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-6 text-center text-[var(--text-muted)]">No machines match these filters.</td></tr>
                  )}
                  {filtered.map((r) => {
                    const e = assetEconomics(r, { peerSpendPerYear: baselines[r?.asset_type] })
                    return (
                      <tr
                        key={r.id || r.asset_no}
                        onClick={() => setDetail(r)}
                        className="border-t border-[var(--input-border)] hover:bg-[var(--input-bg)] cursor-pointer"
                      >
                        <td className="px-3 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">{r.asset_no}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{r.asset_type || 'N/A'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">
                          {regionMeta(r.region).label}
                          <span className="text-[var(--text-muted)]"> / {r.site || 'N/A'}</span>
                        </td>
                        <td className="px-3 py-2"><Badge meta={dispositionMeta(r.disposition)} /></td>
                        <td className="px-3 py-2"><Badge meta={conditionMeta(r.condition)} /></td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {e.inRegister
                            ? <span className="text-[var(--text-secondary)]">{e.fleetStatus || 'Listed'}</span>
                            : <Badge meta={{ label: 'Not in register', tone: 'warning' }} />}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{fmtNum(e.jobCards)}</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(e.spend, e.currency)}</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{e.tyresActive || ''}</td>
                        <td className="px-3 py-2"><Badge meta={disposalStatusMeta(r.status)} /></td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={(ev) => { ev.stopPropagation(); setHistory(r) }}
                            className="text-blue-400 hover:underline inline-flex items-center gap-1 text-xs"
                          >
                            <History size={13} /> History
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
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

function DisposalDetail({ row, baselines }) {
  const e = assetEconomics(row, { peerSpendPerYear: baselines?.[row?.asset_type] })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge meta={{ label: e.verdictLabel, tone: e.verdictTone }} />
        {!e.inRegister && <Badge meta={{ label: 'Not in the fleet register', tone: 'warning' }} />}
        {e.fleetStatus === 'Active' && <Badge meta={{ label: 'Still Active in the register', tone: 'danger' }} />}
        <Link to={`/assets/${encodeURIComponent(row.asset_no)}`} className="ml-auto text-sm text-blue-400 hover:underline inline-flex items-center gap-1">
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[var(--text-muted)]">
                <tr>
                  {['Serial', 'Position', 'Brand', 'Size', 'Fitted', 'Km'].map((h) => (
                    <th key={h} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {e.serials.map((s, i) => (
                  <tr key={`${s?.serial || 'n'}-${i}`} className="border-t border-[var(--input-border)]">
                    <td className="px-2 py-1.5">
                      {s?.serial
                        ? <Link to={`/tyre-passport/${encodeURIComponent(s.serial)}`} className="text-blue-400 hover:underline">{s.serial}</Link>
                        : <span className="text-[var(--text-muted)]">Not recorded</span>}
                    </td>
                    <td className="px-2 py-1.5 text-[var(--text-secondary)]">{s?.position || 'N/A'}</td>
                    <td className="px-2 py-1.5 text-[var(--text-secondary)]">{s?.brand || 'N/A'}</td>
                    <td className="px-2 py-1.5 text-[var(--text-secondary)]">{s?.size || 'N/A'}</td>
                    <td className="px-2 py-1.5 text-[var(--text-secondary)]">{fmtDate(s?.fitted)}</td>
                    <td className="px-2 py-1.5 tabular-nums text-[var(--text-secondary)]">{fmtNum(s?.km)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

  const known = useMemo(() => new Set((existing || []).map((r) => String(r?.asset_no || '').toUpperCase())), [existing])

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

  const added = state.rows.filter((r) => !known.has(String(r.asset_no).toUpperCase())).length
  const refreshed = state.rows.length - added

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
          <div className="text-sm text-red-300 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {state.error}
          </div>
        )}

        {(state.phase === 'pick' || state.phase === 'reading') && (
          <label className="block rounded-lg border border-dashed border-[var(--input-border)] px-4 py-8 text-center cursor-pointer hover:border-blue-600/50">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
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
            <div className="max-h-64 overflow-auto border border-[var(--input-border)] rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-[var(--input-bg)] text-[var(--text-muted)] sticky top-0">
                  <tr>{['Asset', 'Type', 'Disposition', 'Site', 'Remarks'].map((h) => <th key={h} className="text-left font-medium px-2 py-1.5">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {state.rows.slice(0, 200).map((r, i) => (
                    <tr key={`${r.asset_no}-${i}`} className="border-t border-[var(--input-border)]">
                      <td className="px-2 py-1.5 text-[var(--text-primary)]">{r.asset_no}</td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">{r.asset_type || 'N/A'}</td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">{dispositionMeta(r.disposition).label}</td>
                      <td className="px-2 py-1.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="px-2 py-1.5 text-[var(--text-muted)] truncate max-w-xs">{r.remarks || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
