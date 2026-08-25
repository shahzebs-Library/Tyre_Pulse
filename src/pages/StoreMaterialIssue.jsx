/**
 * StoreMaterialIssue (route /store-material-issue) - the store's Material Issue
 * Slip register.
 *
 * A MIS is the document the store raises when it issues parts against a job
 * card. It has been in this data the whole time and nothing had ever surfaced
 * it: `parts_consumption.issue_number` holds 83,580 slips across 209,536 lines,
 * every one linked to exactly one job card. THAT HISTORICAL REGISTER IS THE
 * PRIMARY VALUE OF THIS PAGE, and it works on a database that has not run V609;
 * the V609 tables only add the ability to RAISE a slip in app.
 *
 * Four tabs:
 *   Issue register  - the real slips, filterable, expandable to their lines.
 *   Returns (MRT)   - the second document type nobody had surfaced, plus the
 *                     live integrity finding that every return is booked as a
 *                     charge. Reported, never silently rewritten.
 *   Raise an issue  - the in-app slip (V609). States plainly that there is no
 *                     live on-hand balance to show.
 *   Analytics       - trend, stores, categories, items, MIS vs MRT.
 *
 * MONEY IS NEVER BLENDED. KSA reports in SAR, UAE in AED, Egypt in EGP. Every
 * figure is per country in its own currency; an all-countries scope shows a
 * per-country breakdown and says so rather than printing one wrong total.
 *
 * All maths live in the pure, unit-tested `materialIssue` engine; this page is
 * presentation and orchestration only. Honest loading / empty / error states, no
 * fabricated data. Light and dark via var(--*).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Receipt, ClipboardList, Undo2, PackageOpen, TrendingUp, X, Search,
  RefreshCw, AlertTriangle, Loader2, FileSpreadsheet, FileText, Plus, Trash2,
  ChevronRight, ChevronDown, Info, Store, Layers, Hash, Ban, Check, BarChart3,
  PieChart, Link2, CalendarRange,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EChart from '../components/charts/EChart'
import { usePagedRows, TablePagination } from '../components/ui/TablePagination'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listSlipsFromConsumption, getSlipLines, getIssueSummary,
  materialIssuesProvisioned, listMaterialIssues, createMaterialIssue,
  listIssuableJobCards, DEFAULT_LINE_MAX,
} from '../lib/api/materialIssue'
import { listMaterials } from '../lib/api/materialMaster'
import {
  summarizeIssues, filterSlips, slipFilterOptions, monthlyIssueTrend,
  bucketTotals, docTypeLabel, isReturn, DOC_TYPE_KEYS,
  SLIP_EXPORT_COLUMNS, slipExportRows, LINE_EXPORT_COLUMNS, lineExportRows,
  validateDraftIssue, draftLineValue, issueStatusLabel,
} from '../lib/materialIssue'
import { currencyForCountry, MIXED_CURRENCY } from '../lib/governedCost'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { formatCurrency } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const TABS = [
  { key: 'register', label: 'Issue register', icon: ClipboardList },
  { key: 'returns', label: 'Returns (MRT)', icon: Undo2 },
  { key: 'raise', label: 'Raise an issue', icon: PackageOpen },
  { key: 'analytics', label: 'Analytics', icon: TrendingUp },
]

const inputCls = 'w-full bg-[var(--input-bg)] border border-[var(--input-border)] '
  + 'rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none '
  + 'focus:border-[var(--accent)]'

const btnCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg '
  + 'bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] '
  + 'hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed'

/** ISO day, local time. `toISOString()` would shift the day at a positive offset. */
function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return isoDay(d)
}

/** Money with its currency, or "N/A". Never a dash, never an unlabelled number. */
function money(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  if (!currency || currency === MIXED_CURRENCY) return 'Mixed currencies'
  return formatCurrency(Number(v), currency, 0)
}
const nOr = (v, digits = 0) => (
  Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }) : 'N/A'
)
const pctOr = (v) => (Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : 'N/A')
const txt = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? 'N/A' : s
}

/** Chart options shared by every chart here, so they read the same. */
function baseOption(extra = {}) {
  return {
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    textStyle: { color: 'var(--text-secondary)' },
    ...extra,
  }
}

function EmptyChart({ label = 'Nothing to chart for this window.' }) {
  return (
    <div className="h-full flex items-center justify-center text-center px-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
    </div>
  )
}

function Notice({ tone = 'info', icon: Icon = Info, title, children, action }) {
  const border = tone === 'warn' ? 'border-amber-800/50'
    : tone === 'error' ? 'border-red-800/50' : 'border-[var(--input-border)]'
  const ink = tone === 'warn' ? 'text-amber-400'
    : tone === 'error' ? 'text-red-400' : 'text-[var(--text-secondary)]'
  const head = tone === 'warn' ? 'text-amber-300'
    : tone === 'error' ? 'text-red-300' : 'text-[var(--text-primary)]'
  return (
    <div className={`card border ${border} flex items-start gap-3`}>
      <Icon size={18} className={`${ink} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        {title && <p className={`${head} font-medium`}>{title}</p>}
        <div className="text-[var(--text-muted)] text-sm mt-1 space-y-1">{children}</div>
      </div>
      {action}
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        {Icon && <Icon size={15} className="text-[var(--text-muted)]" />}
      </div>
      <p className={`text-xl font-bold mt-1 ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function StoreMaterialIssue() {
  const { activeCountry } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin || WRITE_ROLES.has(profile?.role)
  // Recorded on the slip so a paper document names who issued it. `issued_by`
  // is stamped server-side from auth.uid(); this is the readable name beside it.
  const profileName = profile?.full_name || profile?.username || ''

  const [tab, setTab] = useState('register')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [slips, setSlips] = useState([])
  const [truncated, setTruncated] = useState(false)
  // null = we could not count them, which renders nothing rather than claiming
  // zero. `null > 0` is false, so the notice below stays silent on unknown.
  const [unslipped, setUnslipped] = useState(null)
  const [serverSummary, setServerSummary] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)

  const [from, setFrom] = useState(monthsAgo(12))
  const [to, setTo] = useState(isoDay(new Date()))
  const [filters, setFilters] = useState({ site: 'All', store: 'All', docType: 'All', search: '' })
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ site: 'All', store: 'All', docType: 'All', search: '' })
  const hasFilters = filters.site !== 'All' || filters.store !== 'All'
    || filters.docType !== 'All' || Boolean(filters.search)

  const [expanded, setExpanded] = useState(null)
  const [expandedLines, setExpandedLines] = useState([])
  const [expandLoading, setExpandLoading] = useState(false)

  // --- Load the historical register -----------------------------------------
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listSlipsFromConsumption({
        country: activeCountry, from, to, max: DEFAULT_LINE_MAX,
      })
      setSlips(res.slips)
      setTruncated(res.truncated)
      setUnslipped(res.unslipped)
      setLoadedAt(new Date())
      // Best effort: the server aggregate is the authoritative window total when
      // the client read was capped. A failure here must never fail the page.
      const s = await getIssueSummary({ country: activeCountry, from, to })
      setServerSummary(s.ok ? s.data : null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the material issue register.'))
      setSlips([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry, from, to])

  useEffect(() => { load() }, [load])

  // --- Derived --------------------------------------------------------------
  const options = useMemo(() => slipFilterOptions(slips), [slips])

  const filtered = useMemo(() => filterSlips(slips, filters), [slips, filters])

  // The tiles are computed over the SAME filtered set the table shows, so a
  // headline can never describe a different population from the rows beneath it.
  const summary = useMemo(
    () => summarizeIssues(filtered, { now: new Date() }),
    [filtered],
  )

  const returns = useMemo(
    () => filterSlips(slips, { ...filters, docType: 'MRT' }),
    [slips, filters],
  )
  const returnsSummary = useMemo(
    () => summarizeIssues(returns, { now: new Date() }),
    [returns],
  )

  const singleCurrency = !summary.mixedCurrency
    ? (Object.keys(summary.byCurrency)[0] || currencyForCountry(activeCountry) || null)
    : null

  const paged = usePagedRows(filtered, { pageSize: 50 })

  const toggleExpand = async (slip) => {
    if (expanded === slip.key) { setExpanded(null); setExpandedLines([]); return }
    setExpanded(slip.key)
    // The lines are already in memory from the register read; only fall back to
    // a query if a slip somehow arrived without them.
    if (slip.lines?.length) { setExpandedLines(slip.lines); return }
    setExpandLoading(true)
    const rows = await getSlipLines(slip.issueNumber, slip.country)
    setExpandedLines(rows)
    setExpandLoading(false)
  }

  // --- Exports --------------------------------------------------------------
  const exportSlips = (rows, name) => {
    const data = slipExportRows(rows)
    const keys = SLIP_EXPORT_COLUMNS.map((c) => c.key)
    const headers = SLIP_EXPORT_COLUMNS.map((c) => c.header)
    return { data, keys, headers, name }
  }
  const doExcel = (rows, name) => {
    const { data, keys, headers } = exportSlips(rows, name)
    exportToExcel(data, keys, headers, reportFileName(name, reportDateLabel()))
  }
  const doPdf = (rows, name) => {
    const { data } = exportSlips(rows, name)
    exportToPdf(
      data,
      SLIP_EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header })),
      name,
      reportFileName(name, reportDateLabel()),
      'landscape',
    )
  }
  const doLinesExcel = (rows, name) => {
    exportToExcel(
      lineExportRows(rows),
      LINE_EXPORT_COLUMNS.map((c) => c.key),
      LINE_EXPORT_COLUMNS.map((c) => c.header),
      reportFileName(name, reportDateLabel()),
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Store - Material Issue (MIS)"
        subtitle="Every slip the store raised against a job card, plus returns"
        icon={Receipt}
        onRefresh={load}
        refreshing={loading}
        updatedAt={loadedAt}
      />

      {error && (
        <Notice
          tone="error"
          icon={AlertTriangle}
          title="Something went wrong."
          action={<button onClick={load} className={btnCls}><RefreshCw size={13} /> Retry</button>}
        >
          <p>{error}</p>
        </Notice>
      )}

      {/* What this register is, and what it cannot tell you. Stated up front
          rather than left for a reader to assume. */}
      <Notice icon={Info} title="What this page reads, and what it cannot show">
        <p>
          A Material Issue Slip is the document the store raises when it issues parts
          against a job card. These slips are read from the expense lines themselves
          (the slip number the store already stamps on every line), so this register
          covers real history, not only slips raised in this app.
        </p>
        <p>
          <strong className="text-[var(--text-secondary)]">There is no live on-hand
          balance on this page.</strong> Stock is recorded by site and description with
          no item code, so it cannot be matched to the item codes a slip carries. Any
          "stock after issue" figure here would be invented, so none is shown.
        </p>
      </Notice>

      {/* Window + filters */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <CalendarRange size={15} />
          <span className="text-sm font-medium">Window and filters</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Country scope follows the app scope: {txt(activeCountry)}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Document</span>
            <select value={filters.docType} onChange={(e) => setFilter('docType', e.target.value)} className={inputCls}>
              <option value="All">All documents</option>
              {DOC_TYPE_KEYS.map((k) => <option key={k} value={k}>{docTypeLabel(k)}</option>)}
              <option value="UNKNOWN">Unreadable number</option>
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
              <option value="All">All sites</option>
              {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Store</span>
            <select value={filters.store} onChange={(e) => setFilter('store', e.target.value)} className={inputCls}>
              <option value="All">All stores</option>
              {options.stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Search</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                className={`${inputCls} pl-9`}
                placeholder="Slip, job card, asset..."
              />
            </div>
          </label>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className={btnCls}><X size={13} /> Clear filters</button>
        )}
      </div>

      {truncated && (
        <Notice tone="warn" icon={AlertTriangle} title="This is a capped view.">
          <p>
            The window holds more lines than one read returns, so this page is showing
            the most recent {nOr(DEFAULT_LINE_MAX)} of them. Narrow the dates, the site
            or the store to see a complete register.
            {serverSummary?.slips != null && (
              <> The server counts {nOr(serverSummary.slips)} slips in this window.</>
            )}
          </p>
        </Notice>
      )}

      {unslipped > 0 && (
        <Notice tone="warn" icon={AlertTriangle} title="Some lines carry no slip number.">
          <p>
            {nOr(unslipped)} expense lines in this window have no slip number, so they
            belong to no document and are not counted in this register.
          </p>
        </Notice>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--input-border)]">
        {TABS.map((tb) => {
          const Icon = tb.icon
          const on = tab === tb.key
          return (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ${
                on
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              aria-current={on ? 'page' : undefined}
            >
              <Icon size={15} /> {tb.label}
            </button>
          )
        })}
      </div>

      {tab === 'register' && (
        <RegisterTab
          loading={loading}
          slips={slips}
          filtered={filtered}
          summary={summary}
          singleCurrency={singleCurrency}
          paged={paged}
          expanded={expanded}
          expandedLines={expandedLines}
          expandLoading={expandLoading}
          toggleExpand={toggleExpand}
          onExcel={() => doExcel(filtered, 'Material Issue Register')}
          onPdf={() => doPdf(filtered, 'Material Issue Register')}
          onLinesExcel={doLinesExcel}
        />
      )}

      {tab === 'returns' && (
        <ReturnsTab
          loading={loading}
          returns={returns}
          summary={returnsSummary}
          singleCurrency={singleCurrency}
          onExcel={() => doExcel(returns, 'Material Returns MRT')}
          onPdf={() => doPdf(returns, 'Material Returns MRT')}
        />
      )}

      {tab === 'raise' && (
        <RaiseTab canWrite={canWrite} activeCountry={activeCountry} profileName={profileName} onSaved={load} />
      )}

      {tab === 'analytics' && (
        <AnalyticsTab
          loading={loading}
          filtered={filtered}
          summary={summary}
          singleCurrency={singleCurrency}
          onExcel={() => doExcel(filtered, 'Material Issue Analytics')}
          onPdf={() => doPdf(filtered, 'Material Issue Analytics')}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Per-country money strip - the ONLY way money is shown across        *
 * countries. There is deliberately no combined total.                 *
 * ------------------------------------------------------------------ */
function CountryMoney({ summary }) {
  if (!summary.byCountry.length) return null
  if (summary.byCountry.length === 1) return null
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Layers size={16} className="text-[var(--text-secondary)]" />
        <h3 className="font-semibold text-[var(--text-primary)]">Value by country</h3>
        <span className="text-[11px] text-[var(--text-muted)]">
          Each country reports in its own currency. These are never added together.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
              <th className="py-2 pr-3 font-medium">Country</th>
              <th className="py-2 pr-3 font-medium text-right">Slips</th>
              <th className="py-2 pr-3 font-medium text-right">Lines</th>
              <th className="py-2 pr-3 font-medium text-right">Value (as booked)</th>
              <th className="py-2 pr-3 font-medium text-right">Issues</th>
              <th className="py-2 pr-3 font-medium text-right">Returns</th>
            </tr>
          </thead>
          <tbody>
            {summary.byCountry.map((c) => (
              <tr key={c.country} className="border-b border-[var(--input-border)] last:border-0">
                <td className="py-2 pr-3 text-[var(--text-primary)]">{txt(c.country)}</td>
                <td className="py-2 pr-3 text-right">{nOr(c.slips)}</td>
                <td className="py-2 pr-3 text-right">{nOr(c.lines)}</td>
                <td className="py-2 pr-3 text-right font-medium text-[var(--text-primary)]">
                  {money(c.bookedValue, c.currency)}
                </td>
                <td className="py-2 pr-3 text-right">{nOr(c.mis.slips)}</td>
                <td className="py-2 pr-3 text-right">{nOr(c.mrt.slips)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tab 1 - the register                                                *
 * ------------------------------------------------------------------ */
function RegisterTab({
  loading, slips, filtered, summary, singleCurrency, paged,
  expanded, expandedLines, expandLoading, toggleExpand,
  onExcel, onPdf, onLinesExcel,
}) {
  const valueLabel = singleCurrency
    ? money(summary.byCurrency[singleCurrency]?.bookedValue, singleCurrency)
    : 'Per country'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Slips" value={loading ? '-' : nOr(summary.slips)} icon={Receipt}
          sub={`${nOr(summary.docTypeSplit.MIS)} issues, ${nOr(summary.docTypeSplit.MRT)} returns`} />
        <Kpi label="Lines" value={loading ? '-' : nOr(summary.lines)} icon={ClipboardList}
          sub={summary.avgLinesPerSlip == null ? 'Not measurable' : `${nOr(summary.avgLinesPerSlip, 1)} per slip`} />
        <Kpi label="Value (as booked)" value={loading ? '-' : valueLabel} icon={Store}
          sub={singleCurrency ? 'In this country currency' : 'Shown per country below'} />
        <Kpi label="Linked to a job card" value={loading ? '-' : pctOr(summary.linkageRate)} icon={Link2}
          sub={summary.linkageRate == null ? 'No slips to measure' : `${nOr(summary.linkedSlips)} of ${nOr(summary.slips)}`} />
        <Kpi
          label="Returns booked as a charge"
          value={loading ? '-' : nOr(summary.returnSignAnomalies)}
          icon={AlertTriangle}
          tone={summary.returnSignAnomalies > 0 ? 'text-amber-300' : undefined}
          sub={summary.returnSignAnomalies > 0 ? 'See the Returns tab' : 'None in this window'}
        />
      </div>

      <CountryMoney summary={summary} />

      <div className="card">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <ClipboardList size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Issue register</h3>
          <span className="text-[11px] text-[var(--text-muted)]">
            {nOr(filtered.length)} of {nOr(slips.length)} shown
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onExcel} disabled={filtered.length === 0} className={btnCls}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={onPdf} disabled={filtered.length === 0} className={btnCls}>
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[var(--text-muted)]">
            <Receipt size={28} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {slips.length === 0
                ? 'No material issue slips in this window.'
                : 'No slips match the filters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="py-2 pr-2 font-medium w-6" />
                    <th className="py-2 pr-3 font-medium">Slip No</th>
                    <th className="py-2 pr-3 font-medium">Document</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Job card</th>
                    <th className="py-2 pr-3 font-medium">Asset</th>
                    <th className="py-2 pr-3 font-medium">Store</th>
                    <th className="py-2 pr-3 font-medium text-right">Lines</th>
                    <th className="py-2 pr-3 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageRows.map((s) => {
                    const open = expanded === s.key
                    return (
                      <FragmentRow
                        key={s.key}
                        slip={s}
                        open={open}
                        lines={open ? expandedLines : []}
                        linesLoading={open && expandLoading}
                        onToggle={() => toggleExpand(s)}
                        onLinesExcel={onLinesExcel}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination {...paged} />
          </>
        )}
      </div>
    </div>
  )
}

function FragmentRow({ slip, open, lines, linesLoading, onToggle, onLinesExcel }) {
  const flagTone = slip.returnSignAnomaly ? 'text-amber-300' : 'text-[var(--text-primary)]'
  return (
    <>
      <tr
        className="border-b border-[var(--input-border)] hover:bg-[var(--input-bg)] cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-2 pr-2 text-[var(--text-muted)]">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="py-2 pr-3 font-mono text-xs text-[var(--text-primary)]">{txt(slip.issueNumber)}</td>
        <td className="py-2 pr-3">
          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
            !slip.docTypeKnown
              ? 'border-[var(--input-border)] text-[var(--text-muted)]'
              : isReturn(slip.docType)
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
          }`}>
            {slip.docTypeKnown ? docTypeLabel(slip.docType) : 'Unreadable number'}
          </span>
        </td>
        <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(slip.date)}</td>
        <td className="py-2 pr-3 font-mono text-xs text-[var(--text-secondary)]">
          {txt(slip.workOrderNo)}
          {slip.workOrderCount > 1 && (
            <span className="ml-1 text-amber-300">(+{slip.workOrderCount - 1})</span>
          )}
        </td>
        <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(slip.assetCode)}</td>
        <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(slip.storeCode)}</td>
        <td className="py-2 pr-3 text-right">{nOr(slip.lineCount)}</td>
        <td className={`py-2 pr-3 text-right font-medium ${flagTone}`}>
          {money(slip.bookedValue, slip.currency)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--input-border)]">
          <td colSpan={9} className="py-3 px-4 bg-[var(--input-bg)]">
            {slip.returnSignAnomaly && (
              <p className="text-[11px] text-amber-300 mb-2">
                This is a return, and it is booked as a charge. Nothing has been changed
                here; the figure above is exactly what the ledger holds.
              </p>
            )}
            {linesLoading ? (
              <p className="text-xs text-[var(--text-muted)]">Loading the items on this slip...</p>
            ) : lines.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No item lines are recorded on this slip.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    {nOr(lines.length)} item{lines.length === 1 ? '' : 's'} issued
                  </span>
                  <button
                    className={`${btnCls} ml-auto`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onLinesExcel(lines, `Material Issue ${slip.issueNumber}`)
                    }}
                  >
                    <FileSpreadsheet size={13} /> Items
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)]">
                        <th className="py-1 pr-3 font-medium">Item code</th>
                        <th className="py-1 pr-3 font-medium">Description</th>
                        <th className="py-1 pr-3 font-medium text-right">Qty</th>
                        <th className="py-1 pr-3 font-medium text-right">Unit cost</th>
                        <th className="py-1 pr-3 font-medium text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={l.id || i} className="text-[var(--text-secondary)]">
                          <td className="py-1 pr-3 font-mono">{txt(l.item_code)}</td>
                          <td className="py-1 pr-3">{txt(l.item_description)}</td>
                          <td className="py-1 pr-3 text-right">{nOr(l.qty, 2)}</td>
                          <td className="py-1 pr-3 text-right">
                            {l.unit_cost == null ? 'N/A' : money(l.unit_cost, l.currency || slip.currency)}
                          </td>
                          <td className="py-1 pr-3 text-right text-[var(--text-primary)]">
                            {money(l.line_cost, l.currency || slip.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Tab 2 - returns, and the integrity finding                          *
 * ------------------------------------------------------------------ */
function ReturnsTab({ loading, returns, summary, singleCurrency, onExcel, onPdf }) {
  const anomalies = summary.returnSignAnomalies

  return (
    <div className="space-y-4">
      <Notice
        tone={anomalies > 0 ? 'warn' : 'info'}
        icon={anomalies > 0 ? AlertTriangle : Info}
        title="A return currently adds cost to a job card instead of crediting it."
      >
        <p>
          MRT is a material RETURN: the store taking parts back off a job. Every return
          line in this data is booked as a positive amount, which means the job card is
          charged for parts that came back to the shelf.
        </p>
        <p>
          <strong className="text-[var(--text-secondary)]">Nothing has been changed.</strong>{' '}
          The value column below is exactly what the ledger holds, so this page agrees
          with Expenses and CPK. The credited column shows what the same returns would
          come to if a return credited the job. Which of those is correct for the books
          is an owner decision about money, not a display setting, so it is reported
          here rather than applied.
        </p>
      </Notice>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Return slips" value={loading ? '-' : nOr(summary.slips)} icon={Undo2} />
        <Kpi label="Return lines" value={loading ? '-' : nOr(summary.lines)} icon={ClipboardList} />
        <Kpi
          label="Value as booked"
          value={loading ? '-' : (singleCurrency
            ? money(summary.byCurrency[singleCurrency]?.bookedValue, singleCurrency)
            : 'Per country')}
          icon={Store}
          sub="What the ledger holds today"
        />
        <Kpi
          label="Value if credited"
          value={loading ? '-' : (singleCurrency
            ? money(summary.byCurrency[singleCurrency]?.creditedValue, singleCurrency)
            : 'Per country')}
          icon={Undo2}
          tone="text-amber-300"
          sub="Not applied anywhere"
        />
      </div>

      <CountryMoney summary={summary} />

      <div className="card">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Undo2 size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Return register</h3>
          <span className="text-[11px] text-[var(--text-muted)]">{nOr(returns.length)} shown</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onExcel} disabled={returns.length === 0} className={btnCls}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={onPdf} disabled={returns.length === 0} className={btnCls}>
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}
          </div>
        ) : returns.length === 0 ? (
          <div className="py-10 text-center text-[var(--text-muted)]">
            <Undo2 size={28} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No material returns in this window.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                  <th className="py-2 pr-3 font-medium">Slip No</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Job card</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Store</th>
                  <th className="py-2 pr-3 font-medium text-right">Lines</th>
                  <th className="py-2 pr-3 font-medium text-right">As booked</th>
                  <th className="py-2 pr-3 font-medium text-right">If credited</th>
                  <th className="py-2 pr-3 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((s) => (
                  <tr key={s.key} className="border-b border-[var(--input-border)] last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--text-primary)]">{txt(s.issueNumber)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(s.date)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--text-secondary)]">{txt(s.workOrderNo)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(s.assetCode)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(s.storeCode)}</td>
                    <td className="py-2 pr-3 text-right">{nOr(s.lineCount)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-[var(--text-primary)]">
                      {money(s.bookedValue, s.currency)}
                    </td>
                    <td className="py-2 pr-3 text-right text-amber-300">
                      {money(s.creditedValue, s.currency)}
                    </td>
                    <td className="py-2 pr-3 text-[11px]">
                      {s.returnSignAnomaly
                        ? <span className="text-amber-300">Booked as a charge</span>
                        : <span className="text-[var(--text-muted)]">Credited already</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tab 3 - raise a slip in app (V609)                                  *
 * ------------------------------------------------------------------ */
// `query` lives ON THE LINE, not in one shared slot. A single global search slot
// shared by every row is the defect that made three signature fields overwrite
// each other elsewhere in this app: typing in row 2 would blank row 1.
const EMPTY_LINE = {
  item_code: '', item_description: '', qty: '', uom: '', unit_cost: '', category: '', query: '',
}

function RaiseTab({ canWrite, activeCountry, profileName, onSaved }) {
  const [provisioned, setProvisioned] = useState(null) // null = checking
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(null)
  const [recent, setRecent] = useState([])

  const [header, setHeader] = useState({
    doc_type: 'MIS',
    country: activeCountry && activeCountry !== 'All' ? activeCountry : '',
    work_order_no: '',
    asset_no: '',
    site: '',
    store_code: '',
    issued_to: '',
    notes: '',
  })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])

  const [jobSearch, setJobSearch] = useState('')
  const [jobs, setJobs] = useState([])
  const [items, setItems] = useState([])
  const [itemsFor, setItemsFor] = useState(null)

  const searchTimer = useRef(null)
  const itemTimer = useRef(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setChecking(true)
      const ok = await materialIssuesProvisioned()
      if (!alive) return
      setProvisioned(ok)
      if (ok) {
        const res = await listMaterialIssues({ country: activeCountry, limit: 50 })
        if (alive) setRecent(res.rows)
      }
      setChecking(false)
    })()
    return () => { alive = false }
  }, [activeCountry])

  // Job card picker - debounced so a keystroke is not a query.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const rows = await listIssuableJobCards({ country: header.country || activeCountry, search: jobSearch })
      setJobs(rows)
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [jobSearch, header.country, activeCountry])

  const setLine = (i, patch) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  /**
   * Search the item master for one line.
   *
   * DEBOUNCED: without this every keystroke is a query against a ~22,000-row
   * table, which is the defect this app already had to fix on the tyre register.
   * REUSES the material master service - `parts_catalog` is empty, so the
   * master's reviewed item codes are the real catalog here.
   */
  const searchItems = useCallback((idx, term) => {
    setLine(idx, { query: term, item_code: '', item_description: '' })
    setItemsFor(idx)
    if (itemTimer.current) clearTimeout(itemTimer.current)
    if (!header.country || !term.trim()) { setItems([]); return }
    itemTimer.current = setTimeout(async () => {
      const rows = await listMaterials({ country: header.country, search: term, limit: 25 })
      setItems(rows)
    }, 300)
  }, [header.country])

  useEffect(() => () => { if (itemTimer.current) clearTimeout(itemTimer.current) }, [])
  const addLine = () => setLines((ls) => [...ls, { ...EMPTY_LINE }])
  const removeLine = (i) => setLines((ls) => (ls.length === 1 ? [{ ...EMPTY_LINE }] : ls.filter((_, k) => k !== i)))

  const check = useMemo(() => validateDraftIssue(header, lines), [header, lines])
  const currency = currencyForCountry(header.country)

  const save = async () => {
    setSaveError('')
    setSaved(null)
    if (!check.ok) return
    setSaving(true)
    try {
      // The slip number is minted BY THE DATABASE on insert. The sequence
      // function is deliberately not callable from a browser, so nothing here
      // asks for a number; the saved slip reports the one the server assigned.
      const res = await createMaterialIssue(
        {
          ...header,
          issued_at: new Date().toISOString(),
          issued_by_name: profileName,
        },
        lines,
      )
      if (!res.ok) {
        setSaveError(res.reason === 'not_provisioned'
          ? 'Raising a slip is not enabled on this database yet.'
          : 'Could not save that slip.')
        return
      }
      setSaved(res.issue_number || 'Saved')
      setLines([{ ...EMPTY_LINE }])
      setHeader((h) => ({ ...h, work_order_no: '', asset_no: '', notes: '' }))
      const rows = await listMaterialIssues({ country: activeCountry, limit: 50 })
      setRecent(rows.rows)
      if (onSaved) onSaved()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Could not save that slip.'))
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="card flex items-center gap-2 text-[var(--text-muted)] text-sm">
        <Loader2 size={15} className="animate-spin" /> Checking whether slips can be raised here...
      </div>
    )
  }

  if (!provisioned) {
    return (
      <Notice tone="warn" icon={Ban} title="Raising a slip is not enabled on this database yet.">
        <p>
          The material issue tables have not been created here, so a slip cannot be
          saved. The Issue register and Returns tabs still work in full: they read the
          slips the store has already raised, from the expense lines themselves.
        </p>
        <p>Apply the V609 material issue migration, then reload this page.</p>
      </Notice>
    )
  }

  if (!canWrite) {
    return (
      <Notice tone="info" icon={Ban} title="You can read the register but not raise a slip.">
        <p>Raising a material issue is limited to Admin, Manager and Director.</p>
      </Notice>
    )
  }

  return (
    <div className="space-y-4">
      <Notice icon={Info} title="Before you issue">
        <p>
          <strong className="text-[var(--text-secondary)]">No on-hand balance is shown,
          and none is checked.</strong> Stock is recorded by site and description with no
          item code, so it cannot be matched to the item codes on a slip. This screen
          records what was issued; it does not know what is on the shelf.
        </p>
        <p>
          Item codes are not unique across countries, so a slip must name one country
          before items can be picked.
        </p>
      </Notice>

      {saved && (
        <Notice tone="info" icon={Check} title="Slip saved.">
          <p>Slip <span className="font-mono">{txt(saved)}</span> has been recorded.</p>
        </Notice>
      )}
      {saveError && (
        <Notice tone="error" icon={AlertTriangle} title="Could not save that slip.">
          <p>{saveError}</p>
        </Notice>
      )}

      <div className="card space-y-3">
        <h3 className="font-semibold text-[var(--text-primary)]">Slip details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Document type</span>
            <select
              value={header.doc_type}
              onChange={(e) => setHeader((h) => ({ ...h, doc_type: e.target.value }))}
              className={inputCls}
            >
              {DOC_TYPE_KEYS.map((k) => <option key={k} value={k}>{docTypeLabel(k)}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Country</span>
            <select
              value={header.country}
              onChange={(e) => setHeader((h) => ({ ...h, country: e.target.value }))}
              className={inputCls}
            >
              <option value="">Pick a country</option>
              {['KSA', 'UAE', 'Egypt'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Store</span>
            <input
              value={header.store_code}
              onChange={(e) => setHeader((h) => ({ ...h, store_code: e.target.value }))}
              className={inputCls}
              placeholder="Store code"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Issued to</span>
            <input
              value={header.issued_to}
              onChange={(e) => setHeader((h) => ({ ...h, issued_to: e.target.value }))}
              className={inputCls}
              placeholder="Who collected it"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1 lg:col-span-2">
            <span>Job card</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={header.work_order_no || jobSearch}
                onChange={(e) => {
                  setJobSearch(e.target.value)
                  setHeader((h) => ({ ...h, work_order_no: '' }))
                }}
                className={`${inputCls} pl-9`}
                placeholder="Search a job card number or asset..."
              />
            </div>
            {!header.work_order_no && jobSearch && jobs.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]">
                {jobs.slice(0, 20).map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => {
                      setHeader((h) => ({
                        ...h,
                        work_order_no: j.work_order_no || '',
                        asset_no: j.asset_no || h.asset_no,
                        site: j.site || h.site,
                      }))
                      setJobSearch('')
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
                  >
                    <span className="font-mono">{txt(j.work_order_no)}</span>
                    <span className="text-[var(--text-muted)]"> - {txt(j.asset_no)} - {txt(j.site)}</span>
                  </button>
                ))}
              </div>
            )}
            {!header.work_order_no && jobSearch && jobs.length === 0 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                No job card matches that in the loaded set.
              </p>
            )}
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Asset</span>
            <input
              value={header.asset_no}
              onChange={(e) => setHeader((h) => ({ ...h, asset_no: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <input
              value={header.site}
              onChange={(e) => setHeader((h) => ({ ...h, site: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1 lg:col-span-4">
            <span>Notes</span>
            <input
              value={header.notes}
              onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))}
              className={inputCls}
              placeholder="Optional"
            />
          </label>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Items</h3>
          <button onClick={addLine} className={`${btnCls} ml-auto`}><Plus size={13} /> Add item</button>
        </div>

        {!header.country && (
          <p className="text-xs text-[var(--text-muted)]">Pick a country to search the item master.</p>
        )}

        <div className="space-y-3">
          {lines.map((l, i) => {
            const v = draftLineValue(l)
            return (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                <div className="sm:col-span-4 space-y-1">
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      value={l.item_code || l.query || ''}
                      onChange={(e) => searchItems(i, e.target.value)}
                      className={`${inputCls} pl-9`}
                      placeholder="Item code or name"
                      disabled={!header.country}
                    />
                  </div>
                  {itemsFor === i && !l.item_code && l.query && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]">
                      {items.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
                          No item in the master matches that.
                        </p>
                      ) : items.map((m) => (
                        <button
                          key={m.id || m.item_code}
                          type="button"
                          onClick={() => {
                            setLine(i, {
                              item_code: m.item_code || '',
                              item_description: m.item_name || '',
                              uom: m.uom || '',
                              category: m.category || '',
                              query: '',
                            })
                            setItemsFor(null)
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
                        >
                          <span className="font-mono">{txt(m.item_code)}</span>
                          <span className="text-[var(--text-muted)]"> - {txt(m.item_name)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {l.item_description && (
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{l.item_description}</p>
                  )}
                </div>
                <input
                  className={`${inputCls} sm:col-span-2`}
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                  placeholder="Qty"
                  inputMode="decimal"
                />
                <input
                  className={`${inputCls} sm:col-span-2`}
                  value={l.uom}
                  onChange={(e) => setLine(i, { uom: e.target.value })}
                  placeholder="UOM"
                />
                <input
                  className={`${inputCls} sm:col-span-2`}
                  value={l.unit_cost}
                  onChange={(e) => setLine(i, { unit_cost: e.target.value })}
                  placeholder="Unit cost"
                  inputMode="decimal"
                />
                <div className="sm:col-span-1 text-sm text-[var(--text-primary)] py-2 text-right">
                  {v == null ? <span className="text-[var(--text-muted)] text-xs">Unpriced</span> : money(v, currency)}
                </div>
                <button
                  onClick={() => removeLine(i)}
                  className="sm:col-span-1 inline-flex items-center justify-center py-2 text-[var(--text-muted)] hover:text-red-400"
                  aria-label={`Remove item ${i + 1}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 flex-wrap border-t border-[var(--input-border)] pt-3">
          <div className="text-sm">
            <span className="text-[var(--text-muted)] text-xs">Slip total </span>
            <span className="font-bold text-[var(--text-primary)]">
              {check.total == null ? 'Not available' : money(check.total, currency)}
            </span>
            {check.unpricedLines > 0 && (
              <span className="text-[11px] text-[var(--text-muted)] ml-2">
                {nOr(check.unpricedLines)} item{check.unpricedLines === 1 ? '' : 's'} unpriced,
                so there is no complete total. Priced so far: {money(check.pricedTotal, currency)}.
              </span>
            )}
          </div>
          <button
            onClick={save}
            disabled={!check.ok || saving}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save slip
          </button>
        </div>

        {!check.ok && (
          <ul className="text-[11px] text-amber-300 space-y-0.5 list-disc list-inside">
            {check.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Hash size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Slips raised in this app</h3>
          <span className="text-[11px] text-[var(--text-muted)]">{nOr(recent.length)} shown</span>
        </div>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            No slips have been raised in this app yet. The historical register on the
            Issue register tab is unaffected by this.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                  <th className="py-2 pr-3 font-medium">Slip No</th>
                  <th className="py-2 pr-3 font-medium">Document</th>
                  <th className="py-2 pr-3 font-medium">Job card</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Issued</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)] last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--text-primary)]">{txt(r.issue_number)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{docTypeLabel(r.doc_type)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--text-secondary)]">{txt(r.work_order_no)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{txt(r.asset_no)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">
                      {txt(String(r.issued_at || '').slice(0, 10))}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{issueStatusLabel(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tab 4 - analytics                                                   *
 * ------------------------------------------------------------------ */
function AnalyticsTab({ loading, filtered, summary, singleCurrency, onExcel, onPdf }) {
  const trend = useMemo(() => monthlyIssueTrend(filtered), [filtered])
  const buckets = useMemo(
    () => bucketTotals(filtered.flatMap((s) => s.lines || [])),
    [filtered],
  )
  const country = summary.byCountry[0]
  // Memoised so the fallback `[]` is not a new array identity on every render,
  // which would re-build the chart option (and re-render the chart) each time.
  const topStores = useMemo(() => country?.topStores || [], [country])
  const topItems = useMemo(() => country?.topItems || [], [country])

  const trendOption = useMemo(() => {
    const months = trend.map((t) => t.month)
    const hasMoney = trend.some((t) => t.value != null)
    return baseOption({
      legend: { textStyle: { color: 'var(--text-muted)' }, top: 0 },
      xAxis: { type: 'category', data: months, axisLabel: { color: 'var(--text-muted)' } },
      yAxis: [
        { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
        { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Slips', type: 'bar', data: trend.map((t) => t.slips),
          itemStyle: { color: withAlpha(colorAt(0), 0.85) },
        },
        ...(hasMoney ? [{
          name: `Value (${singleCurrency || 'per country'})`,
          type: 'line', yAxisIndex: 1, smooth: true,
          data: trend.map((t) => t.value),
          itemStyle: { color: colorAt(1) }, lineStyle: { color: colorAt(1), width: 2 },
        }] : []),
      ],
    })
  }, [trend, singleCurrency])

  const storeOption = useMemo(() => baseOption({
    xAxis: { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
    yAxis: {
      type: 'category',
      data: topStores.map((s) => s.key).reverse(),
      axisLabel: { color: 'var(--text-muted)' },
    },
    series: [{
      type: 'bar',
      data: topStores.map((s) => s.value).reverse(),
      itemStyle: { color: (p) => colorAt(p.dataIndex) },
    }],
  }), [topStores])

  const bucketOption = useMemo(() => {
    const data = [
      { name: 'Tyres', value: buckets.tyre },
      { name: 'Spares', value: buckets.spare },
      { name: 'Oil and lubricants', value: buckets.oil },
    ].filter((d) => d.value > 0)
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: 'var(--text-muted)' } },
      series: [{
        type: 'pie', radius: ['45%', '70%'], data,
        label: { color: 'var(--text-secondary)' },
        itemStyle: { borderWidth: 0 },
        color: categorical(Math.max(1, data.length)),
      }],
    }
  }, [buckets])

  const docOption = useMemo(() => {
    const data = [
      { name: 'Issues (MIS)', value: summary.docTypeSplit.MIS },
      { name: 'Returns (MRT)', value: summary.docTypeSplit.MRT },
      { name: 'Unreadable number', value: summary.docTypeSplit.unknown },
    ].filter((d) => d.value > 0)
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: 'var(--text-muted)' } },
      series: [{
        type: 'pie', radius: ['45%', '70%'], data,
        label: { color: 'var(--text-secondary)' },
        color: categorical(Math.max(1, data.length)),
      }],
    }
  }, [summary.docTypeSplit])

  const bucketsUnavailable = buckets.tyre + buckets.spare + buckets.oil === 0

  return (
    <div className="space-y-4">
      {summary.mixedCurrency && (
        <Notice tone="warn" icon={AlertTriangle} title="This scope spans more than one currency.">
          <p>
            Slip and line counts are still real quantities, so they are charted. Money is
            not: a month that mixes SAR, AED and EGP has no single value, so it is left
            blank on the trend rather than shown as a total that means nothing. Pick one
            country in the app scope to see the money.
          </p>
        </Notice>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button onClick={onExcel} disabled={filtered.length === 0} className={btnCls}>
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button onClick={onPdf} disabled={filtered.length === 0} className={btnCls}>
          <FileText size={14} /> PDF
        </button>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Issues per month</h3>
        </div>
        <div className="h-[280px]">
          {loading ? <EmptyChart label="Loading..." />
            : trend.length === 0 ? <EmptyChart />
              : <EChart option={trendOption} className="h-full" ariaLabel="Issues per month" />}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Value by store</h3>
            {summary.byCountry.length > 1 && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {txt(country?.country)} only, to keep one currency
              </span>
            )}
          </div>
          <div className="h-[260px]">
            {topStores.length === 0
              ? <EmptyChart label="No store is recorded on these slips." />
              : <EChart option={storeOption} className="h-full" ariaLabel="Value by store" />}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">By category</h3>
            <span className="text-[11px] text-[var(--text-muted)]">Tyre, spare and oil split</span>
          </div>
          <div className="h-[260px]">
            {bucketsUnavailable
              ? <EmptyChart label="No category split is recorded on these lines." />
              : <EChart option={bucketOption} className="h-full" ariaLabel="Value by category" />}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Issues against returns</h3>
          </div>
          <div className="h-[260px]">
            {summary.slips === 0
              ? <EmptyChart />
              : <EChart option={docOption} className="h-full" ariaLabel="Issues against returns" />}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Most issued items</h3>
          </div>
          {topItems.length === 0 ? (
            <div className="h-[260px]"><EmptyChart label="No item codes on these slips." /></div>
          ) : (
            <div className="overflow-x-auto max-h-[260px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="py-1.5 pr-3 font-medium">Item</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Lines</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Qty</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((it) => (
                    <tr key={it.key} className="border-b border-[var(--input-border)] last:border-0">
                      <td className="py-1.5 pr-3">
                        <span className="font-mono text-[var(--text-primary)]">{txt(it.key)}</span>
                        {it.description && (
                          <span className="text-[var(--text-muted)]"> - {it.description}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{nOr(it.lines)}</td>
                      <td className="py-1.5 pr-3 text-right">{nOr(it.qty, 2)}</td>
                      <td className="py-1.5 pr-3 text-right text-[var(--text-primary)]">
                        {money(it.value, country?.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
