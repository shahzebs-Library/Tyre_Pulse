import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { contractFormSchema } from '../lib/validation/schemas'
import { FormField, FormDate, FormActions } from '../components/forms'
import * as supplierApi from '../lib/api/supplierManagementApi'
import { recordCost } from '../lib/analyticsEngine'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { computeSupplierScorecard } from '../lib/analytics/supplierScorecard'
import { formatDate } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import {
  Building2, Star, TrendingUp, TrendingDown, Minus, Award, AlertTriangle,
  CheckCircle, Clock, Search, Filter, Download, FileText, FileSpreadsheet,
  RefreshCw, ChevronRight, ChevronLeft, ChevronDown, X, Plus, Edit3,
  BarChart3, DollarSign, Truck, Package, Target, Zap, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Users, Calendar, FileCheck, Loader2,
  SlidersHorizontal, Eye, Globe, MapPin, Hash, Upload, Lock,
} from 'lucide-react'
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Line, Radar, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const CPK_BENCHMARK = 1.20
const FAILURE_THRESHOLD = 0.15
const TABS = ['Directory', 'Performance', 'Spend Analysis', 'Contracts', 'Recommendations', 'Scorecard']
const RATINGS = ['Preferred', 'Approved', 'Under Review', 'Probation']
// i18n key lookup for RATINGS/CONTRACT_STATUSES labels (constants stay stable for logic/equality checks)
const RATING_I18N_KEYS = { Preferred: 'preferred', Approved: 'approved', 'Under Review': 'underReview', Probation: 'probation' }
const TAB_I18N_KEYS = ['directory', 'performance', 'spendAnalysis', 'contracts', 'recommendations', 'scorecard']
// Categorical rating <-> numeric (rating column is numeric). Index is 1-based.
const RATING_TO_NUM = RATINGS.reduce((acc, r, i) => { acc[r] = i + 1; return acc }, {})
function ratingToNum(label) { return RATING_TO_NUM[label] ?? null }
function numToRating(num) {
  const idx = Math.round(Number(num)) - 1
  return RATINGS[idx] || null
}
// Whitelisted writable columns
const RATING_COLS = ['brand', 'rating', 'notes', 'country', 'created_by']
const CONTRACT_COLS = ['supplier_name', 'contract_start', 'contract_end', 'payment_terms', 'price_per_unit', 'min_order', 'notes', 'country', 'created_by']
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#a855f7',
]
const RATING_CONFIG = {
  Preferred:     { color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-700', icon: Star },
  Approved:      { color: 'text-blue-400',    bg: 'bg-blue-900/40',    border: 'border-blue-700',    icon: CheckCircle },
  'Under Review':{ color: 'text-amber-400',   bg: 'bg-amber-900/40',   border: 'border-amber-700',   icon: AlertTriangle },
  Probation:     { color: 'text-red-400',     bg: 'bg-red-900/40',     border: 'border-red-700',     icon: ShieldCheck },
}
const CONTRACT_STATUSES = ['Active', 'Expiring Soon', 'Expired']
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
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
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

// Anchor time windows to the data's latest issue_date (fallback: today) so
// historic imports still populate "last 12 months" and YoY views.
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
  const thisYear = anchorYear
  const yearRecs = recs.filter(r => r.issue_date && new Date(r.issue_date).getFullYear() === thisYear)
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

// ── Supabase persistence helpers ─────────────────────────────────────────────
function pick(obj, cols) {
  const out = {}
  cols.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k] })
  return out
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', trend }) {
  const { t } = useLanguage()
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex flex-col gap-1"
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg bg-[var(--input-bg)] ${color}`}>
          <Icon size={15} />
        </div>
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-muted)]">{sub}</div>}
      {trend != null && (
        <div className={`flex items-center gap-1 text-xs ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {t('suppliers.kpi.vsLastYear', { pct: Math.abs(trend).toFixed(1) })}
        </div>
      )}
    </motion.div>
  )
}

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

// ── Contract Modal ─────────────────────────────────────────────────────────────
function ContractModal({ contract, onSave, onClose, onLockChange }) {
  const { t } = useLanguage()
  const [saveError, setSaveError] = useState(null)
  // Approval-engine gate: locks contract Save while the workflow is active
  // (pending/in_review/returned) or locked (approved). Only a saved contract
  // (with an id) is an approvable subject.
  const [wfLocked, setWfLocked] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      supplier_name: contract?.supplier_name ?? '',
      contract_start: contract?.contract_start ?? '',
      contract_end: contract?.contract_end ?? '',
      payment_terms: contract?.payment_terms ?? '',
      price_per_unit: contract?.price_per_unit ?? '',
      min_order: contract?.min_order ?? '',
      notes: contract?.notes ?? '',
    },
  })

  async function submit(values) {
    // Block edits to a contract whose approval workflow is active/locked.
    if (contract?.id && wfLocked) return
    setSaveError(null)
    const err = await onSave(contract?.id ? { ...values, id: contract.id } : values)
    if (err) setSaveError(err)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--input-border)]">
          <h3 className="font-semibold text-[var(--text-primary)]">{contract?.id ? t('suppliers.contractModal.editTitle') : t('suppliers.contractModal.addTitle')}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(submit)} noValidate className="p-5 grid grid-cols-2 gap-3">
          <FormField
            label={t('suppliers.contractModal.supplierName')}
            required
            wrapperClassName="col-span-2"
            error={errors.supplier_name}
            {...register('supplier_name')}
          />
          <FormDate
            label={t('suppliers.contractModal.contractStart')}
            error={errors.contract_start}
            {...register('contract_start')}
          />
          <FormDate
            label={t('suppliers.contractModal.contractEnd')}
            error={errors.contract_end}
            {...register('contract_end')}
          />
          <FormField
            label={t('suppliers.contractModal.paymentTerms')}
            placeholder={t('suppliers.contractModal.paymentTermsPlaceholder')}
            error={errors.payment_terms}
            {...register('payment_terms')}
          />
          <FormField
            label={t('suppliers.contractModal.pricePerUnit')}
            type="number"
            error={errors.price_per_unit}
            {...register('price_per_unit')}
          />
          <FormField
            label={t('suppliers.contractModal.minOrderQty')}
            type="number"
            error={errors.min_order}
            {...register('min_order')}
          />
          <FormField
            label={t('suppliers.contractModal.notes')}
            multiline
            rows={2}
            wrapperClassName="col-span-2"
            error={errors.notes}
            {...register('notes')}
          />
          {saveError && (
            <div className="col-span-2 flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="flex-shrink-0" /> {saveError}
            </div>
          )}
          {contract?.id && wfLocked && (
            <div className="col-span-2 flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
              <Lock size={12} className="flex-shrink-0" /> Locked — in approval
            </div>
          )}
          <FormActions
            className="col-span-2"
            saving={isSubmitting || (!!contract?.id && wfLocked)}
            onCancel={onClose}
            submitLabel={t('suppliers.contractModal.save')}
            savingLabel={contract?.id && wfLocked && !isSubmitting ? t('suppliers.contractModal.save') : t('suppliers.contractModal.saving')}
            cancelLabel={t('suppliers.contractModal.cancel')}
          />
        </form>

        {/* Approval & Workflow — only a persisted contract is an approvable subject */}
        {contract?.id && (
          <div className="p-5 pt-0">
            <EntityApprovalPanel
              entityType="supplier"
              entityId={contract.id}
              entityLabel={contract.supplier_name || contract.id}
              context={{
                contract_value: contract.price_per_unit != null && contract.min_order != null
                  ? Number(contract.price_per_unit) * Number(contract.min_order)
                  : (contract.price_per_unit != null ? Number(contract.price_per_unit) : null),
                price_per_unit: contract.price_per_unit != null ? Number(contract.price_per_unit) : null,
                min_order: contract.min_order != null ? Number(contract.min_order) : null,
                payment_terms: contract.payment_terms || null,
                status: getContractStatus(contract),
                country: contract.country || null,
              }}
              onStateChange={({ isActive, isLocked }) => {
                const locked = !!(isActive || isLocked)
                setWfLocked(locked)
                onLockChange?.(contract.id, locked)
              }}
              title="Supplier Approval"
            />
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Supplier Detail Drawer ─────────────────────────────────────────────────────
function SupplierDrawer({ supplier, allMetrics, records, currency, isAdmin, onClose, onRatingChange, onSaveNotes }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [notes, setNotes] = useState(supplier.notes || '')
  const [noteSaved, setNoteSaved] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteError, setNoteError] = useState(null)
  const [radarKey] = useState(() => Math.random())
  const pageSize = 8
  const months = useMemo(() => getLast12Months(dataAnchorDate(supplier.recs)), [supplier.recs])

  const radarScores = useMemo(() => computeRadarScores(supplier, allMetrics), [supplier, allMetrics])

  const monthlySpend = useMemo(() => {
    return months.map(m => {
      const recs = supplier.recs.filter(r => toMonthKey(r.issue_date) === m)
      return recs.reduce((s, r) => s + recordCost(r), 0)
    })
  }, [supplier.recs, months])

  const sizeBreakdown = useMemo(() => {
    const map = {}
    supplier.recs.forEach(r => { if (r.size) map[r.size] = (map[r.size] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [supplier.recs])

  const siteBreakdown = useMemo(() => {
    const map = {}
    supplier.recs.forEach(r => { if (r.site) map[r.site] = (map[r.site] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [supplier.recs])

  const pagedRecs = supplier.recs.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.ceil(supplier.recs.length / pageSize)

  useEffect(() => { setNotes(supplier.notes || ''); setNoteSaved(false); setNoteError(null) }, [supplier.brand, supplier.notes])

  async function saveNotes() {
    setNoteSaving(true)
    setNoteError(null)
    const err = await onSaveNotes(supplier.brand, notes)
    setNoteSaving(false)
    if (err) { setNoteError(err); return }
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2000)
  }

  const radarData = {
    labels: [t('suppliers.radarLabels.cpkScore'), t('suppliers.radarLabels.lifeScore'), t('suppliers.radarLabels.reliability'), t('suppliers.radarLabels.value'), t('suppliers.radarLabels.coverage')],
    datasets: [{
      label: supplier.brand,
      data: [radarScores.cpkScore, radarScores.lifeScore, radarScores.reliabilityScore, radarScores.valueScore, radarScores.coverageScore],
      backgroundColor: 'rgba(59,130,246,0.2)',
      borderColor: '#3b82f6',
      pointBackgroundColor: '#3b82f6',
      borderWidth: 2,
    }],
  }

  const radarOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { color: '#6b7280', font: { size: 10 }, stepSize: 25 },
        grid: { color:'var(--text-muted)' },
        pointLabels: { color: '#9ca3af', font: { size: 11 } },
        angleLines: { color:'var(--text-muted)' },
      },
    },
  }

  const spendChartData = {
    labels: months.map(m => { const [y, mo] = m.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]}` }),
    datasets: [{
      label: t('suppliers.monthlySpendLabel'),
      data: monthlySpend,
      backgroundColor: 'rgba(59,130,246,0.7)',
      borderColor: '#3b82f6',
      borderRadius: 4,
    }],
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed right-0 top-0 h-full w-full max-w-2xl bg-[var(--surface-1)] border-l border-[var(--input-border)] z-40 flex flex-col shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--input-border)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-900/40 border border-blue-700 flex items-center justify-center">
            <Building2 size={18} className="text-blue-400" />
          </div>
          <div>
            <h2 className="font-bold text-[var(--text-primary)] text-lg leading-none">{supplier.brand}</h2>
            <div className="flex items-center gap-2 mt-1">
              <RatingBadge rating={supplier.rating} />
              <span className="text-xs text-[var(--text-muted)]">{supplier.count} {t('suppliers.drawer.tyresSuffix')}</span>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-2 rounded-lg hover:bg-[var(--input-bg)]">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Radar + Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card">
            <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.radarTitle')}</h4>
            <div className="h-48">
              <Radar key={radarKey} data={radarData} options={radarOpts} />
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: t('suppliers.drawer.stats.avgCpk'), value: fmtCpk(supplier.avgCpk, currency), good: supplier.avgCpk != null && supplier.avgCpk <= CPK_BENCHMARK },
              { label: t('suppliers.drawer.stats.avgTyreLife'), value: fmtKm(supplier.avgLife), good: supplier.avgLife > 80000 },
              { label: t('suppliers.drawer.stats.failureRate'), value: fmtPct(supplier.failureRate), good: supplier.failureRate < FAILURE_THRESHOLD },
              { label: t('suppliers.drawer.stats.spendThisYear'), value: fmtCurrency(supplier.spendThisYear, currency), good: null },
              { label: t('suppliers.drawer.stats.totalSpend'), value: fmtCurrency(supplier.totalSpend, currency), good: null },
              { label: t('suppliers.drawer.stats.sitesUsed'), value: supplier.sites.length, good: null },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
                <span className={`text-sm font-semibold ${
                  item.good === true ? 'text-emerald-400' : item.good === false ? 'text-red-400' : 'text-[var(--text-primary)]'
                }`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Spend Trend */}
        <div className="card">
          <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.monthlySpendTitle')}</h4>
          <div className="h-40">
            <Bar data={spendChartData} options={{ ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } } }} />
          </div>
        </div>

        {/* Size & Site Breakdown */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card">
            <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.sizeDistribution')}</h4>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {sizeBreakdown.length === 0 && <p className="text-xs text-[var(--text-dim)]">{t('suppliers.drawer.noSizeData')}</p>}
              {sizeBreakdown.map(([size, count]) => (
                <div key={size} className="flex items-center gap-2">
                  <div className="flex-1 text-xs text-[var(--text-secondary)] truncate">{size}</div>
                  <div className="w-20 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / supplier.count) * 100}%` }} />
                  </div>
                  <span className="text-xs text-[var(--text-muted)] w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.siteUsage')}</h4>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {siteBreakdown.length === 0 && <p className="text-xs text-[var(--text-dim)]">{t('suppliers.drawer.noSiteData')}</p>}
              {siteBreakdown.map(([site, count]) => (
                <div key={site} className="flex items-center gap-2">
                  <div className="flex-1 text-xs text-[var(--text-secondary)] truncate">{site}</div>
                  <div className="w-20 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(count / supplier.count) * 100}%` }} />
                  </div>
                  <span className="text-xs text-[var(--text-muted)] w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tyre Records Table */}
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
                      <td className="px-3 py-2"><CpkBadge cpk={cpk} currency={currency} /></td>
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

        {/* Admin Rating Override */}
        {isAdmin && (
          <div className="card">
            <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('suppliers.drawer.ratingOverride')}</h4>
            <div className="flex flex-wrap gap-2">
              {RATINGS.map(r => (
                <button key={r} onClick={() => onRatingChange(supplier.brand, r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    supplier.rating === r ? `${RATING_CONFIG[r].bg} ${RATING_CONFIG[r].color} ${RATING_CONFIG[r].border}` : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:border-[var(--input-border)]'
                  }`}>
                  {t(`suppliers.ratings.${RATING_I18N_KEYS[r]}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="card">
          <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('suppliers.drawer.notes')}</h4>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
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
      </div>
    </motion.div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SupplierManagement() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { activeCurrency, activeCountry } = useSettings()
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [search, setSearch] = useState('')
  const [filterCountry, setFilterCountry] = useState('All')
  const [filterSite, setFilterSite] = useState('All')
  const [filterRating, setFilterRating] = useState('All')
  // ratings: { [brand]: { label, notes, id } } - persisted in supplier_ratings
  const [ratings, setRatings] = useState({})
  const [ratingsError, setRatingsError] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [compareList, setCompareList] = useState([])
  const [contracts, setContracts] = useState([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [contractsError, setContractsError] = useState(null)
  const [contractModal, setContractModal] = useState(null)
  // Approval-engine gate: id of the contract whose workflow is active/locked, so
  // its row-level edit/delete controls are blocked while it is in approval.
  const [lockedContractId, setLockedContractId] = useState(null)
  const [contractSearch, setContractSearch] = useState('')
  const [contractDeleteTarget, setContractDeleteTarget] = useState(null)
  const [contractDeleteError, setContractDeleteError] = useState(null)
  const [contractDeleting, setContractDeleting] = useState(false)
  // Scorecard source data (warranty claims + purchase orders); tyres come from `records`.
  const [scWarranty, setScWarranty] = useState([])
  const [scPos, setScPos] = useState([])

  // Load tyre records
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await fetchAllPages((from, to) =>
      supplierApi.listSupplierTyres({ from, to, country: activeCountry }))
    if (err) { setError(err.message); setLoading(false); return }
    setRecords(data || [])
    setLoading(false)
  }, [activeCountry])

  // Load supplier ratings/notes
  const fetchRatings = useCallback(async () => {
    setRatingsError(null)
    const { data, error: err } = await supplierApi.listSupplierRatings({ country: activeCountry })
    if (err) { setRatingsError(err.message); return }
    const map = {}
    ;(data || []).forEach(row => {
      map[row.brand] = { id: row.id, label: numToRating(row.rating), notes: row.notes || '' }
    })
    setRatings(map)
  }, [activeCountry])

  // Load contracts
  const fetchContracts = useCallback(async () => {
    setContractsLoading(true)
    setContractsError(null)
    const { data, error: err } = await supplierApi.listSupplierContracts({ country: activeCountry })
    if (err) { setContractsError(err.message); setContractsLoading(false); return }
    setContracts(data || [])
    setContractsLoading(false)
  }, [activeCountry])

  // Load warranty claims + purchase orders for the supplier scorecard.
  const fetchScorecardSources = useCallback(async () => {
    const [{ data: w }, { data: p }] = await Promise.all([
      supplierApi.listScorecardWarrantyClaims({ country: activeCountry }),
      supplierApi.listScorecardPurchaseOrders({ country: activeCountry }),
    ])
    setScWarranty(w || [])
    setScPos(p || [])
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { fetchRatings() }, [fetchRatings])
  useEffect(() => { fetchContracts() }, [fetchContracts])
  useEffect(() => { fetchScorecardSources() }, [fetchScorecardSources])

  // Supplier scorecard - tyre supplier falls back to brand (brand-proxied), matching
  // this page's brand-centric model. Cost is ACTUAL only (no fabricated defaults).
  const scorecard = useMemo(() => computeSupplierScorecard({
    tyres: (records || []).map((r) => ({ ...r, supplier: r.supplier || r.brand })),
    warranty: scWarranty,
    purchaseOrders: scPos,
  }), [records, scWarranty, scPos])

  // Derived: unique values for filters
  const countries = useMemo(() => ['All', ...new Set(records.map(r => r.country).filter(Boolean))], [records])
  const sites = useMemo(() => ['All', ...new Set(records.map(r => r.site).filter(Boolean))], [records])

  // Filter records by country/site
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filterCountry !== 'All' && r.country !== filterCountry) return false
      if (filterSite !== 'All' && r.site !== filterSite) return false
      return true
    })
  }, [records, filterCountry, filterSite])

  // All supplier metrics
  const allMetrics = useMemo(() => {
    const brands = [...new Set(filteredRecords.map(r => r.brand).filter(Boolean))]
    const anchorYear = dataAnchorDate(filteredRecords).getFullYear()
    return brands.map(brand => {
      const m = computeSupplierMetrics(filteredRecords, brand, anchorYear)
      const entry = ratings[brand]
      const rating = entry?.label || autoRate(m)
      return { ...m, rating, notes: entry?.notes || '' }
    })
  }, [filteredRecords, ratings])

  function autoRate(m) {
    if (m.avgCpk != null && m.avgCpk <= CPK_BENCHMARK * 0.9 && m.failureRate < 0.1) return 'Preferred'
    if (m.failureRate > FAILURE_THRESHOLD * 1.5) return 'Probation'
    if (m.failureRate > FAILURE_THRESHOLD || (m.avgCpk != null && m.avgCpk > CPK_BENCHMARK * 1.3)) return 'Under Review'
    return 'Approved'
  }

  // Filtered suppliers for directory
  const filteredSuppliers = useMemo(() => {
    return allMetrics.filter(s => {
      if (search && !s.brand.toLowerCase().includes(search.toLowerCase())) return false
      if (filterRating !== 'All' && s.rating !== filterRating) return false
      return true
    })
  }, [allMetrics, search, filterRating])

  // KPI summary
  const kpiSummary = useMemo(() => {
    const cpks = allMetrics.map(m => m.avgCpk).filter(Boolean)
    const preferred = allMetrics.filter(m => m.rating === 'Preferred')
    const sortedByCpk = allMetrics.filter(m => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
    return {
      total: allMetrics.length,
      preferredCount: preferred.length,
      cpkMin: cpks.length ? Math.min(...cpks) : null,
      cpkMax: cpks.length ? Math.max(...cpks) : null,
      best: sortedByCpk[0] || null,
      worst: sortedByCpk[sortedByCpk.length - 1] || null,
    }
  }, [allMetrics])

  const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : null

  // Upsert one supplier_ratings row per (brand, country), preserving the other field.
  async function upsertRating(brand, { label, notes }) {
    const existing = ratings[brand] || {}
    const payload = pick({
      brand,
      rating: ratingToNum(label !== undefined ? label : existing.label),
      notes: notes !== undefined ? notes : (existing.notes || ''),
      country: scopedCountry,
      created_by: user?.id || null,
    }, RATING_COLS)
    const { error: err } = await supplierApi.upsertSupplierRating(payload)
    if (err) return err.message
    await fetchRatings()
    return null
  }

  // Rating override (Admin)
  async function handleRatingChange(brand, rating) {
    const err = await upsertRating(brand, { label: rating })
    if (err) { setRatingsError(err); return }
    if (selectedSupplier?.brand === brand) {
      setSelectedSupplier(prev => ({ ...prev, rating }))
    }
  }

  // Notes save (returns error string or null)
  async function handleSaveNotes(brand, notes) {
    const err = await upsertRating(brand, { notes })
    if (!err && selectedSupplier?.brand === brand) {
      setSelectedSupplier(prev => ({ ...prev, notes }))
    }
    return err
  }

  // Compare list
  function toggleCompare(brand) {
    setCompareList(prev => {
      if (prev.includes(brand)) return prev.filter(b => b !== brand)
      if (prev.length >= 4) return prev
      return [...prev, brand]
    })
  }

  // Contract management - returns error string or null
  async function saveContract(contract) {
    const payload = pick({
      supplier_name: contract.supplier_name?.trim() || '',
      contract_start: contract.contract_start || null,
      contract_end: contract.contract_end || null,
      payment_terms: contract.payment_terms || null,
      price_per_unit: contract.price_per_unit === '' || contract.price_per_unit == null ? null : Number(contract.price_per_unit),
      min_order: contract.min_order === '' || contract.min_order == null ? null : Number(contract.min_order),
      notes: contract.notes || null,
      country: scopedCountry,
      created_by: user?.id || null,
    }, CONTRACT_COLS)

    let err
    if (contract.id) {
      ;({ error: err } = await supplierApi.updateSupplierContract(contract.id, payload))
    } else {
      ;({ error: err } = await supplierApi.insertSupplierContract(payload))
    }
    if (err) return err.message
    await fetchContracts()
    setContractModal(null)
    return null
  }

  async function deleteContract() {
    if (!contractDeleteTarget) return
    setContractDeleting(true)
    setContractDeleteError(null)
    const { data, error: err } = await supplierApi.deleteSupplierContract(contractDeleteTarget.id)
    if (err || (data?.length ?? 0) === 0) {
      setContractDeleteError(err?.message || t('suppliers.deleteContract.defaultError'))
      setContractDeleting(false)
      return
    }
    setContractDeleting(false)
    setContractDeleteTarget(null)
    await fetchContracts()
  }

  // Export
  function handleExcelExport() {
    const rows = allMetrics.map(m => ({
      brand: m.brand,
      rating: m.rating,
      count: m.count,
      avg_cpk: m.avgCpk != null ? m.avgCpk.toFixed(4) : 'N/A',
      avg_life_km: m.avgLife ? Math.round(m.avgLife) : 'N/A',
      failure_rate: m.failureRate != null ? (m.failureRate * 100).toFixed(1) + '%' : 'N/A',
      spend_this_year: Math.round(m.spendThisYear),
      total_spend: Math.round(m.totalSpend),
      sites: m.sites.join(', '),
      countries: m.countries.join(', '),
    }))
    exportToExcel(rows,
      ['brand','rating','count','avg_cpk','avg_life_km','failure_rate','spend_this_year','total_spend','sites','countries'],
      ['Supplier','Rating','Tyres','Avg CPK','Avg Life (km)','Failure Rate','Spend YTD','Total Spend','Sites','Countries'],
      'supplier_management', 'Suppliers')
  }

  function handlePdfExport() {
    const rows = allMetrics.map(m => ({
      brand: m.brand,
      rating: m.rating,
      count: m.count,
      avg_cpk: m.avgCpk != null ? m.avgCpk.toFixed(4) : 'N/A',
      avg_life_km: m.avgLife ? Math.round(m.avgLife).toLocaleString() : 'N/A',
      failure_rate: m.failureRate != null ? (m.failureRate * 100).toFixed(1) + '%' : 'N/A',
      spend_ytd: fmtCurrency(m.spendThisYear, activeCurrency),
    }))
    exportToPdf(rows,
      [
        { key: 'brand', header: 'Supplier' },
        { key: 'rating', header: 'Rating' },
        { key: 'count', header: 'Tyres' },
        { key: 'avg_cpk', header: 'Avg CPK' },
        { key: 'avg_life_km', header: 'Avg Life' },
        { key: 'failure_rate', header: 'Failure %' },
        { key: 'spend_ytd', header: 'Spend YTD' },
      ],
      'Supplier Performance Report', 'supplier_performance_report', 'landscape')
  }

  // ── Procurement Recommendations ────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []
    if (allMetrics.length === 0) return recs
    const fleetAvgCpk = (() => {
      const cpks = allMetrics.map(m => m.avgCpk).filter(Boolean)
      return cpks.length ? cpks.reduce((s, v) => s + v, 0) / cpks.length : CPK_BENCHMARK
    })()
    const sorted = [...allMetrics].filter(m => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    if (best && fleetAvgCpk > 0) {
      const pct = ((fleetAvgCpk - best.avgCpk) / fleetAvgCpk * 100).toFixed(1)
      if (parseFloat(pct) > 5) {
        recs.push({ type: 'increase', brand: best.brand, msg: t('suppliers.recommendations.messages.increase', { brand: best.brand, cpk: fmtCpk(best.avgCpk, activeCurrency), pct }), impact: 'High' })
      }
    }
    allMetrics.filter(m => m.failureRate > FAILURE_THRESHOLD).forEach(m => {
      recs.push({ type: 'review', brand: m.brand, msg: t('suppliers.recommendations.messages.review', { brand: m.brand, rate: (m.failureRate * 100).toFixed(1), threshold: (FAILURE_THRESHOLD * 100).toFixed(0) }), impact: 'Critical' })
    })
    if (worst && best && worst.brand !== best.brand && worst.avgCpk != null && best.avgCpk != null) {
      const annualRecs = worst.recs.length
      const saving = (worst.avgCpk - best.avgCpk) * worst.recs.reduce((s, r) => {
        const km = Number(r.km_at_removal || 0) - Number(r.km_at_fitment || 0)
        return s + (km > 0 ? km : 80000)
      }, 0)
      if (saving > 1000) {
        recs.push({ type: 'saving', brand: worst.brand, msg: t('suppliers.recommendations.messages.saving', { worstBrand: worst.brand, bestBrand: best.brand, amount: fmtCurrency(saving, activeCurrency) }), impact: 'High' })
      }
    }
    // Size consolidation
    const sizeMap = {}
    allMetrics.forEach(m => {
      m.sizes.forEach(sz => {
        const recs2 = m.recs.filter(r => r.size === sz)
        const cpks2 = recs2.map(r => calcCpk(Number(r.cost_per_tyre), Number(r.km_at_fitment), Number(r.km_at_removal))).filter(Boolean)
        const avgCpk2 = cpks2.length ? cpks2.reduce((s, v) => s + v, 0) / cpks2.length : null
        if (!sizeMap[sz] || (avgCpk2 != null && avgCpk2 < (sizeMap[sz].cpk ?? Infinity))) {
          sizeMap[sz] = { brand: m.brand, cpk: avgCpk2 }
        }
      })
    })
    const topSizes = Object.entries(sizeMap).slice(0, 2)
    topSizes.forEach(([sz, info]) => {
      if (info.cpk != null) {
        recs.push({ type: 'consolidate', brand: info.brand, msg: t('suppliers.recommendations.messages.consolidate', { size: sz, brand: info.brand, cpk: fmtCpk(info.cpk, activeCurrency) }), impact: 'Medium' })
      }
    })
    return recs.slice(0, 8)
  }, [allMetrics, activeCurrency, t])

  // ── Spend Analysis ─────────────────────────────────────────────────────────
  const spendAnalysis = useMemo(() => {
    const anchor = dataAnchorDate(filteredRecords)
    const months12 = getLast12Months(anchor)
    const top5 = [...allMetrics].sort((a, b) => b.spendThisYear - a.spendThisYear).slice(0, 5)
    const top5Brands = top5.map(m => m.brand)

    const monthlyByBrand = top5Brands.map(brand => {
      const m = allMetrics.find(x => x.brand === brand)
      return months12.map(mo => {
        const recs = (m?.recs || []).filter(r => toMonthKey(r.issue_date) === mo)
        return recs.reduce((s, r) => s + recordCost(r), 0)
      })
    })

    const otherMonthly = months12.map((mo, idx) => {
      const topTotal = top5Brands.reduce((s, brand, bi) => s + (monthlyByBrand[bi][idx] || 0), 0)
      const totalMo = allMetrics.reduce((s, m) => {
        const recs = m.recs.filter(r => toMonthKey(r.issue_date) === mo)
        return s + recs.reduce((ss, r) => ss + recordCost(r), 0)
      }, 0)
      return Math.max(0, totalMo - topTotal)
    })

    const totalSpend = allMetrics.reduce((s, m) => s + m.totalSpend, 0)

    const doughnutData = {
      labels: [...top5.map(m => m.brand), 'Other'],
      datasets: [{
        data: [...top5.map(m => m.totalSpend), Math.max(0, totalSpend - top5.reduce((s, m) => s + m.totalSpend, 0))],
        backgroundColor: [...PALETTE.slice(0, 5), '#6b7280'],
        borderWidth: 0,
      }],
    }

    const stackedData = {
      labels: months12.map(m => { const [, mo] = m.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1] }),
      datasets: [
        ...top5Brands.map((brand, i) => ({
          label: brand, data: monthlyByBrand[i],
          backgroundColor: PALETTE[i % PALETTE.length], borderWidth: 0, stack: 'a',
        })),
        { label: 'Other', data: otherMonthly, backgroundColor: '#6b7280', borderWidth: 0, stack: 'a' },
      ],
    }

    // YoY change (latest data year vs prior year)
    const thisYear = anchor.getFullYear()
    const lastYear = thisYear - 1
    const yoy = allMetrics.map(m => {
      const tySpend = m.recs.filter(r => r.issue_date && new Date(r.issue_date).getFullYear() === thisYear).reduce((s, r) => s + recordCost(r), 0)
      const lySpend = m.recs.filter(r => r.issue_date && new Date(r.issue_date).getFullYear() === lastYear).reduce((s, r) => s + recordCost(r), 0)
      const change = lySpend > 0 ? ((tySpend - lySpend) / lySpend) * 100 : null
      return { brand: m.brand, thisYear: tySpend, lastYear: lySpend, change }
    }).filter(y => y.thisYear > 0 || y.lastYear > 0).sort((a, b) => b.thisYear - a.thisYear)

    return { doughnutData, stackedData, yoy, top5, totalSpend }
  }, [allMetrics, filteredRecords])

  // ── Performance Comparison ─────────────────────────────────────────────────
  const compareData = useMemo(() => {
    const selected = allMetrics.filter(m => compareList.includes(m.brand))
    if (selected.length === 0) return null
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
    return {
      labels: ['CPK Score', 'Life Score', 'Reliability', 'Value', 'Coverage'],
      datasets: selected.map((m, i) => {
        const scores = computeRadarScores(m, allMetrics)
        return {
          label: m.brand,
          data: [scores.cpkScore, scores.lifeScore, scores.reliabilityScore, scores.valueScore, scores.coverageScore],
          backgroundColor: `${colors[i]}33`,
          borderColor: colors[i],
          pointBackgroundColor: colors[i],
          borderWidth: 2,
        }
      }),
    }
  }, [compareList, allMetrics])

  const compareStats = useMemo(() => {
    return allMetrics.filter(m => compareList.includes(m.brand))
  }, [compareList, allMetrics])

  // ── Filtered contracts ─────────────────────────────────────────────────────
  const filteredContracts = useMemo(() => {
    return contracts.filter(c => !contractSearch || c.supplier_name?.toLowerCase().includes(contractSearch.toLowerCase()))
  }, [contracts, contractSearch])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="space-y-4">
      <SkeletonCards count={4} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
        <p className="text-red-400 font-medium">{t('suppliers.errors.loadFailed')}</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
        <button onClick={fetchData} className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">{t('suppliers.retry')}</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('suppliers.title')}
        subtitle={t('suppliers.subtitle')}
        icon={Building2}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => navigate('/data-intake?module=supplier')} className="btn-primary gap-1.5">
              <Upload size={13} /> {t('suppliers.actions.import')}
            </button>
            <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg">
              <RefreshCw size={13} /> {t('suppliers.actions.refresh')}
            </button>
            <button onClick={handleExcelExport} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded-lg">
              <FileSpreadsheet size={13} /> {t('suppliers.actions.excel')}
            </button>
            <button onClick={handlePdfExport} className="flex items-center gap-1.5 px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg">
              <FileText size={13} /> {t('suppliers.actions.pdf')}
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard icon={Building2} label={t('suppliers.kpi.totalSuppliers')} value={kpiSummary.total} sub={t('suppliers.kpi.uniqueBrands')} color="text-blue-400" />
        <KpiCard icon={Star} label={t('suppliers.kpi.preferred')} value={kpiSummary.preferredCount} sub={t('suppliers.kpi.ofTotalSuppliers', { total: kpiSummary.total })} color="text-emerald-400" />
        <KpiCard icon={Target} label={t('suppliers.kpi.cpkRange')}
          value={kpiSummary.cpkMin != null ? `${fmtCpk(kpiSummary.cpkMin, activeCurrency).split(' ')[1]}` : t('suppliers.recommendations.na')}
          sub={kpiSummary.cpkMax != null ? t('suppliers.kpi.toValue', { value: fmtCpk(kpiSummary.cpkMax, activeCurrency) }) : '-'}
          color="text-purple-400" />
        <KpiCard icon={Award} label={t('suppliers.kpi.bestCpk')} value={kpiSummary.best?.brand || t('suppliers.recommendations.na')} sub={kpiSummary.best ? fmtCpk(kpiSummary.best.avgCpk, activeCurrency) : '-'} color="text-emerald-400" />
        <KpiCard icon={AlertTriangle} label={t('suppliers.kpi.worstCpk')} value={kpiSummary.worst?.brand || t('suppliers.recommendations.na')} sub={kpiSummary.worst ? fmtCpk(kpiSummary.worst.avgCpk, activeCurrency) : '-'} color="text-red-400" />
      </div>

      {/* Ratings persistence error banner */}
      {ratingsError && (
        <div className="flex items-center justify-between gap-3 bg-red-900/20 border border-red-800 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle size={15} className="flex-shrink-0" />
            <span>{t('suppliers.ratingsError', { message: ratingsError })}</span>
          </div>
          <button onClick={fetchRatings} className="px-3 py-1.5 bg-red-800/40 hover:bg-red-800/60 text-red-200 text-xs rounded-lg flex-shrink-0">{t('suppliers.retry')}</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('suppliers.searchPlaceholder')}
            className="pl-7 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 w-44" />
        </div>
        {[
          { label: 'Country', allKey: 'allCountries', value: filterCountry, opts: countries, set: setFilterCountry },
          { label: 'Site', allKey: 'allSites', value: filterSite, opts: sites, set: setFilterSite },
          { label: 'Rating', allKey: 'allRatings', value: filterRating, opts: ['All', ...RATINGS], set: setFilterRating },
        ].map(f => (
          <div key={f.label} className="relative">
            <select value={f.value} onChange={e => f.set(e.target.value)}
              className="appearance-none bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] px-3 py-2 pr-7 focus:outline-none focus:border-blue-500">
              {f.opts.map(o => <option key={o} value={o}>{o === 'All' ? t(`suppliers.filters.${f.allKey}`) : (f.label === 'Rating' ? t(`suppliers.ratings.${RATING_I18N_KEYS[o]}`) : o)}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-3 text-[var(--text-muted)] pointer-events-none" />
          </div>
        ))}
        {(search || filterCountry !== 'All' || filterSite !== 'All' || filterRating !== 'All') && (
          <button onClick={() => { setSearch(''); setFilterCountry('All'); setFilterSite('All'); setFilterRating('All') }}
            className="flex items-center gap-1 px-2 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--input-bg)] rounded-lg">
            <X size={12} /> {t('suppliers.filters.clear')}
          </button>
        )}
        <span className="text-xs text-[var(--text-dim)] ml-auto">{t('suppliers.suppliersCount', { count: filteredSuppliers.length })}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 w-full overflow-x-auto">
        {TABS.map((tabLabel, i) => (
          <button key={tabLabel} onClick={() => setActiveTab(i)}
            className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === i ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
            }`}>
            {t(`suppliers.tabs.${TAB_I18N_KEYS[i]}`)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* Tab 0: Directory */}
        {activeTab === 0 && (
          <motion.div key="dir" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {filteredSuppliers.length === 0 ? (
              <EmptyState
                illustration="module/purchase-orders"
                icon={Building2}
                title={t('suppliers.directory.emptyTitle')}
                description={t('suppliers.directory.emptyDesc')}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredSuppliers.map((supplier, idx) => {
                  const cfg = RATING_CONFIG[supplier.rating] || RATING_CONFIG['Approved']
                  const inCompare = compareList.includes(supplier.brand)
                  return (
                    <motion.div
                      key={supplier.brand}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="card flex flex-col gap-3 hover:border-[var(--input-border)] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-lg bg-[var(--input-bg)] flex items-center justify-center text-[var(--text-secondary)] font-bold text-sm">
                            {supplier.brand.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-semibold text-[var(--text-primary)] text-sm leading-tight">{supplier.brand}</h3>
                            <RatingBadge rating={supplier.rating} />
                          </div>
                        </div>
                        <button onClick={() => toggleCompare(supplier.brand)}
                          className={`p-1.5 rounded-lg text-xs transition-colors ${inCompare ? 'bg-blue-600 text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                          title={inCompare ? t('suppliers.directory.removeFromCompare') : t('suppliers.directory.addToCompare')}>
                          <BarChart3 size={13} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-[var(--input-bg)]/60 rounded-lg px-2.5 py-1.5">
                          <div className="text-xs text-[var(--text-muted)]">{t('suppliers.directory.spendYtd')}</div>
                          <div className="text-sm font-semibold text-[var(--text-primary)]">{fmtCurrency(supplier.spendThisYear, activeCurrency)}</div>
                        </div>
                        <div className="bg-[var(--input-bg)]/60 rounded-lg px-2.5 py-1.5">
                          <div className="text-xs text-[var(--text-muted)]">{t('suppliers.directory.tyres')}</div>
                          <div className="text-sm font-semibold text-[var(--text-primary)]">{supplier.count}</div>
                        </div>
                        <div className="bg-[var(--input-bg)]/60 rounded-lg px-2.5 py-1.5">
                          <div className="text-xs text-[var(--text-muted)]">{t('suppliers.directory.avgCpk')}</div>
                          <CpkBadge cpk={supplier.avgCpk} currency={activeCurrency} />
                        </div>
                        <div className="bg-[var(--input-bg)]/60 rounded-lg px-2.5 py-1.5">
                          <div className="text-xs text-[var(--text-muted)]">{t('suppliers.directory.failurePct')}</div>
                          <div className={`text-sm font-semibold ${supplier.failureRate > FAILURE_THRESHOLD ? 'text-red-400' : 'text-emerald-400'}`}>
                            {fmtPct(supplier.failureRate)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        {supplier.countries.slice(0, 2).map(c => (
                          <span key={c} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--input-bg)] rounded text-xs text-[var(--text-muted)]">
                            <Globe size={9} />{c}
                          </span>
                        ))}
                        {supplier.sites.slice(0, 2).map(s => (
                          <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--input-bg)] rounded text-xs text-[var(--text-muted)]">
                            <MapPin size={9} />{s}
                          </span>
                        ))}
                        {(supplier.countries.length + supplier.sites.length) > 4 && (
                          <span className="text-xs text-[var(--text-dim)]">+{supplier.countries.length + supplier.sites.length - 4} more</span>
                        )}
                      </div>

                      <button onClick={() => setSelectedSupplier(supplier)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] hover:border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <Eye size={12} /> {t('suppliers.directory.viewDetails')}
                      </button>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* Tab 1: Performance Comparison */}
        {activeTab === 1 && (
          <motion.div key="perf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">{t('suppliers.performance.selectToCompare')}</h3>
                {compareList.length > 0 && (
                  <button onClick={() => setCompareList([])} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1">
                    <X size={12} /> {t('suppliers.performance.clearSelection')}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {allMetrics.map(m => {
                  const sel = compareList.includes(m.brand)
                  return (
                    <button key={m.brand} onClick={() => toggleCompare(m.brand)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        sel ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:border-[var(--input-border)]'
                      } ${!sel && compareList.length >= 4 ? 'opacity-40 cursor-not-allowed' : ''}`}
                      disabled={!sel && compareList.length >= 4}>
                      {m.brand}
                    </button>
                  )
                })}
              </div>
            </div>

            {compareList.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title={t('suppliers.performance.emptyTitle')}
                description={t('suppliers.performance.emptyDesc')}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="card">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{t('suppliers.performance.radarTitle')}</h4>
                    <div className="h-72">
                      {compareData && (
                        <Radar data={compareData} options={{
                          responsive: true, maintainAspectRatio: false,
                          plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
                          scales: {
                            r: {
                              min: 0, max: 100,
                              ticks: { color: '#6b7280', font: { size: 10 }, stepSize: 25 },
                              grid: { color:'var(--text-muted)' },
                              pointLabels: { color: '#9ca3af', font: { size: 11 } },
                              angleLines: { color:'var(--text-muted)' },
                            },
                          },
                        }} />
                      )}
                    </div>
                  </div>

                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--input-border)]">
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('suppliers.performance.sideBySide')}</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[var(--input-border)]">
                            <th className="px-3 py-2.5 text-left text-[var(--text-muted)] font-medium">{t('suppliers.performance.metric')}</th>
                            {compareStats.map(m => (
                              <th key={m.brand} className="px-3 py-2.5 text-right text-[var(--text-muted)] font-semibold">{m.brand}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { label: t('suppliers.performance.rows.avgCpk'), key: 'avgCpk', fmt: v => fmtCpk(v, activeCurrency), lowerBetter: true },
                            { label: t('suppliers.performance.rows.avgLifeKm'), key: 'avgLife', fmt: v => fmtKm(v), lowerBetter: false },
                            { label: t('suppliers.performance.rows.failureRate'), key: 'failureRate', fmt: v => fmtPct(v), lowerBetter: true },
                            { label: t('suppliers.performance.rows.tyreCount'), key: 'count', fmt: v => v, lowerBetter: false },
                            { label: t('suppliers.performance.rows.spendYtd'), key: 'spendThisYear', fmt: v => fmtCurrency(v, activeCurrency), lowerBetter: false },
                            { label: t('suppliers.performance.rows.totalSpend'), key: 'totalSpend', fmt: v => fmtCurrency(v, activeCurrency), lowerBetter: false },
                            { label: t('suppliers.performance.rows.rating'), key: 'rating', fmt: v => (RATING_I18N_KEYS[v] ? t(`suppliers.ratings.${RATING_I18N_KEYS[v]}`) : v), lowerBetter: null },
                          ].map(row => {
                            const vals = compareStats.map(m => m[row.key])
                            const numVals = vals.filter(v => typeof v === 'number' && isFinite(v))
                            const best = numVals.length ? (row.lowerBetter ? Math.min(...numVals) : Math.max(...numVals)) : null
                            return (
                              <tr key={row.label} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                                <td className="px-3 py-2.5 text-[var(--text-muted)]">{row.label}</td>
                                {compareStats.map(m => {
                                  const v = m[row.key]
                                  const isWinner = typeof v === 'number' && isFinite(v) && v === best
                                  return (
                                    <td key={m.brand} className={`px-3 py-2.5 text-right font-mono ${isWinner ? 'text-emerald-400 font-semibold' : 'text-[var(--text-secondary)]'}`}>
                                      {row.fmt(v)}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* Tab 2: Spend Analysis */}
        {activeTab === 2 && (
          <motion.div key="spend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="card">
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{t('suppliers.spend.shareTitle')}</h4>
                <div className="h-64 flex items-center justify-center">
                  {spendAnalysis.doughnutData.datasets[0].data.some(v => v > 0) ? (
                    <Doughnut data={spendAnalysis.doughnutData} options={{
                      responsive: true, maintainAspectRatio: false, cutout: '65%',
                      plugins: {
                        legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, padding: 10 } },
                        tooltip: CHART_DEFAULTS.plugins.tooltip,
                      },
                    }} />
                  ) : (
                    <p className="text-[var(--text-dim)] text-sm">{t('suppliers.spend.noData')}</p>
                  )}
                </div>
                <div className="mt-3 text-center">
                  <span className="text-xs text-[var(--text-muted)]">{t('suppliers.spend.totalSpend')}</span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{fmtCurrency(spendAnalysis.totalSpend, activeCurrency)}</span>
                </div>
              </div>

              <div className="card">
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{t('suppliers.spend.monthlyTitle')}</h4>
                <div className="h-64">
                  <Bar data={spendAnalysis.stackedData} options={{
                    ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins },
                    scales: {
                      ...CHART_DEFAULTS.scales,
                      x: { ...CHART_DEFAULTS.scales.x, stacked: true },
                      y: { ...CHART_DEFAULTS.scales.y, stacked: true },
                    },
                  }} />
                </div>
              </div>
            </div>

            {/* YoY Table */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)]">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('suppliers.spend.yoyTitle')}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--input-border)]">
                      <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium text-xs">{t('suppliers.spend.columns.supplier')}</th>
                      <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium text-xs">{t('suppliers.spend.columns.thisYear')}</th>
                      <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium text-xs">{t('suppliers.spend.columns.lastYear')}</th>
                      <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium text-xs">{t('suppliers.spend.columns.change')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spendAnalysis.yoy.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--text-dim)]">{t('suppliers.spend.noYoyData')}</td></tr>
                    )}
                    {spendAnalysis.yoy.map(row => (
                      <tr key={row.brand} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                        <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{row.brand}</td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{fmtCurrency(row.thisYear, activeCurrency)}</td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{fmtCurrency(row.lastYear, activeCurrency)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {row.change == null ? (
                            <span className="text-[var(--text-dim)] text-xs">{t('suppliers.spend.na')}</span>
                          ) : (
                            <span className={`flex items-center justify-end gap-1 font-semibold ${row.change > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {row.change > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                              {Math.abs(row.change).toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tab 3: Contracts */}
        {activeTab === 3 && (
          <motion.div key="contracts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
                <input value={contractSearch} onChange={e => setContractSearch(e.target.value)}
                  placeholder={t('suppliers.contracts.searchPlaceholder')}
                  className="pl-7 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 w-52" />
              </div>
              <button onClick={() => setContractModal({})}
                className="btn-primary gap-1.5">
                <Plus size={13} /> {t('suppliers.contracts.add')}
              </button>
            </div>

            {contractsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={28} className="animate-spin text-blue-500" />
              </div>
            ) : contractsError ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <AlertTriangle size={32} className="text-red-400 mb-2" />
                <p className="text-red-400 font-medium">{t('suppliers.contracts.loadError')}</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">{contractsError}</p>
                <button onClick={fetchContracts} className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">{t('suppliers.retry')}</button>
              </div>
            ) : filteredContracts.length === 0 ? (
              <EmptyState
                icon={FileCheck}
                title={t('suppliers.contracts.emptyTitle')}
                description={t('suppliers.contracts.emptyDesc')}
              />
            ) : (
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)]">
                        {[
                          t('suppliers.contracts.columns.supplier'), t('suppliers.contracts.columns.start'), t('suppliers.contracts.columns.end'),
                          t('suppliers.contracts.columns.paymentTerms'), t('suppliers.contracts.columns.pricePerUnit'), t('suppliers.contracts.columns.minOrder'),
                          t('suppliers.contracts.columns.status'), t('suppliers.contracts.columns.actions'),
                        ].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-[var(--text-muted)] font-medium text-xs">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContracts.map(c => {
                        const status = getContractStatus(c)
                        const statusConfig = {
                          Active: { color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700' },
                          'Expiring Soon': { color: 'text-amber-400', bg: 'bg-amber-900/30', border: 'border-amber-700' },
                          Expired: { color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700' },
                        }[status]
                        return (
                          <tr key={c.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                            <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{c.supplier_name}</td>
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
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {lockedContractId === c.id && (
                                  <span title="Locked — in approval" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] mr-1">
                                    <Lock size={11} /> Locked
                                  </span>
                                )}
                                <button onClick={() => setContractModal(c)} className="p-1.5 text-[var(--text-muted)] hover:text-blue-400 hover:bg-[var(--input-bg)] rounded">
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  onClick={() => { if (lockedContractId === c.id) return; setContractDeleteError(null); setContractDeleteTarget(c) }}
                                  disabled={lockedContractId === c.id}
                                  title={lockedContractId === c.id ? 'Locked — in approval' : undefined}
                                  className="p-1.5 text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)] rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--text-muted)]"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Expiring Soon alerts */}
            {contracts.filter(c => getContractStatus(c) === 'Expiring Soon').length > 0 && (
              <div className="bg-amber-900/20 border border-amber-700 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-400 font-medium text-sm">{t('suppliers.contracts.expiringBannerTitle')}</p>
                  <p className="text-amber-300/70 text-xs mt-1">
                    {t('suppliers.contracts.expiringBannerDesc', { names: contracts.filter(c => getContractStatus(c) === 'Expiring Soon').map(c => c.supplier_name).join(', ') })}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Tab 4: Recommendations */}
        {activeTab === 4 && (
          <motion.div key="recs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('suppliers.recommendations.title')}</h3>
              <span className="text-xs text-[var(--text-dim)] ml-auto">{t('suppliers.recommendations.basedOn', { count: records.length })}</span>
            </div>
            {recommendations.length === 0 ? (
              <EmptyState
                icon={Zap}
                title={t('suppliers.recommendations.emptyTitle')}
                description={t('suppliers.recommendations.emptyDesc')}
              />
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec, i) => {
                  const impactConfig = {
                    Critical: { color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-800', icon: AlertTriangle },
                    High:     { color: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-800', icon: TrendingUp },
                    Medium:   { color: 'text-blue-400', bg: 'bg-blue-900/20', border: 'border-blue-800', icon: Target },
                  }[rec.impact] || { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]', icon: Zap }
                  const IconComp = impactConfig.icon
                  const typeI18nKey = { increase: 'increase', review: 'review', saving: 'saving', consolidate: 'consolidate' }[rec.type] || 'action'
                  const typeLabel = t(`suppliers.recommendations.types.${typeI18nKey}`)
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.07 }}
                      className={`border rounded-xl p-4 flex items-start gap-3 ${impactConfig.bg} ${impactConfig.border}`}
                    >
                      <div className={`p-2 rounded-lg bg-[var(--surface-1)]/50 ${impactConfig.color} flex-shrink-0`}>
                        <IconComp size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-xs font-bold uppercase tracking-wider ${impactConfig.color}`}>{typeLabel}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${impactConfig.bg} ${impactConfig.color} ${impactConfig.border}`}>{t('suppliers.recommendations.impact', { impact: t(`suppliers.recommendations.impactLevels.${rec.impact}`) })}</span>
                          <span className="text-xs text-[var(--text-muted)] font-medium">{rec.brand}</span>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{rec.msg}</p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}

            {/* Supplier performance summary for context */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden mt-5">
              <div className="px-4 py-3 border-b border-[var(--input-border)]">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t('suppliers.recommendations.summaryTitle')}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--input-border)]">
                      {[
                        t('suppliers.recommendations.columns.supplier'), t('suppliers.recommendations.columns.rating'), t('suppliers.recommendations.columns.tyres'),
                        t('suppliers.recommendations.columns.avgCpk'), t('suppliers.recommendations.columns.avgLife'), t('suppliers.recommendations.columns.failurePct'),
                        t('suppliers.recommendations.columns.vsBenchmark'),
                      ].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-[var(--text-muted)] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...allMetrics].sort((a, b) => (a.avgCpk ?? Infinity) - (b.avgCpk ?? Infinity)).map(m => {
                      const vsB = m.avgCpk != null ? ((m.avgCpk - CPK_BENCHMARK) / CPK_BENCHMARK) * 100 : null
                      return (
                        <tr key={m.brand} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                          <td className="px-3 py-2.5 text-[var(--text-primary)] font-medium">{m.brand}</td>
                          <td className="px-3 py-2.5"><RatingBadge rating={m.rating} /></td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{m.count}</td>
                          <td className="px-3 py-2.5"><CpkBadge cpk={m.avgCpk} currency={activeCurrency} /></td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{fmtKm(m.avgLife)}</td>
                          <td className={`px-3 py-2.5 font-semibold ${m.failureRate > FAILURE_THRESHOLD ? 'text-red-400' : 'text-emerald-400'}`}>{fmtPct(m.failureRate)}</td>
                          <td className="px-3 py-2.5">
                            {vsB == null ? <span className="text-[var(--text-dim)]">{t('suppliers.recommendations.na')}</span> : (
                              <span className={`flex items-center gap-1 font-semibold ${vsB <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {vsB <= 0 ? <ArrowDownRight size={11} /> : <ArrowUpRight size={11} />}
                                {Math.abs(vsB).toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tab 5: Scorecard */}
        {activeTab === 5 && (
          <motion.div key="scorecard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                [t('suppliers.scorecard.cards.suppliers'), scorecard.totals.supplierCount],
                [t('suppliers.scorecard.cards.tyres'), scorecard.totals.totalTyres],
                [t('suppliers.scorecard.cards.totalSpend'), fmtCurrency(scorecard.totals.totalSpend, activeCurrency)],
                [t('suppliers.scorecard.cards.warrantyCredit'), fmtCurrency(scorecard.totals.totalWarrantyCredit, activeCurrency)],
              ].map(([l, v]) => (
                <div key={l} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3"><p className="text-xs text-[var(--text-muted)]">{l}</p><p className="text-xl font-bold text-[var(--text-primary)]">{v}</p></div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">{t('suppliers.scorecard.description')}</p>
            <div className="border border-[var(--input-border)] rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--input-bg)]/60 text-[var(--text-muted)] text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">{t('suppliers.scorecard.columns.rank')}</th><th className="text-left px-3 py-2">{t('suppliers.scorecard.columns.supplier')}</th>
                    <th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.score')}</th><th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.tyres')}</th>
                    <th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.spend')}</th><th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.avgCpk')}</th>
                    <th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.failurePct')}</th><th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.warrantyRec')}</th>
                    <th className="text-right px-3 py-2">{t('suppliers.scorecard.columns.onTimePct')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.suppliers.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--text-dim)]">{t('suppliers.scorecard.empty')}</td></tr>}
                  {scorecard.suppliers.map((s) => (
                    <tr key={s.supplier} className="border-t border-[var(--input-border)]">
                      <td className="px-3 py-2 text-[var(--text-muted)]">{s.rank}</td>
                      <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{s.supplier}</td>
                      <td className="px-3 py-2 text-right"><span className={`px-2 py-0.5 rounded font-semibold ${s.score >= 70 ? 'bg-green-900/30 text-green-400' : s.score >= 40 ? 'bg-amber-900/30 text-amber-400' : 'bg-red-900/30 text-red-400'}`}>{s.score}</span></td>
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{s.tyreCount}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{fmtCurrency(s.totalSpend, activeCurrency)}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{s.avgCpk == null ? '-' : s.avgCpk.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{s.failureRate == null ? '-' : `${(s.failureRate * 100).toFixed(1)}%`}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{s.warrantyRecoveryRate == null ? '-' : fmtCurrency(s.warrantyRecoveryRate, activeCurrency)}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{s.onTimeRate == null ? '-' : `${(s.onTimeRate * 100).toFixed(0)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Supplier Drawer */}
      <AnimatePresence>
        {selectedSupplier && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
              onClick={() => setSelectedSupplier(null)}
            />
            <SupplierDrawer
              supplier={selectedSupplier}
              allMetrics={allMetrics}
              records={filteredRecords}
              currency={activeCurrency}
              isAdmin={isAdmin}
              onClose={() => setSelectedSupplier(null)}
              onRatingChange={handleRatingChange}
              onSaveNotes={handleSaveNotes}
            />
          </>
        )}
      </AnimatePresence>

      {/* Contract Modal */}
      <AnimatePresence>
        {contractModal !== null && (
          <ContractModal
            contract={contractModal?.id ? contractModal : null}
            onSave={saveContract}
            onClose={() => { setContractModal(null); setLockedContractId(null) }}
            onLockChange={(id, locked) => setLockedContractId(locked ? id : null)}
          />
        )}
      </AnimatePresence>

      {/* Delete Contract Confirmation */}
      <AnimatePresence>
        {contractDeleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-md shadow-2xl p-5"
            >
              <div className="flex gap-3 mb-4">
                <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[var(--text-primary)] font-medium">{t('suppliers.deleteContract.confirmTitle', { name: contractDeleteTarget.supplier_name })}</p>
                  <p className="text-[var(--text-muted)] text-sm mt-1">{t('suppliers.deleteContract.warning')}</p>
                </div>
              </div>
              {contractDeleteError && (
                <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{contractDeleteError}</p>
              )}
              <div className="flex gap-3">
                <button onClick={deleteContract} disabled={contractDeleting} className="btn-danger flex items-center gap-2 disabled:opacity-50">
                  <X size={15} /> {contractDeleting ? t('suppliers.deleteContract.deleting') : t('suppliers.deleteContract.delete')}
                </button>
                <button onClick={() => { setContractDeleteTarget(null); setContractDeleteError(null) }} className="btn-secondary">{t('suppliers.deleteContract.cancel')}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
