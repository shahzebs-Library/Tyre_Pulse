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
import Card, { CardHeader } from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import EChart from '../components/charts/EChart'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import DateField from '../components/ui/DateField'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  listSlipsFromConsumption, getSlipLines, getIssueSummary, getMaterialIssueCoverage,
  materialIssuesProvisioned, listMaterialIssues, createMaterialIssue,
  listIssuableJobCards, DEFAULT_LINE_MAX,
  issueSlipPostingAvailable, postMaterialIssueSlip, listSlipStockLines,
} from '../lib/api/materialIssue'
import { slipStockOptions, pickSlipStockLine } from '../lib/inventory/stockFlowRules'
import { listMaterials } from '../lib/api/materialMaster'
import {
  summarizeIssues, filterSlips, slipFilterOptions, monthlyIssueTrend,
  isReturn, DOC_TYPE_KEYS,
  SLIP_EXPORT_COLUMNS, slipExportRows, LINE_EXPORT_COLUMNS, lineExportRows,
  validateDraftIssue, draftLineValue, slipPostingSummary,
} from '../lib/materialIssue'
import { currencyForCountry, MIXED_CURRENCY } from '../lib/governedCost'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { formatCurrency } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import {
  singleCurrencyOf, headlineValue, categoryShare, docTypeShare, returnFlag,
  recentSlipRows, topItemRows, slipLineRows, issueHistoryYears,
} from '../lib/storeMaterialIssueAnalytics'

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const TABS = [
  { key: 'register', icon: ClipboardList },
  { key: 'returns', icon: Undo2 },
  { key: 'raise', icon: PackageOpen },
  { key: 'analytics', icon: TrendingUp },
]

// The app's shared `.input` control style (same as every other register).
const inputCls = 'input'

const btnCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg '
  + 'bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] '
  + 'hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed'

/** ISO day, local time. `toISOString()` would shift the day at a positive offset. */
function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function monthStart() {
  const d = new Date()
  d.setDate(1)
  return isoDay(d)
}
function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return isoDay(d)
}

/**
 * Display formatters bound to the active language. Money with its currency, or
 * the translated "N/A". Never a dash, never an unlabelled number.
 */
function makeFmt(t) {
  const na = t('wmsissue.common.na')
  return {
    money(v, currency) {
      if (v == null || !Number.isFinite(Number(v))) return na
      if (!currency || currency === MIXED_CURRENCY) return t('wmsissue.common.mixedCurrencies')
      return formatCurrency(Number(v), currency, 0)
    },
    nOr: (v, digits = 0) => (
      Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, {
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }) : na
    ),
    pctOr: (v) => (Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : na),
    txt: (v) => {
      const s = String(v ?? '').trim()
      return s === '' ? na : s
    },
  }
}
function useFmt() {
  const { t } = useLanguage()
  return useMemo(() => makeFmt(t), [t])
}

// Display labels for values the material issue engine returns in English.
// The tokens themselves (MIS, MRT, draft...) are never translated.
const DOC_LABEL_KEY = { 'Material issue': 'MIS', 'Material return': 'MRT' }
const STATUS_LABEL_KEY = { Draft: 'draft', Issued: 'issued', Cancelled: 'cancelled', Unknown: 'unknown' }
const CATEGORY_NAME_KEY = { Tyres: 'tyres', Spares: 'spares', 'Oil and lubricants': 'oil' }
const DOC_SHARE_KEY = { 'Issues (MIS)': 'mis', 'Returns (MRT)': 'mrt', 'Unreadable number': 'unknown' }
const CHECK_ERROR_KEY = {
  'Pick a country. Item codes are not unique across countries, so a slip must name one.': 'country',
  'Pick the job card this slip is issued against.': 'jobCard',
  'Pick a document type.': 'docType',
  'Add at least one item.': 'noItems',
  'enter a quantity greater than zero.': 'qty',
  'a unit cost cannot be negative. Use the return document type to credit a job.': 'negativeCost',
  'pick the item from the material master.': 'pickItem',
  'choose the stock line it comes from.': 'pickStock',
}

function docLabel(t, key) {
  return key === 'MIS' || key === 'MRT' ? t(`wmsissue.doc.${key}`) : t('wmsissue.doc.unreadable')
}

/** Translate one validateDraftIssue message; an unknown message is shown as is. */
function checkErrorText(t, e) {
  const m = /^Line (\d+): (.*)$/.exec(String(e))
  if (m) {
    const k = CHECK_ERROR_KEY[m[2]]
    return k ? t('wmsissue.raise.lineError', { line: m[1], message: t(`wmsissue.raise.errors.${k}`) }) : e
  }
  const k = CHECK_ERROR_KEY[e]
  return k ? t(`wmsissue.raise.errors.${k}`) : e
}

/** Title and detail for an inv_issue_slip answer; mirrors slipPostingSummary. */
function postingText(t, res) {
  if (!res) return { title: t('wmsissue.post.notMovedTitle'), detail: t('wmsissue.post.noAnswer') }
  if (res.ok) {
    const posted = Number(res.posted) || 0
    const already = Number(res.already) || 0
    if (posted === 0 && already > 0) {
      return { title: t('wmsissue.post.alreadyTitle'), detail: t('wmsissue.post.alreadyDetail', { count: already }) }
    }
    return {
      title: t('wmsissue.post.updatedTitle'),
      detail: already
        ? t('wmsissue.post.updatedDetailAlready', { posted, already })
        : t('wmsissue.post.updatedDetail', { posted }),
    }
  }
  if (res.reason === 'not_available') {
    return { title: t('wmsissue.post.docOnlyTitle'), detail: t('wmsissue.post.docOnlyDetail') }
  }
  const message = String(res.message ?? '').trim()
  if (res.reason === 'shortage') {
    return {
      title: t('wmsissue.post.savedNotMovedTitle'),
      detail: t('wmsissue.post.shortageDetail', { message: message || t('wmsissue.post.notEnough') }),
    }
  }
  return { title: t('wmsissue.post.savedNotMovedTitle'), detail: message || t('wmsissue.post.refused') }
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

function EmptyChart({ label }) {
  const { t } = useLanguage()
  if (label == null) label = t('wmsissue.common.nothingToChart')
  return (
    <div className="h-full flex items-center justify-center text-center px-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
    </div>
  )
}

function Notice({ tone = 'info', icon: Icon = Info, title, children, action }) {
  // The old `border border-X` classes are DEAD against Card, which sets both
  // `border` and `borderColor` as inline styles that a plain class cannot beat.
  // The edge tint is now the `tone` prop, which is the only place it can live.
  const cardTone = tone === 'warn' ? 'warn' : tone === 'error' ? 'crit' : 'default'
  const ink = tone === 'warn' ? 'text-amber-400'
    : tone === 'error' ? 'text-red-400' : 'text-[var(--text-secondary)]'
  const head = tone === 'warn' ? 'text-amber-300'
    : tone === 'error' ? 'text-red-300' : 'text-[var(--text-primary)]'
  return (
    // Card is `flex flex-col` and Tailwind emits .flex-col after .flex-row, so
    // a `flex-row` class here could never win; the direction goes in `style`,
    // which Card spreads last.
    <Card tone={cardTone} className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
      <Icon size={18} className={`${ink} mt-0.5 shrink-0`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className={`${head} font-medium`}>{title}</p>}
        <div className="text-[var(--text-muted)] text-sm mt-1 space-y-1">{children}</div>
      </div>
      {action}
    </Card>
  )
}

export default function StoreMaterialIssue() {
  const { t } = useLanguage()
  const { nOr, txt } = useFmt()
  const { activeCountry } = useSettings()
  const { profile, isSuperAdmin, hasCapability } = useAuth()
  // Mirrors the server: material_issues is writable by an elevated role OR a
  // person granted stock:edit (RLS `material_issues_write`). Checking roles only
  // hid the form from someone the server would accept.
  const canWrite = isSuperAdmin || WRITE_ROLES.has(profile?.role)
    || (typeof hasCapability === 'function' && !!hasCapability('stock', 'edit'))
  // WP5 also lets the people who issue stock raise a slip (stock:issue). Only
  // offered once the posting function exists, because the same migration widens
  // the write policy; before it the server would refuse the save.
  const canIssue = typeof hasCapability === 'function' && !!hasCapability('stock', 'issue')
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

  const [coverage, setCoverage] = useState(null)
  const [coverageError, setCoverageError] = useState('')
  const [historyPeriod, setHistoryPeriod] = useState('month')
  const [coverageRefresh, setCoverageRefresh] = useState(0)
  const historyYears = useMemo(() => issueHistoryYears(coverage), [coverage])
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(isoDay(new Date()))
  const [filters, setFilters] = useState({ site: 'All', store: 'All', docType: 'All', search: '' })
  const [querySearch, setQuerySearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuerySearch(filters.search), 300)
    return () => clearTimeout(timer)
  }, [filters.search])
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ site: 'All', store: 'All', docType: 'All', search: '' })
  const hasFilters = filters.site !== 'All' || filters.store !== 'All'
    || filters.docType !== 'All' || Boolean(filters.search)

  const [expanded, setExpanded] = useState(null)
  const [expandedLines, setExpandedLines] = useState([])
  const [expandLoading, setExpandLoading] = useState(false)
  const [expandError, setExpandError] = useState('')

  // Coverage includes all accessible uploads, independent of the chosen date window.
  useEffect(() => {
    let current = true
    setCoverage(null); setCoverageError('')
    getMaterialIssueCoverage({ country: activeCountry }).then(result => {
      if (current) setCoverage(result)
    }).catch(err => {
      if (current) setCoverageError(toUserMessage(err, t('wmsissue.history.loadError')))
    })
    return () => { current = false }
    // t is read only for the error fallback; a language switch must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, coverageRefresh])
  function choosePeriod(value) {
    setHistoryPeriod(value)
    if (value === 'month') { setFrom(monthStart()); setTo(isoDay(new Date())) }
    else if (value === 'recent') { setFrom(monthsAgo(12)); setTo(isoDay(new Date())) }
    else if (/^\d{4}$/.test(value)) { setFrom(`${value}-01-01`); setTo(`${value}-12-31`) }
  }
  const registerRequest = useRef(0)

  // --- Load the historical register -----------------------------------------
  const load = useCallback(async () => {
    const request = ++registerRequest.current
    setLoading(true)
    setError(''); setSlips([]); setServerSummary(null); setTruncated(false); setUnslipped(null)
    setExpanded(null); setExpandedLines([]); setExpandError('')
    try {
      const [res, s] = await Promise.all([
        listSlipsFromConsumption({
          country: activeCountry, from, to,
          site: filters.site, store: filters.store, search: querySearch,
          max: DEFAULT_LINE_MAX,
        }),
        getIssueSummary({ country: activeCountry, from, to }),
      ])
      if (request !== registerRequest.current) return
      setSlips(res.slips)
      setTruncated(res.truncated)
      setUnslipped(res.unslipped)
      setLoadedAt(new Date())
      // Best effort: the server aggregate is the authoritative window total when
      // the client read was capped. A failure here must never fail the page.
      setServerSummary(s.ok ? s.data : null)
    } catch (err) {
      if (request !== registerRequest.current) return
      setError(toUserMessage(err, t('wmsissue.page.loadError')))
      setSlips([])
    } finally {
      if (request === registerRequest.current) setLoading(false)
    }
    // t is read only for the error fallback; a language switch must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, from, to, filters.site, filters.store, querySearch])

  useEffect(() => { load(); return () => { registerRequest.current += 1 } }, [load])

  // --- Derived --------------------------------------------------------------
  const options = useMemo(() => {
    const available = slipFilterOptions(slips)
    return {
      sites: [...new Set([...available.sites, ...(filters.site !== 'All' ? [filters.site] : [])])].sort(),
      stores: [...new Set([...available.stores, ...(filters.store !== 'All' ? [filters.store] : [])])].sort(),
    }
  }, [slips, filters.site, filters.store])

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

  const singleCurrency = singleCurrencyOf(summary, activeCountry)

  const toggleExpand = async (slip) => {
    setExpandError('')
    if (expanded === slip.key) { setExpanded(null); setExpandedLines([]); return }
    setExpanded(slip.key)
    // The lines are already in memory from the register read; only fall back to
    // a query if a slip somehow arrived without them.
    if (slip.lines?.length) { setExpandedLines(slip.lines); return }
    setExpandLoading(true)
    try {
      setExpandedLines(await getSlipLines(slip.issueNumber, slip.country))
    } catch (err) {
      // An unreadable slip must not read as "No item lines are recorded".
      setExpandedLines([])
      setExpandError(toUserMessage(err, t('wmsissue.slip.linesError')))
    } finally {
      setExpandLoading(false)
    }
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
        title={t('wmsissue.page.title')}
        subtitle={t('wmsissue.page.subtitle')}
        icon={Receipt}
        onRefresh={load}
        refreshing={loading}
        updatedAt={loadedAt}
      />

      {error && (
        <Notice
          tone="error"
          icon={AlertTriangle}
          title={t('wmsissue.common.somethingWrong')}
          action={<button onClick={load} className={btnCls}><RefreshCw size={13} aria-hidden="true" /> {t('wmsissue.common.retry')}</button>}
        >
          <p>{error}</p>
        </Notice>
      )}

      <Card className="gap-[var(--space-3)]">
        <CardHeader icon={FileSpreadsheet} title={t('wmsissue.history.title')}
          description={t('wmsissue.history.description')} />
        {coverageError ? <p role="alert" className="text-sm text-[var(--text-secondary)]">{coverageError}{' '}
          <button className={btnCls} onClick={() => setCoverageRefresh(n => n + 1)}>{t('wmsissue.history.retry')}</button></p>
          : coverage === null ? <p role="status" className="text-sm text-[var(--text-muted)]">{t('wmsissue.history.checking')}</p>
            : <p className="text-sm text-[var(--text-secondary)]">{coverage.first
              ? t('wmsissue.history.range', { first: coverage.first, last: coverage.last })
              : t('wmsissue.history.none')}</p>}
        <label className="text-xs text-[var(--text-muted)] space-y-1 max-w-xs">
          <span>{t('wmsissue.history.period')}</span>
          <select className={inputCls} value={historyPeriod} onChange={e => choosePeriod(e.target.value)}>
            <option value="month">{t('wmsissue.history.thisMonth')}</option>
            <option value="recent">{t('wmsissue.history.last12')}</option>
            {historyYears.map(year => <option key={year} value={year}>{t('wmsissue.history.yearOption', { year })}</option>)}
            <option value="custom">{t('wmsissue.history.custom')}</option>
          </select>
        </label>
      </Card>

      {/* Window + filters. No `clip`: the selects are native and the dates use
          DateField, whose calendar is portalled outside the card, so there is
          nothing to crop. */}
      <Card className="gap-[var(--space-3)]">
        <CardHeader
          className="!mb-0"
          icon={CalendarRange}
          title={t('wmsissue.filters.title')}
          description={t('wmsissue.filters.description', { country: txt(activeCountry) })}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.filters.from')}</span>
            <DateField ariaLabel={t('wmsissue.filters.from')} value={from} onChange={(v) => { setHistoryPeriod('custom'); setFrom(v) }} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.filters.to')}</span>
            <DateField ariaLabel={t('wmsissue.filters.to')} value={to} onChange={(v) => { setHistoryPeriod('custom'); setTo(v) }} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.filters.document')}</span>
            <select value={filters.docType} onChange={(e) => setFilter('docType', e.target.value)} className={inputCls}>
              <option value="All">{t('wmsissue.filters.allDocuments')}</option>
              {DOC_TYPE_KEYS.map((k) => <option key={k} value={k}>{docLabel(t, k)}</option>)}
              <option value="UNKNOWN">{t('wmsissue.doc.unreadable')}</option>
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.filters.site')}</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
              <option value="All">{t('wmsissue.filters.allSites')}</option>
              {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.filters.store')}</span>
            <select value={filters.store} onChange={(e) => setFilter('store', e.target.value)} className={inputCls}>
              <option value="All">{t('wmsissue.filters.allStores')}</option>
              {options.stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.filters.search')}</span>
            <div className="relative">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                className={`${inputCls} ps-9`}
                placeholder={t('wmsissue.filters.searchPlaceholder')}
              />
            </div>
          </label>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className={`${btnCls} self-start`}><X size={13} aria-hidden="true" /> {t('wmsissue.common.clearFilters')}</button>
        )}
      </Card>

      {truncated && (
        <Notice tone="warn" icon={AlertTriangle} title={t('wmsissue.notices.cappedTitle')}>
          <p>
            {t('wmsissue.notices.cappedBody', { max: nOr(DEFAULT_LINE_MAX) })}
            {serverSummary?.slips != null && (
              <> {t('wmsissue.notices.cappedServer', { count: nOr(serverSummary.slips) })}</>
            )}
          </p>
        </Notice>
      )}

      {unslipped > 0 && (
        <Notice tone="warn" icon={AlertTriangle} title={t('wmsissue.notices.unslippedTitle')}>
          <p>{t('wmsissue.notices.unslippedBody', { count: nOr(unslipped) })}</p>
        </Notice>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--input-border)]" role="tablist" aria-label={t('wmsissue.tabs.label')}>
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
              <Icon size={15} aria-hidden="true" /> {t(`wmsissue.tabs.${tb.key}`)}
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
          expanded={expanded}
          expandedLines={expandedLines}
          expandLoading={expandLoading}
          expandError={expandError}
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
        <RaiseTab canWrite={canWrite} canIssue={canIssue} activeCountry={activeCountry} profileName={profileName} onSaved={load} />
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
  const { t } = useLanguage()
  const { money, nOr, txt } = useFmt()
  const columns = useMemo(() => [
    { id: 'country', header: t('wmsissue.country.country'), accessorFn: (c) => txt(c.country), cell: ({ row }) => <span className="text-[var(--text-primary)]">{txt(row.original.country)}</span> },
    { id: 'slips', header: t('wmsissue.country.slips'), accessorFn: (c) => c.slips, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.slips) },
    { id: 'lines', header: t('wmsissue.country.lines'), accessorFn: (c) => c.lines, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.lines) },
    {
      id: 'value', header: t('wmsissue.country.valueBooked'), accessorFn: (c) => c.bookedValue ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{money(row.original.bookedValue, row.original.currency)}</span>,
    },
    { id: 'mis', header: t('wmsissue.country.issues'), accessorFn: (c) => c.mis?.slips ?? 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.mis?.slips) },
    { id: 'mrt', header: t('wmsissue.country.returns'), accessorFn: (c) => c.mrt?.slips ?? 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.mrt?.slips) },
  ], [t, money, nOr, txt])
  if (summary.byCountry.length <= 1) return null
  return (
    <Card>
      <CardHeader
        icon={Layers}
        title={t('wmsissue.country.title')}
        description={t('wmsissue.country.description')}
      />
      <EnterpriseTable
        columns={columns}
        data={summary.byCountry}
        getRowId={(c) => String(c.country)}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        emptyMessage={t('wmsissue.country.empty')}
      />
    </Card>
  )
}

function DocBadge({ slip }) {
  const { t } = useLanguage()
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
      !slip.docTypeKnown
        ? 'border-[var(--input-border)] text-[var(--text-muted)]'
        : isReturn(slip.docType)
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
    }`}>
      {slip.docTypeKnown ? docLabel(t, slip.docType) : t('wmsissue.doc.unreadable')}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Tab 1 - the register                                                *
 * ------------------------------------------------------------------ */
function RegisterTab({
  loading, slips, filtered, summary, singleCurrency,
  expanded, expandedLines, expandLoading, expandError, toggleExpand,
  onExcel, onPdf, onLinesExcel,
}) {
  const { t } = useLanguage()
  const { money, nOr, pctOr, txt } = useFmt()
  const booked = headlineValue(summary, singleCurrency)
  const valueLabel = singleCurrency ? money(booked, singleCurrency) : t('wmsissue.common.perCountry')
  const openSlip = useMemo(() => filtered.find((s) => s.key === expanded) || null, [filtered, expanded])

  const columns = useMemo(() => [
    {
      id: 'open', header: '', enableSorting: false, size: 36, meta: { export: false },
      cell: ({ row }) => (expanded === row.original.key
        ? <ChevronDown size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
        : <ChevronRight size={14} className="text-[var(--text-muted)] rtl-flip" aria-hidden="true" />),
    },
    { id: 'slip', header: t('wmsissue.cols.slipNo'), accessorFn: (s) => txt(s.issueNumber), cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]" dir="ltr">{txt(row.original.issueNumber)}</span> },
    { id: 'doc', header: t('wmsissue.cols.document'), accessorFn: (s) => (s.docTypeKnown ? docLabel(t, s.docType) : t('wmsissue.doc.unreadable')), cell: ({ row }) => <DocBadge slip={row.original} /> },
    { id: 'date', header: t('wmsissue.cols.date'), accessorFn: (s) => s.date || '', cell: ({ row }) => txt(row.original.date) },
    {
      id: 'job', header: t('wmsissue.cols.jobCard'), accessorFn: (s) => txt(s.workOrderNo),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-[var(--text-secondary)]">
          <span dir="ltr">{txt(row.original.workOrderNo)}</span>
          {row.original.workOrderCount > 1 && <span className="ms-1 text-amber-300" dir="ltr">(+{row.original.workOrderCount - 1})</span>}
        </span>
      ),
    },
    { id: 'asset', header: t('wmsissue.cols.asset'), accessorFn: (s) => txt(s.assetCode) },
    { id: 'store', header: t('wmsissue.cols.store'), accessorFn: (s) => txt(s.storeCode) },
    { id: 'lines', header: t('wmsissue.cols.lines'), accessorFn: (s) => s.lineCount ?? 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.lineCount) },
    {
      id: 'value', header: t('wmsissue.cols.value'), accessorFn: (s) => s.bookedValue ?? -1, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`font-medium ${row.original.returnSignAnomaly ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
          {money(row.original.bookedValue, row.original.currency)}
        </span>
      ),
    },
  ], [expanded, t, money, nOr, txt])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label={t('wmsissue.register.slips')} value={loading ? '-' : nOr(summary.slips)} icon={Receipt}
          sub={t('wmsissue.register.slipsSub', { issues: nOr(summary.docTypeSplit.MIS), returns: nOr(summary.docTypeSplit.MRT) })} />
        <StatTile label={t('wmsissue.register.lines')} value={loading ? '-' : nOr(summary.lines)} icon={ClipboardList}
          sub={summary.avgLinesPerSlip == null ? t('wmsissue.register.notMeasurable') : t('wmsissue.register.perSlip', { count: nOr(summary.avgLinesPerSlip, 1) })} />
        <StatTile label={t('wmsissue.register.valueBooked')} value={loading ? '-' : valueLabel} icon={Store}
          sub={singleCurrency ? t('wmsissue.register.inCountryCurrency') : t('wmsissue.register.shownPerCountry')} />
        <StatTile label={t('wmsissue.register.linked')} value={loading ? '-' : pctOr(summary.linkageRate)} icon={Link2}
          sub={summary.linkageRate == null ? t('wmsissue.register.noSlipsToMeasure') : t('wmsissue.register.linkedOf', { linked: nOr(summary.linkedSlips), total: nOr(summary.slips) })} />
        <StatTile
          label={t('wmsissue.register.returnsCharged')}
          value={loading ? '-' : nOr(summary.returnSignAnomalies)}
          icon={AlertTriangle}
          tone={summary.returnSignAnomalies > 0 ? 'warn' : 'neutral'}
          sub={summary.returnSignAnomalies > 0 ? t('wmsissue.register.seeReturns') : t('wmsissue.register.noneInWindow')}
        />
      </div>

      <CountryMoney summary={summary} />

      <Card>
        {/* Two export buttons only, so `actions` (flex-shrink-0, cannot wrap) is
            the right slot; a wider control group would need its own row. */}
        <CardHeader
          icon={ClipboardList}
          title={t('wmsissue.register.title')}
          description={t('wmsissue.register.shown', { shown: nOr(filtered.length), total: nOr(slips.length) })}
          actions={
            <>
              <button onClick={onExcel} disabled={filtered.length === 0} className={btnCls}>
                <FileSpreadsheet size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}
              </button>
              <button onClick={onPdf} disabled={filtered.length === 0} className={btnCls}>
                <FileText size={14} aria-hidden="true" /> {t('wmsissue.common.pdf')}
              </button>
            </>
          }
        />

        {/* The page filters above drive this table (and the tiles), so the
            table's own search stays off: two searches would let the rows and
            the headline figures describe different populations. */}
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(s) => String(s.key)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={50}
          pageSizeOptions={[25, 50, 100]}
          onRowClick={toggleExpand}
          emptyMessage={slips.length === 0 ? t('wmsissue.register.empty') : t('wmsissue.register.noMatch')}
        />
      </Card>

      {openSlip && (
        <SlipLines
          slip={openSlip}
          lines={expandedLines}
          linesLoading={expandLoading}
          linesError={expandError}
          onClose={() => toggleExpand(openSlip)}
          onLinesExcel={onLinesExcel}
        />
      )}
    </div>
  )
}

function SlipLines({ slip, lines, linesLoading, linesError, onClose, onLinesExcel }) {
  const { t } = useLanguage()
  const { money, nOr, txt } = useFmt()
  const rows = useMemo(() => slipLineRows(lines, slip.currency), [lines, slip.currency])
  const columns = useMemo(() => [
    { id: 'code', header: t('wmsissue.cols.itemCode'), accessorFn: (l) => txt(l.item_code), cell: ({ row }) => <span className="font-mono" dir="ltr">{txt(row.original.item_code)}</span> },
    { id: 'desc', header: t('wmsissue.cols.description'), accessorFn: (l) => txt(l.item_description) },
    { id: 'uom', header: t('wmsissue.cols.unit'), accessorFn: (l) => txt(l.uom) },
    { id: 'source', header: t('wmsissue.cols.importSource'), accessorFn: (l) => txt(l.source_system) },
    { id: 'sourceRow', header: t('wmsissue.cols.sourceRow'), accessorFn: (l) => txt(l.source_row) },
    { id: 'qty', header: t('wmsissue.cols.qty'), accessorFn: (l) => Number(l.qty) || 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.qty, 2) },
    {
      id: 'unit', header: t('wmsissue.cols.unitCost'), accessorFn: (l) => l.unit_cost ?? -1, meta: { align: 'right' },
      cell: ({ row }) => (row.original.unit_cost == null ? t('wmsissue.common.na') : money(row.original.unit_cost, row.original.currency)),
    },
    {
      id: 'value', header: t('wmsissue.cols.value'), accessorFn: (l) => l.line_cost ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-[var(--text-primary)]">{money(row.original.line_cost, row.original.currency)}</span>,
    },
  ], [t, money, nOr, txt])

  return (
    <Card>
      <CardHeader
        icon={Hash}
        title={t('wmsissue.slip.title', { number: txt(slip.issueNumber) })}
        description={linesLoading ? t('wmsissue.slip.loading') : t(rows.length === 1 ? 'wmsissue.slip.itemsOne' : 'wmsissue.slip.items', { count: nOr(rows.length) })}
        actions={
          <>
            <button
              className={btnCls}
              disabled={rows.length === 0}
              onClick={() => onLinesExcel(lines, `Material Issue ${slip.issueNumber}`)}
            >
              <FileSpreadsheet size={13} aria-hidden="true" /> {t('wmsissue.slip.itemsExport')}
            </button>
            <button className={btnCls} onClick={onClose} aria-label={t('wmsissue.slip.closeAria')}><X size={13} aria-hidden="true" /> {t('wmsissue.common.close')}</button>
          </>
        }
      />
      {linesError && (
        <p role="alert" className="text-[11px] text-red-400 mb-2">{linesError}</p>
      )}
      {slip.returnSignAnomaly && (
        <p className="text-[11px] text-amber-300 mb-2">{t('wmsissue.slip.returnCharged')}</p>
      )}
      <EnterpriseTable
        columns={columns}
        data={rows}
        getRowId={(l) => l.rowKey}
        loading={linesLoading}
        enableColumnFilters={false}
        enableExport={false}
        searchPlaceholder={t('wmsissue.slip.searchPlaceholder')}
        emptyMessage={linesError ? t('wmsissue.slip.linesUnreadable') : t('wmsissue.slip.noLines')}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Tab 2 - returns, and the integrity finding                          *
 * ------------------------------------------------------------------ */
function ReturnsTab({ loading, returns, summary, singleCurrency, onExcel, onPdf }) {
  const { t } = useLanguage()
  const { money, nOr, txt } = useFmt()
  const anomalies = summary.returnSignAnomalies
  const flagText = useCallback((s) => (returnFlag(s).anomaly ? t('wmsissue.returns.flagCharged') : t('wmsissue.returns.flagCredited')), [t])
  const columns = useMemo(() => [
    { id: 'slip', header: t('wmsissue.cols.slipNo'), accessorFn: (s) => txt(s.issueNumber), cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]" dir="ltr">{txt(row.original.issueNumber)}</span> },
    { id: 'date', header: t('wmsissue.cols.date'), accessorFn: (s) => s.date || '', cell: ({ row }) => txt(row.original.date) },
    { id: 'job', header: t('wmsissue.cols.jobCard'), accessorFn: (s) => txt(s.workOrderNo), cell: ({ row }) => <span className="font-mono text-xs" dir="ltr">{txt(row.original.workOrderNo)}</span> },
    { id: 'asset', header: t('wmsissue.cols.asset'), accessorFn: (s) => txt(s.assetCode) },
    { id: 'store', header: t('wmsissue.cols.store'), accessorFn: (s) => txt(s.storeCode) },
    { id: 'lines', header: t('wmsissue.cols.lines'), accessorFn: (s) => s.lineCount ?? 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.lineCount) },
    {
      id: 'booked', header: t('wmsissue.cols.asBooked'), accessorFn: (s) => s.bookedValue ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{money(row.original.bookedValue, row.original.currency)}</span>,
    },
    {
      id: 'credited', header: t('wmsissue.cols.ifCredited'), accessorFn: (s) => s.creditedValue ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-amber-300">{money(row.original.creditedValue, row.original.currency)}</span>,
    },
    {
      id: 'flag', header: t('wmsissue.cols.flag'), accessorFn: (s) => flagText(s),
      cell: ({ row }) => {
        const f = returnFlag(row.original)
        return <span className={`text-[11px] ${f.anomaly ? 'text-amber-300' : 'text-[var(--text-muted)]'}`}>{flagText(row.original)}</span>
      },
    },
  ], [t, money, nOr, txt, flagText])

  return (
    <div className="space-y-4">
      <Notice
        tone={anomalies > 0 ? 'warn' : 'info'}
        icon={anomalies > 0 ? AlertTriangle : Info}
        title={t('wmsissue.returns.noticeTitle')}
      >
        <p>{t('wmsissue.returns.noticeBody1')}</p>
        <p>
          <strong className="text-[var(--text-secondary)]">{t('wmsissue.returns.nothingChanged')}</strong>{' '}
          {t('wmsissue.returns.noticeBody2')}
        </p>
      </Notice>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label={t('wmsissue.returns.slips')} value={loading ? '-' : nOr(summary.slips)} icon={Undo2} />
        <StatTile label={t('wmsissue.returns.lines')} value={loading ? '-' : nOr(summary.lines)} icon={ClipboardList} />
        <StatTile
          label={t('wmsissue.returns.valueBooked')}
          value={loading ? '-' : (singleCurrency
            ? money(headlineValue(summary, singleCurrency), singleCurrency)
            : t('wmsissue.common.perCountry'))}
          icon={Store}
          sub={t('wmsissue.returns.valueBookedSub')}
        />
        <StatTile
          label={t('wmsissue.returns.valueCredited')}
          value={loading ? '-' : (singleCurrency
            ? money(headlineValue(summary, singleCurrency, 'creditedValue'), singleCurrency)
            : t('wmsissue.common.perCountry'))}
          icon={Undo2}
          tone="warn"
          sub={t('wmsissue.returns.valueCreditedSub')}
        />
      </div>

      <CountryMoney summary={summary} />

      <Card>
        <CardHeader
          icon={Undo2}
          title={t('wmsissue.returns.title')}
          description={t('wmsissue.common.shown', { count: nOr(returns.length) })}
          actions={
            <>
              <button onClick={onExcel} disabled={returns.length === 0} className={btnCls}>
                <FileSpreadsheet size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}
              </button>
              <button onClick={onPdf} disabled={returns.length === 0} className={btnCls}>
                <FileText size={14} aria-hidden="true" /> {t('wmsissue.common.pdf')}
              </button>
            </>
          }
        />

        <EnterpriseTable
          columns={columns}
          data={returns}
          getRowId={(r) => String(r.key)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={t('wmsissue.returns.empty')}
        />
      </Card>
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
  item_code: '', item_description: '', qty: '', uom: '', unit_cost: '', category: '', query: '', stock_id: '',
}

function RaiseTab({ canWrite: canWriteBase, canIssue = false, activeCountry, profileName, onSaved }) {
  const { t } = useLanguage()
  const { money, nOr, txt } = useFmt()
  const [provisioned, setProvisioned] = useState(null) // null = checking
  // null = not known yet; true once inv_issue_slip exists (WP5). Until then a slip
  // is a document only and the page says so.
  const [postingOn, setPostingOn] = useState(null)
  const [postResult, setPostResult] = useState(null)
  const [posting, setPosting] = useState(false)
  // { [lineIndex]: { loading, rows, error } } - the stock lines a line can come from
  const [stockFor, setStockFor] = useState({})
  const canWrite = canWriteBase || (postingOn === true && canIssue)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(null)
  const [recent, setRecent] = useState([])
  const [recentError, setRecentError] = useState('')
  const [jobsError, setJobsError] = useState('')

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
  const [itemsError, setItemsError] = useState('')

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
        const canPost = await issueSlipPostingAvailable()
        if (alive) setPostingOn(canPost)
        try {
          const res = await listMaterialIssues({ country: activeCountry, limit: 50 })
          if (alive) { setRecent(res.rows); setRecentError('') }
        } catch (err) {
          if (alive) { setRecent([]); setRecentError(toUserMessage(err, t('wmsissue.raise.recentError'))) }
        }
      }
      setChecking(false)
    })()
    return () => { alive = false }
    // t is read only for the error fallback; a language switch must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry])

  // Job card picker - debounced so a keystroke is not a query.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      try {
        setJobs(await listIssuableJobCards({ country: header.country || activeCountry, search: jobSearch }))
        setJobsError('')
      } catch (err) {
        // A failed lookup must not read as "No job card matches that".
        setJobs([])
        setJobsError(toUserMessage(err, t('wmsissue.raise.jobsError')))
      }
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setLine(idx, { query: term, item_code: '', item_description: '', stock_id: '' })
    setItemsFor(idx)
    if (itemTimer.current) clearTimeout(itemTimer.current)
    setItemsError('')
    if (!header.country || !term.trim()) { setItems([]); return }
    itemTimer.current = setTimeout(async () => {
      try {
        const rows = await listMaterials({ country: header.country, search: term, limit: 25 })
        setItemsError('')
        setItems(rows)
      } catch (err) {
        // A failed lookup must not read as "No item in the master matches that".
        setItems([])
        setItemsError(toUserMessage(err, t('wmsissue.raise.itemsError')))
      }
    }, 300)
  }, [header.country, t])

  useEffect(() => () => { if (itemTimer.current) clearTimeout(itemTimer.current) }, [])
  const addLine = () => setLines((ls) => [...ls, { ...EMPTY_LINE }])
  const removeLine = (i) => setLines((ls) => (ls.length === 1 ? [{ ...EMPTY_LINE }] : ls.filter((_, k) => k !== i)))

  const check = useMemo(
    () => validateDraftIssue(header, lines, { posting: postingOn === true }),
    [header, lines, postingOn],
  )

  // Posting mode: load the stock lines each item can come from (slip site, item
  // code) and pre-select the obvious one. Re-runs when the site, document type
  // or an item changes; quantities change the pick but not the read.
  const stockKey = postingOn === true
    ? `${header.country}|${header.site}|${lines.map((l) => l.item_code || '').join(',')}`
    : ''
  useEffect(() => {
    if (!stockKey) return undefined
    let alive = true
    lines.forEach((l, i) => {
      if (!l.item_code) return
      setStockFor((m) => ({ ...m, [i]: { loading: true, rows: m[i]?.rows || [], error: '' } }))
      listSlipStockLines({ country: header.country, site: header.site, itemCode: l.item_code })
        .then((rows) => {
          if (!alive) return
          setStockFor((m) => ({ ...m, [i]: { loading: false, rows, error: '' } }))
          setLines((ls) => ls.map((x, k) => {
            if (k !== i || x.item_code !== l.item_code) return x
            const still = x.stock_id && rows.some((r) => r.id === x.stock_id)
            if (still) return x
            const pick = pickSlipStockLine(rows, { site: header.site, itemCode: x.item_code, qty: x.qty, docType: header.doc_type })
            return { ...x, stock_id: pick ? pick.id : '' }
          }))
        })
        .catch((err) => {
          if (!alive) return
          setStockFor((m) => ({ ...m, [i]: { loading: false, rows: [], error: toUserMessage(err, t('wmsissue.raise.stockError')) } }))
        })
    })
    return () => { alive = false }
    // lines is read through stockKey on purpose: typing a quantity must not re-read stock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockKey, header.doc_type])

  const postSlip = async (slipId) => {
    setPosting(true)
    try {
      const res = await postMaterialIssueSlip(slipId)
      if (res.reason === 'not_available') setPostingOn(false)
      setPostResult({ ...slipPostingSummary(res), ...postingText(t, res), slipId, ok: res.ok })
      return res
    } finally {
      setPosting(false)
    }
  }
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
          ? t('wmsissue.raise.notEnabledTitle')
          : t('wmsissue.raise.saveError'))
        return
      }
      setSaved(res.issue_number || t('wmsissue.raise.savedFallback'))
      setPostResult(null)
      // Saving and posting are two calls; a refused posting leaves a saved slip
      // that can be posted again once corrected (the post is idempotent).
      if (postingOn === true && res.id) await postSlip(res.id)
      setLines([{ ...EMPTY_LINE }])
      setStockFor({})
      setHeader((h) => ({ ...h, work_order_no: '', asset_no: '', notes: '' }))
      if (onSaved) onSaved()
      try {
        const rows = await listMaterialIssues({ country: activeCountry, limit: 50 })
        setRecent(rows.rows)
        setRecentError('')
      } catch (err) {
        // The slip IS saved; only the refresh of the list below failed.
        setRecentError(toUserMessage(err, t('wmsissue.raise.recentError')))
      }
    } catch (err) {
      setSaveError(toUserMessage(err, t('wmsissue.raise.saveError')))
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      // Row direction in `style`: Card is flex-col and Tailwind's .flex-col is
      // emitted after .flex-row, so a class could not win here.
      <Card className="items-center gap-[var(--space-2)] text-[var(--text-muted)] text-sm" style={{ flexDirection: 'row' }}>
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> {t('wmsissue.raise.checking')}
      </Card>
    )
  }

  if (!provisioned) {
    return (
      <Notice tone="warn" icon={Ban} title={t('wmsissue.raise.notEnabledTitle')}>
        <p>{t('wmsissue.raise.notEnabledBody')}</p>
        <p>{t('wmsissue.raise.notEnabledAction')}</p>
      </Notice>
    )
  }

  if (!canWrite) {
    return (
      <Notice tone="info" icon={Ban} title={t('wmsissue.raise.readOnlyTitle')}>
        <p>{postingOn === true ? t('wmsissue.raise.readOnlyRolesIssue') : t('wmsissue.raise.readOnlyRoles')}</p>
        <p>{t('wmsissue.raise.readOnlyHint')}</p>
      </Notice>
    )
  }

  return (
    <div className="space-y-4">
      {saved && (
        <Notice tone="info" icon={Check} title={t('wmsissue.raise.savedTitle')}>
          <p>{t('wmsissue.raise.savedPrefix')} <span className="font-mono" dir="ltr">{txt(saved)}</span> {t('wmsissue.raise.savedSuffix')}</p>
        </Notice>
      )}
      {postResult && (
        <Notice
          tone={postResult.tone}
          icon={postResult.tone === 'info' ? Check : AlertTriangle}
          title={postResult.title}
          action={!postResult.ok && postResult.slipId && postingOn === true ? (
            <button type="button" className={btnCls} disabled={posting} onClick={() => postSlip(postResult.slipId)}>
              {posting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />} {t('wmsissue.raise.postAgain')}
            </button>
          ) : null}
        >
          <p>{postResult.detail}</p>
        </Notice>
      )}
      {saveError && (
        <Notice tone="error" icon={AlertTriangle} title={t('wmsissue.raise.saveError')}>
          <p>{saveError}</p>
        </Notice>
      )}

      {/* Slip details. No `clip`: the job-card and item pickers below render a
          real in-flow results list inside this card, and the country/document
          controls are native <select>, so nothing here wants cropping. */}
      <Card>
        <CardHeader
          title={t('wmsissue.raise.detailsTitle')}
          description={postingOn === true ? t('wmsissue.raise.detailsPosting') : t('wmsissue.raise.detailsDocument')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.raise.docType')}</span>
            <select
              value={header.doc_type}
              onChange={(e) => setHeader((h) => ({ ...h, doc_type: e.target.value }))}
              className={inputCls}
            >
              {DOC_TYPE_KEYS.map((k) => <option key={k} value={k}>{docLabel(t, k)}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.raise.country')}</span>
            <select
              value={header.country}
              onChange={(e) => setHeader((h) => ({ ...h, country: e.target.value }))}
              className={inputCls}
            >
              <option value="">{t('wmsissue.raise.pickCountry')}</option>
              {['KSA', 'UAE', 'Egypt'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.raise.store')}</span>
            <input
              value={header.store_code}
              onChange={(e) => setHeader((h) => ({ ...h, store_code: e.target.value }))}
              className={inputCls}
              placeholder={t('wmsissue.raise.storePlaceholder')}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.raise.issuedTo')}</span>
            <input
              value={header.issued_to}
              onChange={(e) => setHeader((h) => ({ ...h, issued_to: e.target.value }))}
              className={inputCls}
              placeholder={t('wmsissue.raise.issuedToPlaceholder')}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1 lg:col-span-2">
            <span>{t('wmsissue.raise.jobCard')}</span>
            <div className="relative">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                value={header.work_order_no || jobSearch}
                onChange={(e) => {
                  setJobSearch(e.target.value)
                  setHeader((h) => ({ ...h, work_order_no: '' }))
                }}
                className={`${inputCls} ps-9`}
                placeholder={t('wmsissue.raise.jobSearchPlaceholder')}
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
                    className="w-full text-start px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
                  >
                    <span className="font-mono" dir="ltr">{txt(j.work_order_no)}</span>
                    <span className="text-[var(--text-muted)]"> - {txt(j.asset_no)} - {txt(j.site)}</span>
                  </button>
                ))}
              </div>
            )}
            {jobsError && (
              <p role="alert" className="text-[11px] text-red-400 mt-1">{jobsError}</p>
            )}
            {!header.work_order_no && jobSearch && !jobsError && jobs.length === 0 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1">{t('wmsissue.raise.noJobMatch')}</p>
            )}
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.raise.asset')}</span>
            <input
              value={header.asset_no}
              onChange={(e) => setHeader((h) => ({ ...h, asset_no: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>{t('wmsissue.raise.site')}</span>
            <input
              value={header.site}
              onChange={(e) => setHeader((h) => ({ ...h, site: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1 lg:col-span-4">
            <span>{t('wmsissue.raise.notes')}</span>
            <input
              value={header.notes}
              onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))}
              className={inputCls}
              placeholder={t('wmsissue.raise.optional')}
            />
          </label>
        </div>
      </Card>

      <Card className="gap-[var(--space-3)]">
        <CardHeader
          className="!mb-0"
          icon={Layers}
          title={t('wmsissue.raise.itemsTitle')}
          actions={<button onClick={addLine} className={btnCls}><Plus size={13} aria-hidden="true" /> {t('wmsissue.raise.addItem')}</button>}
        />

        {!header.country && (
          <p className="text-xs text-[var(--text-muted)]">{t('wmsissue.raise.pickCountryFirst')}</p>
        )}

        <div className="space-y-3">
          {lines.map((l, i) => {
            const v = draftLineValue(l)
            return (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                <div className="sm:col-span-4 space-y-1">
                  <div className="relative">
                    <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                    <input
                      value={l.item_code || l.query || ''}
                      onChange={(e) => searchItems(i, e.target.value)}
                      className={`${inputCls} ps-9`}
                      aria-label={t('wmsissue.raise.itemAria', { n: i + 1 })}
                      placeholder={t('wmsissue.raise.itemPlaceholder')}
                      disabled={!header.country}
                    />
                  </div>
                  {itemsFor === i && !l.item_code && l.query && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]">
                      {itemsError ? (
                        <p role="alert" className="px-3 py-2 text-[11px] text-red-400">
                          {itemsError}
                        </p>
                      ) : items.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-[var(--text-muted)]">{t('wmsissue.raise.noItemMatch')}</p>
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
                              stock_id: '',
                            })
                            setItemsFor(null)
                          }}
                          className="w-full text-start px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
                        >
                          <span className="font-mono" dir="ltr">{txt(m.item_code)}</span>
                          <span className="text-[var(--text-muted)]"> - {txt(m.item_name)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {l.item_description && (
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{l.item_description}</p>
                  )}
                  {postingOn === true && l.item_code && (() => {
                    const st = stockFor[i] || { loading: true, rows: [], error: '' }
                    const opts = slipStockOptions(st.rows, { site: header.site, itemCode: l.item_code })
                    if (st.error) return <p role="alert" className="text-[11px] text-red-400">{st.error}</p>
                    if (st.loading && opts.length === 0) return <p className="text-[11px] text-[var(--text-muted)]">{t('wmsissue.raise.readingStock')}</p>
                    if (opts.length === 0) {
                      return (
                        <p className="text-[11px] text-amber-300">
                          {header.site ? t('wmsissue.raise.noStockLineAt', { site: header.site }) : t('wmsissue.raise.noStockLine')}
                        </p>
                      )
                    }
                    return (
                      <select
                        aria-label={t('wmsissue.raise.stockLineAria', { n: i + 1 })}
                        value={l.stock_id || ''}
                        onChange={(e) => setLine(i, { stock_id: e.target.value })}
                        className={inputCls}
                      >
                        <option value="">{t('wmsissue.raise.chooseStockLine')}</option>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {t('wmsissue.raise.stockLineOption', { location: txt(o.location_code), condition: txt(o.condition), free: o.available == null ? t('wmsissue.common.na') : nOr(o.available) })}
                          </option>
                        ))}
                      </select>
                    )
                  })()}
                </div>
                <input
                  className={`${inputCls} sm:col-span-2`}
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                  aria-label={t('wmsissue.raise.qtyAria', { n: i + 1 })}
                  placeholder={t('wmsissue.raise.qty')}
                  inputMode="decimal"
                />
                <input
                  className={`${inputCls} sm:col-span-2`}
                  value={l.uom}
                  onChange={(e) => setLine(i, { uom: e.target.value })}
                  aria-label={t('wmsissue.raise.uomAria', { n: i + 1 })}
                  placeholder={t('wmsissue.raise.uom')}
                />
                <input
                  className={`${inputCls} sm:col-span-2`}
                  value={l.unit_cost}
                  onChange={(e) => setLine(i, { unit_cost: e.target.value })}
                  aria-label={t('wmsissue.raise.unitCostAria', { n: i + 1 })}
                  placeholder={t('wmsissue.raise.unitCost')}
                  inputMode="decimal"
                />
                <div className="sm:col-span-1 text-sm text-[var(--text-primary)] py-2 text-end">
                  {v == null ? <span className="text-[var(--text-muted)] text-xs">{t('wmsissue.raise.unpriced')}</span> : money(v, currency)}
                </div>
                <button
                  onClick={() => removeLine(i)}
                  className="sm:col-span-1 inline-flex items-center justify-center py-2 text-[var(--text-muted)] hover:text-red-400"
                  aria-label={t('wmsissue.raise.removeAria', { n: i + 1 })}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 flex-wrap border-t border-[var(--input-border)] pt-3">
          <div className="text-sm">
            <span className="text-[var(--text-muted)] text-xs">{t('wmsissue.raise.slipTotal')} </span>
            <span className="font-bold text-[var(--text-primary)]">
              {check.total == null ? t('wmsissue.raise.notAvailable') : money(check.total, currency)}
            </span>
            {check.unpricedLines > 0 && (
              <span className="text-[11px] text-[var(--text-muted)] ms-2">
                {t('wmsissue.raise.unpricedNote', { count: nOr(check.unpricedLines), priced: money(check.pricedTotal, currency) })}
              </span>
            )}
          </div>
          <button
            onClick={save}
            disabled={!check.ok || saving}
            className="ms-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
            {t('wmsissue.raise.saveSlip')}
          </button>
        </div>

        {!check.ok && (
          <ul className="text-[11px] text-amber-300 space-y-0.5 list-disc list-inside">
            {check.errors.map((e) => <li key={e}>{checkErrorText(t, e)}</li>)}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={Hash}
          title={t('wmsissue.raise.recentTitle')}
          description={t('wmsissue.common.shown', { count: nOr(recent.length) })}
        />
        {recentError && (
          <p role="alert" className="text-[11px] text-red-400 mb-2">{recentError}</p>
        )}
        <RecentSlips recent={recent} />
      </Card>
    </div>
  )
}

/** Slips raised in this app (V609), through the shared table. */
function RecentSlips({ recent }) {
  const { t } = useLanguage()
  const { txt } = useFmt()
  const rows = useMemo(() => recentSlipRows(recent), [recent])
  const columns = useMemo(() => {
    const docText = (label) => (DOC_LABEL_KEY[label] ? t(`wmsissue.doc.${DOC_LABEL_KEY[label]}`) : label)
    const statusText = (label) => (STATUS_LABEL_KEY[label] ? t(`wmsissue.status.${STATUS_LABEL_KEY[label]}`) : label)
    return [
      { id: 'slip', header: t('wmsissue.cols.slipNo'), accessorFn: (r) => txt(r.issueNumber), cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]" dir="ltr">{txt(row.original.issueNumber)}</span> },
      { id: 'doc', header: t('wmsissue.cols.document'), accessorFn: (r) => docText(r.docType) },
      { id: 'job', header: t('wmsissue.cols.jobCard'), accessorFn: (r) => txt(r.workOrderNo), cell: ({ row }) => <span className="font-mono text-xs" dir="ltr">{txt(row.original.workOrderNo)}</span> },
      { id: 'asset', header: t('wmsissue.cols.asset'), accessorFn: (r) => txt(r.assetNo) },
      { id: 'issued', header: t('wmsissue.cols.issued'), accessorFn: (r) => r.issuedDay || '', cell: ({ row }) => txt(row.original.issuedDay) },
      { id: 'status', header: t('wmsissue.cols.status'), accessorFn: (r) => statusText(r.status) },
    ]
  }, [t, txt])
  return (
    <EnterpriseTable
      columns={columns}
      data={rows}
      getRowId={(r) => String(r.id)}
      enableColumnFilters={false}
      enableExport={false}
      searchPlaceholder={t('wmsissue.raise.recentSearch')}
      emptyMessage={t('wmsissue.raise.recentEmpty')}
    />
  )
}

/* ------------------------------------------------------------------ *
 * Tab 4 - analytics                                                   *
 * ------------------------------------------------------------------ */
function AnalyticsTab({ loading, filtered, summary, singleCurrency, onExcel, onPdf }) {
  const { t } = useLanguage()
  const { money, nOr, txt } = useFmt()
  const trend = useMemo(() => monthlyIssueTrend(filtered), [filtered])
  const country = summary.byCountry[0]
  // A mixed scope shows the category split for ONE country's currency (the same
  // country the store chart uses); summing SAR, AED and EGP would be meaningless.
  const shareCurrency = summary.byCountry.length > 1 ? (country?.currency || null) : null
  const categories = useMemo(
    () => categoryShare(filtered, { currency: shareCurrency }),
    [filtered, shareCurrency],
  )
  // Memoised so the fallback `[]` is not a new array identity on every render,
  // which would re-build the chart option (and re-render the chart) each time.
  const topStores = useMemo(() => country?.topStores || [], [country])
  const topItems = useMemo(() => topItemRows(country?.topItems), [country])
  const itemColumns = useMemo(() => [
    {
      id: 'item', header: t('wmsissue.cols.item'), accessorFn: (it) => `${txt(it.key)} ${it.description || ''}`,
      cell: ({ row }) => (
        <span>
          <span className="font-mono text-[var(--text-primary)]" dir="ltr">{txt(row.original.key)}</span>
          {row.original.description && <span className="text-[var(--text-muted)]"> - {row.original.description}</span>}
        </span>
      ),
    },
    { id: 'lines', header: t('wmsissue.cols.lines'), accessorFn: (it) => it.lines ?? 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.lines) },
    { id: 'qty', header: t('wmsissue.cols.qty'), accessorFn: (it) => Number(it.qty) || 0, meta: { align: 'right' }, cell: ({ row }) => nOr(row.original.qty, 2) },
    {
      id: 'value', header: t('wmsissue.cols.value'), accessorFn: (it) => it.value ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-[var(--text-primary)]">{money(row.original.value, country?.currency)}</span>,
    },
  ], [country, t, money, nOr, txt])

  const trendOption = useMemo(() => {
    const months = trend.map((p) => p.month)
    const hasMoney = trend.some((p) => p.value != null)
    return baseOption({
      legend: { textStyle: { color: 'var(--text-muted)' }, top: 0 },
      xAxis: { type: 'category', data: months, axisLabel: { color: 'var(--text-muted)' } },
      yAxis: [
        { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
        { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { show: false } },
      ],
      series: [
        {
          name: t('wmsissue.analytics.slips'), type: 'bar', data: trend.map((p) => p.slips),
          itemStyle: { color: withAlpha(colorAt(0), 0.85) },
        },
        ...(hasMoney ? [{
          name: t('wmsissue.analytics.valueSeries', { currency: singleCurrency || t('wmsissue.analytics.perCountryLower') }),
          type: 'line', yAxisIndex: 1, smooth: true,
          data: trend.map((p) => p.value),
          itemStyle: { color: colorAt(1) }, lineStyle: { color: colorAt(1), width: 2 },
        }] : []),
      ],
    })
  }, [trend, singleCurrency, t])

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
    const data = categories.data.map((d) => ({ ...d, name: CATEGORY_NAME_KEY[d.name] ? t(`wmsissue.analytics.cat.${CATEGORY_NAME_KEY[d.name]}`) : d.name }))
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
  }, [categories, t])

  const docOption = useMemo(() => {
    const data = docTypeShare(summary.docTypeSplit).map((d) => ({ ...d, name: DOC_SHARE_KEY[d.name] ? t(`wmsissue.analytics.share.${DOC_SHARE_KEY[d.name]}`) : d.name }))
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: 'var(--text-muted)' } },
      series: [{
        type: 'pie', radius: ['45%', '70%'], data,
        label: { color: 'var(--text-secondary)' },
        color: categorical(Math.max(1, data.length)),
      }],
    }
  }, [summary.docTypeSplit, t])

  const bucketsUnavailable = categories.unavailable

  return (
    <div className="space-y-4">
      {summary.mixedCurrency && (
        <Notice tone="warn" icon={AlertTriangle} title={t('wmsissue.analytics.mixedTitle')}>
          <p>{t('wmsissue.analytics.mixedBody')}</p>
        </Notice>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button onClick={onExcel} disabled={filtered.length === 0} className={btnCls}>
          <FileSpreadsheet size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}
        </button>
        <button onClick={onPdf} disabled={filtered.length === 0} className={btnCls}>
          <FileText size={14} aria-hidden="true" /> {t('wmsissue.common.pdf')}
        </button>
      </div>

      <Card>
        <CardHeader icon={TrendingUp} title={t('wmsissue.analytics.perMonth')} />
        <div className="h-[280px]">
          {loading ? <EmptyChart label={t('wmsissue.common.loading')} />
            : trend.length === 0 ? <EmptyChart />
              : <EChart option={trendOption} className="h-full" ariaLabel={t('wmsissue.analytics.perMonth')} />}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
        <Card>
          <CardHeader
            icon={BarChart3}
            title={t('wmsissue.analytics.byStore')}
            description={summary.byCountry.length > 1
              ? t('wmsissue.analytics.oneCountry', { country: txt(country?.country) })
              : undefined}
          />
          <div className="h-[260px]">
            {topStores.length === 0
              ? <EmptyChart label={t('wmsissue.analytics.noStore')} />
              : <EChart option={storeOption} className="h-full" ariaLabel={t('wmsissue.analytics.byStore')} />}
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={PieChart}
            title={t('wmsissue.analytics.byCategory')}
            description={shareCurrency ? t('wmsissue.analytics.oneCountry', { country: txt(country?.country) }) : t('wmsissue.analytics.categorySplit')}
          />
          <div className="h-[260px]">
            {bucketsUnavailable
              ? <EmptyChart label={t('wmsissue.analytics.noCategory')} />
              : <EChart option={bucketOption} className="h-full" ariaLabel={t('wmsissue.analytics.byCategoryAria')} />}
          </div>
        </Card>

        <Card>
          <CardHeader icon={PieChart} title={t('wmsissue.analytics.issuesVsReturns')} />
          <div className="h-[260px]">
            {summary.slips === 0
              ? <EmptyChart />
              : <EChart option={docOption} className="h-full" ariaLabel={t('wmsissue.analytics.issuesVsReturns')} />}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Layers} title={t('wmsissue.analytics.topItems')} />
          {topItems.length === 0 ? (
            <div className="h-[260px]"><EmptyChart label={t('wmsissue.analytics.noItems')} /></div>
          ) : (
            <EnterpriseTable
              columns={itemColumns}
              data={topItems}
              getRowId={(it) => it.rowKey}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              virtual
              maxHeight={260}
              emptyMessage={t('wmsissue.analytics.noItems')}
            />
          )}
        </Card>
      </div>
    </div>
  )
}
