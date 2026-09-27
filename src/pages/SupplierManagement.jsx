import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { contractFormSchema } from '../lib/validation/schemas'
import { FormField, FormDate, FormActions } from '../components/forms'
import * as supplierApi from '../lib/api/supplierManagementApi'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { toUserMessage } from '../lib/safeError'
import { computeSupplierScorecard } from '../lib/analytics/supplierScorecard'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  CPK_BENCHMARK, FAILURE_THRESHOLD, RATINGS, CONTRACT_STATUSES,
  contractStatus, daysToExpiry, contractValue, filterContracts, summarizeContracts,
  buildSupplierMetrics, filterRecords, filterSuppliers, supplierKpis, sortByCpk,
  vsBenchmark, radarScores, yoySpend, monthlySpend, dataAnchorDate, last12Months,
  recommendationFacts, supplierExportRows, SUPPLIER_EXPORT_COLUMNS,
  contractExportRows, CONTRACT_EXPORT_COLUMNS,
} from '../lib/supplierManagementAnalytics'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import EmptyState from '../components/EmptyState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import {
  Building2, Star, TrendingUp, TrendingDown, Minus, Award, AlertTriangle,
  CheckCircle, Clock, Search, Filter, Download, FileText, FileSpreadsheet,
  RefreshCw, ChevronDown, X, Plus, Edit3,
  BarChart3, DollarSign, Truck, Package, Target, Zap, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Users, Calendar, FileCheck, Loader2,
  SlidersHorizontal, Eye, Globe, MapPin, Hash, Lock, Flag, Gauge,
} from 'lucide-react'
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Radar, Doughnut } from 'react-chartjs-2'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const TABS = ['Directory', 'Performance', 'Spend Analysis', 'Contracts', 'Recommendations', 'Scorecard']
// i18n key lookup for RATINGS/CONTRACT_STATUSES labels (constants stay stable for logic/equality checks)
const RATING_I18N_KEYS = { Preferred: 'preferred', Approved: 'approved', 'Under Review': 'underReview', Probation: 'probation' }
const TAB_I18N_KEYS = ['directory', 'performance', 'spendAnalysis', 'contracts', 'recommendations', 'scorecard']
// Categorical rating -> numeric (rating column is numeric). Index is 1-based.
function numToRating(num) {
  const idx = Math.round(Number(num)) - 1
  return RATINGS[idx] || null
}
// Whitelisted writable columns
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
// Calculation lives in ../lib/supplierManagementAnalytics (pure, tested). These
// are display formatters only.
function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
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

/** EnterpriseTable over the page's shared pager: the pager owns paging, the table owns the rest. */
function PagedTable({ columns, pager, emptyMessage, getRowId, maxHeight = 600 }) {
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={columns}
        data={pager ? pager.pageRows : []}
        getRowId={getRowId}
        className="border-0 rounded-none shadow-none"
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        enableColumnVisibility={false}
        enableKeyboard={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      {pager && <TablePagination {...pager} />}
    </div>
  )
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

// ── Vendor lifecycle band pill (from supplierScorecard.lifecycleBand) ───────────
const BAND_CONFIG = {
  preferred:    { color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-700', icon: Star,        label: 'Preferred' },
  approved:     { color: 'text-blue-400',    bg: 'bg-blue-900/40',    border: 'border-blue-700',    icon: CheckCircle,  label: 'Approved' },
  watch:        { color: 'text-amber-400',   bg: 'bg-amber-900/40',   border: 'border-amber-700',   icon: Eye,          label: 'Watch' },
  probation:    { color: 'text-orange-400',  bg: 'bg-orange-900/40',  border: 'border-orange-700',  icon: ShieldCheck,  label: 'Probation' },
  disqualified: { color: 'text-red-400',     bg: 'bg-red-900/40',     border: 'border-red-700',     icon: AlertTriangle,label: 'Disqualified' },
  unknown:      { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]', icon: Minus, label: 'Unscored' },
}

function BandPill({ band }) {
  const cfg = BAND_CONFIG[band?.band] || BAND_CONFIG.unknown
  const Icon = cfg.icon
  return (
    <span title={band?.label || cfg.label}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  )
}

const GRADE_COLOR = {
  A: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  B: 'bg-blue-900/40 text-blue-300 border-blue-700',
  C: 'bg-amber-900/40 text-amber-300 border-amber-700',
  D: 'bg-orange-900/40 text-orange-300 border-orange-700',
  F: 'bg-red-900/40 text-red-300 border-red-700',
}
function GradeBadge({ grade }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold border ${GRADE_COLOR[grade] || GRADE_COLOR.F}`}>
      {grade}
    </span>
  )
}

function TrendCell({ trend, delta }) {
  const cfg = {
    improving: { color: 'text-emerald-400', Icon: TrendingUp, label: 'Improving' },
    declining: { color: 'text-red-400', Icon: TrendingDown, label: 'Declining' },
    stable:    { color: 'text-[var(--text-muted)]', Icon: Minus, label: 'Stable' },
  }[trend] || { color: 'text-[var(--text-muted)]', Icon: Minus, label: 'Stable' }
  const { Icon } = cfg
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.color}`} title={cfg.label}>
      <Icon size={13} />
      {delta != null ? `${delta > 0 ? '+' : ''}${delta}` : cfg.label}
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
    <Modal
      open
      onClose={isSubmitting ? undefined : onClose}
      title={contract?.id ? t('suppliers.contractModal.editTitle') : t('suppliers.contractModal.addTitle')}
      size="md"
    >
        <form onSubmit={handleSubmit(submit)} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            label={t('suppliers.contractModal.supplierName')}
            required
            wrapperClassName="sm:col-span-2"
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
            wrapperClassName="sm:col-span-2"
            error={errors.notes}
            {...register('notes')}
          />
          {saveError && (
            <div className="sm:col-span-2 flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="flex-shrink-0" /> {saveError}
            </div>
          )}
          {contract?.id && wfLocked && (
            <div className="sm:col-span-2 flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
              <Lock size={12} className="flex-shrink-0" /> Locked, in approval
            </div>
          )}
          <FormActions
            className="sm:col-span-2"
            saving={isSubmitting || (!!contract?.id && wfLocked)}
            onCancel={onClose}
            submitLabel={t('suppliers.contractModal.save')}
            savingLabel={contract?.id && wfLocked && !isSubmitting ? t('suppliers.contractModal.save') : t('suppliers.contractModal.saving')}
            cancelLabel={t('suppliers.contractModal.cancel')}
          />
        </form>

        {/* Approval & Workflow — only a persisted contract is an approvable subject */}
        {contract?.id && (
          <div className="pt-4">
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
                status: contractStatus(contract),
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
    </Modal>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SupplierManagement() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { activeCurrency, activeCountry } = useSettings()
  const { user } = useAuth()

  const [records, setRecords] = useState([])
  const [recordsTruncated, setRecordsTruncated] = useState(false)
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
  const [compareList, setCompareList] = useState([])
  const [contracts, setContracts] = useState([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [contractsError, setContractsError] = useState(null)
  const [contractModal, setContractModal] = useState(null)
  // Approval-engine gate: id of the contract whose workflow is active/locked, so
  // its row-level edit/delete controls are blocked while it is in approval.
  const [lockedContractId, setLockedContractId] = useState(null)
  const [contractSearch, setContractSearch] = useState('')
  const [contractStatusFilter, setContractStatusFilter] = useState('All')
  const [contractDeleteTarget, setContractDeleteTarget] = useState(null)
  const [contractDeleteError, setContractDeleteError] = useState(null)
  const [contractDeleting, setContractDeleting] = useState(false)
  // Scorecard source data (warranty claims + purchase orders); tyres come from `records`.
  const [scWarranty, setScWarranty] = useState([])
  const [scPos, setScPos] = useState([])
  const [scError, setScError] = useState(null)

  // Load tyre records
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Bounded read: tyre_records runs into the thousands, so cap the paged fetch
    // and surface a capped-view note rather than pulling an unbounded set.
    const { data, error: err, truncated } = await fetchAllPages((from, to) =>
      supplierApi.listSupplierTyres({ from, to, country: activeCountry }), { max: 50000 })
    if (err) { setError(toUserMessage(err)); setLoading(false); return }
    setRecords(data || [])
    setRecordsTruncated(!!truncated)
    setLoading(false)
  }, [activeCountry])

  // Load supplier ratings/notes
  const fetchRatings = useCallback(async () => {
    setRatingsError(null)
    const { data, error: err } = await supplierApi.listSupplierRatings({ country: activeCountry })
    if (err) { setRatingsError(toUserMessage(err, 'Could not load ratings.')); return }
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
    if (err) { setContractsError(toUserMessage(err, 'Could not load contracts.')); setContractsLoading(false); return }
    setContracts(data || [])
    setContractsLoading(false)
  }, [activeCountry])

  // Load warranty claims + purchase orders for the supplier scorecard.
  const fetchScorecardSources = useCallback(async () => {
    setScError(null)
    try {
      const [{ data: w, error: we }, { data: p, error: pe }] = await Promise.all([
        supplierApi.listScorecardWarrantyClaims({ country: activeCountry }),
        supplierApi.listScorecardPurchaseOrders({ country: activeCountry }),
      ])
      if (we || pe) setScError(toUserMessage(we || pe, 'Could not load warranty claims or purchase orders.'))
      setScWarranty(w || [])
      setScPos(p || [])
    } catch (err) {
      setScError(toUserMessage(err, 'Could not load warranty claims or purchase orders.'))
    }
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
  const filteredRecords = useMemo(
    () => filterRecords(records, { country: filterCountry, site: filterSite }),
    [records, filterCountry, filterSite],
  )

  // All supplier metrics (pure engine: CPK via kpiEngine, honest nulls)
  const allMetrics = useMemo(() => buildSupplierMetrics(filteredRecords, ratings), [filteredRecords, ratings])

  // Filtered suppliers for directory
  const filteredSuppliers = useMemo(
    () => filterSuppliers(allMetrics, { search, rating: filterRating }),
    [allMetrics, search, filterRating],
  )

  // KPI summary follows every filter on screen (country, site, rating, search).
  const kpiSummary = useMemo(() => supplierKpis(filteredSuppliers), [filteredSuppliers])


  const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : null

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
    if (err) return toUserMessage(err, 'Could not save the contract.')
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
      setContractDeleteError(toUserMessage(err, t('suppliers.deleteContract.defaultError')))
      setContractDeleting(false)
      return
    }
    setContractDeleting(false)
    setContractDeleteTarget(null)
    await fetchContracts()
  }

  // Export: exactly the suppliers on screen (country, site, rating and search filters).
  async function handleExcelExport() {
    const { exportToExcel, reportFileName } = await loadExportUtils()
    exportToExcel(supplierExportRows(filteredSuppliers),
      SUPPLIER_EXPORT_COLUMNS.map(c => c.key),
      SUPPLIER_EXPORT_COLUMNS.map(c => c.header),
      reportFileName('Supplier Performance', scopedCountry), 'Suppliers', { currency: activeCurrency })
  }

  async function handlePdfExport() {
    const { exportToPdf, reportFileName } = await loadExportUtils()
    exportToPdf(supplierExportRows(filteredSuppliers), SUPPLIER_EXPORT_COLUMNS,
      'Supplier Performance Report', reportFileName('Supplier Performance', scopedCountry),
      'landscape', '', { currency: activeCurrency })
  }

  async function handleContractsExcel() {
    const { exportToExcel, reportFileName } = await loadExportUtils()
    exportToExcel(contractExportRows(filteredContracts),
      CONTRACT_EXPORT_COLUMNS.map(c => c.key),
      CONTRACT_EXPORT_COLUMNS.map(c => c.header),
      reportFileName('Supplier Contracts', scopedCountry), 'Contracts', { currency: activeCurrency })
  }

  async function handleContractsPdf() {
    const { exportToPdf, reportFileName } = await loadExportUtils()
    exportToPdf(contractExportRows(filteredContracts), CONTRACT_EXPORT_COLUMNS,
      'Supplier Contracts', reportFileName('Supplier Contracts', scopedCountry),
      'landscape', '', { currency: activeCurrency })
  }


  // ── Procurement Recommendations ────────────────────────────────────────────
  const recommendations = useMemo(() => recommendationFacts(allMetrics).map((f) => {
    const msg = {
      increase: () => t('suppliers.recommendations.messages.increase', { brand: f.brand, cpk: fmtCpk(f.cpk, activeCurrency), pct: f.pct?.toFixed(1) }),
      review: () => t('suppliers.recommendations.messages.review', { brand: f.brand, rate: (f.rate * 100).toFixed(1), threshold: (FAILURE_THRESHOLD * 100).toFixed(0) }),
      saving: () => t('suppliers.recommendations.messages.saving', { worstBrand: f.brand, bestBrand: f.bestBrand, amount: fmtCurrency(f.amount, activeCurrency) }),
      consolidate: () => t('suppliers.recommendations.messages.consolidate', { size: f.size, brand: f.brand, cpk: fmtCpk(f.cpk, activeCurrency) }),
    }[f.type]
    return { ...f, msg: msg ? msg() : '' }
  }), [allMetrics, activeCurrency, t])

  // ── Spend Analysis ─────────────────────────────────────────────────────────
  const spendAnalysis = useMemo(() => {
    const anchor = dataAnchorDate(filteredRecords)
    const months12 = last12Months(anchor)
    const top5 = [...allMetrics].sort((a, b) => b.spendThisYear - a.spendThisYear).slice(0, 5)
    const monthlyByBrand = top5.map(m => monthlySpend(m.recs, months12))
    const allRecs = allMetrics.flatMap(m => m.recs)
    const totalByMonth = monthlySpend(allRecs, months12)
    const otherMonthly = months12.map((_, idx) =>
      Math.max(0, totalByMonth[idx] - monthlyByBrand.reduce((s, series) => s + (series[idx] || 0), 0)))
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
        ...top5.map((m, i) => ({
          label: m.brand, data: monthlyByBrand[i],
          backgroundColor: PALETTE[i % PALETTE.length], borderWidth: 0, stack: 'a',
        })),
        { label: 'Other', data: otherMonthly, backgroundColor: '#6b7280', borderWidth: 0, stack: 'a' },
      ],
    }

    return { doughnutData, stackedData, yoy: yoySpend(allMetrics, anchor.getFullYear()), top5, totalSpend }
  }, [allMetrics, filteredRecords])

  // ── Performance Comparison ─────────────────────────────────────────────────
  const compareData = useMemo(() => {
    const selected = allMetrics.filter(m => compareList.includes(m.brand))
    if (selected.length === 0) return null
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
    return {
      labels: ['CPK Score', 'Life Score', 'Reliability', 'Value', 'Coverage'],
      datasets: selected.map((m, i) => {
        const scores = radarScores(m, allMetrics)
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

  // ── Contracts: filter, summary, table columns ─────────────────────────────
  const filteredContracts = useMemo(
    () => filterContracts(contracts, { search: contractSearch, status: contractStatusFilter }),
    [contracts, contractSearch, contractStatusFilter],
  )
  const contractSummary = useMemo(() => summarizeContracts(contracts), [contracts])
  const sortedMetrics = useMemo(() => sortByCpk(allMetrics), [allMetrics])
  const metricsPager = usePagedRows(sortedMetrics)
  const contractsPager = usePagedRows(filteredContracts)
  const scorecardPager = usePagedRows(scorecard.suppliers)
  const yoyPager = usePagedRows(spendAnalysis.yoy)

  const compareRows = useMemo(() => [
    { label: t('suppliers.performance.rows.avgCpk'), key: 'avgCpk', fmt: v => fmtCpk(v, activeCurrency), lowerBetter: true },
    { label: t('suppliers.performance.rows.avgLifeKm'), key: 'avgLife', fmt: v => fmtKm(v), lowerBetter: false },
    { label: t('suppliers.performance.rows.failureRate'), key: 'failureRate', fmt: v => fmtPct(v), lowerBetter: true },
    { label: t('suppliers.performance.rows.tyreCount'), key: 'count', fmt: v => v, lowerBetter: false },
    { label: t('suppliers.performance.rows.spendYtd'), key: 'spendThisYear', fmt: v => fmtCurrency(v, activeCurrency), lowerBetter: false },
    { label: t('suppliers.performance.rows.totalSpend'), key: 'totalSpend', fmt: v => fmtCurrency(v, activeCurrency), lowerBetter: false },
    { label: t('suppliers.performance.rows.rating'), key: 'rating', fmt: v => (RATING_I18N_KEYS[v] ? t(`suppliers.ratings.${RATING_I18N_KEYS[v]}`) : v), lowerBetter: null },
  ], [t, activeCurrency])

  const compareColumns = useMemo(() => [
    { id: 'metric', header: t('suppliers.performance.metric'), cell: ({ row }) => <span className="text-[var(--text-muted)]">{row.original.label}</span> },
    ...compareStats.map(m => ({
      id: `b_${m.brand}`,
      header: m.brand,
      meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const nums = compareStats.map(x => x[r.key]).filter(v => typeof v === 'number' && isFinite(v))
        const best = nums.length && r.lowerBetter != null ? (r.lowerBetter ? Math.min(...nums) : Math.max(...nums)) : null
        const v = m[r.key]
        const isWinner = typeof v === 'number' && isFinite(v) && v === best
        return <span className={`block text-right font-mono ${isWinner ? 'text-emerald-400 font-semibold' : 'text-[var(--text-secondary)]'}`}>{r.fmt(v)}</span>
      },
    })),
  ], [compareStats, t])

  const yoyColumns = useMemo(() => [
    { id: 'brand', header: t('suppliers.spend.columns.supplier'), cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.brand}</span> },
    { id: 'thisYear', header: t('suppliers.spend.columns.thisYear'), meta: { align: 'right' }, cell: ({ row }) => <span className="block text-right text-[var(--text-secondary)]">{fmtCurrency(row.original.thisYear, activeCurrency)}</span> },
    { id: 'lastYear', header: t('suppliers.spend.columns.lastYear'), meta: { align: 'right' }, cell: ({ row }) => <span className="block text-right text-[var(--text-muted)]">{fmtCurrency(row.original.lastYear, activeCurrency)}</span> },
    {
      id: 'change', header: t('suppliers.spend.columns.change'), meta: { align: 'right' },
      cell: ({ row }) => {
        const c = row.original.change
        if (c == null) return <span className="block text-right text-[var(--text-dim)] text-xs">{t('suppliers.spend.na')}</span>
        return (
          <span className={`flex items-center justify-end gap-1 font-semibold ${c > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {c > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(c).toFixed(1)}%
          </span>
        )
      },
    },
  ], [t, activeCurrency])

  const contractColumns = useMemo(() => {
    const statusStyle = {
      Active: { color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700' },
      'Expiring Soon': { color: 'text-amber-400', bg: 'bg-amber-900/30', border: 'border-amber-700' },
      Expired: { color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700' },
    }
    return [
      { id: 'supplier', header: t('suppliers.contracts.columns.supplier'), cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.supplier_name}</span> },
      { id: 'start', header: t('suppliers.contracts.columns.start'), cell: ({ row }) => <span className="text-[var(--text-muted)] text-xs">{row.original.contract_start || 'N/A'}</span> },
      {
        id: 'end', header: t('suppliers.contracts.columns.end'),
        cell: ({ row }) => {
          const days = daysToExpiry(row.original)
          return (
            <div className="text-xs">
              <span className="text-[var(--text-muted)]">{row.original.contract_end || 'N/A'}</span>
              {days != null && days >= 0 && <span className="block text-[var(--text-dim)]">{days} days left</span>}
            </div>
          )
        },
      },
      { id: 'terms', header: t('suppliers.contracts.columns.paymentTerms'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.payment_terms || 'N/A'}</span> },
      { id: 'price', header: t('suppliers.contracts.columns.pricePerUnit'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.price_per_unit != null && row.original.price_per_unit !== '' ? fmtCurrency(Number(row.original.price_per_unit), activeCurrency) : 'N/A'}</span> },
      { id: 'min', header: t('suppliers.contracts.columns.minOrder'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.min_order ?? 'N/A'}</span> },
      { id: 'value', header: 'Committed Value', cell: ({ row }) => <span className="text-[var(--text-secondary)]">{fmtCurrency(contractValue(row.original), activeCurrency)}</span> },
      {
        id: 'status', header: t('suppliers.contracts.columns.status'),
        cell: ({ row }) => {
          const status = contractStatus(row.original)
          const cfg = statusStyle[status]
          return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
              {status === 'Expiring Soon' && <AlertTriangle size={9} />}
              {t(`suppliers.contracts.statuses.${CONTRACT_STATUS_I18N_KEYS[status]}`)}
            </span>
          )
        },
      },
      {
        id: 'actions', header: t('suppliers.contracts.columns.actions'),
        cell: ({ row }) => {
          const c = row.original
          return (
            <div className="flex items-center gap-1">
              {lockedContractId === c.id && (
                <span title="Locked, in approval" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] mr-1">
                  <Lock size={11} /> Locked
                </span>
              )}
              <button onClick={() => setContractModal(c)} aria-label="Edit contract" className="p-1.5 text-[var(--text-muted)] hover:text-blue-400 hover:bg-[var(--input-bg)] rounded">
                <Edit3 size={13} />
              </button>
              <button
                onClick={() => { if (lockedContractId === c.id) return; setContractDeleteError(null); setContractDeleteTarget(c) }}
                disabled={lockedContractId === c.id}
                title={lockedContractId === c.id ? 'Locked, in approval' : undefined}
                aria-label="Delete contract"
                className="p-1.5 text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)] rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--text-muted)]"
              >
                <X size={13} />
              </button>
            </div>
          )
        },
      },
    ]
  }, [t, activeCurrency, lockedContractId])

  const summaryColumns = useMemo(() => [
    { id: 'brand', header: t('suppliers.recommendations.columns.supplier'), cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.brand}</span> },
    { id: 'rating', header: t('suppliers.recommendations.columns.rating'), cell: ({ row }) => <RatingBadge rating={row.original.rating} /> },
    { id: 'count', header: t('suppliers.recommendations.columns.tyres'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.count}</span> },
    { id: 'cpk', header: t('suppliers.recommendations.columns.avgCpk'), cell: ({ row }) => <CpkBadge cpk={row.original.avgCpk} currency={activeCurrency} /> },
    { id: 'life', header: t('suppliers.recommendations.columns.avgLife'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{fmtKm(row.original.avgLife)}</span> },
    {
      id: 'failure', header: t('suppliers.recommendations.columns.failurePct'),
      cell: ({ row }) => {
        const fr = row.original.failureRate
        return <span className={`font-semibold ${fr != null && fr > FAILURE_THRESHOLD ? 'text-red-400' : 'text-emerald-400'}`}>{fmtPct(fr)}</span>
      },
    },
    {
      id: 'vsb', header: t('suppliers.recommendations.columns.vsBenchmark'),
      cell: ({ row }) => {
        const vsB = vsBenchmark(row.original.avgCpk)
        if (vsB == null) return <span className="text-[var(--text-dim)]">{t('suppliers.recommendations.na')}</span>
        return (
          <span className={`flex items-center gap-1 font-semibold ${vsB <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {vsB <= 0 ? <ArrowDownRight size={11} /> : <ArrowUpRight size={11} />}
            {Math.abs(vsB).toFixed(1)}%
          </span>
        )
      },
    },
  ], [t, activeCurrency])

  const scorecardColumns = useMemo(() => [
    { id: 'rank', header: t('suppliers.scorecard.columns.rank'), cell: ({ row }) => <span className="text-[var(--text-muted)]">{row.original.rank}</span> },
    {
      id: 'supplier', header: t('suppliers.scorecard.columns.supplier'),
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-[var(--text-primary)]">{row.original.supplier}</span>
          <BandPill band={row.original.band} />
        </div>
      ),
    },
    { id: 'grade', header: 'Grade', cell: ({ row }) => <GradeBadge grade={row.original.grade} /> },
    {
      id: 'score', header: t('suppliers.scorecard.columns.score'),
      cell: ({ row }) => { const s = row.original.score; return <span className={`px-2 py-0.5 rounded font-semibold ${s >= 70 ? 'bg-green-900/30 text-green-400' : s >= 40 ? 'bg-amber-900/30 text-amber-400' : 'bg-red-900/30 text-red-400'}`}>{s}</span> },
    },
    { id: 'tyres', header: t('suppliers.scorecard.columns.tyres'), cell: ({ row }) => <span className="text-[var(--text-muted)]">{row.original.tyreCount}</span> },
    { id: 'spend', header: t('suppliers.scorecard.columns.spend'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{fmtCurrency(row.original.totalSpend, activeCurrency)}</span> },
    { id: 'cpk', header: t('suppliers.scorecard.columns.avgCpk'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.avgCpk == null ? 'N/A' : row.original.avgCpk.toFixed(3)}</span> },
    { id: 'failure', header: t('suppliers.scorecard.columns.failurePct'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.failureRate == null ? 'N/A' : `${(row.original.failureRate * 100).toFixed(1)}%`}</span> },
    {
      id: 'acceptance', header: 'Acceptance',
      cell: ({ row }) => {
        const s = row.original
        return (
          <span className={`font-medium ${s.warrantyClaims === 0 ? 'text-[var(--text-muted)]' : s.warrantyAcceptanceRate * 100 < 80 ? 'text-red-400' : 'text-emerald-400'}`}>
            {s.warrantyClaims === 0 ? 'N/A' : `${(s.warrantyAcceptanceRate * 100).toFixed(0)}%`}
          </span>
        )
      },
    },
    { id: 'price', header: 'Price', cell: ({ row }) => <span className={`font-medium ${row.original.priceCompetitiveness >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{row.original.priceCompetitiveness}</span> },
    { id: 'ontime', header: t('suppliers.scorecard.columns.onTimePct'), cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.onTimeRate == null ? 'N/A' : `${(row.original.onTimeRate * 100).toFixed(0)}%`}</span> },
    { id: 'trend', header: 'Trend', cell: ({ row }) => <TrendCell trend={row.original.trend} delta={row.original.trendDelta} /> },
  ], [t, activeCurrency])


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
      <NotInUseNotice count={records.length} label="suppliers"
        hint="Suppliers appear once they are added here or arrive with a purchase order import." />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard icon={Building2} label={t('suppliers.kpi.totalSuppliers')} value={kpiSummary.total} sub={t('suppliers.kpi.uniqueBrands')} color="text-blue-400" />
        <KpiCard icon={Star} label={t('suppliers.kpi.preferred')} value={kpiSummary.preferredCount} sub={t('suppliers.kpi.ofTotalSuppliers', { total: kpiSummary.total })} color="text-emerald-400" />
        <KpiCard icon={Target} label={t('suppliers.kpi.cpkRange')}
          value={kpiSummary.cpkMin != null ? `${fmtCpk(kpiSummary.cpkMin, activeCurrency).split(' ')[1]}` : t('suppliers.recommendations.na')}
          sub={kpiSummary.cpkMax != null ? t('suppliers.kpi.toValue', { value: fmtCpk(kpiSummary.cpkMax, activeCurrency) }) : 'N/A'}
          color="text-purple-400" />
        <KpiCard icon={Award} label={t('suppliers.kpi.bestCpk')} value={kpiSummary.best?.brand || t('suppliers.recommendations.na')} sub={kpiSummary.best ? fmtCpk(kpiSummary.best.avgCpk, activeCurrency) : 'N/A'} color="text-emerald-400" />
        <KpiCard icon={AlertTriangle} label={t('suppliers.kpi.worstCpk')} value={kpiSummary.worst?.brand || t('suppliers.recommendations.na')} sub={kpiSummary.worst ? fmtCpk(kpiSummary.worst.avgCpk, activeCurrency) : 'N/A'} color="text-red-400" />
        <KpiCard icon={DollarSign} label="Total spend" value={fmtCurrency(kpiSummary.totalSpend, activeCurrency)}
          sub={kpiSummary.cpkCoverage == null ? 'N/A' : `CPK measurable for ${Math.round(kpiSummary.cpkCoverage * 100)}% of suppliers`} color="text-[var(--text-primary)]" />
        <KpiCard icon={Flag} label="Failure above 15%" value={kpiSummary.atRiskCount}
          sub={`of ${kpiSummary.total} suppliers on screen`} color={kpiSummary.atRiskCount > 0 ? 'text-orange-400' : 'text-emerald-400'} />
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

      {/* Capped view note: metrics reflect a bounded read once the tyre set is very large */}
      {recordsTruncated && (
        <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-800 rounded-xl px-4 py-2.5 text-xs text-amber-200">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
          <span>Capped view: showing up to 50,000 tyre records. Some records may be excluded from these metrics. Narrow the country filter for a complete view.</span>
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
                          <div className={`text-sm font-semibold ${supplier.failureRate != null && supplier.failureRate > FAILURE_THRESHOLD ? 'text-red-400' : 'text-emerald-400'}`}>
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

                      <button onClick={() => navigate(`/suppliers/${encodeURIComponent(supplier.brand)}`)}
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
                      <EnterpriseTable
                        columns={compareColumns}
                        data={compareRows}
                        getRowId={(r) => r.key}
                        enableGlobalFilter={false}
                        enableColumnFilters={false}
                        enableSorting={false}
                        enableExport={false}
                        enableColumnVisibility={false}
                        enableKeyboard={false}
                        virtual
                        maxHeight={420}
                      />
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
              <PagedTable columns={yoyColumns} pager={yoyPager} getRowId={(r) => r.brand} emptyMessage={t('suppliers.spend.noYoyData')} />
            </div>
          </motion.div>
        )}

        {/* Tab 3: Contracts */}
        {activeTab === 3 && (
          <motion.div key="contracts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Contract KPIs: computed over every contract loaded for this country */}
            {!contractsLoading && !contractsError && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Contracts', value: contractSummary.total, color: 'text-blue-400', status: 'All' },
                  { label: 'Active', value: contractSummary.active, color: 'text-emerald-400', status: 'Active' },
                  { label: 'Expiring in 30 days', value: contractSummary.expiringSoon, color: 'text-amber-400', status: 'Expiring Soon' },
                  { label: 'Expired', value: contractSummary.expired, color: 'text-red-400', status: 'Expired' },
                ].map(k => (
                  <button key={k.label} type="button" onClick={() => setContractStatusFilter(k.status)}
                    aria-pressed={contractStatusFilter === k.status}
                    className={`text-left bg-[var(--surface-1)] border rounded-xl p-3 transition-colors ${contractStatusFilter === k.status ? 'border-blue-500' : 'border-[var(--input-border)] hover:border-blue-500/50'}`}>
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  </button>
                ))}
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">Committed value (live)</p>
                  <p className="text-xl font-bold text-[var(--text-primary)]">{fmtCurrency(contractSummary.committedValue, activeCurrency)}</p>
                  <p className="text-[11px] text-[var(--text-dim)]">
                    {contractSummary.committedValue == null
                      ? 'No live contract records both price and minimum order'
                      : `From ${contractSummary.valuedCount} contract(s) with price and minimum order`}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
                  <input value={contractSearch} onChange={e => setContractSearch(e.target.value)}
                    placeholder={t('suppliers.contracts.searchPlaceholder')}
                    aria-label={t('suppliers.contracts.searchPlaceholder')}
                    className="pl-7 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 w-52" />
                </div>
                <div className="relative">
                  <select value={contractStatusFilter} onChange={e => setContractStatusFilter(e.target.value)}
                    aria-label="Contract status"
                    className="appearance-none bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] px-3 py-2 pr-7 focus:outline-none focus:border-blue-500">
                    <option value="All">All statuses</option>
                    {CONTRACT_STATUSES.map(st => (
                      <option key={st} value={st}>{t(`suppliers.contracts.statuses.${CONTRACT_STATUS_I18N_KEYS[st]}`)}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-3 text-[var(--text-muted)] pointer-events-none" />
                </div>
                {(contractSearch || contractStatusFilter !== 'All') && (
                  <button onClick={() => { setContractSearch(''); setContractStatusFilter('All') }}
                    className="flex items-center gap-1 px-2 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--input-bg)] rounded-lg">
                    <X size={12} /> {t('suppliers.filters.clear')}
                  </button>
                )}
                <span className="text-xs text-[var(--text-dim)]">{filteredContracts.length} of {contracts.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleContractsExcel} disabled={filteredContracts.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg disabled:opacity-40">
                  <FileSpreadsheet size={13} /> Excel
                </button>
                <button onClick={handleContractsPdf} disabled={filteredContracts.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg disabled:opacity-40">
                  <FileText size={13} /> PDF
                </button>
                <button onClick={() => setContractModal({})}
                  className="btn-primary gap-1.5">
                  <Plus size={13} /> {t('suppliers.contracts.add')}
                </button>
              </div>
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
                <PagedTable columns={contractColumns} pager={contractsPager} getRowId={(r) => String(r.id)} emptyMessage={t('suppliers.contracts.emptyTitle')} />
              </div>
            )}

            {/* Expiring Soon alerts */}
            {contractSummary.expiringSoon > 0 && (
              <div className="bg-amber-900/20 border border-amber-700 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-400 font-medium text-sm">{t('suppliers.contracts.expiringBannerTitle')}</p>
                  <p className="text-amber-300/70 text-xs mt-1">
                    {t('suppliers.contracts.expiringBannerDesc', { names: contractSummary.expiring.map(c => c.supplier_name).join(', ') })}
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
              <PagedTable columns={summaryColumns} pager={metricsPager} getRowId={(r) => r.brand} emptyMessage={t('suppliers.directory.emptyTitle')} />
            </div>
          </motion.div>
        )}

        {/* Tab 5: Scorecard */}
        {activeTab === 5 && (
          <motion.div key="scorecard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {scError && (
              <div className="flex items-center justify-between gap-3 bg-red-900/20 border border-red-800 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <AlertTriangle size={15} className="flex-shrink-0" />
                  <span>{scError} Warranty and delivery scores below may be incomplete.</span>
                </div>
                <button onClick={fetchScorecardSources} className="px-3 py-1.5 bg-red-800/40 hover:bg-red-800/60 text-red-200 text-xs rounded-lg flex-shrink-0">{t('suppliers.retry')}</button>
              </div>
            )}
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
            {/* Band / grade summary (from lifecycleBand + scoreGrade) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Avg Score', value: scorecard.totals.avgScore, icon: Gauge, color: 'text-blue-400' },
                { label: 'Preferred', value: scorecard.totals.preferredCount, icon: Award, color: 'text-emerald-400' },
                { label: 'At Risk', value: scorecard.totals.atRiskCount, icon: ShieldCheck, color: 'text-orange-400' },
                { label: 'Flagged', value: scorecard.totals.flaggedCount, icon: Flag, color: 'text-red-400' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-0.5"><Icon size={13} className={color} /><p className="text-xs text-[var(--text-muted)]">{label}</p></div>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {t('suppliers.scorecard.description')} Grade, lifecycle band, warranty acceptance, price competitiveness and period-over-period trend are derived from actual tyre, warranty and purchase-order data. Invoice accuracy and returns-processing time are omitted (no source data).
            </p>
            <div className="border border-[var(--input-border)] rounded-xl overflow-hidden">
              <PagedTable columns={scorecardColumns} pager={scorecardPager} getRowId={(r) => r.supplier} emptyMessage={t('suppliers.scorecard.empty')} />
            </div>

            {/* Flagged issues — threshold-driven, actionable */}
            {scorecard.suppliers.some((s) => s.flags && s.flags.length > 0) && (
              <div className="bg-[var(--surface-1)] border border-red-800/50 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                  <Flag size={15} className="text-red-400" />
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Flagged Suppliers</h4>
                  <span className="text-xs text-[var(--text-dim)] ml-auto">
                    on-time &lt; {80}% · acceptance &lt; {80}% · failures &gt; {5}%
                  </span>
                </div>
                <div className="divide-y divide-[var(--input-border)]/50">
                  {scorecard.suppliers.filter((s) => s.flags && s.flags.length > 0).map((s) => (
                    <div key={s.supplier} className="px-4 py-3 flex items-start gap-3">
                      <BandPill band={s.band} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{s.supplier}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {s.flags.map((f) => (
                            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-red-900/20 text-red-300 border border-red-800">
                              <AlertTriangle size={9} /> {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contract Modal */}
      {contractModal !== null && (
        <ContractModal
          contract={contractModal?.id ? contractModal : null}
          onSave={saveContract}
          onClose={() => { setContractModal(null); setLockedContractId(null) }}
          onLockChange={(id, locked) => setLockedContractId(locked ? id : null)}
        />
      )}

      {/* Delete Contract Confirmation */}
      <Modal
        open={!!contractDeleteTarget}
        onClose={contractDeleting ? undefined : () => { setContractDeleteTarget(null); setContractDeleteError(null) }}
        title={t('suppliers.deleteContract.delete')}
        size="sm"
        footer={(
          <>
            <button onClick={() => { setContractDeleteTarget(null); setContractDeleteError(null) }} disabled={contractDeleting} className="btn-secondary disabled:opacity-50">{t('suppliers.deleteContract.cancel')}</button>
            <button onClick={deleteContract} disabled={contractDeleting} className="btn-danger flex items-center gap-2 disabled:opacity-50">
              <X size={15} /> {contractDeleting ? t('suppliers.deleteContract.deleting') : t('suppliers.deleteContract.delete')}
            </button>
          </>
        )}
      >
        <div className="flex gap-3 mb-4">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">{t('suppliers.deleteContract.confirmTitle', { name: contractDeleteTarget?.supplier_name })}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{t('suppliers.deleteContract.warning')}</p>
          </div>
        </div>
        {contractDeleteError && (
          <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5">{contractDeleteError}</p>
        )}
      </Modal>
    </div>
  )
}
