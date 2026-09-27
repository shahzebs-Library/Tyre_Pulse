import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  ShieldCheck, ShieldAlert, DollarSign, TrendingUp, BarChart3,
  Plus, X, Search, Filter, Download, FileText, FileSpreadsheet,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  RefreshCw, CheckCircle, Clock, AlertTriangle, XCircle,
  Edit2, Save, Loader2, Calendar, Tag, Package,
  Building2, Hash, Percent, CreditCard, Activity, Info,
  ArrowUpRight, Layers, Zap, Target, List, PieChart, Lock, Trash2,
} from 'lucide-react'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import * as warranty from '../lib/api/warranty'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { formatDate } from '../lib/formatters'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import EmptyState from '../components/EmptyState'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  FAILURE_TYPES, CLAIM_STATUSES, CREDITED_STATUSES, scopeClaimsByCountry, filterClaimsBase,
  filterClaimsByDimension, claimKpis, brandPerformance, failureBreakdown,
  statusCounts as countStatuses, monthlyCredits as creditsByMonth, creditAnalysis as analyseCredits,
  roiModel, generateClaimNo, optionsOf, lifePct,
} from '../lib/warrantyTrackerAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
)


const STATUS_CFG = {
  'Submitted':     { text: 'text-blue-400',    bg: 'bg-blue-900/30',    border: 'border-blue-700'    },
  'Under Review':  { text: 'text-yellow-400',  bg: 'bg-yellow-900/30',  border: 'border-yellow-700'  },
  'Approved':      { text: 'text-green-400',   bg: 'bg-green-900/30',   border: 'border-green-700'   },
  'Rejected':      { text: 'text-red-400',     bg: 'bg-red-900/30',     border: 'border-red-700'     },
  'Credit Issued': { text: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700' },
  'Closed':        { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]' },
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
}

const PALETTE = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#14b8a6', '#6b7280',
]

const FAILURE_PALETTE = [
  '#f97316', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1',
]


function fmtDate(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  return isNaN(d) ? iso : formatDate(d)
}

const EMPTY_FORM = {
  serial_number: '',
  brand: '',
  size: '',
  asset_no: '',
  site: '',
  country: '',
  fitment_date: '',
  removal_date: '',
  km_at_fitment: '',
  km_at_removal: '',
  expected_life_km: 100000,
  failure_type: 'Premature Wear',
  supplier: '',
  notes: '',
  claim_status: 'Submitted',
  credit_amount: '',
  credit_date: '',
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.text} ${cfg.bg} ${cfg.border}`}>
      {status}
    </span>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', warn }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-[var(--surface-1)] border ${warn ? 'border-red-700/60' : 'border-[var(--input-border)]'} rounded-xl p-4 flex items-start gap-3`}
    >
      <div className={`p-2 rounded-lg bg-[var(--input-bg)] ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[var(--text-muted)] text-xs truncate">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
        {sub && <p className="text-[var(--text-muted)] text-xs mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

export default function WarrantyTracker() {
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { profile } = useAuth()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [claims, setClaims]     = useState([])
  const [tyreRecords, setTyreRecords] = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('Claims')

  const [search, setSearch]           = useState('')
  const [filterBrand, setFilterBrand] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterFailure, setFilterFailure] = useState('All')
  const [filterSite, setFilterSite]   = useState('All')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')

  const [showAdd, setShowAdd]     = useState(false)
  const [editClaim, setEditClaim] = useState(null)
  const [drawer, setDrawer]       = useState(null)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving]       = useState(false)
  const [serialLookupLoading, setSerialLookupLoading] = useState(false)

  const [roiAnnualCount, setRoiAnnualCount] = useState('')
  const [roiAvgCost, setRoiAvgCost]         = useState('')
  const [expandedRow, setExpandedRow]       = useState(null)

  const [claimsError, setClaimsError] = useState('')
  const [claimsLoading, setClaimsLoading] = useState(true)

  // Approval-engine lock state for the claim currently open in the edit modal.
  // While that claim is mid-approval (pending/in_review/returned) or approved &
  // locked, its edit/save/status/delete controls are disabled — the server RPCs
  // remain the authoritative boundary; this is the UI convenience gate.
  const [wfLocked, setWfLocked] = useState({ isActive: false, isLocked: false, status: null })
  const claimLocked = wfLocked.isActive || wfLocked.isLocked
  // EntityApprovalPanel invokes onStateChange during its effect, so this must be
  // a stable callback that only commits a change when a value actually differs —
  // otherwise a fresh object each render would trigger an update loop.
  const handleWfStateChange = useCallback((next) => {
    setWfLocked(prev =>
      prev.isActive === next.isActive &&
      prev.isLocked === next.isLocked &&
      prev.status === next.status
        ? prev
        : next,
    )
  }, [])
  // Reset the approval lock whenever the open claim changes (or the modal
  // closes) so one claim's approval state never leaks into another's controls.
  useEffect(() => {
    setWfLocked({ isActive: false, isLocked: false, status: null })
  }, [editClaim?.id])

  const loadClaims = useCallback(async () => {
    try {
      setClaimsError('')
      const data = await warranty.listWarrantyClaims()
      setClaims(data ?? [])
    } catch (e) {
      setClaimsError(toUserMessage(e, 'Could not load warranty claims. Please retry.'))
      setClaims([])
    } finally {
      setClaimsLoading(false)
    }
  }, [])

  // Persist a single claim (insert or update) then refresh from the server so
  // the list always reflects committed state - no optimistic divergence.
  const upsertClaim = useCallback(async (row, id) => {
    if (id) {
      await warranty.updateWarrantyClaim(id, row)
    } else {
      await warranty.createWarrantyClaim(row)
    }
    await loadClaims()
  }, [loadClaims])

  const removeClaim = useCallback(async (id) => {
    await warranty.deleteWarrantyClaim(id)
    await loadClaims()
  }, [loadClaims])

  useEffect(() => {
    loadClaims()
  }, [loadClaims])

  useEffect(() => {
    async function load() {
      setLoading(true)
      let data = []
      try { data = await warranty.listTyreContext() } catch { data = [] }
      setTyreRecords(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // Country scoping - mirror the app-wide null-safe convention (applyCountry):
  // "All" shows every country; a specific country shows its own rows plus any
  // with a NULL country (never silently dropped). warranty.listWarrantyClaims()
  // returns the full claim set (its API takes no country arg and is out of
  // scope to edit), so the scope is applied here before any aggregation. This
  // keeps per-country credit money in a single currency (activeCurrency) rather
  // than blending SAR + AED + EGP. Numbers for a single-country selection are
  // exactly the same rows as before - only the scope predicate changed.
  const scopedClaims = useMemo(() => scopeClaimsByCountry(claims, activeCountry), [claims, activeCountry])

  const cur = activeCurrency
  const fmt = (v) => {
    if (v == null || !isFinite(v)) return 'N/A'
    if (Math.abs(v) >= 1_000_000) return `${cur} ${(v / 1_000_000).toFixed(2)}M`
    if (Math.abs(v) >= 1_000) return `${cur} ${(v / 1_000).toFixed(1)}K`
    return `${cur} ${Math.round(v).toLocaleString()}`
  }
  const pct = (v) => (v == null || !isFinite(v) ? 'N/A' : `${Number(v).toFixed(1)}%`)

  const brands = useMemo(() => optionsOf(scopedClaims, 'brand'), [scopedClaims])
  const sites  = useMemo(() => optionsOf(scopedClaims, 'site'), [scopedClaims])

  // Two scopes (engine: src/lib/warrantyTrackerAnalytics). `filteredBase`
  // applies the POPULATION filters (site, date range, search) and holds out the
  // brand / status / failure selects, because the brand table, status doughnut
  // and failure table ARE those dimensions; filtering them by themselves would
  // only echo the select back. The KPI tiles compute over `filteredBase`.
  const filteredBase = useMemo(
    () => filterClaimsBase(scopedClaims, { site: filterSite, from: dateFrom, to: dateTo, search }),
    [scopedClaims, filterSite, dateFrom, dateTo, search],
  )
  const scopeActive = filteredBase.length !== scopedClaims.length
  const dimensionActive = filterBrand !== 'All' || filterStatus !== 'All' || filterFailure !== 'All'
  const filtered = useMemo(
    () => filterClaimsByDimension(filteredBase, { brand: filterBrand, status: filterStatus, failure: filterFailure }),
    [filteredBase, filterBrand, filterStatus, filterFailure],
  )
  const kpis = useMemo(() => claimKpis(filteredBase), [filteredBase])
  const brandPerf = useMemo(() => brandPerformance(filteredBase), [filteredBase])
  const statusCounts = useMemo(() => countStatuses(filteredBase), [filteredBase])
  const failureCounts = useMemo(() => failureBreakdown(filteredBase), [filteredBase])
  const monthlyCredits = useMemo(() => creditsByMonth(filteredBase, { now: new Date() }), [filteredBase])
  const creditAnalysis = useMemo(() => analyseCredits(filteredBase), [filteredBase])
  const expandedClaim = useMemo(() => filtered.find(c => c.id === expandedRow) || null, [filtered, expandedRow])

  const openForm = useCallback((claim = null) => {
    if (claim) {
      setForm({
        serial_number: claim.serial_number || '',
        brand: claim.brand || '',
        size: claim.size || '',
        asset_no: claim.asset_no || '',
        site: claim.site || '',
        country: claim.country || '',
        fitment_date: claim.fitment_date || '',
        removal_date: claim.removal_date || '',
        km_at_fitment: claim.km_at_fitment ?? '',
        km_at_removal: claim.km_at_removal ?? '',
        expected_life_km: claim.expected_life_km ?? 100000,
        failure_type: claim.failure_type || 'Premature Wear',
        supplier: claim.supplier || '',
        notes: claim.notes || '',
        claim_status: claim.claim_status || 'Submitted',
        credit_amount: claim.credit_amount ?? '',
        credit_date: claim.credit_date || '',
      })
      setEditClaim(claim)
    } else {
      setForm(EMPTY_FORM)
      setEditClaim(null)
    }
    setFormError('')
    setShowAdd(true)
  }, [])

  const handleSerialLookup = useCallback(async () => {
    if (!form.serial_number.trim()) return
    setSerialLookupLoading(true)
    try {
      const data = await warranty.findTyreForClaim(form.serial_number.trim())
      if (data) {
        setForm(prev => ({
          ...prev,
          brand: data.brand || prev.brand,
          size: data.size || prev.size,
          asset_no: data.asset_no || prev.asset_no,
          site: data.site || prev.site,
          country: data.country || prev.country,
          fitment_date: data.fitment_date || prev.fitment_date,
          km_at_fitment: data.km_at_fitment ?? prev.km_at_fitment,
          km_at_removal: data.km_at_removal ?? prev.km_at_removal,
          supplier: data.supplier || prev.supplier,
        }))
      }
    } catch {
    } finally {
      setSerialLookupLoading(false)
    }
  }, [form.serial_number])

  const kmRun = useMemo(() => {
    const fit = Number(form.km_at_fitment)
    const rem = Number(form.km_at_removal)
    if (fit >= 0 && rem > 0 && rem > fit) return rem - fit
    return 0
  }, [form.km_at_fitment, form.km_at_removal])

  const handleSave = useCallback(async () => {
    // Editing an in-approval / approved claim is blocked — the workflow owns it.
    if (editClaim && claimLocked) { setFormError('Locked, in approval. Edits are disabled while an approval is running or the claim is approved.'); return }
    if (!form.serial_number.trim()) { setFormError('Serial number is required.'); return }
    if (!form.brand.trim()) { setFormError('Brand is required.'); return }
    if (!form.failure_type) { setFormError('Failure type is required.'); return }
    setSaving(true)
    setFormError('')
    try {
      // Whitelist only real columns - never spread unknown form keys into the row
      const base = {
        serial_number: form.serial_number.trim(),
        brand: form.brand.trim(),
        size: form.size || null,
        asset_no: form.asset_no || null,
        site: form.site || null,
        country: form.country || profile?.country || null,
        fitment_date: form.fitment_date || null,
        removal_date: form.removal_date || null,
        km_at_fitment: Number(form.km_at_fitment) || 0,
        km_at_removal: Number(form.km_at_removal) || 0,
        km_run: kmRun,
        expected_life_km: Number(form.expected_life_km) || 100000,
        failure_type: form.failure_type,
        supplier: form.supplier || null,
        notes: form.notes || null,
        claim_status: form.claim_status || 'Submitted',
        credit_amount: Number(form.credit_amount) || 0,
        credit_date: form.credit_date || null,
      }
      if (editClaim) {
        await upsertClaim(base, editClaim.id)
      } else {
        await upsertClaim({
          ...base,
          claim_no: generateClaimNo(claims, new Date()),
          created_by: profile?.id ?? null,
        })
      }
      setShowAdd(false)
      setEditClaim(null)
      setForm(EMPTY_FORM)
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not save the claim. Please retry.'))
    } finally {
      setSaving(false)
    }
  }, [claims, editClaim, form, kmRun, upsertClaim, profile, claimLocked])

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletingClaim, setDeletingClaim] = useState(false)

  const handleDelete = useCallback(async (id) => {
    // Block deletion of the claim that is currently open in the approval-locked
    // edit modal — a document under approval must not be removed out from under
    // the workflow (server RLS/RPCs remain the hard boundary).
    if (editClaim?.id === id && claimLocked) {
      window.alert('Locked, in approval. This claim cannot be deleted while an approval is running or the claim is approved.')
      return
    }
    setDeleteTarget(id)
  }, [editClaim, claimLocked])

  const confirmDeleteClaim = useCallback(async () => {
    const id = deleteTarget
    if (!id) return
    setDeletingClaim(true)
    try {
      await removeClaim(id)
      setDrawer(null)
    } catch (e) {
      window.alert(toUserMessage(e, 'Could not delete the claim.'))
    } finally {
      setDeletingClaim(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, removeClaim])

  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape' })
    const brand = await resolvePdfBrand(branding)

    // ── EMPTY STATE ──
    if (filtered.length === 0) {
      pdfHeader(doc, 'Warranty Claims Report', `0 claims | ${formatDate(new Date())}`, company, brand)
      pdfEmptyState(doc, 'No warranty claims for the selected filters')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`warranty-claims-${new Date().toISOString().split('T')[0]}.pdf`)
      return
    }

    pdfHeader(doc, 'Warranty Claims Report', `${filtered.length} claims | ${formatDate(new Date())}`, company, brand)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['Claim No', 'Serial', 'Brand', 'Size', 'Asset', 'Site', 'Failure Type', 'Status', 'km Run', 'Exp km', '% Life', 'Credit', 'Date']],
      body: filtered.map(c => [
        c.claim_no, c.serial_number, c.brand, c.size, c.asset_no, c.site,
        c.failure_type, c.claim_status,
        c.km_run != null ? Number(c.km_run).toLocaleString() : 'N/A',
        c.expected_life_km != null ? Number(c.expected_life_km).toLocaleString() : 'N/A',
        lifePct(c) == null ? 'N/A' : `${lifePct(c).toFixed(1)}%`,
        c.credit_amount ? `${cur} ${Number(c.credit_amount).toLocaleString()}` : 'N/A',
        fmtDate(c.created_at),
      ]),
    })
    // ONE scope per document. Page 1 lists `filtered`; this page used to be
    // built from the screen's `brandPerf`, which holds out the brand/status/
    // failure selects, so a filtered report carried a brand table covering
    // claims that were not in it, under a single title.
    const exportBrandPerf = brandPerformance(filtered)
    if (exportBrandPerf.length > 0) {
      doc.addPage()
      pdfHeader(doc, 'Warranty Claims Report', `Brand Warranty Performance, same ${filtered.length} claims | ${formatDate(new Date())}`, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        head: [['Brand', 'Total Claims', 'Approval Rate', 'Avg Credit', 'Avg km at Failure']],
        body: exportBrandPerf.map(b => [
          b.brand, b.total, pct(b.approvalRate),
          b.avgCredit != null ? `${cur} ${Math.round(b.avgCredit).toLocaleString()}` : 'N/A',
          b.avgKm != null ? Math.round(b.avgKm).toLocaleString() : 'N/A',
        ]),
      })
    }
    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`warranty-claims-${new Date().toISOString().split('T')[0]}.pdf`)
  }, [filtered, cur, branding, company])

  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const rows = filtered.map(c => ({
      'Claim No': c.claim_no,
      'Serial Number': c.serial_number,
      Brand: c.brand,
      Size: c.size,
      'Asset No': c.asset_no,
      Site: c.site,
      Country: c.country,
      'Fitment Date': c.fitment_date,
      'Removal Date': c.removal_date,
      'km at Fitment': c.km_at_fitment,
      'km at Removal': c.km_at_removal,
      'km Run': c.km_run,
      'Expected Life km': c.expected_life_km,
      '% of Life': lifePct(c) == null ? null : +lifePct(c).toFixed(1),
      'Failure Type': c.failure_type,
      Status: c.claim_status,
      'Credit Amount': c.credit_amount,
      'Credit Date': c.credit_date,
      Supplier: c.supplier,
      Notes: c.notes,
      'Created At': fmtDate(c.created_at),
    }))
    const wb = XLSX.utils.book_new()
    // ONE scope per workbook: every sheet is derived from `filtered`, the same
    // set the Warranty Claims sheet lists. The Brand Performance and Failure
    // Analysis sheets used to be built from the screen aggregates, which cover
    // a wider population than the claim list beside them.
    const exportBrandPerf = brandPerformance(filtered)
    const exportFailures = failureBreakdown(filtered)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Warranty Claims')
    if (exportBrandPerf.length > 0) {
      const bpRows = exportBrandPerf.map(b => ({
        Brand: b.brand,
        'Total Claims': b.total,
        'Approval Rate %': b.approvalRate == null ? null : +b.approvalRate.toFixed(1),
        'Avg Credit': b.avgCredit == null ? null : +b.avgCredit.toFixed(0),
        'Avg km at Failure': b.avgKm == null ? null : +b.avgKm.toFixed(0),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bpRows), 'Brand Performance')
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportFailures.map(f => ({
      'Failure Type': f.type,
      Count: f.count,
      'Avg km at Failure': f.avgKm,
    }))), 'Failure Analysis')
    XLSX.writeFile(wb, `warranty-claims-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [filtered])

  const exportClaimLetter = useCallback(async (claim) => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    doc.setFontSize(20)
    doc.setTextColor(30, 64, 175)
    doc.text('TYRE WARRANTY CLAIM', 105, 30, { align: 'center' })
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(11)
    doc.text(`Claim Reference: ${claim.claim_no}`, 14, 48)
    doc.text(`Date: ${formatDate(new Date())}`, 14, 56)
    doc.setDrawColor(200, 200, 200)
    doc.line(14, 60, 196, 60)
    doc.setFontSize(12)
    doc.setTextColor(30, 64, 175)
    doc.text('Claim Details', 14, 70)
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    const fields = [
      ['Serial Number', claim.serial_number],
      ['Brand', claim.brand],
      ['Size', claim.size],
      ['Supplier', claim.supplier || 'N/A'],
      ['Asset / Vehicle', claim.asset_no],
      ['Site / Location', claim.site],
      ['Fitment Date', fmtDate(claim.fitment_date)],
      ['Removal Date', fmtDate(claim.removal_date)],
      ['km at Fitment', claim.km_at_fitment?.toLocaleString() || '0'],
      ['km at Removal', claim.km_at_removal?.toLocaleString() || '0'],
      ['km Run', claim.km_run?.toLocaleString() || '0'],
      ['Expected Life km', claim.expected_life_km?.toLocaleString() || '0'],
      ['% of Expected Life', claim.expected_life_km > 0 ? `${((claim.km_run / claim.expected_life_km) * 100).toFixed(1)}%` : 'N/A'],
      ['Failure Type', claim.failure_type],
    ]
    let y = 80
    fields.forEach(([k, v]) => {
      doc.setFont(undefined, 'bold')
      doc.text(`${k}:`, 14, y)
      doc.setFont(undefined, 'normal')
      doc.text(String(v ?? 'N/A'), 80, y)
      y += 8
    })
    doc.line(14, y + 2, 196, y + 2)
    y += 10
    doc.setFontSize(12)
    doc.setTextColor(30, 64, 175)
    doc.text('Failure Description', 14, y)
    y += 8
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    const descLines = doc.splitTextToSize(claim.notes || 'No additional notes provided.', 180)
    doc.text(descLines, 14, y)
    y += descLines.length * 7 + 10
    doc.line(14, y, 196, y)
    y += 10
    doc.setFontSize(11)
    doc.text('We hereby submit this tyre warranty claim for your review and request a credit note', 14, y)
    y += 7
    doc.text('or replacement as per the applicable warranty policy.', 14, y)
    y += 20
    doc.text('Authorized Signature: ________________________', 14, y)
    y += 8
    doc.text('Name: ________________________', 14, y)
    y += 8
    doc.text(`Date: ${formatDate(new Date())}`, 14, y)
    doc.save(`warranty-claim-${claim.claim_no}.pdf`)
  }, [])

  // DELIBERATELY whole-country. The ROI model compares this year's credits with
  // an annual purchase volume the user types in, and that volume is a
  // country-wide figure, so narrowing one side of the ratio would understate
  // the recovery rate. The panel says so on screen.
  const roiCalc = useMemo(
    () => roiModel(scopedClaims, { annualCount: roiAnnualCount, avgCost: roiAvgCost, now: new Date() }),
    [scopedClaims, roiAnnualCount, roiAvgCost],
  )

  const brandChartData = useMemo(() => ({
    labels: brandPerf.slice(0, 10).map(b => b.brand),
    datasets: [
      {
        label: 'Total Claims',
        data: brandPerf.slice(0, 10).map(b => b.total),
        backgroundColor: '#3b82f6',
        borderRadius: 4,
      },
      {
        label: 'Approval Rate %',
        data: brandPerf.slice(0, 10).map(b => (b.approvalRate == null ? null : +b.approvalRate.toFixed(1))),
        backgroundColor: '#10b981',
        borderRadius: 4,
      },
    ],
  }), [brandPerf])

  const statusDoughnutData = useMemo(() => ({
    labels: CLAIM_STATUSES,
    datasets: [{
      data: CLAIM_STATUSES.map(s => statusCounts[s] || 0),
      backgroundColor: PALETTE,
      borderColor: PALETTE.map(c => c + '88'),
      borderWidth: 1,
    }],
  }), [statusCounts])

  const failureDoughnutData = useMemo(() => ({
    labels: failureCounts.map(f => f.type),
    datasets: [{
      data: failureCounts.map(f => f.count),
      backgroundColor: FAILURE_PALETTE,
      borderColor: FAILURE_PALETTE.map(c => c + '88'),
      borderWidth: 1,
    }],
  }), [failureCounts])

  const creditTrendData = useMemo(() => ({
    labels: monthlyCredits.labels,
    datasets: [{
      label: 'Credits Received',
      data: monthlyCredits.data,
      backgroundColor: '#10b981',
      borderRadius: 4,
    }],
  }), [monthlyCredits])

  // ── Register columns (EnterpriseTable) ──────────────────────────────────────
  const claimColumns = [
    { accessorKey: 'claim_no', header: 'Claim No', cell: ({ getValue }) => <span className="font-mono text-blue-400 text-xs whitespace-nowrap">{getValue() || 'N/A'}</span> },
    { accessorKey: 'serial_number', header: 'Serial', cell: ({ getValue }) => getValue() || 'N/A' },
    { accessorKey: 'brand', header: 'Brand', cell: ({ getValue }) => <span className="font-medium text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    { accessorKey: 'size', header: 'Size', cell: ({ getValue }) => getValue() || 'N/A' },
    { accessorKey: 'asset_no', header: 'Asset', cell: ({ getValue }) => getValue() || 'N/A' },
    { accessorKey: 'site', header: 'Site', cell: ({ getValue }) => getValue() || 'N/A' },
    { accessorKey: 'failure_type', header: 'Failure Type', cell: ({ getValue }) => getValue() || 'N/A' },
    { accessorKey: 'claim_status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    { accessorKey: 'km_run', header: 'km Run', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : Number(getValue()).toLocaleString()) },
    { accessorKey: 'expected_life_km', header: 'Exp km', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : Number(getValue()).toLocaleString()) },
    {
      id: 'life_pct', header: '% Life', accessorFn: (c) => lifePct(c), meta: { align: 'right' },
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return 'N/A'
        const low = v < 50
        return <span className={`font-semibold ${low ? 'text-red-400' : 'text-[var(--text-dim)]'}`}>{v.toFixed(1)}%{low && <span className="sr-only"> (below half of expected life)</span>}</span>
      },
    },
    { accessorKey: 'credit_amount', header: `Credit (${cur})`, meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-emerald-400">{getValue() ? fmt(Number(getValue())) : 'N/A'}</span> },
    { accessorKey: 'created_at', header: 'Date', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue())}</span> },
    {
      id: 'actions', header: 'Actions', enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const c = row.original
        return (
          <div className="flex gap-1">
            <button type="button" aria-label={`Edit claim ${c.claim_no || ''}`.trim()} onClick={e => { e.stopPropagation(); openForm(c) }}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-blue-400 hover:bg-[var(--input-bg)] rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"><Edit2 size={14} /></button>
            <button type="button" aria-label={`Export claim letter ${c.claim_no || ''}`.trim()} onClick={e => { e.stopPropagation(); exportClaimLetter(c) }}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-400 hover:bg-[var(--input-bg)] rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"><FileText size={14} /></button>
          </div>
        )
      },
    },
  ]

  const brandColumns = [
    { accessorKey: 'brand', header: 'Brand', cell: ({ getValue }) => <span className="font-medium text-[var(--text-secondary)]">{getValue()}</span> },
    { accessorKey: 'total', header: 'Total Claims', meta: { align: 'right' } },
    {
      accessorKey: 'approvalRate', header: 'Approval Rate',
      meta: { exportValue: (b) => (b.approvalRate == null ? '' : +b.approvalRate.toFixed(1)) },
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return 'N/A'
        const band = v >= 70 ? { cls: 'text-green-400', label: 'high' } : v >= 40 ? { cls: 'text-yellow-400', label: 'medium' } : { cls: 'text-red-400', label: 'low' }
        return (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
              <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, v)}%` }} />
            </div>
            <span className={`text-xs font-semibold ${band.cls}`}>{v.toFixed(1)}%<span className="sr-only"> ({band.label})</span></span>
          </div>
        )
      },
    },
    { accessorKey: 'avgCredit', header: `Avg Credit per Claim (${cur})`, meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-emerald-400 font-semibold">{fmt(getValue())}</span> },
    { accessorKey: 'avgKm', header: 'Avg km at Failure', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : `${Math.round(getValue()).toLocaleString()} km`) },
  ]

  const tabs = ['Claims', 'Brand Analysis', 'Failure Analysis', 'Credit Recovery', 'ROI Calculator']

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warranty & Claims Tracker"
        subtitle="Track tyre warranties, claims, and supplier accountability"
        icon={ShieldCheck}
        actions={
        <div className="flex gap-2">
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] transition-colors"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] transition-colors"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button
            onClick={() => openForm()}
            className="btn-primary gap-1.5"
          >
            <Plus size={14} /> Add Claim
          </button>
        </div>
        }
      />
      <NotInUseNotice count={claims.length} label="warranty claims"
        hint="Claims appear once one is raised against a tyre." />

      {activeCountry === 'All' && (
        <div className="flex items-start gap-2 text-xs text-amber-400/90 bg-amber-900/15 border border-amber-800/40 rounded-lg px-3 py-2">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          <span>Showing all countries. Credit figures below span multiple currencies (SAR, AED, EGP) and are not a single-currency total. Select a country to see credits in that country's currency.</span>
        </div>
      )}

      {(scopeActive || dimensionActive) && (
        <p className="text-[var(--text-muted)] text-xs">
          {scopeActive && `These figures and the analytics panels cover the ${filteredBase.length} of ${scopedClaims.length} claims matching the site, date and search filters. `}
          {dimensionActive && 'The brand, status and failure selects shape the claim table and the exports below, not these figures, so each panel still states how many claims picking a value would show.'}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard icon={ShieldCheck} label="Total Claims" value={kpis.total} color="text-blue-400" />
        <KpiCard icon={Clock} label="Open Claims" value={kpis.open} color="text-yellow-400" warn={kpis.open > 10} />
        <KpiCard icon={DollarSign} label="Total Credits" value={fmt(kpis.totalCredits)} color="text-emerald-400" sub="received" />
        <KpiCard icon={Percent} label="Approval Rate" value={pct(kpis.approvalRate)} color="text-green-400" />
        <KpiCard icon={CreditCard} label="Avg Credit/Claim" value={fmt(kpis.avgCredit)} color="text-purple-400" />
      </div>

      <div className="flex gap-1 flex-wrap bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Claims' && (
        <div className="space-y-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <div className="flex flex-col md:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  aria-label="Search claims"
                  placeholder="Search claim, serial, brand, asset..."
                  value={search}
                  onChange={e => { setSearch(e.target.value)}}
                  className="w-full pl-8 pr-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>
              <select aria-label="Brand" value={filterBrand} onChange={e => { setFilterBrand(e.target.value)}}
                className="px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500">
                {brands.map(b => <option key={b}>{b}</option>)}
              </select>
              <select aria-label="Claim status" value={filterStatus} onChange={e => { setFilterStatus(e.target.value)}}
                className="px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500">
                {['All', ...CLAIM_STATUSES].map(s => <option key={s}>{s}</option>)}
              </select>
              <select aria-label="Failure type" value={filterFailure} onChange={e => { setFilterFailure(e.target.value)}}
                className="px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500">
                {['All', ...FAILURE_TYPES].map(f => <option key={f}>{f}</option>)}
              </select>
              <select aria-label="Site" value={filterSite} onChange={e => { setFilterSite(e.target.value)}}
                className="px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500">
                {sites.map(s => <option key={s}>{s}</option>)}
              </select>
              <input type="date" aria-label="Created from" value={dateFrom} onChange={e => { setDateFrom(e.target.value)}}
                className="px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500" />
              <input type="date" aria-label="Created to" value={dateTo} onChange={e => { setDateTo(e.target.value)}}
                className="px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {(scopeActive || dimensionActive) && (
            <p className="text-xs text-[var(--text-muted)]">
              The tiles above cover the {filteredBase.length} claims matching the site, date and search filters. The brand, status and failure selects narrow the table only.
            </p>
          )}

          <EnterpriseTable
            columns={claimColumns}
            data={filtered}
            getRowId={(c) => String(c.id)}
            loading={claimsLoading}
            error={claimsError || null}
            onRetry={() => { setClaimsLoading(true); loadClaims() }}
            enableGlobalFilter={false}
            enableExport={false}
            emptyMessage={scopedClaims.length === 0 ? 'No warranty claims recorded yet. Use New Claim to add the first one.' : 'No claims match these filters.'}
            onRowClick={(c) => setExpandedRow(expandedRow === c.id ? null : c.id)}
            viewKey="warranty-claims"
          />

          {expandedClaim && (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4" role="region" aria-label={`Claim ${expandedClaim.claim_no} details`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Claim {expandedClaim.claim_no}</h3>
                <button type="button" onClick={() => setExpandedRow(null)} aria-label="Close claim details" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                {[
                  ['Country', expandedClaim.country || 'N/A'],
                  ['Fitment Date', fmtDate(expandedClaim.fitment_date)],
                  ['Removal Date', fmtDate(expandedClaim.removal_date)],
                  ['Supplier', expandedClaim.supplier || 'N/A'],
                  ['Credit Date', fmtDate(expandedClaim.credit_date)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[var(--text-muted)] mb-1">{k}</p>
                    <p className="text-[var(--text-secondary)]">{v}</p>
                  </div>
                ))}
                <div className="col-span-2">
                  <p className="text-[var(--text-muted)] mb-1">Notes</p>
                  <p className="text-[var(--text-dim)]">{expandedClaim.notes || 'N/A'}</p>
                </div>
                <div className="flex items-end gap-2 col-span-2 md:col-span-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => exportClaimLetter(expandedClaim)}
                    className="min-h-[44px] flex items-center gap-1.5 px-3 bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-700/50 rounded-lg text-emerald-400 transition-colors"
                  >
                    <FileText size={12} aria-hidden="true" /> Claim Letter
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(expandedClaim.id)}
                    disabled={editClaim?.id === expandedClaim.id && claimLocked}
                    title={editClaim?.id === expandedClaim.id && claimLocked ? 'Locked, in approval' : undefined}
                    className="min-h-[44px] flex items-center gap-1.5 px-3 bg-red-900/30 hover:bg-red-800/40 border border-red-800/50 rounded-lg text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {editClaim?.id === expandedClaim.id && claimLocked ? <Lock size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />} Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'Brand Analysis' && (
        <div className="space-y-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-blue-400" /> Brand Warranty Performance
            </h3>
            {brandPerf.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">No data available</div>
            ) : (
              <div className="h-64">
                <Bar data={brandChartData} options={CHART_OPTS} />
              </div>
            )}
          </div>
          <EnterpriseTable
            columns={brandColumns}
            data={brandPerf}
            getRowId={(b) => b.brand}
            loading={claimsLoading}
            error={claimsError || null}
            onRetry={() => { setClaimsLoading(true); loadClaims() }}
            emptyMessage="Brand warranty performance will appear once claims are recorded."
            exportFileName={`Warranty Brand Performance ${new Date().toISOString().slice(0, 10)}`}
            reportMeta={{ title: 'Warranty brand performance', currency: cur, company }}
          />
        </div>
      )}

      {activeTab === 'Failure Analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
              <PieChart size={16} className="text-orange-400" /> Claims by Failure Type
            </h3>
            {scopedClaims.length === 0 ? (
              <div className="flex items-center justify-center h-52 text-[var(--text-muted)] text-sm">No data available</div>
            ) : (
              <>
                <div className="h-52">
                  <Doughnut data={failureDoughnutData} options={DOUGHNUT_OPTS} />
                </div>
                {failureCounts[0] && (
                  <div className="mt-3 p-3 bg-orange-900/20 border border-orange-800/40 rounded-lg text-xs text-orange-300">
                    Most common failure: <span className="font-bold">{failureCounts[0].type}</span> ({failureCounts[0].count} claims)
                  </div>
                )}
              </>
            )}
          </div>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
              <Activity size={16} className="text-purple-400" /> Average km at Failure by Type
            </h3>
            <div className="space-y-3">
              {failureCounts.filter(f => f.count > 0).map((f, i) => {
                const maxKm = Math.max(...failureCounts.map(x => x.avgKm || 0), 1)
                return (
                  <div key={f.type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[var(--text-dim)]">{f.type}</span>
                      <span className="text-[var(--text-muted)]">{f.count} claims · {f.avgKm != null ? f.avgKm.toLocaleString() + ' km avg' : 'N/A'}</span>
                    </div>
                    <div className="h-2 bg-[var(--input-border)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${f.avgKm != null ? (f.avgKm / maxKm) * 100 : 0}%`,
                          backgroundColor: FAILURE_PALETTE[i % FAILURE_PALETTE.length],
                        }}
                      />
                    </div>
                  </div>
                )
              })}
              {failureCounts.every(f => f.count === 0) && (
                <EmptyState
                  icon={Activity}
                  title="No failure data yet"
                  description="Average km at failure will appear once claims are recorded."
                  compact
                />
              )}
            </div>
          </div>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">Claim Status Distribution</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {CLAIM_STATUSES.map((s, i) => (
                <div key={s} className={`p-3 rounded-xl border ${STATUS_CFG[s]?.bg} ${STATUS_CFG[s]?.border}`}>
                  <p className={`text-2xl font-bold ${STATUS_CFG[s]?.text}`}>{statusCounts[s] || 0}</p>
                  <p className="text-[var(--text-muted)] text-xs mt-0.5">{s}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Credit Recovery' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
              <p className="text-[var(--text-muted)] text-xs mb-1">Total Credits Received</p>
              <p className="text-3xl font-bold text-emerald-400">{fmt(creditAnalysis.totalCredits)}</p>
              <p className="text-[var(--text-muted)] text-xs mt-1">across {filteredBase.filter(c => CREDITED_STATUSES.includes(c.claim_status)).length} claims</p>
            </div>
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
              <p className="text-[var(--text-muted)] text-xs mb-1">Est. Unclaimed (Approved)</p>
              <p className="text-3xl font-bold text-yellow-400">{fmt(creditAnalysis.estimatedUnclaimed)}</p>
              <p className="text-[var(--text-muted)] text-xs mt-1">{creditAnalysis.openApprovedCount} approved claims pending credit</p>
            </div>
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
              <p className="text-[var(--text-muted)] text-xs mb-1">Total Recovery Pipeline</p>
              <p className="text-3xl font-bold text-blue-400">{fmt(creditAnalysis.estimatedUnclaimed == null ? creditAnalysis.totalCredits : creditAnalysis.totalCredits + creditAnalysis.estimatedUnclaimed)}</p>
              <p className="text-[var(--text-muted)] text-xs mt-1">received + unclaimed potential</p>
            </div>
          </div>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-400" /> Monthly Credits Received (12 months)
            </h3>
            <div className="h-64">
              <Bar data={creditTrendData} options={CHART_OPTS} />
            </div>
          </div>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 flex items-center gap-2">
              <PieChart size={16} className="text-blue-400" /> Claim Status Funnel
            </h3>
            <div className="h-56">
              <Doughnut data={statusDoughnutData} options={DOUGHNUT_OPTS} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ROI Calculator' && (
        <div className="space-y-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-6">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-5 flex items-center gap-2">
              <Target size={16} className="text-blue-400" /> Warranty ROI Calculator
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1.5">Annual Tyre Count (fleet)</label>
                <input
                  type="number"
                  value={roiAnnualCount}
                  onChange={e => setRoiAnnualCount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-1.5">Average Tyre Cost ({cur})</label>
                <input
                  type="number"
                  value={roiAvgCost}
                  onChange={e => setRoiAvgCost(e.target.value)}
                  placeholder="e.g. 1200"
                  className="w-full px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            {(scopeActive || dimensionActive) && (
              <p className="text-[var(--text-muted)] text-xs">
                This model compares the year's credits with the annual purchase volume entered above, which is a whole country figure, so it covers every claim in the country and is not narrowed by the filters.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4">
                <p className="text-[var(--text-muted)] text-xs mb-1">Claims Filed (this year)</p>
                <p className="text-2xl font-bold text-blue-400">{roiCalc.thisYearClaims}</p>
              </div>
              <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4">
                <p className="text-[var(--text-muted)] text-xs mb-1">Amount Recovered</p>
                <p className="text-2xl font-bold text-emerald-400">{fmt(roiCalc.thisYearCredits)}</p>
              </div>
              <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4">
                <p className="text-[var(--text-muted)] text-xs mb-1">Recovery Rate</p>
                <p className="text-2xl font-bold text-green-400">
                  {pct(roiCalc.recoveryRate)}
                </p>
              </div>
              <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4">
                <p className="text-[var(--text-muted)] text-xs mb-1">Est. Unclaimed Potential</p>
                <p className="text-2xl font-bold text-yellow-400">
                  {Number(roiAvgCost) > 0 ? fmt(roiCalc.eligibleUnclaimed) : 'N/A'}
                </p>
              </div>
            </div>
            {Number(roiAvgCost) > 0 && Number(roiAnnualCount) > 0 && roiCalc.eligibleUnclaimed > 0 && (
              <div className="mt-4 p-4 bg-blue-900/20 border border-blue-700/40 rounded-xl text-sm text-blue-300">
                <strong>Opportunity:</strong> If you filed claims on all eligible removals, you could recover an additional{' '}
                <span className="font-bold text-blue-200">{fmt(roiCalc.eligibleUnclaimed)}</span> per year.
                Based on 30% eligibility assumption at {`${cur} ${Number(roiAvgCost).toLocaleString()}`} per tyre x 40% credit rate.
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={saving ? undefined : () => { setShowAdd(false); setEditClaim(null) }}
        size="lg"
        title={(
          <span className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-blue-400" />
            {editClaim ? 'Edit Warranty Claim' : 'New Warranty Claim'}
          </span>
        )}
        footer={(
          <>
            <button onClick={() => { setShowAdd(false); setEditClaim(null) }}
              disabled={saving}
              className="btn-secondary disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || claimLocked}
              title={claimLocked ? 'Locked, in approval' : undefined}
              className="btn-primary gap-2 disabled:opacity-50">
              {claimLocked ? <Lock size={14} /> : saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editClaim ? 'Update Claim' : 'Save Claim'}
            </button>
          </>
        )}
      >
              <div className="space-y-4">
                {formError && (
                  <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm flex items-center gap-2">
                    <AlertTriangle size={14} /> {formError}
                  </div>
                )}

                {/*
                  Approval engine — wired for existing claims only (a claim must
                  exist before it can enter an approval chain). While the claim is
                  mid-approval or approved, `wfLocked` (via onStateChange) disables
                  every edit/save/status control below. Charts/exports are untouched.
                */}
                {editClaim && (
                  <>
                    <EntityApprovalPanel
                      entityType="warranty_claim"
                      entityId={editClaim.id}
                      entityLabel={editClaim.claim_no || editClaim.serial_number || editClaim.id}
                      context={{
                        claim_amount: Number(editClaim.credit_amount) || 0,
                        status: editClaim.claim_status,
                        brand: editClaim.brand,
                        serial_number: editClaim.serial_number,
                        country: editClaim.country,
                      }}
                      title="Warranty Approval"
                      onStateChange={handleWfStateChange}
                    />
                    {claimLocked && (
                      <div className="p-3 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-muted)] flex items-center gap-2">
                        <Lock size={13} className="text-[var(--accent)]" />
                        Locked, in approval. Edits, status changes, and deletion are disabled while this claim is under approval or approved.
                      </div>
                    )}
                  </>
                )}

                <fieldset disabled={claimLocked} className="contents">
                <div className="space-y-1">
                  <label htmlFor="wc-serial-number" className="text-xs text-[var(--text-muted)]">Serial Number *</label>
                  <div className="flex gap-2">
                    <input id="wc-serial-number"
                      value={form.serial_number}
                      onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))}
                      placeholder="Enter serial number"
                      className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={handleSerialLookup}
                      disabled={serialLookupLoading}
                      className="px-3 py-2 bg-blue-800/40 hover:bg-blue-700/50 border border-blue-700/50 rounded-lg text-blue-400 text-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {serialLookupLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Lookup
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="wc-brand" className="text-xs text-[var(--text-muted)]">Brand *</label>
                    <input id="wc-brand" value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-size" className="text-xs text-[var(--text-muted)]">Size</label>
                    <input id="wc-size" value={form.size} onChange={e => setForm(p => ({ ...p, size: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-asset-no" className="text-xs text-[var(--text-muted)]">Asset No</label>
                    <input id="wc-asset-no" value={form.asset_no} onChange={e => setForm(p => ({ ...p, asset_no: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-site" className="text-xs text-[var(--text-muted)]">Site</label>
                    <input id="wc-site" value={form.site} onChange={e => setForm(p => ({ ...p, site: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-country" className="text-xs text-[var(--text-muted)]">Country</label>
                    <input id="wc-country" value={form.country} onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-supplier" className="text-xs text-[var(--text-muted)]">Supplier</label>
                    <input id="wc-supplier" value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-fitment-date" className="text-xs text-[var(--text-muted)]">Fitment Date</label>
                    <input id="wc-fitment-date" type="date" value={form.fitment_date} onChange={e => setForm(p => ({ ...p, fitment_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-removal-date" className="text-xs text-[var(--text-muted)]">Removal Date</label>
                    <input id="wc-removal-date" type="date" value={form.removal_date} onChange={e => setForm(p => ({ ...p, removal_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-km-at-fitment" className="text-xs text-[var(--text-muted)]">km at Fitment</label>
                    <input id="wc-km-at-fitment" type="number" value={form.km_at_fitment} onChange={e => setForm(p => ({ ...p, km_at_fitment: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-km-at-removal" className="text-xs text-[var(--text-muted)]">km at Removal</label>
                    <input id="wc-km-at-removal" type="number" value={form.km_at_removal} onChange={e => setForm(p => ({ ...p, km_at_removal: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                </div>

                {kmRun > 0 && (
                  <div className="p-3 bg-blue-900/20 border border-blue-700/40 rounded-lg text-xs text-blue-300">
                    km Run: <span className="font-bold text-blue-200">{kmRun.toLocaleString()} km</span>
                    {form.expected_life_km > 0 && (
                      <> · {((kmRun / Number(form.expected_life_km)) * 100).toFixed(1)}% of expected life</>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="wc-expected-life-km" className="text-xs text-[var(--text-muted)]">Expected Life km</label>
                    <input id="wc-expected-life-km" type="number" value={form.expected_life_km} onChange={e => setForm(p => ({ ...p, expected_life_km: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="wc-failure-type" className="text-xs text-[var(--text-muted)]">Failure Type *</label>
                    <select id="wc-failure-type" value={form.failure_type} onChange={e => setForm(p => ({ ...p, failure_type: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500">
                      {FAILURE_TYPES.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                </div>

                {editClaim && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="wc-status" className="text-xs text-[var(--text-muted)]">Status</label>
                      <select id="wc-status" value={form.claim_status} onChange={e => setForm(p => ({ ...p, claim_status: e.target.value }))}
                        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-dim)] focus:outline-none focus:border-blue-500">
                        {CLAIM_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    {form.claim_status === 'Credit Issued' && (
                      <>
                        <div className="space-y-1">
                          <label htmlFor="wc-credit-amount" className="text-xs text-[var(--text-muted)]">Credit Amount ({cur})</label>
                          <input id="wc-credit-amount" type="number" value={form.credit_amount} onChange={e => setForm(p => ({ ...p, credit_amount: e.target.value }))}
                            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="wc-credit-date" className="text-xs text-[var(--text-muted)]">Credit Date</label>
                          <input id="wc-credit-date" type="date" value={form.credit_date} onChange={e => setForm(p => ({ ...p, credit_date: e.target.value }))}
                            className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500" />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor="wc-notes-failure-description" className="text-xs text-[var(--text-muted)]">Notes / Failure Description</label>
                  <textarea id="wc-notes-failure-description" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    rows={3} placeholder="Describe the failure, location on tyre, etc."
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500 resize-none" />
                </div>
                </fieldset>
              </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={deletingClaim ? undefined : () => setDeleteTarget(null)}
        title="Delete warranty claim"
        size="sm"
        footer={(
          <>
            <button onClick={() => setDeleteTarget(null)} disabled={deletingClaim} className="btn-secondary disabled:opacity-50">
              Cancel
            </button>
            <button onClick={confirmDeleteClaim} disabled={deletingClaim}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50">
              {deletingClaim ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">Delete this warranty claim?</p>
      </Modal>
    </div>
  )
}
