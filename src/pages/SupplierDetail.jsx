import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import * as supplierApi from '../lib/api/supplierManagementApi'
import { recordCost } from '../lib/analyticsEngine'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'
import EmptyState from '../components/EmptyState'
import { SkeletonCards } from '../components/ui/Skeleton'
import {
  Building2, Star, AlertTriangle, CheckCircle, ShieldCheck, ArrowLeft,
  ChevronRight, ChevronLeft, Loader2, Globe, MapPin, FileCheck, Lock,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Radar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

// ── Constants (mirror SupplierManagement so metrics stay identical) ──────────────
const CPK_BENCHMARK = 1.20
const FAILURE_THRESHOLD = 0.15
const RATINGS = ['Preferred', 'Approved', 'Under Review', 'Probation']
const RATING_I18N_KEYS = { Preferred: 'preferred', Approved: 'approved', 'Under Review': 'underReview', Probation: 'probation' }
const RATING_TO_NUM = RATINGS.reduce((acc, r, i) => { acc[r] = i + 1; return acc }, {})
function ratingToNum(label) { return RATING_TO_NUM[label] ?? null }
function numToRating(num) {
  const idx = Math.round(Number(num)) - 1
  return RATINGS[idx] || null
}
const RATING_COLS = ['brand', 'rating', 'notes', 'country', 'created_by']
const RATING_CONFIG = {
  Preferred:     { color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-700', icon: Star },
  Approved:      { color: 'text-blue-400',    bg: 'bg-blue-900/40',    border: 'border-blue-700',    icon: CheckCircle },
  'Under Review':{ color: 'text-amber-400',   bg: 'bg-amber-900/40',   border: 'border-amber-700',   icon: AlertTriangle },
  Probation:     { color: 'text-red-400',     bg: 'bg-red-900/40',     border: 'border-red-700',     icon: ShieldCheck },
}
const CONTRACT_STATUS_I18N_KEYS = { Active: 'active', 'Expiring Soon': 'expiringSoon', Expired: 'expired' }
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(59,130,246,0.3)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'var(--text-muted)' } },
  },
}

const DETAIL_TABS = ['profile', 'performance', 'contracts', 'notes']

// ── Helpers (identical formulas to SupplierManagement) ───────────────────────────
function calcCpk(cost, kmFit, kmRem) {
  const km = (kmRem ?? 0) - (kmFit ?? 0)
  if (!km || km <= 0 || !cost || cost <= 0) return null
  return cost / km
}
function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}
function fmtCpk(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}/km`
}
function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k km`
  return `${Math.round(v)} km`
}
function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}
function dataAnchorDate(recs) {
  let max = null
  for (const r of recs || []) { if (r.issue_date && (!max || r.issue_date > max)) max = r.issue_date }
  return max ? new Date(max.slice(0, 10) + 'T00:00:00') : new Date()
}
function getLast12Months(anchor = new Date()) {
  const months = []
  const now = anchor
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}
function toMonthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function getContractStatus(contract) {
  if (!contract.contract_end) return 'Active'
  const end = new Date(contract.contract_end)
  const now = new Date()
  const diffDays = (end - now) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'Expired'
  if (diffDays <= 30) return 'Expiring Soon'
  return 'Active'
}
function computeSupplierMetrics(records, brand, anchorYear = new Date().getFullYear()) {
  const recs = records.filter(r => r.brand === brand)
  const validRecs = recs.filter(r => {
    const fit = Number(r.km_at_fitment), rem = Number(r.km_at_removal), cost = Number(r.cost_per_tyre)
    return isFinite(fit) && fit > 0 && isFinite(rem) && rem > fit && isFinite(cost) && cost > 0
  })
  const cpks = validRecs.map(r => calcCpk(Number(r.cost_per_tyre), Number(r.km_at_fitment), Number(r.km_at_removal))).filter(Boolean)
  const avgCpk = cpks.length ? cpks.reduce((s, v) => s + v, 0) / cpks.length : null
  const kms = validRecs.map(r => Number(r.km_at_removal) - Number(r.km_at_fitment))
  const avgLife = kms.length ? kms.reduce((s, v) => s + v, 0) / kms.length : 0
  const failures = recs.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical')
  const failureRate = recs.length > 0 ? failures.length / recs.length : 0
  const totalSpend = recs.reduce((s, r) => s + recordCost(r), 0)
  const yearRecs = recs.filter(r => r.issue_date && new Date(r.issue_date).getFullYear() === anchorYear)
  const spendThisYear = yearRecs.reduce((s, r) => s + recordCost(r), 0)
  const sites = [...new Set(recs.map(r => r.site).filter(Boolean))]
  const sizes = [...new Set(recs.map(r => r.size).filter(Boolean))]
  const countries = [...new Set(recs.map(r => r.country).filter(Boolean))]
  return { brand, recs, validRecs, avgCpk, avgLife, failureRate, totalSpend, spendThisYear, sites, sizes, countries, count: recs.length }
}
function computeRadarScores(metrics, allMetrics) {
  const allCpks = allMetrics.map(m => m.avgCpk).filter(Boolean)
  const allLives = allMetrics.map(m => m.avgLife).filter(v => v > 0)
  const maxCpk = allCpks.length ? Math.max(...allCpks) : 1
  const maxLife = allLives.length ? Math.max(...allLives) : 1
  const fleetAvgCpk = allCpks.length ? allCpks.reduce((s, v) => s + v, 0) / allCpks.length : CPK_BENCHMARK
  const totalCount = allMetrics.reduce((s, m) => s + m.count, 0)
  const cpkScore = metrics.avgCpk != null ? Math.max(0, 100 - (metrics.avgCpk / maxCpk) * 100) : 0
  const lifeScore = maxLife > 0 ? (metrics.avgLife / maxLife) * 100 : 0
  const reliabilityScore = Math.max(0, 100 - metrics.failureRate * 100 * 4)
  const valueScore = metrics.avgCpk != null && fleetAvgCpk > 0 ? Math.min(100, (fleetAvgCpk / metrics.avgCpk) * 50 + 50) : 50
  const coverageScore = totalCount > 0 ? (metrics.count / totalCount) * 100 * 3 : 0
  return {
    cpkScore: Math.min(100, cpkScore),
    lifeScore: Math.min(100, lifeScore),
    reliabilityScore: Math.min(100, reliabilityScore),
    valueScore: Math.min(100, valueScore),
    coverageScore: Math.min(100, coverageScore),
  }
}
function autoRate(m) {
  if (m.avgCpk != null && m.avgCpk <= CPK_BENCHMARK * 0.9 && m.failureRate < 0.1) return 'Preferred'
  if (m.failureRate > FAILURE_THRESHOLD * 1.5) return 'Probation'
  if (m.failureRate > FAILURE_THRESHOLD || (m.avgCpk != null && m.avgCpk > CPK_BENCHMARK * 1.3)) return 'Under Review'
  return 'Approved'
}
function pick(obj, cols) {
  const out = {}
  cols.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k] })
  return out
}

// ── Presentational bits ──────────────────────────────────────────────────────────
function RatingBadge({ rating }) {
  const { t } = useLanguage()
  const cfg = RATING_CONFIG[rating] || RATING_CONFIG['Approved']
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon size={10} />
      {RATING_I18N_KEYS[rating] ? t(`suppliers.ratings.${RATING_I18N_KEYS[rating]}`) : rating}
    </span>
  )
}
function CpkBadge({ cpk, currency }) {
  const { t } = useLanguage()
  if (cpk == null) return <span className="text-[var(--text-muted)] text-xs">{t('suppliers.spend.na')}</span>
  const good = cpk <= CPK_BENCHMARK
  return (
    <span className={`text-xs font-mono font-semibold ${good ? 'text-emerald-400' : 'text-amber-400'}`}>
      {fmtCpk(cpk, currency)}
    </span>
  )
}

// ── Supplier Detail Page ─────────────────────────────────────────────────────────
export default function SupplierDetail() {
  const { supplierId } = useParams()
  const brand = decodeURIComponent(supplierId || '')
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { activeCurrency, activeCountry } = useSettings()
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [records, setRecords] = useState([])
  const [ratings, setRatings] = useState({})
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [activeTab, setActiveTab] = useState('profile')
  const [page, setPage] = useState(0)
  const pageSize = 8

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
    const [tyresRes, ratingsRes, contractsRes] = await Promise.all([
      fetchAllPages((from, to) => supplierApi.listSupplierTyres({ from, to, country: activeCountry })),
      supplierApi.listSupplierRatings({ country: activeCountry }),
      supplierApi.listSupplierContracts({ country: activeCountry }),
    ])
    if (tyresRes.error) { setError(toUserMessage(tyresRes.error, 'Could not load supplier tyres.')); setLoading(false); return }
    if (ratingsRes.error) setRatingsError(toUserMessage(ratingsRes.error, 'Could not load supplier ratings.'))
    setRecords(tyresRes.data || [])
    const map = {}
    ;(ratingsRes.data || []).forEach(row => {
      map[row.brand] = { id: row.id, label: numToRating(row.rating), notes: row.notes || '' }
    })
    setRatings(map)
    setContracts(contractsRes.data || [])
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [brand])

  // Country filter mirrors the directory: records already country-scoped by the API.
  // No per-site/rating filters here (page targets a single supplier).
  const allMetrics = useMemo(() => {
    const brands = [...new Set(records.map(r => r.brand).filter(Boolean))]
    const anchorYear = dataAnchorDate(records).getFullYear()
    return brands.map(b => {
      const m = computeSupplierMetrics(records, b, anchorYear)
      const entry = ratings[b]
      const rating = entry?.label || autoRate(m)
      return { ...m, rating, notes: entry?.notes || '' }
    })
  }, [records, ratings])

  const supplier = useMemo(() => allMetrics.find(m => m.brand === brand) || null, [allMetrics, brand])

  // Sync notes when the resolved supplier changes.
  useEffect(() => {
    setNotes(supplier?.notes || '')
    setNoteSaved(false)
    setNoteError(null)
  }, [supplier?.brand, supplier?.notes])

  const months = useMemo(() => getLast12Months(dataAnchorDate(supplier?.recs)), [supplier?.recs])
  const radarScores = useMemo(() => (supplier ? computeRadarScores(supplier, allMetrics) : null), [supplier, allMetrics])

  const monthlySpend = useMemo(() => {
    if (!supplier) return []
    return months.map(m => supplier.recs.filter(r => toMonthKey(r.issue_date) === m).reduce((s, r) => s + recordCost(r), 0))
  }, [supplier, months])

  const sizeBreakdown = useMemo(() => {
    if (!supplier) return []
    const map = {}
    supplier.recs.forEach(r => { if (r.size) map[r.size] = (map[r.size] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [supplier])

  const siteBreakdown = useMemo(() => {
    if (!supplier) return []
    const map = {}
    supplier.recs.forEach(r => { if (r.site) map[r.site] = (map[r.site] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [supplier])

  // Contracts whose supplier_name matches this brand (case-insensitive).
  const supplierContracts = useMemo(() => {
    const b = brand.toLowerCase()
    return contracts.filter(c => (c.supplier_name || '').toLowerCase() === b)
  }, [contracts, brand])

  const pagedRecs = supplier ? supplier.recs.slice(page * pageSize, (page + 1) * pageSize) : []
  const totalPages = supplier ? Math.ceil(supplier.recs.length / pageSize) : 0

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
    // Optimistic local refresh so metrics/rating stay consistent without a full reload.
    setRatings(prev => ({
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

  // ── Chart configs ─────────────────────────────────────────────────────────────
  const radarData = supplier && radarScores ? {
    labels: [t('suppliers.radarLabels.cpkScore'), t('suppliers.radarLabels.lifeScore'), t('suppliers.radarLabels.reliability'), t('suppliers.radarLabels.value'), t('suppliers.radarLabels.coverage')],
    datasets: [{
      label: supplier.brand,
      data: [radarScores.cpkScore, radarScores.lifeScore, radarScores.reliabilityScore, radarScores.valueScore, radarScores.coverageScore],
      backgroundColor: 'rgba(59,130,246,0.2)',
      borderColor: '#3b82f6',
      pointBackgroundColor: '#3b82f6',
      borderWidth: 2,
    }],
  } : null

  const radarOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { color: '#6b7280', font: { size: 10 }, stepSize: 25 },
        grid: { color: 'var(--text-muted)' },
        pointLabels: { color: '#9ca3af', font: { size: 11 } },
        angleLines: { color: 'var(--text-muted)' },
      },
    },
  }

  const spendChartData = {
    labels: months.map(m => { const [, mo] = m.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo) - 1] }),
    datasets: [{
      label: t('suppliers.monthlySpendLabel'),
      data: monthlySpend,
      backgroundColor: 'rgba(59,130,246,0.7)',
      borderColor: '#3b82f6',
      borderRadius: 4,
    }],
  }

  const backBtn = (
    <button
      onClick={() => navigate('/suppliers')}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors"
    >
      <ArrowLeft size={14} /> {t('suppliers.detail.back')}
    </button>
  )

  // ── States: loading / error / not-found ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {backBtn}
        <SkeletonCards count={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backBtn}
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
            <p className="text-red-400 font-medium">{t('suppliers.errors.loadFailed')}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">{t('suppliers.retry')}</button>
          </div>
        </div>
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="space-y-4">
        {backBtn}
        <EmptyState
          icon={Building2}
          title={t('suppliers.detail.notFoundTitle')}
          description={t('suppliers.detail.notFoundDesc', { brand })}
        />
      </div>
    )
  }

  const stats = [
    { label: t('suppliers.drawer.stats.avgCpk'), value: fmtCpk(supplier.avgCpk, activeCurrency), good: supplier.avgCpk != null && supplier.avgCpk <= CPK_BENCHMARK },
    { label: t('suppliers.drawer.stats.avgTyreLife'), value: fmtKm(supplier.avgLife), good: supplier.avgLife > 80000 },
    { label: t('suppliers.drawer.stats.failureRate'), value: fmtPct(supplier.failureRate), good: supplier.failureRate < FAILURE_THRESHOLD },
    { label: t('suppliers.drawer.stats.spendThisYear'), value: fmtCurrency(supplier.spendThisYear, activeCurrency), good: null },
    { label: t('suppliers.drawer.stats.totalSpend'), value: fmtCurrency(supplier.totalSpend, activeCurrency), good: null },
    { label: t('suppliers.drawer.stats.sitesUsed'), value: supplier.sites.length, good: null },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          {backBtn}
          <div className="w-11 h-11 rounded-xl bg-blue-900/40 border border-blue-700 flex items-center justify-center flex-shrink-0">
            <Building2 size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="font-bold text-[var(--text-primary)] text-xl leading-none">{supplier.brand}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <RatingBadge rating={supplier.rating} />
              <span className="text-xs text-[var(--text-muted)]">{supplier.count} {t('suppliers.drawer.tyresSuffix')}</span>
              {supplier.countries.slice(0, 3).map(c => (
                <span key={c} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--input-bg)] rounded text-xs text-[var(--text-muted)]">
                  <Globe size={9} />{c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {ratingsError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-xl px-4 py-2.5">
          <AlertTriangle size={15} className="flex-shrink-0" />
          <span>{t('suppliers.ratingsError', { message: ratingsError })}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 w-full overflow-x-auto">
        {DETAIL_TABS.map(key => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === key ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
            }`}
          >
            {t(`suppliers.detail.tabs.${key}`)}
          </button>
        ))}
      </div>

      {/* ── Tab: Profile ── */}
      {activeTab === 'profile' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.radarTitle')}</h4>
              <div className="h-56">
                {radarData && <Radar data={radarData} options={radarOpts} />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 content-start">
              {stats.map(item => (
                <div key={item.label} className="flex flex-col justify-between bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2.5">
                  <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
                  <span className={`text-sm font-semibold mt-1 ${
                    item.good === true ? 'text-emerald-400' : item.good === false ? 'text-red-400' : 'text-[var(--text-primary)]'
                  }`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly Spend Trend */}
          <div className="card">
            <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.monthlySpendTitle')}</h4>
            <div className="h-48">
              <Bar data={spendChartData} options={{ ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } } }} />
            </div>
          </div>

          {/* Size & Site breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.sizeDistribution')}</h4>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {sizeBreakdown.length === 0 && <p className="text-xs text-[var(--text-dim)]">{t('suppliers.drawer.noSizeData')}</p>}
                {sizeBreakdown.map(([size, count]) => (
                  <div key={size} className="flex items-center gap-2">
                    <div className="flex-1 text-xs text-[var(--text-secondary)] truncate">{size}</div>
                    <div className="w-24 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / supplier.count) * 100}%` }} />
                    </div>
                    <span className="text-xs text-[var(--text-muted)] w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.siteUsage')}</h4>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {siteBreakdown.length === 0 && <p className="text-xs text-[var(--text-dim)]">{t('suppliers.drawer.noSiteData')}</p>}
                {siteBreakdown.map(([site, count]) => (
                  <div key={site} className="flex items-center gap-2">
                    <div className="flex-1 text-xs text-[var(--text-secondary)] truncate">{site}</div>
                    <div className="w-24 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(count / supplier.count) * 100}%` }} />
                    </div>
                    <span className="text-xs text-[var(--text-muted)] w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Admin Rating Override */}
          {isAdmin && (
            <div className="card">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.ratingOverride')}</h4>
              <div className="flex flex-wrap gap-2">
                {RATINGS.map(r => (
                  <button key={r} onClick={() => handleRatingChange(r)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      supplier.rating === r ? `${RATING_CONFIG[r].bg} ${RATING_CONFIG[r].color} ${RATING_CONFIG[r].border}` : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:border-[var(--input-border)]'
                    }`}>
                    {t(`suppliers.ratings.${RATING_I18N_KEYS[r]}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Tab: Performance (tyre records table) ── */}
      {activeTab === 'performance' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('suppliers.drawer.tyreRecords')}</h4>
              <span className="text-xs text-[var(--text-dim)]">{t('suppliers.drawer.totalSuffix', { count: supplier.count })}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--input-border)]">
                    {[
                      t('suppliers.drawer.columns.serial'), t('suppliers.drawer.columns.size'), t('suppliers.drawer.columns.asset'),
                      t('suppliers.drawer.columns.site'), t('suppliers.drawer.columns.cpk'), t('suppliers.drawer.columns.risk'), t('suppliers.drawer.columns.date'),
                    ].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRecs.map(r => {
                    const cpk = calcCpk(Number(r.cost_per_tyre), Number(r.km_at_fitment), Number(r.km_at_removal))
                    const riskColor = { High: 'text-red-400', Critical: 'text-red-500', Medium: 'text-amber-400', Low: 'text-emerald-400' }[r.risk_level] || 'text-[var(--text-muted)]'
                    return (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/30">
                        <td className="px-3 py-2 text-[var(--text-secondary)] font-mono truncate max-w-[80px]">{r.serial_number || '-'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.size || '-'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.asset_no || '-'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.site || '-'}</td>
                        <td className="px-3 py-2"><CpkBadge cpk={cpk} currency={activeCurrency} /></td>
                        <td className={`px-3 py-2 ${riskColor}`}>{r.risk_level || '-'}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{r.issue_date ? formatDate(r.issue_date) : '-'}</td>
                      </tr>
                    )
                  })}
                  {pagedRecs.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-[var(--text-dim)]">{t('suppliers.drawer.noRecords')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--input-border)]">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 flex items-center gap-1">
                  <ChevronLeft size={12} /> {t('suppliers.drawer.prev')}
                </button>
                <span className="text-xs text-[var(--text-dim)]">{t('suppliers.drawer.pageOf', { page: page + 1, total: totalPages })}</span>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 flex items-center gap-1">
                  {t('suppliers.drawer.next')} <ChevronRight size={12} />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Tab: Contracts (history for this supplier, read-only) ── */}
      {activeTab === 'contracts' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {supplierContracts.length === 0 ? (
            <EmptyState
              icon={FileCheck}
              title={t('suppliers.detail.contracts.emptyTitle')}
              description={t('suppliers.detail.contracts.emptyDesc')}
            />
          ) : (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--input-border)]">
                      {[
                        t('suppliers.contracts.columns.start'), t('suppliers.contracts.columns.end'),
                        t('suppliers.contracts.columns.paymentTerms'), t('suppliers.contracts.columns.pricePerUnit'),
                        t('suppliers.contracts.columns.minOrder'), t('suppliers.contracts.columns.status'),
                      ].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[var(--text-muted)] font-medium text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {supplierContracts.map(c => {
                      const status = getContractStatus(c)
                      const statusConfig = {
                        Active: { color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700' },
                        'Expiring Soon': { color: 'text-amber-400', bg: 'bg-amber-900/30', border: 'border-amber-700' },
                        Expired: { color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700' },
                      }[status]
                      return (
                        <tr key={c.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                          <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{c.contract_start || '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{c.contract_end || '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{c.payment_terms || '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{c.price_per_unit ? fmtCurrency(Number(c.price_per_unit), activeCurrency) : '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{c.min_order || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border}`}>
                              {status === 'Expiring Soon' && <AlertTriangle size={9} />}
                              {t(`suppliers.contracts.statuses.${CONTRACT_STATUS_I18N_KEYS[status]}`)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-xs text-[var(--text-dim)] flex items-center gap-1.5">
            <Lock size={11} /> {t('suppliers.detail.contracts.manageHint')}
          </p>
        </motion.div>
      )}

      {/* ── Tab: Notes ── */}
      {activeTab === 'notes' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="card">
            <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('suppliers.drawer.notes')}</h4>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={6}
              placeholder={t('suppliers.drawer.notesPlaceholder')}
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={saveNotes} disabled={noteSaving}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 ${noteSaved ? 'bg-emerald-700 text-emerald-200' : 'bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] text-[var(--text-secondary)]'}`}>
                {noteSaving && <Loader2 size={11} className="animate-spin" />}
                {noteSaving ? t('suppliers.drawer.saving') : noteSaved ? t('suppliers.drawer.saved') : t('suppliers.drawer.saveNotes')}
              </button>
              {noteError && (
                <span className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle size={11} /> {noteError}
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}

      <div className="flex items-center gap-4 flex-wrap px-1">
        {supplier.sites.slice(0, 6).map(s => (
          <span key={s} className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)]">
            <MapPin size={10} />{s}
          </span>
        ))}
      </div>
    </div>
  )
}
