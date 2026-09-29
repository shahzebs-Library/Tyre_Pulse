/**
 * AssetDisposals (route /asset-disposals) - the disposal committee register,
 * rebuilt on the shared page kit to the owner's light reference design.
 *
 * The committee proposes machines to scrap or sell. That proposal is where the
 * work STARTS, and this page exists because of the gap it leaves behind: most
 * of these machines are still marked Active in the fleet register, some are not
 * in the register at all, and several still have tyres bolted to them. So every
 * row is shown beside its LIVE evidence - the register's own view of the asset,
 * its job cards and spend, the tyres still fitted BY SERIAL, and its downtime
 * from the breakdown register - and an elevated user can add, edit and decide.
 *
 * Maths live in the pure engines: `assetDisposal` (register, economics,
 * findings), `assetDisposalReliability`, `assetBreakdowns`, and
 * `assetDisposalView` (tiles, pipeline, reasons, recovery trend, next action).
 * Nothing is fabricated: an estimated value of 0 or blank reads "Not valued",
 * book value is not carried by any source so it reads N/A, recovery money is
 * shown per currency and never summed across countries, and a failed read says
 * so rather than showing an empty register.
 */
import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import {
  Recycle, AlertTriangle, Upload, FileSpreadsheet, FileText, Presentation,
  X, Loader2, ExternalLink, Save, Search, RefreshCw, CheckCircle2, Clock,
  ShoppingCart, Coins, ShieldAlert, Plus, FileSearch, Download, Eye, Pencil,
  History, ClipboardCheck, SlidersHorizontal, ChevronDown, Info,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import StudioBoundary from '../components/present/StudioBoundary'
import {
  Card, CardState, Kpi, PageHero, Pager, Tabs, KitTable, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getDisposalRegister, getDisposalReliability, getDisposalFleetBaseline,
  listReplacementBenchmarks,
  updateDisposal, setDisposalDecision, upsertDisposal,
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
import {
  disposalKpis, recoveryLabel, pipeline, topReasons, recoveryTrend, nextAction,
  approvalPill, CONDITION_TONE, makeModel, ageOf, valuationOf, applyViewFilters,
  valuationRequestRows, VALUATION_COLUMNS, VALUATION_HEADERS, ADDED_WINDOWS,
} from '../lib/assetDisposalView'
import { parseWorkbook } from '../lib/import/parseWorkbook'
import { exportToExcel, exportSheetsToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { disposalWorkbookSheets, workbookNotes } from '../lib/assetDisposalWorkbook'
import { toUserMessage } from '../lib/safeError'
import {
  disposalFilterOptions, countActiveFilters, mergeExportModel, uploadPreviewCounts,
  stillActiveShare, findingDotClass,
} from '../lib/assetDisposalsAnalytics'
import './AssetDisposals.css'

const DisposalDeckBuilder = lazy(() => import('../components/disposal/DisposalDeckBuilder'))
const ReliabilityPanel = lazy(() => import('../components/disposal/ReliabilityPanel'))
const ReplacementPanel = lazy(() => import('../components/disposal/ReplacementPanel'))
const AssetHistoryDrawer = lazy(() => import('../components/disposal/AssetHistoryDrawer'))

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])
const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

const EMPTY_FILTERS = {
  search: '', disposition: '', region: '', assetType: '',
  status: '', condition: '', site: '', inRegister: 'all', downtime: '',
  added: '', valuation: '', compliance: '', sold: false,
}

/** Tone -> the classes the badges in the modals use (they portal to the app theme). */
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

const Pill = ({ tone = 'muted', children, title }) => <span className={`cc-pill ${tone}`} title={title}>{children}</span>
const NA = ({ title, children = 'N/A' }) => <span className="cc-na" title={title}>{children}</span>

/**
 * How long this machine has been standing still, from the breakdown register.
 * A machine with no breakdown row prints "Not recorded", NEVER "0 days": the
 * breakdown register is young, so no row means nobody told us, not that the
 * machine has never stopped.
 */
function DowntimeCell({ entry }) {
  if (!entry) return <NA>Not recorded</NA>
  const note = downtimeNote(entry)
  if (entry.open > 0) {
    const long = (entry.currentDays ?? 0) >= 30
    return (
      <span className="ad-stack">
        <Pill tone={long ? 'bad' : 'warn'}>{note}</Pill>
        {entry.repairLocation && <small>{repairLabel(entry.repairLocation)}</small>}
      </span>
    )
  }
  return <span className="ad-soft">{note || 'Back in service'}</span>
}

const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 min-h-11'

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

function PipelineCard({ state, rows, sites }) {
  const [site, setSite] = useState('')
  const p = useMemo(() => pipeline(rows, { site }), [rows, site])
  return (
    <Card title="Disposal Pipeline" sub="Where each machine on the list stands today."
      action={(
        <select className="cc-select" aria-label="Pipeline site" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}>
      <CardState state={state} empty={state.data && !p.total ? (site ? 'No machine on the list sits at this site.' : 'No machine is on the disposal list.') : null}>
        <div className="ad-pipe" role="list">
          {p.stages.map((s) => (
            <div key={s.key} className="ad-pipe-row" role="listitem">
              <span className="ad-pipe-label">{s.label}</span>
              <span className="ad-pipe-track"><i style={{ width: p.max ? `${(s.count / p.max) * 100}%` : 0, background: s.color }} /></span>
              <b>{fmtInt(s.count)}</b>
            </div>
          ))}
        </div>
        <p className="ad-foot">The register records proposed, approved, rejected and disposed, plus whether a valuation exists. No other stage is tracked, so none is drawn.</p>
      </CardState>
    </Card>
  )
}

const REASON_DOT = { bad: 'var(--cc-red)', warn: 'var(--cc-amber)', good: 'var(--cc-green)', info: 'var(--cc-blue)', muted: 'var(--cc-ink-3)' }

function ReasonsCard({ state, rows }) {
  const [months, setMonths] = useState(0)
  const r = useMemo(() => topReasons(rows, { months, now: Date.now() }), [rows, months])
  return (
    <Card title="Top Disposal Reasons" sub="The condition the committee recorded."
      action={(
        <select className="cc-select" aria-label="Reasons period" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          <option value={0}>All time</option>
          <option value={6}>Added in last 6 months</option>
          <option value={12}>Added in last 12 months</option>
        </select>
      )}>
      <CardState state={state} empty={state.data && !r.total ? 'No machine was added to the list in this period.' : null}>
        <ul className="ad-reasons">
          {r.reasons.map((x) => {
            const tone = CONDITION_TONE[x.tone] || 'muted'
            return (
              <li key={x.label}>
                <i style={{ background: REASON_DOT[tone] }} aria-hidden="true" />
                <span>{x.label}</span>
                <b>{fmtInt(x.count)}</b>
                <small>{x.pct == null ? 'N/A' : `${x.pct}%`}</small>
              </li>
            )
          })}
        </ul>
        <p className="ad-foot">The committee sheet has no separate reason field, so the recorded condition is grouped.{r.more ? ` ${r.more} more not shown.` : ''}</p>
      </CardState>
    </Card>
  )
}

function RecoveryChart({ trend, currency }) {
  const W = 420; const H = 170; const pad = { l: 44, r: 30, t: 10, b: 22 }
  const series = trend.series
  const vals = series.map((s) => (currency ? (s.values[currency] ?? 0) : 0))
  const vMax = Math.max(1, ...vals)
  const cMax = Math.max(1, ...series.map((s) => s.count))
  const bw = (W - pad.l - pad.r) / series.length
  const x = (i) => pad.l + i * bw + bw / 2
  const yv = (v) => pad.t + (1 - v / vMax) * (H - pad.t - pad.b)
  const yc = (c) => pad.t + (1 - c / cMax) * (H - pad.t - pad.b)
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${yc(s.count)}`).join(' ')
  const label = series.map((s, i) => `${s.label} ${s.count} disposed${currency ? `, ${currency} ${Math.round(vals[i]).toLocaleString('en-US')}` : ''}`).join('; ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Recovery by month: ${label}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={yv(vMax * f)} y2={yv(vMax * f)} stroke="var(--cc-track)" />
          {currency && <text className="cc-axis" x={pad.l - 6} y={yv(vMax * f)} dy="0.35em" textAnchor="end">{Math.round(vMax * f).toLocaleString('en-US')}</text>}
          <text className="cc-axis" x={W - pad.r + 6} y={yc(cMax * f)} dy="0.35em">{Math.round(cMax * f)}</text>
        </g>
      ))}
      {currency && vals.map((v, i) => v > 0 && (
        <rect key={series[i].key} x={x(i) - bw * 0.3} y={yv(v)} width={bw * 0.6} height={H - pad.b - yv(v)} rx="2" fill="var(--cc-green)" opacity="0.55" />
      ))}
      <path d={line} fill="none" stroke="var(--cc-green-strong)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {series.map((s, i) => <circle key={s.key} cx={x(i)} cy={yc(s.count)} r="3" fill="var(--cc-green-strong)" />)}
      {series.map((s, i) => <text key={`l${s.key}`} className="cc-axis" x={x(i)} y={H - 5} textAnchor="middle">{s.label}</text>)}
    </svg>
  )
}

function RecoveryCard({ state, rows }) {
  const [months, setMonths] = useState(12)
  const trend = useMemo(() => recoveryTrend(rows, { months, now: Date.now() }), [rows, months])
  const [cur, setCur] = useState('')
  const currency = trend.currencies.includes(cur) ? cur : trend.currencies[0] || ''
  return (
    <Card title="Recovery Value Trend" sub="Machines disposed by month and the proceeds recorded on them."
      action={(
        <div className="ad-head-selects">
          {trend.currencies.length > 1 && (
            <select className="cc-select" aria-label="Currency" value={currency} onChange={(e) => setCur(e.target.value)}>
              {trend.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="cc-select" aria-label="Recovery period" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
        </div>
      )}>
      <CardState state={state} empty={state.data && !trend.disposed
        ? `No machine has been marked disposed in this period${trend.undated ? ` (${trend.undated} disposed with no date)` : ''}, so there is no recovery to chart.`
        : null}>
        <div className="ad-legend">
          {trend.hasValue && <span><i style={{ background: 'var(--cc-green)', opacity: 0.55 }} aria-hidden="true" />Recovery value ({currency})</span>}
          <span><i style={{ background: 'var(--cc-green-strong)' }} aria-hidden="true" />Assets disposed</span>
        </div>
        <div className="cc-chart ad-chart"><RecoveryChart trend={trend} currency={trend.hasValue ? currency : ''} /></div>
        {!trend.hasValue && <p className="ad-foot">No sale proceeds are recorded on these disposals, so only the count is drawn.</p>}
        {trend.currencies.length > 1 && <p className="ad-foot">Proceeds are shown one currency at a time and never added across countries.</p>}
      </CardState>
    </Card>
  )
}

/** Export menu: register sheet, full workbook, PDF and the deck builder. */
function ExportMenu({ disabled, onRegister, onWorkbook, onPdf, onDeck }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const run = (fn) => { setOpen(false); fn() }
  return (
    <div className="ad-menu" ref={ref}>
      <button type="button" className="cc-btn-ghost" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download size={14} aria-hidden="true" /> Export <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="ad-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => run(onRegister)}><FileSpreadsheet size={14} aria-hidden="true" /> Register only (Excel)</button>
          <button type="button" role="menuitem" onClick={() => run(onWorkbook)} title="Register, reliability, replacement prices, quotations, board points and the fleet comparison, in one workbook"><FileSpreadsheet size={14} aria-hidden="true" /> Download everything</button>
          <button type="button" role="menuitem" onClick={() => run(onPdf)}><FileText size={14} aria-hidden="true" /> PDF</button>
          <button type="button" role="menuitem" onClick={() => run(onDeck)}><Presentation size={14} aria-hidden="true" /> Build deck</button>
        </div>
      )}
    </div>
  )
}

function Bars({ list, money, currency }) {
  const vals = list.map((g) => (money ? g.spend : g.count) ?? 0)
  const max = Math.max(1, ...vals)
  return (
    <div className="ad-pipe">
      {list.map((g, i) => (
        <div key={g.label} className="ad-pipe-row">
          <span className="ad-pipe-label">{g.label}</span>
          <span className="ad-pipe-track"><i style={{ width: `${(vals[i] / max) * 100}%`, background: 'var(--cc-green)' }} /></span>
          <b>{money ? fmtMoney(vals[i], currency) : fmtInt(vals[i])}</b>
        </div>
      ))}
    </div>
  )
}

/** The register profile: the breakdowns the old register tab charted. */
function ProfilePanel({ filtered, totals, findings, currency }) {
  const byType = byGroup(filtered, 'asset_type')
  const byRegion = byGroup(filtered, 'region').map((g) => ({ ...g, label: regionMeta(g.label).label === 'Not recorded' ? g.label : regionMeta(g.label).label }))
  const byCondition = byGroup(filtered, 'condition')
  const spendTypes = byType.filter((g) => g.spend != null && g.spend > 0)
  const ages = ageBands(filtered)
  const empty = <div className="cc-empty">Nothing to show for this selection.</div>
  return (
    <div className="ad-profile">
      <div className="ad-profile-grid">
        <section><h3 className="ad-h3">Machines by asset type</h3>{byType.length ? <Bars list={byType} /> : empty}</section>
        <section><h3 className="ad-h3">Machines by region</h3>{byRegion.length ? <Bars list={byRegion} /> : empty}</section>
        <section><h3 className="ad-h3">Condition</h3>{byCondition.length ? <Bars list={byCondition} /> : empty}</section>
        <section>
          <h3 className="ad-h3">Lifetime spend by asset type {currency && <span className="ad-soft">({currency})</span>}</h3>
          {totals.mixedCurrency
            ? <div className="cc-empty">This selection carries more than one currency, so spend is not shown as a single total.</div>
            : spendTypes.length ? <Bars list={spendTypes} money currency={currency} /> : <div className="cc-empty">No spend is recorded against these machines.</div>}
        </section>
      </div>
      <section>
        <h3 className="ad-h3">Age</h3>
        <div className="ad-ages">
          {ages.map((b) => <div key={b.key}><b>{fmtNum(b.count)}</b><span>{b.label}</span></div>)}
        </div>
        <p className="ad-foot">Age is worked out from the model year. {fmtNum(totals.agedKnown)} of {fmtNum(totals.assets)} machines carry one.</p>
      </section>
      {findings.length > 0 && (
        <section>
          <h3 className="ad-h3"><Info size={14} aria-hidden="true" /> What this list says</h3>
          <ul className="ad-findings">
            {findings.map((f) => (
              <li key={f.key}><span aria-hidden="true" className={`ad-fdot ${findingDotClass(f.tone)}`} />{f.text}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function AssetDisposals() {
  const { activeCountry, appSettings } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)
  const company = appSettings?.company_name || 'TyrePulse'

  const [register, setRegister] = useState(null)
  const [reliability, setReliability] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [benchmarkRows, setBenchmarkRows] = useState([])
  const [tab, setTab] = useState('register')
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showMore, setShowMore] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const [detail, setDetail] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deciding, setDeciding] = useState(null)
  const [starting, setStarting] = useState(false)
  const [upload, setUpload] = useState(null)
  const [breakdownRows, setBreakdownRows] = useState([])
  const [breakdownState, setBreakdownState] = useState('loading')
  const [deckOpen, setDeckOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Independent reads: a database without the reliability RPC must still
      // show the register, and a failed quotation or breakdown read costs only
      // its own figures.
      const [reg, rel, base, bench, brk] = await Promise.allSettled([
        getDisposalRegister({ country: activeCountry }),
        getDisposalReliability({ country: activeCountry }),
        getDisposalFleetBaseline({ country: activeCountry }),
        listReplacementBenchmarks({ country: activeCountry }),
        listAssetBreakdowns({ country: activeCountry }),
      ])
      if (reg.status === 'fulfilled') {
        setRegister(shapeDisposalRegister(reg.value))
      } else {
        setRegister(null)
        setError(toUserMessage(reg.reason))
      }
      setReliability(shapeReliability(rel.status === 'fulfilled' ? rel.value : null))
      setBaseline(base.status === 'fulfilled' ? base.value : null)
      setBenchmarkRows(bench.status === 'fulfilled' ? (bench.value?.rows || []) : [])
      // A failed breakdown read leaves NO downtime, so every machine reads
      // "Not recorded" - never a silent zero days down.
      setBreakdownRows(brk.status === 'fulfilled' ? (brk.value?.rows || []) : [])
      setBreakdownState(brk.status === 'fulfilled' ? 'ready' : 'error')
    } catch (e) {
      setError(toUserMessage(e))
      setRegister(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Reliability and downtime are merged BEFORE filtering so a filtered table and
  // every panel describe the same machines.
  const baseRows = useMemo(() => {
    const base = register?.rows || []
    const assets = reliability?.ok ? (reliability.assets || []) : []
    if (!assets.length) return base
    const merged = mergeReliability(base, assets)
    return Array.isArray(merged) ? merged : base
  }, [register, reliability])
  const rows = useMemo(() => mergeBreakdowns(baseRows, breakdownRows, Date.now()), [baseRows, breakdownRows])
  const filtered = useMemo(
    () => applyViewFilters(filterDisposals(rows, filters), filters, Date.now()),
    [rows, filters],
  )
  // From the FULL register: a filter must never make a machine look missing.
  const missingCandidates = useMemo(
    () => disposalCandidatesFromBreakdowns(breakdownRows, baseRows, { now: Date.now() }),
    [breakdownRows, baseRows],
  )
  const totals = useMemo(() => disposalSummary(filtered), [filtered])
  const findings = useMemo(() => disposalFindings(filtered, totals), [filtered, totals])
  const baselines = useMemo(() => spendBaselines(rows), [rows])
  const benchmarks = useMemo(() => shapeBenchmarks(benchmarkRows, { now: Date.now() }), [benchmarkRows])
  // The tiles cover the whole register in scope: each one is also a filter, and
  // a tile recomputed over its own filter would only echo the choice back.
  const kpis = useMemo(() => disposalKpis(rows), [rows])
  const activeShare = useMemo(() => stillActiveShare(disposalSummary(rows)), [rows])

  const options = useMemo(() => disposalFilterOptions(rows), [rows])
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }
  const toggle = (patch) => {
    setFilters((f) => {
      const on = Object.entries(patch).every(([k, v]) => f[k] === v)
      const reset = { status: '', valuation: '', compliance: '', sold: false }
      return on ? { ...f, ...reset } : { ...f, ...reset, ...patch }
    })
    setPage(0)
  }
  const isOn = (patch) => Object.entries(patch).every(([k, v]) => filters[k] === v)

  const currency = totals.mixedCurrency ? '' : (totals.currency || '')

  const shapedBaseline = useMemo(() => shapeFleetBaseline(baseline), [baseline])
  const boardPoints = useMemo(() => {
    const fleet = fleetReliability(filtered)
    return boardRecommendations(filtered, fleet, {
      now: Date.now(),
      currency: fleet.mixedCurrency ? 'SAR' : (currency || fleet.currency || 'SAR'),
      fleetBaseline: shapedBaseline,
    })
  }, [filtered, currency, shapedBaseline])

  // ── table ──────────────────────────────────────────────────────────────────
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const pageRows = useMemo(
    () => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filtered, safePage, pageSize],
  )
  const now = Date.now()
  const columns = [
    {
      key: 'asset_no', header: 'Asset no',
      cell: (r) => <span className="cc-strong ad-nowrap">{r.asset_no}</span>,
    },
    {
      key: 'plate', header: 'Plate',
      cell: (r) => (r.registration_no ? <span className="ad-nowrap">{r.registration_no}</span> : <NA title={r.in_register ? 'No plate in the fleet register' : 'Not in the fleet register'} />),
    },
    { key: 'make', header: 'Make / model', cell: (r) => makeModel(r) || <NA /> },
    { key: 'asset_type', header: 'Category', cell: (r) => r.asset_type || <NA /> },
    { key: 'age', header: 'Age (years)', align: 'right', cell: (r) => { const a = ageOf(r, now); return a == null ? <NA title="No model year recorded" /> : a } },
    {
      key: 'condition', header: 'Condition',
      cell: (r) => { const m = conditionMeta(r.condition); return <Pill tone={CONDITION_TONE[m.tone] || 'muted'}>{m.label}</Pill> },
    },
    { key: 'book', header: 'Book value', align: 'right', cell: () => <NA title="No source records a book value for these machines" /> },
    {
      key: 'value', header: 'Est. resale / scrap value', align: 'right',
      cell: (r) => { const v = valuationOf(r); return v == null ? <NA title="Blank or zero on the committee sheet">Not valued</NA> : <span className="ad-nowrap">{fmtMoney(v, r.currency || 'SAR')}</span> },
    },
    { key: 'downtime', header: 'Downtime', cell: (r) => <DowntimeCell entry={r.breakdown} /> },
    { key: 'status', header: 'Approval status', cell: (r) => { const p = approvalPill(r); return <Pill tone={p.tone}>{p.label}</Pill> } },
    {
      key: 'channel', header: 'Channel / reference',
      cell: (r) => (
        <span className="ad-stack">
          <span>{dispositionMeta(r.disposition).label}</span>
          {r.disposal_ref && <small>{r.disposal_ref}</small>}
        </span>
      ),
    },
    { key: 'next', header: 'Next action', cell: (r) => { const a = nextAction(r); return <span className={`ad-next ${a.tone}`}>{a.label}</span> } },
    {
      key: 'actions', header: 'Actions',
      cell: (r) => (
        <span className="ad-actions" onClick={(ev) => ev.stopPropagation()} role="presentation">
          <button type="button" className="ad-act" aria-label={`View ${r.asset_no}`} onClick={() => setDetail(r)}><Eye size={15} /></button>
          {canWrite && <button type="button" className="ad-act" aria-label={`Edit ${r.asset_no}`} onClick={() => setEditing(r)}><Pencil size={15} /></button>}
          {canWrite && <button type="button" className="ad-act" aria-label={`Record a decision on ${r.asset_no}`} onClick={() => setDeciding(r)}><ClipboardCheck size={15} /></button>}
          <button type="button" className="ad-act" aria-label={`Open the history of ${r.asset_no}`} onClick={() => setHistory(r)}><History size={15} /></button>
        </span>
      ),
    },
  ]
  const candidateColumns = [
    { key: 'asset_no', header: 'Asset', cell: (c) => <Link to={`/asset-management/${encodeURIComponent(c.asset_no)}`} className="ad-link">{c.asset_no}</Link> },
    { key: 'days', header: 'Days down', align: 'right', cell: (c) => <span className="ad-amber">{fmtNum(c.currentDays)}</span> },
    { key: 'fault', header: 'Fault', cell: (c) => c.fault || <NA>Not recorded</NA> },
    { key: 'repair', header: 'Repaired at', cell: (c) => repairLabel(c.repairLocation) },
  ]

  // ── exports ────────────────────────────────────────────────────────────────
  const exportModel = useCallback(() => {
    const base = disposalExportRows(filtered)
    return reliability?.ok ? mergeExportModel(base, reliabilityExportRows(filtered)) : base
  }, [filtered, reliability])
  const [notice, setNotice] = useState(null)
  const runExport = async (fn) => {
    setNotice(null)
    try { await fn() } catch (e) { setNotice({ tone: 'bad', text: toUserMessage(e, 'The export could not be created.') }) }
  }
  const doExportExcel = async () => {
    const { columns: cols, rows: objects, head } = exportModel()
    await exportToExcel(objects, cols, head, reportFileName('Asset Disposals', reportDateLabel()), 'Disposals', {
      title: 'Asset Disposal Register', company, currency: currency || 'SAR',
    })
  }
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
      meta: { Country: activeCountry || 'All countries', 'Machines exported': filtered.length },
      notes: workbookNotes({ rows: filtered, benchmarks, baseline, now: Date.now() }),
    })
  }
  const doExportPdf = async () => {
    const { columns: cols, rows: objects, head } = exportModel()
    await exportToPdf(
      objects, cols.map((k, i) => ({ key: k, header: head[i] })),
      'Asset Disposal Register', reportFileName('Asset Disposals', reportDateLabel()),
      'landscape', company, { currency: currency || 'SAR' },
    )
  }
  /**
   * A valuation request is a sheet of the open machines nobody has valued, in
   * the columns the upload reads back. The valuer fills Estimated value and the
   * sheet goes back in through Upload sheet, which refreshes each row in place.
   */
  const doRequestValuation = async () => {
    const list = valuationRequestRows(filtered)
    if (!list.length) { setNotice({ tone: 'good', text: 'Every open machine in this selection already carries a valuation.' }); return }
    await exportSheetsToExcel([{
      name: 'Valuation request', rows: list, columns: VALUATION_COLUMNS, headers: VALUATION_HEADERS,
      note: 'Fill Estimated value, then upload this file with Upload sheet.',
    }], reportFileName('Disposal valuation request', reportDateLabel()), {
      title: 'Disposal valuation request', company,
      meta: { Country: activeCountry || 'All countries', Machines: list.length },
      notes: ['Leave Asset, Disposition and the other columns as they are: the upload refreshes each machine in place on its asset code.'],
    })
    setNotice({ tone: 'good', text: `Valuation request for ${list.length} machine${list.length === 1 ? '' : 's'} downloaded. Upload it back with Upload sheet once the values are filled in.` })
  }

  // ── write paths ────────────────────────────────────────────────────────────
  const writeThen = async (fn, close) => {
    setBusy(true)
    try {
      await fn()
      close()
      setDetail(null)
      await load()
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e) })
    } finally { setBusy(false) }
  }
  const saveEdit = (patch) => writeThen(() => updateDisposal(editing.id, patch), () => setEditing(null))
  const saveDecision = (decision) => writeThen(() => setDisposalDecision(deciding.id, decision), () => setDeciding(null))
  const saveStart = (row) => writeThen(() => upsertDisposal(row), () => setStarting(false))

  const notProvisioned = register && register.ok === false && register.reason === 'not_provisioned'
  const readFailed = register && register.ok === false && !notProvisioned
  const regFailed = !!(readFailed || error)
  const regState = {
    loading,
    data: register?.ok ? register : null,
    error: regFailed ? 'This section needs the disposal register, which could not be read.' : notProvisioned ? 'Asset Disposal is not enabled on this database yet.' : null,
    retry: load,
  }
  const ready = !loading && register?.ok
  const kpiLoading = loading
  const kpiNA = !loading && !register?.ok ? 'N/A' : undefined
  const recovery = recoveryLabel(kpis.recovery)

  return (
    <div className="cc ad-page">
      <PageHero
        title="Asset Disposal"
        lead="Maximize value. Ensure compliance. A cleaner, more efficient fleet."
        imgLight="/dashboard/hero-disposal-light.webp"
        imgDark="/dashboard/hero-disposal-dark.webp"
      />

      {notice && (
        <div className={`cc-card ad-banner ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          {notice.tone === 'bad' ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
          <div><p>{notice.text}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {notProvisioned && (
        <div className="cc-card ad-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Asset Disposal is not enabled on this database yet.</b><p>The disposal register has not been created here. Nothing is missing from your data.</p></div>
        </div>
      )}

      {regFailed && (
        <div className="cc-card ad-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <b>The disposal register could not be loaded.</b>
            <p>{error || 'We could not read the register, so this page is not showing an empty list. It is showing nothing at all.'}</p>
          </div>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      <div className="cc-kpis ad-kpis">
        <Kpi icon={Recycle} tone="t-red" value={kpis.candidates} label="Disposal candidates" display={kpiNA} loading={kpiLoading}
          title="On the list, awaiting a committee decision" onClick={() => toggle({ status: 'proposed' })} />
        <Kpi icon={CheckCircle2} tone="t-green" value={kpis.approved} label="Approved for disposal" display={kpiNA} loading={kpiLoading}
          onClick={() => toggle({ status: 'approved' })} />
        <Kpi icon={Clock} tone="t-amber" value={kpis.pendingValuation} label="Pending valuation" display={kpiNA} loading={kpiLoading}
          title="Open machines with no estimated value. A zero on the committee sheet is read as not valued." onClick={() => toggle({ valuation: 'pending' })} />
        <Kpi icon={ShoppingCart} tone="t-blue" value={kpis.sold} label="Sold assets" display={kpiNA} loading={kpiLoading}
          title="Disposed machines the committee chose to sell" onClick={() => toggle({ sold: true })} />
        <Kpi icon={Coins} tone="t-purple" display={kpiNA || recovery || 'N/A'} label="Total scrap / recovery value" loading={kpiLoading}
          title={recovery ? `Sale proceeds recorded on ${kpis.recoveredMachines} disposed machine(s), per currency` : 'No sale proceeds are recorded on a disposed machine yet'} />
        <Kpi icon={ShieldAlert} tone="t-orange" value={kpis.compliancePending} label="Compliance pending" display={kpiNA} loading={kpiLoading} danger={kpis.compliancePending > 0}
          title={`Still Active in the fleet register or with tyres still fitted${activeShare == null ? '' : `. ${activeShare}% of the list is still counted as available fleet`}`}
          onClick={() => toggle({ compliance: 'pending' })} />
      </div>

      <div className="ad-cards">
        <PipelineCard state={regState} rows={rows} sites={options.sites} />
        <ReasonsCard state={regState} rows={rows} />
        <RecoveryCard state={regState} rows={rows} />
      </div>

      {/* Down long enough to consider: machines out of service over 30 days
          that are not on the list. Proposes only; adding one stays the
          committee's decision. Renders nothing when there is nothing to show. */}
      {missingCandidates.length > 0 && (
        <Card className="ad-candidates" title={`Down long enough to consider (${missingCandidates.length})`}
          sub="Out of service for over 30 days and not on the disposal register. Not a recommendation to scrap: the list the committee has not seen."
          action={<Link to="/asset-breakdowns" className="cc-link">Breakdown register <ExternalLink size={12} aria-hidden="true" /></Link>}>
          <KitTable compact columns={candidateColumns} rows={missingCandidates} getRowId={(c) => String(c.asset_no)}
            empty="No machine has been down long enough to consider." />
        </Card>
      )}
      {breakdownState === 'error' && (
        <p className="ad-foot ad-pad">The breakdown register could not be read, so downtime reads Not recorded and no candidates are proposed.</p>
      )}

      <Card className="ad-register">
        <Tabs label="Disposal views" variant="line" value={tab} onChange={setTab} tabs={[
          { key: 'register', label: 'Register', count: ready ? filtered.length : null },
          { key: 'profile', label: 'Profile' },
          { key: 'reliability', label: 'Reliability and board view' },
          { key: 'replacement', label: 'Replacement' },
        ]} />

        <div className="ad-toolbar">
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input value={filters.search} onChange={(e) => setFilter('search', e.target.value)}
              placeholder="Search asset no, brand, type, site or tyre serial" aria-label="Search the disposal register" />
          </div>
          <select className="cc-select" aria-label="Category" value={filters.assetType} onChange={(e) => setFilter('assetType', e.target.value)}>
            <option value="">All categories</option>
            {options.assetTypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {Object.values(DISPOSAL_STATUSES).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select className="cc-select" aria-label="Site" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
            <option value="">All sites</option>
            {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Date added to the list" value={filters.added} onChange={(e) => setFilter('added', e.target.value)}>
            {ADDED_WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
          <button type="button" className="cc-btn-ghost" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>
            <SlidersHorizontal size={14} aria-hidden="true" /> More{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button type="button" className="cc-btn-ghost" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0) }}><X size={13} aria-hidden="true" /> Clear</button>
          )}
          <span className="ad-spacer" />
          {canWrite && (
            <button type="button" className="cc-btn-primary" disabled={notProvisioned || regFailed} onClick={() => setStarting(true)}>
              <Plus size={15} aria-hidden="true" /> Start Disposal
            </button>
          )}
          <button type="button" className="cc-btn-ghost" disabled={!filtered.length} onClick={() => runExport(doRequestValuation)}
            title="Download the open machines with no valuation, in a sheet the upload reads back">
            <FileSearch size={14} aria-hidden="true" /> Request Valuation
          </button>
          {canWrite && (
            <button type="button" className="cc-btn-ghost" disabled={notProvisioned} onClick={() => setUpload({ stage: 'pick' })}>
              <Upload size={14} aria-hidden="true" /> Upload sheet
            </button>
          )}
          <ExportMenu disabled={!filtered.length}
            onRegister={() => runExport(doExportExcel)} onWorkbook={() => runExport(doExportWorkbook)}
            onPdf={() => runExport(doExportPdf)} onDeck={() => setDeckOpen(true)} />
        </div>

        {showMore && (
          <div className="ad-toolbar ad-more">
            <select className="cc-select" aria-label="Disposition" value={filters.disposition} onChange={(e) => setFilter('disposition', e.target.value)}>
              <option value="">Any disposition</option>
              {Object.values(DISPOSITIONS).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select className="cc-select" aria-label="Region" value={filters.region} onChange={(e) => setFilter('region', e.target.value)}>
              <option value="">All regions</option>
              {options.regions.map((r) => <option key={r} value={r}>{regionMeta(r).label}</option>)}
            </select>
            <select className="cc-select" aria-label="Condition" value={filters.condition} onChange={(e) => setFilter('condition', e.target.value)}>
              <option value="">Any condition</option>
              {Object.values(CONDITIONS).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select className="cc-select" aria-label="Fleet register" value={filters.inRegister} onChange={(e) => setFilter('inRegister', e.target.value)}>
              <option value="all">In or out of the fleet register</option>
              <option value="yes">In the fleet register</option>
              <option value="no">Not in the fleet register</option>
            </select>
            <select className="cc-select" aria-label="Downtime" value={filters.downtime} onChange={(e) => setFilter('downtime', e.target.value)}>
              <option value="">Any downtime</option>
              <option value="down">Down right now</option>
              <option value="long">Down over 30 days</option>
              <option value="unknown">No breakdown on record</option>
            </select>
            <select className="cc-select" aria-label="Valuation" value={filters.valuation} onChange={(e) => setFilter('valuation', e.target.value)}>
              <option value="">Valued or not</option>
              <option value="pending">Pending valuation</option>
            </select>
            <select className="cc-select" aria-label="Compliance" value={filters.compliance} onChange={(e) => setFilter('compliance', e.target.value)}>
              <option value="">Any compliance state</option>
              <option value="pending">Compliance pending</option>
            </select>
          </div>
        )}

        {(isOn({ sold: true })) && <p className="ad-foot">Showing sold machines only.</p>}

        {tab === 'register' && (
          <CardState state={regState} lines={6}
            empty={ready && rows.length === 0 ? 'No machines are on the disposal list. The register was read and it is empty. Start a disposal or upload a committee sheet.' : null}>
            <KitTable
              className="ad-table"
              columns={columns}
              rows={pageRows}
              manualPagination
              showPagination={false}
              enableSorting={false}
              getRowId={(r) => String(r.id || r.asset_no)}
              onRowClick={(r) => setDetail(r)}
              empty="No machines match these filters."
            />
            <Pager page={safePage} pageSize={pageSize} total={filtered.length} noun="machines"
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }} />
          </CardState>
        )}

        {tab === 'profile' && (
          <CardState state={regState} lines={6} empty={ready && !filtered.length ? 'No machines match these filters.' : null}>
            <ProfilePanel filtered={filtered} totals={totals} findings={findings} currency={currency} />
          </CardState>
        )}

        {tab === 'reliability' && (
          <StudioBoundary>
            <Suspense fallback={<div className="cc-skel" style={{ height: 200 }} />}>
              <ReliabilityPanel
                rows={filtered}
                reliability={reliability}
                baseline={baseline}
                recommendations={boardPoints}
                currency={currency}
                loading={loading}
                onRetry={load}
                onOpenAsset={(r) => setHistory(r)}
              />
            </Suspense>
          </StudioBoundary>
        )}

        {tab === 'replacement' && (
          <StudioBoundary>
            <Suspense fallback={<div className="cc-skel" style={{ height: 200 }} />}>
              <ReplacementPanel
                rows={filtered}
                benchmarks={benchmarks}
                benchmarksRaw={benchmarkRows}
                currency={currency}
                canEdit={canWrite}
                onSaved={load}
              />
            </Suspense>
          </StudioBoundary>
        )}
      </Card>

      {history && (
        <StudioBoundary>
          <Suspense fallback={null}>
            <AssetHistoryDrawer row={history} rows={filtered} currency={currency} onClose={() => setHistory(null)} />
          </Suspense>
        </StudioBoundary>
      )}

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

      {editing && <DisposalEditor row={editing} busy={busy} onClose={() => setEditing(null)} onSave={saveEdit} />}
      {deciding && <DecisionModal row={deciding} busy={busy} onClose={() => setDeciding(null)} onSave={saveDecision} />}
      {starting && (
        <StartDisposalModal country={activeCountry} existing={rows} busy={busy}
          onClose={() => setStarting(false)} onSave={saveStart} />
      )}
      {upload && (
        <UploadModal country={activeCountry} existing={rows}
          onClose={() => setUpload(null)} onDone={async () => { setUpload(null); await load() }} />
      )}

      {deckOpen && (
        <StudioBoundary>
          <Suspense fallback={null}>
            <DisposalDeckBuilder
              rows={filtered}
              totals={totals}
              benchmarks={benchmarks}
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
 * Start a disposal - one machine added to the committee list
 * ------------------------------------------------------------------ */

function StartDisposalModal({ country, existing, busy, onClose, onSave }) {
  const fixed = country && country !== 'All' ? country : ''
  const [form, setForm] = useState({
    country: fixed, asset_no: '', asset_type: '', model_year: '', disposition: 'undecided',
    condition: '', site: '', remarks: '',
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const code = form.asset_no.toUpperCase().replace(/\s+/g, '')
  const already = code && (existing || []).some((r) => String(r.asset_no || '').toUpperCase() === code && (!form.country || r.country === form.country))
  const valid = code && form.country
  const submit = () => onSave({
    ...form,
    asset_no: code,
    model_year: form.model_year === '' ? null : form.model_year,
    currency: COUNTRY_CURRENCY[form.country] || null,
  })
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Start a disposal"
      subtitle="Adds one machine to the committee list as Proposed. It does not change the fleet register."
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={busy || !valid}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {already ? 'Refresh listed machine' : 'Add to list'}
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Country</span>
          <select value={form.country} onChange={(e) => set('country', e.target.value)} className={inputCls} disabled={!!fixed}>
            <option value="">Choose a country</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Asset no</span>
          <input value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} className={inputCls} placeholder="For example TM514" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Category</span>
          <input value={form.asset_type} onChange={(e) => set('asset_type', e.target.value)} className={inputCls} placeholder="Asset type" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Model year</span>
          <input type="number" value={form.model_year} onChange={(e) => set('model_year', e.target.value)} className={inputCls} placeholder="Leave blank if unknown" />
        </label>
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
        <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
          <span>Site</span>
          <input value={form.site} onChange={(e) => set('site', e.target.value)} className={inputCls} placeholder="Where the machine sits" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
          <span>Remarks</span>
          <textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} rows={3} className={inputCls} placeholder="Why the machine is proposed" />
        </label>
      </div>
      {already && <p className="text-xs text-amber-300 mt-3">This machine is already on the list for this country. Saving refreshes its record rather than adding it twice.</p>}
    </Modal>
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
      // The first sheet that carries asset codes, so a workbook opening on a
      // Contents sheet (the valuation request this page downloads) still reads.
      let mapped = []
      for (const sheet of parsed?.sheets || []) {
        mapped = mapDisposalSheetRows(sheet?.rows || [], { country, sourceFile: file.name })
        if (mapped.length) break
      }
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
