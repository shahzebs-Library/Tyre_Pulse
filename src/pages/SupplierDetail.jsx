/**
 * SupplierDetail (route /suppliers/:supplierId) - one tyre supplier (brand).
 *
 * Tabs: Profile (KPI strip, radar, monthly spend, size and site mix, admin
 * rating override), Performance (every tyre record, sortable + filterable +
 * exportable), Contracts (this supplier's contract history, read-only) and
 * Notes.
 *
 * All supplier maths come from src/lib/supplierManagementAnalytics.js (the
 * SAME engine the supplier directory uses, CPK via kpiEngine), so the detail
 * page can never disagree with the directory. Single-supplier views and the
 * honest failure-rate read live in src/lib/supplierDetailAnalytics.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as supplierApi from '../lib/api/supplierManagementApi'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'
import EmptyState from '../components/EmptyState'
import { SkeletonCards } from '../components/ui/Skeleton'
import Card, { CardHeader } from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  Building2, Star, AlertTriangle, CheckCircle, ShieldCheck, ArrowLeft,
  Loader2, Globe, MapPin, FileCheck, Lock, Gauge, Ruler, Wallet, Receipt, Search, X,
  FileSpreadsheet, FileText, Award, Package,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Radar } from 'react-chartjs-2'
import {
  buildSupplierDetail, ratingsMap, ratingToNum, recordRows, filterRecordRows, supplierContractRows,
  recordExportRows, RECORD_EXPORT_COLUMNS, CPK_BENCHMARK, FAILURE_THRESHOLD, RATINGS,
} from '../lib/supplierDetailAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

const loadExportUtils = () => import('../lib/exportUtils')

const RATING_I18N_KEYS = { Preferred: 'preferred', Approved: 'approved', 'Under Review': 'underReview', Probation: 'probation' }
const RATING_COLS = ['brand', 'rating', 'notes', 'country', 'created_by']
// Semantic rating / status colours (meaning-carrying).
const RATING_CONFIG = {
  Preferred:     { color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-700', icon: Star },
  Approved:      { color: 'text-blue-400',    bg: 'bg-blue-900/40',    border: 'border-blue-700',    icon: CheckCircle },
  'Under Review':{ color: 'text-amber-400',   bg: 'bg-amber-900/40',   border: 'border-amber-700',   icon: AlertTriangle },
  Probation:     { color: 'text-red-400',     bg: 'bg-red-900/40',     border: 'border-red-700',     icon: ShieldCheck },
}
const CONTRACT_STATUS_I18N_KEYS = { Active: 'active', 'Expiring Soon': 'expiringSoon', Expired: 'expired' }
const CONTRACT_STATUS_STYLE = {
  Active: 'text-emerald-400 bg-emerald-900/30 border-emerald-700',
  'Expiring Soon': 'text-amber-400 bg-amber-900/30 border-amber-700',
  Expired: 'text-red-400 bg-red-900/30 border-red-700',
}
const RISK_TEXT = { High: 'text-red-400', Critical: 'text-red-500', Medium: 'text-amber-400', Low: 'text-emerald-400' }
const DETAIL_TABS = ['profile', 'performance', 'contracts', 'notes']
const TICK = { color: 'var(--text-muted)', font: { size: 11 } }
const GRID = { color: 'var(--panel-2)' }

function pick(obj, cols) {
  const out = {}
  cols.forEach((k) => { if (obj[k] !== undefined) out[k] = obj[k] })
  return out
}
function fmtCurrency(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}
const fmtCpk = (v, currency) => (v == null || !Number.isFinite(v) ? 'N/A' : `${currency} ${v.toFixed(4)}/km`)
const fmtKm = (v) => (v == null || !Number.isFinite(v) || v === 0 ? 'N/A' : v >= 1000 ? `${(v / 1000).toFixed(0)}k km` : `${Math.round(v)} km`)
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`)

function RatingBadge({ rating }) {
  const { t } = useLanguage()
  const cfg = RATING_CONFIG[rating] || RATING_CONFIG.Approved
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon size={10} aria-hidden="true" />
      {RATING_I18N_KEYS[rating] ? t(`suppliers.ratings.${RATING_I18N_KEYS[rating]}`) : rating}
    </span>
  )
}

function Breakdown({ title, rows, empty, barClass }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? <p className="text-xs text-[var(--text-muted)]">{empty}</p> : (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-2">
              <span className="flex-1 text-xs text-[var(--text-secondary)] truncate" title={r.name}>{r.name}</span>
              <span className="w-24 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden" aria-hidden="true">
                <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${r.sharePct ?? 0}%` }} />
              </span>
              <span className="text-xs text-[var(--text-muted)] w-20 text-right tabular-nums">{r.count} ({r.sharePct ?? 0}%)</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function SupplierDetail() {
  const { supplierId } = useParams()
  const brand = decodeURIComponent(supplierId || '')
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || ''
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [records, setRecords] = useState([])
  const [recordsTruncated, setRecordsTruncated] = useState(false)
  const [ratings, setRatings] = useState({})
  const [contracts, setContracts] = useState([])
  const [contractsError, setContractsError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('profile')

  const [recSearch, setRecSearch] = useState('')
  const [recRisk, setRecRisk] = useState('all')
  const [recSite, setRecSite] = useState('')
  const [exportError, setExportError] = useState(null)

  const [notes, setNotes] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteError, setNoteError] = useState(null)
  const [ratingsError, setRatingsError] = useState(null)

  const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setRatingsError(null)
    setContractsError(null)
    try {
      const [tyresRes, ratingsRes, contractsRes] = await Promise.all([
        fetchAllPages((from, to) => supplierApi.listSupplierTyres({ from, to, country: activeCountry }), { max: 50000 }),
        supplierApi.listSupplierRatings({ country: activeCountry }),
        supplierApi.listSupplierContracts({ country: activeCountry }),
      ])
      if (tyresRes.error) { setError(toUserMessage(tyresRes.error, 'Could not load supplier tyres.')); return }
      if (ratingsRes.error) setRatingsError(toUserMessage(ratingsRes.error, 'Could not load supplier ratings.'))
      if (contractsRes.error) setContractsError(toUserMessage(contractsRes.error, 'Could not load contracts.'))
      setRecords(tyresRes.data || [])
      setRecordsTruncated(!!tyresRes.truncated)
      setRatings(ratingsMap(ratingsRes.data || []))
      setContracts(contractsRes.data || [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load supplier data.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const detail = useMemo(() => buildSupplierDetail(records, ratings, brand, new Date()), [records, ratings, brand])
  const supplier = detail.supplier

  useEffect(() => {
    setNotes(supplier?.notes || '')
    setNoteSaved(false)
    setNoteError(null)
  }, [supplier?.brand, supplier?.notes])

  const recRows = useMemo(() => recordRows(supplier?.recs || []), [supplier])
  const filteredRecs = useMemo(() => filterRecordRows(recRows, { search: recSearch, risk: recRisk, site: recSite }), [recRows, recSearch, recRisk, recSite])
  const contractRows = useMemo(() => supplierContractRows(contracts, brand, new Date()), [contracts, brand])

  async function upsertRating({ label, notes: nextNotes }) {
    const existing = ratings[brand] || {}
    const payload = pick({
      brand,
      rating: ratingToNum(label !== undefined ? label : existing.label),
      notes: nextNotes !== undefined ? nextNotes : (existing.notes || ''),
      country: scopedCountry,
      created_by: user?.id || null,
    }, RATING_COLS)
    const { error: err } = await supplierApi.upsertSupplierRating(payload)
    if (err) return toUserMessage(err, 'Could not save the rating.')
    setRatings((prev) => ({
      ...prev,
      [brand]: {
        id: prev[brand]?.id,
        label: label !== undefined ? label : (prev[brand]?.label ?? existing.label),
        notes: nextNotes !== undefined ? nextNotes : (prev[brand]?.notes ?? existing.notes ?? ''),
      },
    }))
    return null
  }

  async function handleRatingChange(rating) {
    const err = await upsertRating({ label: rating })
    if (err) setRatingsError(err)
  }

  async function saveNotes() {
    setNoteSaving(true)
    setNoteError(null)
    const err = await upsertRating({ notes })
    setNoteSaving(false)
    if (err) { setNoteError(err); return }
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2000)
  }

  async function exportRecords(format) {
    setExportError(null)
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const rows = recordExportRows(filteredRecs)
      const title = `${brand} Tyre Records`
      const file = reportFileName(brand, 'Tyre Records')
      if (format === 'pdf') await exportToPdf(rows, RECORD_EXPORT_COLUMNS, title, file, 'landscape', company, { meta: { Currency: activeCurrency || 'N/A' } })
      else await exportToExcel(rows, RECORD_EXPORT_COLUMNS.map((c) => c.key), RECORD_EXPORT_COLUMNS.map((c) => c.header), file, 'Records')
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const recordColumns = useMemo(() => [
    { id: 'serial', header: t('suppliers.drawer.columns.serial'), accessorFn: (r) => r.serial || undefined, sortUndefined: 'last', size: 130,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{row.original.serial || 'N/A'}</span> },
    { id: 'size', header: t('suppliers.drawer.columns.size'), accessorFn: (r) => r.size || undefined, sortUndefined: 'last', size: 130 },
    { id: 'asset', header: t('suppliers.drawer.columns.asset'), accessorFn: (r) => r.asset_no || undefined, sortUndefined: 'last', size: 100 },
    { id: 'site', header: t('suppliers.drawer.columns.site'), accessorFn: (r) => r.site || undefined, sortUndefined: 'last', size: 110 },
    { id: 'km', header: 'Km run', accessorFn: (r) => r.kmRun ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => fmtKm(row.original.kmRun) },
    { id: 'cpk', header: t('suppliers.drawer.columns.cpk'), accessorFn: (r) => r.cpk ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 140,
      cell: ({ row }) => {
        const c = row.original.cpk
        if (c == null) return <span className="text-[var(--text-muted)] text-xs">N/A</span>
        const good = c <= CPK_BENCHMARK
        return <span className={`text-xs font-mono font-semibold ${good ? 'text-emerald-400' : 'text-amber-400'}`}>{fmtCpk(c, activeCurrency)}<span className="sr-only">{good ? ' within benchmark' : ' above benchmark'}</span></span>
      } },
    { id: 'risk', header: t('suppliers.drawer.columns.risk'), accessorFn: (r) => r.risk_level || undefined, sortUndefined: 'last', size: 100,
      cell: ({ row }) => <span className={RISK_TEXT[row.original.risk_level] || 'text-[var(--text-muted)]'}>{row.original.risk_level || 'Not rated'}</span> },
    { id: 'date', header: t('suppliers.drawer.columns.date'), accessorFn: (r) => r.issue_date || undefined, sortUndefined: 'last', size: 110,
      cell: ({ row }) => (row.original.issue_date ? formatDate(row.original.issue_date) : 'N/A') },
  ], [t, activeCurrency])

  const contractColumns = useMemo(() => [
    { id: 'start', header: t('suppliers.contracts.columns.start'), accessorFn: (c) => c.contract_start || undefined, sortUndefined: 'last', size: 110,
      cell: ({ row }) => row.original.contract_start || 'N/A' },
    { id: 'end', header: t('suppliers.contracts.columns.end'), accessorFn: (c) => c.contract_end || undefined, sortUndefined: 'last', size: 110,
      cell: ({ row }) => row.original.contract_end || 'Open-ended' },
    { id: 'days', header: 'Days to expiry', accessorFn: (c) => c.daysToExpiry ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 120,
      cell: ({ row }) => (row.original.daysToExpiry == null ? 'N/A' : row.original.daysToExpiry) },
    { id: 'terms', header: t('suppliers.contracts.columns.paymentTerms'), accessorFn: (c) => c.payment_terms || undefined, sortUndefined: 'last', size: 130,
      cell: ({ row }) => row.original.payment_terms || 'N/A' },
    { id: 'price', header: t('suppliers.contracts.columns.pricePerUnit'), accessorFn: (c) => (c.price_per_unit == null ? undefined : Number(c.price_per_unit)), sortUndefined: 'last', meta: { align: 'right' }, size: 120,
      cell: ({ row }) => (row.original.price_per_unit ? fmtCurrency(Number(row.original.price_per_unit), activeCurrency) : 'N/A') },
    { id: 'min', header: t('suppliers.contracts.columns.minOrder'), accessorFn: (c) => (c.min_order == null ? undefined : Number(c.min_order)), sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => row.original.min_order || 'N/A' },
    { id: 'value', header: 'Committed value', accessorFn: (c) => c.value ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 130,
      cell: ({ row }) => fmtCurrency(row.original.value, activeCurrency) },
    { id: 'status', header: t('suppliers.contracts.columns.status'), accessorFn: (c) => c.status, size: 130,
      cell: ({ row }) => {
        const s = row.original.status
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${CONTRACT_STATUS_STYLE[s]}`}>
            {s !== 'Active' && <AlertTriangle size={9} aria-hidden="true" />}
            {t(`suppliers.contracts.statuses.${CONTRACT_STATUS_I18N_KEYS[s]}`)}
          </span>
        )
      } },
  ], [t, activeCurrency])

  const backBtn = (
    <button
      type="button"
      onClick={() => navigate('/suppliers')}
      className="inline-flex items-center gap-1.5 px-3 min-h-[40px] bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <ArrowLeft size={14} aria-hidden="true" /> {t('suppliers.detail.back')}
    </button>
  )

  if (loading) {
    return <div className="space-y-4">{backBtn}<SkeletonCards count={4} /></div>
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backBtn}
        <Card tone="crit" className="items-center text-center gap-2" style={{ paddingBlock: '3rem' }} role="alert">
          <AlertTriangle size={32} className="text-red-400" aria-hidden="true" />
          <p className="text-red-400 font-medium">{t('suppliers.errors.loadFailed')}</p>
          <p className="text-[var(--text-muted)] text-sm">{error}</p>
          <button type="button" onClick={load} className="btn-primary text-sm min-h-[40px] mt-2">{t('suppliers.retry')}</button>
        </Card>
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="space-y-4">
        {backBtn}
        <EmptyState icon={Building2} title={t('suppliers.detail.notFoundTitle')} description={t('suppliers.detail.notFoundDesc', { brand })} />
      </div>
    )
  }

  const radar = detail.radar
  const radarData = {
    labels: [t('suppliers.radarLabels.cpkScore'), t('suppliers.radarLabels.lifeScore'), t('suppliers.radarLabels.reliability'), t('suppliers.radarLabels.value'), t('suppliers.radarLabels.coverage')],
    datasets: [{
      label: supplier.brand,
      data: [radar.cpkScore, radar.lifeScore, radar.reliabilityScore, radar.valueScore, radar.coverageScore],
      backgroundColor: withAlpha(colorAt(0), 0.2), borderColor: colorAt(0), pointBackgroundColor: colorAt(0), borderWidth: 2,
    }],
  }
  const radarOpts = {
    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { r: { min: 0, max: 100, ticks: { ...TICK, stepSize: 25, backdropColor: 'transparent' }, grid: GRID, pointLabels: TICK, angleLines: GRID } },
  }
  const spendChartData = {
    labels: detail.monthLabels,
    datasets: [{ label: t('suppliers.monthlySpendLabel'), data: detail.monthlySpend, backgroundColor: withAlpha(colorAt(0), 0.75), borderColor: colorAt(0), borderRadius: 4 }],
  }
  const cov = detail.ratedCoverage
  const failSub = detail.failureRate == null
    ? 'No records carry a risk level'
    : `${cov.rated} of ${cov.total} records rated (${cov.pct}%)`
  const siteOptions = detail.sites.map((s) => s.name)
  const recFiltersOn = recSearch || recRisk !== 'all' || recSite

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {backBtn}
          <div className="w-11 h-11 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center justify-center flex-shrink-0">
            <Building2 size={20} className="text-[var(--text-secondary)]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-[var(--text-primary)] text-xl leading-none break-words">{supplier.brand}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <RatingBadge rating={supplier.rating} />
              <span className="text-[11px] text-[var(--text-muted)]">{supplier.ratingSource === 'manual' ? 'Set by admin' : 'Automatic rating'}</span>
              <span className="text-xs text-[var(--text-muted)]">{supplier.count} {t('suppliers.drawer.tyresSuffix')}</span>
              {supplier.countries.slice(0, 3).map((c) => (
                <span key={c} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--input-bg)] rounded text-xs text-[var(--text-muted)]">
                  <Globe size={9} aria-hidden="true" />{c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {ratingsError && (
        <Card tone="crit" className="items-center gap-2" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={15} className="text-red-400 flex-shrink-0" aria-hidden="true" />
          <span className="text-sm text-red-400">{t('suppliers.ratingsError', { message: ratingsError })}</span>
        </Card>
      )}
      {recordsTruncated && (
        <Card tone="warn" className="items-center gap-2" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={14} className="flex-shrink-0 text-amber-400" aria-hidden="true" />
          <span className="text-xs text-[var(--text-secondary)]">Capped view: showing up to 50,000 tyre records. Some records may be excluded from these metrics. Narrow the country filter for a complete view.</span>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label={t('suppliers.drawer.stats.avgCpk')} value={fmtCpk(supplier.avgCpk, activeCurrency)} icon={Gauge}
          tone={supplier.avgCpk == null ? 'neutral' : supplier.avgCpk <= CPK_BENCHMARK ? 'accent' : 'warn'}
          sub={detail.vsBenchmarkPct == null ? `${detail.costedRecords} costed records` : `${detail.vsBenchmarkPct > 0 ? '+' : ''}${detail.vsBenchmarkPct.toFixed(0)}% vs ${CPK_BENCHMARK} benchmark`} />
        <StatTile label={t('suppliers.drawer.stats.avgTyreLife')} value={fmtKm(supplier.avgLife)} icon={Ruler} sub={`${detail.costedRecords} records with a km run`} />
        <StatTile label={t('suppliers.drawer.stats.failureRate')} value={fmtPct(detail.failureRate)} icon={ShieldCheck}
          tone={detail.failureRate == null ? 'neutral' : detail.failureRate < FAILURE_THRESHOLD ? 'accent' : 'crit'} sub={failSub} />
        <StatTile label={t('suppliers.drawer.stats.spendThisYear')} value={fmtCurrency(supplier.spendThisYear, activeCurrency)} icon={Wallet} sub="Latest data year" />
        <StatTile label={t('suppliers.drawer.stats.totalSpend')} value={fmtCurrency(supplier.totalSpend, activeCurrency)} icon={Receipt} sub={`${fmtCurrency(detail.spendInWindow, activeCurrency)} in last 12 months`} />
        <StatTile label="CPK rank" value={detail.cpkRank ? `#${detail.cpkRank.rank}` : 'N/A'} icon={Award}
          sub={detail.cpkRank ? `of ${detail.cpkRank.of} suppliers with CPK` : 'CPK not measurable'} />
      </div>

      <div role="tablist" aria-label="Supplier detail views" className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]">
        {DETAIL_TABS.map((key) => {
          const active = activeTab === key
          const count = key === 'performance' ? supplier.count : key === 'contracts' ? contractRows.length : null
          return (
            <button key={key} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-t ${active ? 'border-brand-bright text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              {t(`suppliers.detail.tabs.${key}`)}
              {count != null && <span className="text-[11px] px-1.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)]">{count}</span>}
            </button>
          )
        })}
      </div>

      {activeTab === 'profile' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title={t('suppliers.drawer.radarTitle')} description="0 to 100, higher is better, relative to every supplier in scope." />
              <div className="h-64" role="img" aria-label={`Scores: CPK ${Math.round(radar.cpkScore)}, life ${Math.round(radar.lifeScore)}, reliability ${Math.round(radar.reliabilityScore)}, value ${Math.round(radar.valueScore)}, coverage ${Math.round(radar.coverageScore)}`}>
                <Radar data={radarData} options={radarOpts} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t('suppliers.drawer.monthlySpendTitle')} description="Last 12 months to the latest data month." />
              <div className="h-64">
                {detail.spendInWindow > 0
                  ? <Bar data={spendChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: TICK, grid: { display: false } }, y: { ticks: TICK, grid: GRID, beginAtZero: true } } }} />
                  : <div className="h-full grid place-items-center text-sm text-[var(--text-muted)]">No recorded spend in the last 12 months.</div>}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Breakdown title={t('suppliers.drawer.sizeDistribution')} rows={detail.sizes} empty={t('suppliers.drawer.noSizeData')} barClass="bg-sky-500" />
            <Breakdown title={t('suppliers.drawer.siteUsage')} rows={detail.sites} empty={t('suppliers.drawer.noSiteData')} barClass="bg-emerald-500" />
          </div>

          {isAdmin && (
            <Card>
              <CardHeader title={t('suppliers.drawer.ratingOverride')} />
              <div role="group" aria-label={t('suppliers.drawer.ratingOverride')} className="flex flex-wrap gap-2">
                {RATINGS.map((r) => {
                  const cfg = RATING_CONFIG[r]
                  const on = supplier.rating === r
                  return (
                    <button key={r} type="button" onClick={() => handleRatingChange(r)} aria-pressed={on}
                      className={`px-3 min-h-[40px] rounded-lg text-xs font-medium border transition-colors ${on ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      {t(`suppliers.ratings.${RATING_I18N_KEYS[r]}`)}
                    </button>
                  )
                })}
              </div>
            </Card>
          )}

          {supplier.sites.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap px-1">
              {supplier.sites.slice(0, 8).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"><MapPin size={10} aria-hidden="true" />{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'performance' && (
        <Card>
          <CardHeader title={t('suppliers.drawer.tyreRecords')} icon={Package}
            description={`${t('suppliers.drawer.totalSuffix', { count: supplier.count })}. Cost/km is green when at or below the ${CPK_BENCHMARK} benchmark.`}
            actions={
              <div className="flex gap-2">
                <button type="button" onClick={() => exportRecords('excel')} disabled={!filteredRecs.length} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[36px]"><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
                <button type="button" onClick={() => exportRecords('pdf')} disabled={!filteredRecs.length} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[36px]"><FileText size={13} aria-hidden="true" /> PDF</button>
              </div>
            } />
          {exportError && <p role="alert" className="text-sm text-red-400 mb-2">{exportError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_auto_auto_auto] items-center gap-2 mb-3">
            <div className="relative">
              <label htmlFor="sup-rec-search" className="sr-only">Search records</label>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="sup-rec-search" className="input pl-9 w-full min-h-[40px]" placeholder="Search serial, size, asset, site" value={recSearch} onChange={(e) => setRecSearch(e.target.value)} />
            </div>
            <select className="input min-h-[40px]" value={recRisk} onChange={(e) => setRecRisk(e.target.value)} aria-label="Filter by risk level">
              <option value="all">All risk levels</option>
              {['Critical', 'High', 'Medium', 'Low'].map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="unrated">Not rated</option>
            </select>
            <select className="input min-h-[40px]" value={recSite} onChange={(e) => setRecSite(e.target.value)} aria-label="Filter by site">
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-2 justify-between sm:justify-end">
              {recFiltersOn && <button type="button" onClick={() => { setRecSearch(''); setRecRisk('all'); setRecSite('') }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap" aria-live="polite">{filteredRecs.length} of {recRows.length}</span>
            </div>
          </div>
          <EnterpriseTable
            columns={recordColumns}
            data={filteredRecs}
            getRowId={(r) => String(r.id)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            viewKey="supplier-detail-records"
            initialPageSize={25}
            emptyMessage={recRows.length === 0 ? t('suppliers.drawer.noRecords') : 'No records match these filters.'}
          />
        </Card>
      )}

      {activeTab === 'contracts' && (
        <div className="space-y-3">
          {contractsError ? (
            <Card tone="crit" className="items-center justify-between gap-3" style={{ flexDirection: 'row' }} role="alert">
              <span className="text-sm text-red-400">{contractsError}</span>
              <button type="button" onClick={load} className="btn-secondary text-sm min-h-[40px]">{t('suppliers.retry')}</button>
            </Card>
          ) : contractRows.length === 0 ? (
            <EmptyState icon={FileCheck} title={t('suppliers.detail.contracts.emptyTitle')} description={t('suppliers.detail.contracts.emptyDesc')} />
          ) : (
            <Card>
              <EnterpriseTable
                columns={contractColumns}
                data={contractRows}
                getRowId={(c) => String(c.id)}
                enableColumnFilters={false}
                exportFileName={`${brand}_contracts`}
                reportMeta={{ title: `${brand} Contracts`, company, currency: activeCurrency }}
                initialPageSize={25}
                emptyMessage={t('suppliers.detail.contracts.emptyTitle')}
              />
            </Card>
          )}
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <Lock size={11} aria-hidden="true" /> {t('suppliers.detail.contracts.manageHint')}
          </p>
        </div>
      )}

      {activeTab === 'notes' && (
        <Card>
          <label htmlFor="sup-notes" className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2 block">{t('suppliers.drawer.notes')}</label>
          <textarea
            id="sup-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder={t('suppliers.drawer.notesPlaceholder')}
            className="input w-full resize-y"
          />
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="button" onClick={saveNotes} disabled={noteSaving}
              className={`px-3 min-h-[40px] text-sm rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 ${noteSaved ? 'bg-emerald-700 text-white' : 'btn-secondary'}`}>
              {noteSaving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              {noteSaving ? t('suppliers.drawer.saving') : noteSaved ? t('suppliers.drawer.saved') : t('suppliers.drawer.saveNotes')}
            </button>
            {noteError && (
              <span role="alert" className="text-xs text-red-400 inline-flex items-center gap-1"><AlertTriangle size={11} aria-hidden="true" /> {noteError}</span>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
