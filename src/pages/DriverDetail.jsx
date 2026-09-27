import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, FileText, FileSpreadsheet, Lock, User, AlertTriangle,
  RefreshCw, Award, ShieldAlert, ClipboardList, StickyNote, Gauge, Search, X, Info,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  buildDriverView, performanceBadge, enrichRecords, filterRecords, optionList, breakdown, recordExport,
} from '../lib/driverDetailAnalytics'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

// ── Formatting helpers (display only; all maths lives in driverDetailAnalytics) ─
function fmtCpk(v, currency) {
  if (v == null || !isFinite(v) || v <= 0) return 'N/A'
  return `${currency} ${v.toFixed(4)}`
}

function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k km`
  return `${Math.round(v).toLocaleString()} km`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}

const BADGE_CLS = {
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  muted: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

function cpkColor(cpk) {
  if (cpk == null || !isFinite(cpk) || cpk <= 0) return 'text-[var(--text-muted)]'
  if (cpk <= 1.0) return 'text-green-400'
  if (cpk <= 2.0) return 'text-yellow-400'
  return 'text-red-400'
}

const RISK_CLS = {
  Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-green-400',
}

const PANEL = 'rounded-xl bg-[var(--surface-1)] border border-[var(--input-border)]'

// ── Tab definitions ─────────────────────────────────────────────────────────────
const TABS = [
  { key: 'profile',   labelKey: 'driver.detail.tabs.profile',   fallback: 'Profile',     icon: User },
  { key: 'performance', labelKey: 'driver.detail.tabs.performance', fallback: 'Performance', icon: Gauge },
  { key: 'incidents', labelKey: 'driver.detail.tabs.incidents', fallback: 'Incidents',   icon: ShieldAlert },
  { key: 'records',   labelKey: 'driver.detail.tabs.records',   fallback: 'Tyre Records', icon: ClipboardList },
  { key: 'notes',     labelKey: 'driver.detail.tabs.notes',     fallback: 'Notes',       icon: StickyNote },
]

// ── Stat tile ────────────────────────────────────────────────────────────────────
function StatTile({ label, value, accent, sub }) {
  return (
    <div className="rounded-lg p-3 bg-[var(--surface-1)] border border-[var(--input-border)]">
      <p className="text-[11px] text-[var(--text-muted)] mb-0.5">{label}</p>
      <p className={`text-base font-bold tabular-nums break-words ${accent || 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function DriverDetail() {
  const { driverId } = useParams()
  const navigate = useNavigate()
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()

  const driverName = useMemo(() => {
    try { return decodeURIComponent(driverId ?? '') } catch { return driverId ?? '' }
  }, [driverId])

  // Data state
  const [driver, setDriver] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [exportError, setExportError] = useState('')

  // Approval & Workflow Engine gate — mirrors the original drawer: while the
  // driver-violation approval is active (pending/in_review/returned) or locked
  // (approved) the formal disciplinary PDF export is disabled.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [driverName])

  // Guards against a slow earlier response overwriting a newer one.
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      // Fetch the whole fleet's records (respecting the active-country scope) so
      // the driver's fleet-relative rank & composite risk score match the
      // ranking table exactly, then narrow to this driver.
      // BOUNDED: tyre_records is a large table. Cap the fleet read at 20,000 with
      // a stable order tiebreak (a paged read without an ORDER can drop/repeat
      // rows at a page boundary) and note when the ceiling is hit, since the
      // fleet-relative rank is then computed over a partial fleet.
      const { data, error: err, truncated: tr } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select(
            'id,asset_no,asset_number,serial_no,brand,site,country,driver_name,driver_id,' +
            'cost_per_tyre,km_at_fitment,km_at_removal,risk_level,removal_reason,issue_date,category,qty'
          )
          .order('id')
        if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 20000 })
      if (myReq !== reqIdRef.current) return
      if (err) throw err
      setTruncated(!!tr)

      setDriver(buildDriverView(driverName, data || []))
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, 'Failed to load driver record'))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [activeCountry, driverName])

  useEffect(() => { load() }, [load])

  const enriched = useMemo(() => (driver ? enrichRecords(driver.records) : []), [driver])
  const brandOptions = useMemo(() => optionList(enriched, 'brand'), [enriched])
  const siteOptions = useMemo(() => optionList(enriched, 'site'), [enriched])
  const filtered = useMemo(
    () => filterRecords(enriched, { risk: riskFilter, brand: brandFilter, site: siteFilter, from: fromDate, to: toDate, search }),
    [enriched, riskFilter, brandFilter, siteFilter, fromDate, toDate, search],
  )
  const incidents = useMemo(() => filterRecords(enriched, { risk: 'high' }), [enriched])
  const notes = useMemo(() => enriched.filter((r) => r.removal_reason), [enriched])
  const brandMix = useMemo(() => breakdown(enriched, 'brand'), [enriched])
  const reasonMix = useMemo(() => breakdown(enriched.filter((r) => r.removal_reason), 'removal_reason'), [enriched])
  const hasFilters = !!(search || riskFilter || brandFilter || siteFilter || fromDate || toDate)
  const clearFilters = () => { setSearch(''); setRiskFilter(''); setBrandFilter(''); setSiteFilter(''); setFromDate(''); setToDate('') }

  // Exports cover the FILTERED record set (what the reader is looking at).
  async function runExport(format) {
    if (!driver) return
    if (format === 'pdf' && wfLocked) return
    setExportError('')
    const shaped = recordExport(filtered)
    const file = reportFileName('Driver History', driver.name)
    try {
      if (format === 'pdf') {
        await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), `Driver History: ${driver.name}`, file, 'landscape')
      } else {
        await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file, 'Driver History')
      }
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const recordColumns = useMemo(() => [
    { id: 'asset', header: t('driver.detail.cols.asset'), accessorFn: (r) => r._asset || '', size: 110, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original._asset || 'N/A'}</span> },
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || '', size: 130, cell: ({ row }) => <span className="font-mono text-xs">{row.original.serial_no || 'N/A'}</span> },
    { id: 'brand', header: t('driver.detail.cols.brand'), accessorFn: (r) => r.brand || 'N/A', size: 110 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'date', header: t('driver.detail.cols.date'), accessorFn: (r) => r._date || '', size: 110, cell: ({ row }) => row.original._date || 'N/A' },
    { id: 'cost', header: t('driver.detail.cols.cost'), accessorFn: (r) => (r.cost_per_tyre == null ? -1 : Number(r.cost_per_tyre)), size: 110, meta: { align: 'right' }, cell: ({ row }) => (row.original.cost_per_tyre != null ? `${activeCurrency} ${Number(row.original.cost_per_tyre).toLocaleString()}` : 'N/A') },
    { id: 'cpk', header: t('driver.detail.cols.cpk'), accessorFn: (r) => (r._cpk == null ? Number.POSITIVE_INFINITY : r._cpk), size: 120, meta: { align: 'right' }, cell: ({ row }) => <span className={`font-mono ${cpkColor(row.original._cpk)}`}>{fmtCpk(row.original._cpk, activeCurrency)}</span> },
    { id: 'life', header: t('driver.detail.cols.life'), accessorFn: (r) => r._life ?? -1, size: 100, meta: { align: 'right' }, cell: ({ row }) => fmtKm(row.original._life) },
    { id: 'risk', header: t('driver.detail.cols.risk'), accessorFn: (r) => r._risk || '', size: 100, cell: ({ row }) => (row.original._risk ? <span className={`font-semibold ${RISK_CLS[row.original._risk]}`}>{row.original._risk}</span> : <span className="text-[var(--text-muted)]">Not rated</span>) },
    { id: 'reason', header: t('driver.detail.cols.reason'), accessorFn: (r) => r.removal_reason || '', size: 180, cell: ({ row }) => <span className="block max-w-[220px] truncate" title={row.original.removal_reason || ''}>{row.original.removal_reason || 'N/A'}</span> },
  ], [t, activeCurrency])

  // ── States ─────────────────────────────────────────────────────────────────────
  if (loading) return <LoadingState message={t('driver.detail.loading')} />

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <button
          onClick={() => navigate('/driver-management')}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 min-h-[44px]"
        >
          <ArrowLeft size={15} /> {t('driver.detail.back')}
        </button>
        <div role="alert" className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <AlertTriangle size={32} className="text-red-500" />
          <p className="text-red-400 font-medium">{t('driver.detail.errorTitle')}</p>
          <p className="text-[var(--text-dim)] text-sm">{error}</p>
          <button
            onClick={load}
            className="mt-2 btn-secondary inline-flex items-center gap-2 text-sm min-h-[44px]"
          >
            <RefreshCw size={14} /> {t('driver.detail.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <button
          onClick={() => navigate('/driver-management')}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 min-h-[44px]"
        >
          <ArrowLeft size={15} /> {t('driver.detail.back')}
        </button>
        <EmptyState
          illustration="module/fleet"
          icon={User}
          title={t('driver.detail.notFoundTitle')}
          description={t('driver.detail.notFoundDesc', { name: driverName })}
          action={{ label: t('driver.detail.back'), onClick: () => navigate('/driver-management') }}
        />
      </div>
    )
  }

  const badge = performanceBadge(driver.riskScore)
  const ev = driver.evidence
  const basisNote = `Risk score rests on ${ev.cpkTyres} tyre${ev.cpkTyres === 1 ? '' : 's'} with cost and distance and ${ev.ratedTyres} risk-rated tyre${ev.ratedTyres === 1 ? '' : 's'} of ${driver.totalTyres}.`

  const recordFilters = (
    <div className="flex flex-wrap items-end gap-2 p-4 border-b border-[var(--input-border)]">
      <div className="relative flex-1 min-w-[180px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
        <input className="input pl-9 w-full min-h-[44px]" aria-label="Search tyre records" placeholder="Search asset, serial, brand, reason" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <select className="input min-h-[44px]" aria-label="Risk level" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
        <option value="">All risk levels</option>
        <option value="high">High or critical</option>
        <option value="Critical">Critical</option>
        <option value="High">High</option>
        <option value="Medium">Medium</option>
        <option value="Low">Low</option>
        <option value="unrated">Not rated</option>
      </select>
      <select className="input min-h-[44px]" aria-label="Brand" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
        <option value="">All brands</option>
        {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select className="input min-h-[44px]" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
        <option value="">All sites</option>
        {siteOptions.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-0.5">From
        <input type="date" className="input min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
      </label>
      <label className="text-[11px] text-[var(--text-muted)] flex flex-col gap-0.5">To
        <input type="date" className="input min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </label>
      {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
      <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {enriched.length}</span>
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/driver-management')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={t('driver.detail.back')}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0 bg-[var(--brand)]" aria-hidden="true">
            {driver.name[0]?.toUpperCase() ?? 'D'}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight break-words">{driver.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${BADGE_CLS[badge.tone]}`}>
                {badge.label}
              </span>
              {driver.rank != null && (
                <span className="text-xs text-[var(--text-muted)]">
                  {t('driver.detail.rank', { rank: driver.rank })}{driver.driverCount ? ` of ${driver.driverCount}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runExport('pdf')}
            disabled={wfLocked || !filtered.length}
            title={wfLocked ? t('driver.detail.lockedTitle') : t('driver.detail.exportPdfTitle')}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {wfLocked ? <Lock size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />} PDF
          </button>
          <button
            onClick={() => runExport('excel')}
            disabled={!filtered.length}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px] disabled:opacity-40"
          >
            <FileSpreadsheet size={13} aria-hidden="true" /> Excel
          </button>
        </div>
      </div>

      {exportError && <p role="alert" className="text-sm text-red-400">{exportError}</p>}

      {truncated && (
        <p className="text-xs text-amber-400">
          Capped view: the fleet-relative rank and risk score are based on the first 20,000 tyre records in this scope. Narrow the country to refine.
        </p>
      )}

      {/* ── Stat summary strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatTile label={t('driver.detail.stats.totalTyres')} value={driver.totalTyres} />
        <StatTile label={t('driver.detail.stats.avgCpk')} value={fmtCpk(driver.avgCpk, activeCurrency)} accent={cpkColor(driver.avgCpk)} sub={`From ${ev.cpkTyres} tyre${ev.cpkTyres === 1 ? '' : 's'}`} />
        <StatTile label={t('driver.detail.stats.totalCost')} value={fmtCurrency(driver.totalCost, activeCurrency)} sub={`${ev.pricedTyres} of ${driver.totalTyres} priced`} />
        <StatTile label={t('driver.detail.stats.failureRate')} value={fmtPct(driver.failureRate)} sub={`${ev.ratedTyres} risk-rated`} />
        <StatTile label={t('driver.detail.stats.avgTyreLife')} value={fmtKm(driver.avgTyreLife)} sub={`From ${ev.lifeTyres} removed tyre${ev.lifeTyres === 1 ? '' : 's'}`} />
        <StatTile label={t('driver.detail.stats.highRisk')} value={driver.highRiskCount} accent={driver.highRiskCount > 0 ? 'text-red-400' : undefined} />
        <StatTile label={t('driver.detail.stats.riskScore')} value={driver.riskScore ?? 'N/A'} />
        <StatTile label={t('driver.detail.stats.performance')} value={badge.label} />
      </div>
      <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {basisNote} Cost is the recorded tyre price only; totals for whole-fleet spend come from the expense grid.</p>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Driver sections" className={`flex flex-wrap gap-1 p-1 ${PANEL}`}>
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                active ? 'text-white bg-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={13} aria-hidden="true" /> {t(tab.labelKey) === tab.labelKey ? tab.fallback : t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'profile' && (
          <div className="space-y-5">
            <div className={`p-5 ${PANEL}`}>
              <div className="flex items-center gap-2 mb-4">
                <User size={14} className="text-green-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.profile.title')}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                <Field label={t('driver.detail.profile.name')} value={driver.name} />
                <Field label={t('driver.detail.profile.rank')} value={driver.rank != null ? `#${driver.rank}` : 'N/A'} />
                <Field label={t('driver.detail.profile.performance')} value={badge.label} />
                <Field label={t('driver.detail.profile.sites')} value={uniqueValues(driver.records, 'site')} />
                <Field label={t('driver.detail.profile.countries')} value={uniqueValues(driver.records, 'country')} />
                <Field label={t('driver.detail.profile.driverId')} value={firstValue(driver.records, 'driver_id')} />
              </div>
            </div>

            {/* Approval & Workflow Engine: driver-violation gate (preserved from drawer). */}
            <div className={`p-5 space-y-3 ${PANEL}`}>
              <EntityApprovalPanel
                entityType="driver_violation"
                entityId={driver.name}
                entityLabel={driver.name}
                context={{
                  severity: badge.label,
                  violation_type: 'tyre_cost_risk',
                  points: driver.riskScore ?? 0,
                  failure_rate: driver.failureRate == null ? null : Number(driver.failureRate.toFixed(1)),
                  high_risk_count: driver.highRiskCount,
                  total_tyres: driver.totalTyres,
                  total_cost: driver.totalCost == null ? null : Math.round(driver.totalCost),
                }}
                onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
                title={t('driver.detail.approval.title')}
              />
              {wfLocked && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                  <Lock size={12} aria-hidden="true" />
                  {t('driver.detail.approval.lockedNote')}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="space-y-5">
            <div className={`p-5 ${PANEL}`}>
              <div className="flex items-center gap-2 mb-4">
                <Award size={14} className="text-yellow-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.performance.title')}</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <StatTile label={t('driver.detail.stats.avgCpk')} value={fmtCpk(driver.avgCpk, activeCurrency)} accent={cpkColor(driver.avgCpk)} />
                <StatTile label={t('driver.detail.stats.totalCost')} value={fmtCurrency(driver.totalCost, activeCurrency)} />
                <StatTile label={t('driver.detail.stats.avgTyreLife')} value={fmtKm(driver.avgTyreLife)} />
                <StatTile label={t('driver.detail.stats.failureRate')} value={fmtPct(driver.failureRate)} accent={
                  driver.failureRate == null ? undefined : driver.failureRate >= 30 ? 'text-red-400' : driver.failureRate >= 15 ? 'text-yellow-400' : 'text-green-400'
                } />
                <StatTile label={t('driver.detail.stats.totalTyres')} value={driver.totalTyres} />
                <StatTile label={t('driver.detail.stats.highRisk')} value={driver.highRiskCount} accent={driver.highRiskCount > 0 ? 'text-red-400' : undefined} />
                <StatTile label={t('driver.detail.stats.riskScore')} value={driver.riskScore ?? 'N/A'} />
                <StatTile label={t('driver.detail.stats.rank')} value={driver.rank != null ? `#${driver.rank}` : 'N/A'} />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <MixPanel title="Tyres by brand" rows={brandMix} total={enriched.length} empty="No brand recorded on this driver's tyres." />
              <MixPanel title="Top removal reasons" rows={reasonMix} total={notes.length} empty="No removal reasons recorded." />
            </div>
          </div>
        )}

        {activeTab === 'incidents' && (
          <div className={`overflow-hidden ${PANEL}`}>
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <ShieldAlert size={14} className="text-red-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.incidents.title')}</h2>
              <span className="text-xs text-[var(--text-muted)] ml-1">({incidents.length})</span>
            </div>
            {ev.ratedTyres === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title="No tyres are risk-rated"
                description="None of this driver's tyre records carries a risk level, so high-risk incidents cannot be identified yet."
                compact
              />
            ) : incidents.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title={t('driver.detail.incidents.emptyTitle')}
                description={t('driver.detail.incidents.emptyDesc')}
                compact
              />
            ) : (
              <EnterpriseTable
                columns={recordColumns}
                data={incidents}
                getRowId={(r) => String(r.id)}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                initialPageSize={25}
                emptyMessage="No high-risk records."
              />
            )}
          </div>
        )}

        {activeTab === 'records' && (
          <div className={`overflow-hidden ${PANEL}`}>
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <ClipboardList size={14} className="text-green-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.records.title')}</h2>
              <span className="text-xs text-[var(--text-muted)] ml-1">({driver.records.length})</span>
            </div>
            {recordFilters}
            <EnterpriseTable
              columns={recordColumns}
              data={filtered}
              getRowId={(r) => String(r.id)}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage={hasFilters ? 'No tyre records match these filters.' : t('driver.detail.records.emptyDesc')}
            />
          </div>
        )}

        {activeTab === 'notes' && (
          <div className={`p-5 ${PANEL}`}>
            <div className="flex items-center gap-2 mb-4">
              <StickyNote size={14} className="text-blue-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('driver.detail.notes.title')}</h2>
            </div>
            {/* Removal-reason notes surfaced from the driver's tyre records. */}
            {notes.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title={t('driver.detail.notes.emptyTitle')}
                description={t('driver.detail.notes.emptyDesc')}
                compact
              />
            ) : (
              <ul className="space-y-2">
                {sortedNotes(notes).map((r, i) => (
                  <li key={r.id ?? i}
                    className="rounded-lg px-3 py-2.5 text-sm text-[var(--text-secondary)] bg-[var(--input-bg)] border border-[var(--input-border)]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs text-[var(--text-muted)]">
                        {r._asset ?? 'N/A'}{r._date ? `, ${r._date}` : ''}
                      </span>
                      <span className={`text-[11px] ${r._risk ? RISK_CLS[r._risk] : 'text-[var(--text-muted)]'}`}>{r._risk || 'Not rated'}</span>
                    </div>
                    {r.removal_reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Small presentational helpers ─────────────────────────────────────────────────
function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--text-dim)] mb-0.5">{label}</p>
      <p className="text-[var(--text-primary)] font-medium">{value || 'N/A'}</p>
    </div>
  )
}

function uniqueValues(records, key) {
  const s = new Set(records.map(r => r[key]).filter(Boolean))
  return Array.from(s).join(', ')
}

function firstValue(records, key) {
  const hit = records.find(r => r[key])
  return hit ? hit[key] : ''
}

function sortedNotes(rows) {
  return [...rows].sort((a, b) => String(b._date || '').localeCompare(String(a._date || '')))
}

function MixPanel({ title, rows, total, empty }) {
  return (
    <div className={`p-5 ${PANEL}`}>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{empty}</p> : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const pct = total ? Math.round((r.count / total) * 100) : 0
            return (
              <li key={r.label}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--text-secondary)] break-words min-w-0">{r.label}</span>
                  <span className="text-[var(--text-muted)] tabular-nums whitespace-nowrap">{r.count} ({pct}%)</span>
                </div>
                <div className="h-2 mt-1 rounded bg-[var(--input-bg)] overflow-hidden" role="presentation">
                  <div className="h-full rounded bg-sky-500/70" style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
