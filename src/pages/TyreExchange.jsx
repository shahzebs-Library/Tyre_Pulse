import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ArrowLeftRight, MapPin, RefreshCw, Clock, Search, Filter, X,
  Download, FileText, FileSpreadsheet, ChevronLeft, ChevronRight,
  CheckCircle, AlertTriangle, AlertCircle, History, Package,
  TrendingUp, RotateCcw, Truck, Eye, CheckSquare, XCircle,
  Calendar, ChevronDown, Lock,
} from 'lucide-react'
import * as exchangeApi from '../lib/api/tyreExchange'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { exportToPdf, exportToExcel, resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../lib/formatters'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const GRID = { color: '#1f2937' }
const TICK = { color: '#9ca3af' }
const PAGE_SIZE = 25

const BAR_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: GRID, ticks: TICK },
    y: { grid: GRID, ticks: TICK },
  },
}

const DONUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right',
      labels: { color: '#9ca3af', boxWidth: 12, padding: 12 },
    },
    tooltip: {
      callbacks: {
        label: ctx => {
          const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
          const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0
          return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`
        },
      },
    },
  },
}

const TABS = [
  { id: 'transfers',  label: 'Transfer History',    icon: ArrowLeftRight },
  { id: 'retreads',   label: 'Retread Tracking',     icon: RefreshCw },
  { id: 'custody',    label: 'Chain of Custody',     icon: History },
  { id: 'pending',    label: 'Pending Returns',      icon: Clock },
  { id: 'analytics',  label: 'Transfer Analytics',   icon: TrendingUp },
  { id: 'flow',       label: 'Site Flow Matrix',     icon: Truck },
]

function fmtDate(d) {
  if (!d) return '-'
  return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysDiff(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now - d) / (1000 * 60 * 60 * 24))
}

// Derive transfer events from tyre_records grouped by serial_number
function deriveTransfers(records) {
  const bySerial = {}
  for (const r of records) {
    const sn = r.serial_number || r.serial_no
    if (!sn) continue
    if (!bySerial[sn]) bySerial[sn] = []
    bySerial[sn].push(r)
  }

  const transfers = []
  for (const [serial, recs] of Object.entries(bySerial)) {
    const sorted = [...recs].sort((a, b) => {
      const da = a.issue_date ? new Date(a.issue_date) : new Date(0)
      const db = b.issue_date ? new Date(b.issue_date) : new Date(0)
      return da - db
    })

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      const fromAsset = prev.asset_no
      const toAsset = curr.asset_no
      const fromSite = prev.site
      const toSite = curr.site

      const isVehicleTransfer = fromAsset && toAsset && fromAsset !== toAsset
      const isSiteTransfer = fromSite && toSite && fromSite !== toSite

      if (isVehicleTransfer || isSiteTransfer) {
        let transferType = 'Inter-Vehicle'
        if (isSiteTransfer && isVehicleTransfer) transferType = 'Inter-Site'
        else if (isSiteTransfer) transferType = 'Inter-Site'
        else if ((curr.category || '').toLowerCase().includes('retread')) transferType = 'Retread'
        else if ((curr.category || '').toLowerCase().includes('repair')) transferType = 'Repair'

        const kmAtRemoval = prev.km_at_removal || null
        const kmAtFitment = prev.km_at_fitment || null
        const kmRun = kmAtRemoval && kmAtFitment ? kmAtRemoval - kmAtFitment : null

        transfers.push({
          id: `${serial}-${i}`,
          serial,
          brand: prev.brand || curr.brand || '-',
          size: prev.size || curr.size || '-',
          fromAsset: fromAsset || '-',
          toAsset: toAsset || '-',
          fromSite: fromSite || '-',
          toSite: toSite || '-',
          transferDate: curr.issue_date,
          kmAtTransfer: kmAtRemoval,
          kmRun,
          category: curr.category || prev.category || '-',
          treadAtTransfer: prev.tread_depth,
          transferType,
          prevRecord: prev,
          currRecord: curr,
        })
      }
    }
  }
  return transfers
}

// Derive custody chain for a single serial
function deriveCustody(records, serial) {
  const sn = serial.trim().toLowerCase()
  const matched = records.filter(r => {
    const s = (r.serial_number || r.serial_no || '').toLowerCase()
    return s === sn
  })
  return [...matched].sort((a, b) => {
    const da = a.issue_date ? new Date(a.issue_date) : new Date(0)
    const db = b.issue_date ? new Date(b.issue_date) : new Date(0)
    return da - db
  })
}

// Derive pending returns: removed (retread/repair) with no subsequent fitment
function derivePendingReturns(records) {
  const bySerial = {}
  for (const r of records) {
    const sn = r.serial_number || r.serial_no
    if (!sn) continue
    if (!bySerial[sn]) bySerial[sn] = []
    bySerial[sn].push(r)
  }

  const pending = []
  for (const [serial, recs] of Object.entries(bySerial)) {
    const sorted = [...recs].sort((a, b) => {
      const da = a.issue_date ? new Date(a.issue_date) : new Date(0)
      const db = b.issue_date ? new Date(b.issue_date) : new Date(0)
      return da - db
    })

    const last = sorted[sorted.length - 1]
    const cat = (last.category || '').toLowerCase()
    const isRemoved = cat.includes('retread') || cat.includes('repair') || cat.includes('scrap')
    const hasRemovalDate = !!last.km_at_removal || !!(last.issue_date && sorted.length > 1 && sorted[sorted.length - 2].km_at_removal)

    if (isRemoved && sorted.length >= 1) {
      const removalDate = last.issue_date
      const days = removalDate ? daysDiff(removalDate) : null

      pending.push({
        serial,
        brand: last.brand || '-',
        size: last.size || '-',
        removedFrom: last.asset_no || '-',
        site: last.site || '-',
        removalDate,
        daysPending: days,
        category: last.category || '-',
        treadAtRemoval: last.tread_depth,
        lastRecord: last,
      })
    }
  }

  return pending
}

export default function TyreExchange() {
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const { branding } = useTenant()
  const { profile } = useAuth()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records, setRecords] = useState([])
  const [stockMovements, setStockMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('transfers')

  // Transfer history filters
  const [filterFromSite, setFilterFromSite] = useState('')
  const [filterToSite, setFilterToSite] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterTransferType, setFilterTransferType] = useState('')
  const [txPage, setTxPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)

  // Custody search
  const [custodySerial, setCustodySerial] = useState('')
  const [custodyInput, setCustodyInput] = useState('')
  const [custodySearched, setCustodySearched] = useState(false)

  // ── Replacement approval workflow (Approval & Workflow Engine) ──────────────────
  // The open custody record is treated as the tyre-replacement document under
  // review. While its approval is active/locked, the record's mutation controls
  // (mark returned / write off) are disabled so an in-approval document can't be
  // edited out from under the workflow. State resets whenever the record changes.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [custodySerial])

  // Return / write-off marks - persisted in tyre_status_marks (V62) so they are
  // shared across users and devices instead of living in one browser.
  const [returnedSerials, setReturnedSerials] = useState([])
  const [writtenOffSerials, setWrittenOffSerials] = useState([])
  const [markError, setMarkError] = useState('')

  useEffect(() => {
    let cancelled = false
    exchangeApi.listTyreStatusMarks().then(({ data }) => {
      if (cancelled || !data) return
      setReturnedSerials(data.filter((m) => m.mark_type === 'returned').map((m) => m.serial))
      setWrittenOffSerials(data.filter((m) => m.mark_type === 'written_off').map((m) => m.serial))
    })
    return () => { cancelled = true }
  }, [])

  // Selected transfer for certificate
  const [certTransfer, setCertTransfer] = useState(null)

  // ── Data Loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data: recData } = await exchangeApi.listExchangeTyreRecords({ country: activeCountry })
        // Try loading stock_movements table (may not exist)
        const { data: movData } = await exchangeApi.listStockMovements()
        if (cancelled) return   // a newer country selection superseded this load
        setRecords(recData || [])
        setStockMovements(movData || [])
      } finally {
        if (!cancelled) setLoading(false)   // never leave the spinner stuck
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry])

  // ── Derived data ──────────────────────────────────────────────────────────────
  const transfers = useMemo(() => deriveTransfers(records), [records])

  const retreads = useMemo(() => {
    const bySerial = {}
    for (const r of records) {
      const sn = r.serial_number || r.serial_no
      if (!sn) continue
      if (!bySerial[sn]) bySerial[sn] = []
      bySerial[sn].push(r)
    }
    const result = []
    for (const [serial, recs] of Object.entries(bySerial)) {
      const sorted = [...recs].sort((a, b) => {
        const da = a.issue_date ? new Date(a.issue_date) : new Date(0)
        const db = b.issue_date ? new Date(b.issue_date) : new Date(0)
        return da - db
      })
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i]
        if ((r.category || '').toLowerCase().includes('retread')) {
          const later = sorted.slice(i + 1)
          const returned = later.length > 0 && later[0].asset_no
          const returnRec = returned ? later[0] : null
          const daysSent = r.issue_date ? daysDiff(r.issue_date) : null
          result.push({
            serial,
            brand: r.brand || '-',
            size: r.size || '-',
            sentFromAsset: r.asset_no || '-',
            sentFromSite: r.site || '-',
            sendDate: r.issue_date,
            kmAtRemoval: r.km_at_removal,
            treadAtSend: r.tread_depth,
            returnStatus: returned ? 'Returned' : 'Pending Return',
            returnDate: returned ? returnRec.issue_date : null,
            returnAsset: returned ? returnRec.asset_no : null,
            daysSent,
            overdue: !returned && daysSent && daysSent > 60,
          })
        }
      }
    }
    return result
  }, [records])

  const pendingReturns = useMemo(() => {
    const all = derivePendingReturns(records)
    return all.filter(p =>
      !returnedSerials.includes(p.serial) &&
      !writtenOffSerials.includes(p.serial)
    )
  }, [records, returnedSerials, writtenOffSerials])

  const custodyChain = useMemo(() => {
    if (!custodySerial) return []
    return deriveCustody(records, custodySerial)
  }, [records, custodySerial])

  // The current-state record for the searched serial: the tyre-replacement
  // document the Approval & Workflow Engine tracks. Latest event in the chain.
  const replacementRecord = useMemo(() => {
    if (custodyChain.length === 0) return null
    const r = custodyChain[custodyChain.length - 1]
    return {
      ...r,
      serial: r.serial_number || r.serial_no || custodySerial,
      replacement_cost: r.cost_per_tyre ?? null,
      reason: r.category ?? null,
    }
  }, [custodyChain, custodySerial])

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const bySerial = {}
    for (const r of records) {
      const sn = r.serial_number || r.serial_no
      if (!sn) continue
      if (!bySerial[sn]) bySerial[sn] = { assets: new Set(), sites: new Set() }
      if (r.asset_no) bySerial[sn].assets.add(r.asset_no)
      if (r.site) bySerial[sn].sites.add(r.site)
    }
    const interVehicle = Object.values(bySerial).filter(v => v.assets.size >= 2).length
    const interSite = Object.values(bySerial).filter(v => v.sites.size >= 2).length
    const retreadCount = retreads.length
    const transfersWithKm = transfers.filter(t => t.kmAtTransfer != null)
    const avgKm = transfersWithKm.length > 0
      ? Math.round(transfersWithKm.reduce((s, t) => s + t.kmAtTransfer, 0) / transfersWithKm.length)
      : 0

    return { interVehicle, interSite, retreadCount, avgKm }
  }, [records, retreads, transfers])

  // ── Unique filter values ──────────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [records])

  const uniqueBrands = useMemo(() => {
    const b = new Set(records.map(r => r.brand).filter(Boolean))
    return [...b].sort()
  }, [records])

  const uniqueCategories = useMemo(() => {
    const c = new Set(transfers.map(t => t.category).filter(v => v && v !== '-'))
    return [...c].sort()
  }, [transfers])

  // ── Filtered transfers ────────────────────────────────────────────────────────
  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => {
      if (filterFromSite && t.fromSite !== filterFromSite) return false
      if (filterToSite && t.toSite !== filterToSite) return false
      if (filterBrand && t.brand !== filterBrand) return false
      if (filterDateFrom && t.transferDate && t.transferDate < filterDateFrom) return false
      if (filterDateTo && t.transferDate && t.transferDate > filterDateTo) return false
      if (filterCategory && t.category !== filterCategory) return false
      if (filterTransferType && t.transferType !== filterTransferType) return false
      return true
    })
  }, [transfers, filterFromSite, filterToSite, filterBrand, filterDateFrom, filterDateTo, filterCategory, filterTransferType])

  const txTotalPages = Math.max(1, Math.ceil(filteredTransfers.length / PAGE_SIZE))
  const txPagedData = useMemo(() => {
    const start = (txPage - 1) * PAGE_SIZE
    return filteredTransfers.slice(start, start + PAGE_SIZE)
  }, [filteredTransfers, txPage])

  // ── Site Flow Matrix ──────────────────────────────────────────────────────────
  const siteFlowMatrix = useMemo(() => {
    const sites = [...new Set([
      ...transfers.map(t => t.fromSite).filter(s => s && s !== '-'),
      ...transfers.map(t => t.toSite).filter(s => s && s !== '-'),
    ])].sort()

    const matrix = {}
    for (const from of sites) {
      matrix[from] = {}
      for (const to of sites) matrix[from][to] = 0
    }
    for (const t of transfers) {
      if (t.fromSite !== '-' && t.toSite !== '-' && t.fromSite !== t.toSite) {
        if (!matrix[t.fromSite]) matrix[t.fromSite] = {}
        matrix[t.fromSite][t.toSite] = (matrix[t.fromSite][t.toSite] || 0) + 1
      }
    }
    return { sites, matrix }
  }, [transfers])

  const maxFlowValue = useMemo(() => {
    let max = 0
    for (const row of Object.values(siteFlowMatrix.matrix)) {
      for (const v of Object.values(row)) {
        if (v > max) max = v
      }
    }
    return max
  }, [siteFlowMatrix])

  // ── Analytics Charts ──────────────────────────────────────────────────────────
  const monthlyBarData = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        count: 0,
      })
    }
    for (const t of transfers) {
      if (!t.transferDate) continue
      const key = t.transferDate.slice(0, 7)
      const m = months.find(m => m.key === key)
      if (m) m.count++
    }
    return {
      labels: months.map(m => m.label),
      datasets: [{
        label: 'Transfers',
        data: months.map(m => m.count),
        backgroundColor: '#2563eb',
        borderRadius: 4,
      }],
    }
  }, [transfers])

  const transferTypeDonut = useMemo(() => {
    const counts = { 'Inter-Vehicle': 0, 'Inter-Site': 0, Retread: 0, Repair: 0 }
    for (const t of transfers) {
      if (counts[t.transferType] !== undefined) counts[t.transferType]++
      else counts['Inter-Vehicle']++
    }
    return {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ['#2563eb', '#7c3aed', '#16a34a', '#d97706'],
        borderWidth: 0,
      }],
    }
  }, [transfers])

  // ── Actions ───────────────────────────────────────────────────────────────────
  // Optimistic update + DB persist; rolled back with a visible error on failure
  // so a rejected write can never silently pretend to be saved.
  async function persistMark(serial, markType, list, setList) {
    setMarkError('')
    // Locked — this record is mid-approval; edits are blocked (server also enforces).
    if (wfLocked && serial === replacementRecord?.serial) {
      setMarkError(`${serial} is locked: an approval is in progress for this record.`)
      return
    }
    const prev = list
    setList([...list, serial])
    const { error } = await exchangeApi.upsertTyreStatusMark(serial, markType)
    if (error) {
      setList(prev)
      setMarkError(`Could not save the ${markType.replace('_', '-')} mark for ${serial}: ${error.message}`)
    }
  }

  function markReturned(serial) { persistMark(serial, 'returned', returnedSerials, setReturnedSerials) }

  function markWrittenOff(serial) { persistMark(serial, 'written_off', writtenOffSerials, setWrittenOffSerials) }

  function clearFilters() {
    setFilterFromSite('')
    setFilterToSite('')
    setFilterBrand('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterCategory('')
    setFilterTransferType('')
    setTxPage(1)
  }

  const hasActiveFilter = filterFromSite || filterToSite || filterBrand || filterDateFrom || filterDateTo || filterCategory || filterTransferType

  // ── Export functions ──────────────────────────────────────────────────────────
  function exportTransfersPdf() {
    exportToPdf(
      filteredTransfers,
      [
        { key: 'serial', header: 'Serial' },
        { key: 'brand', header: 'Brand' },
        { key: 'size', header: 'Size' },
        { key: 'fromAsset', header: 'From Asset' },
        { key: 'toAsset', header: 'To Asset' },
        { key: 'fromSite', header: 'From Site' },
        { key: 'toSite', header: 'To Site' },
        { key: 'transferDate', header: 'Transfer Date' },
        { key: 'kmAtTransfer', header: 'KM at Transfer' },
        { key: 'transferType', header: 'Type' },
        { key: 'treadAtTransfer', header: 'Tread (mm)' },
      ],
      'Tyre Transfer History',
      'TyrePulse_Transfers',
      'landscape'
    )
  }

  async function exportTransfersExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const transferSheet = XLSX.utils.json_to_sheet(filteredTransfers.map(t => ({
      Serial: t.serial,
      Brand: t.brand,
      Size: t.size,
      'From Asset': t.fromAsset,
      'To Asset': t.toAsset,
      'From Site': t.fromSite,
      'To Site': t.toSite,
      'Transfer Date': t.transferDate,
      'KM at Transfer': t.kmAtTransfer,
      'Transfer Type': t.transferType,
      Category: t.category,
      'Tread at Transfer': t.treadAtTransfer,
    })))
    XLSX.utils.book_append_sheet(wb, transferSheet, 'Transfers')

    if (custodyChain.length > 0) {
      const custodySheet = XLSX.utils.json_to_sheet(custodyChain.map(r => ({
        Serial: r.serial_number || r.serial_no,
        'Fitment Date': r.issue_date,
        Asset: r.asset_no,
        Site: r.site,
        Position: r.position,
        Brand: r.brand,
        'KM Start': r.km_at_fitment,
        'KM End': r.km_at_removal,
        'Tread (mm)': r.tread_depth,
        Category: r.category,
        'Risk Level': r.risk_level,
      })))
      XLSX.utils.book_append_sheet(wb, custodySheet, 'Custody Chain')
    }

    XLSX.writeFile(wb, 'TyrePulse_TransferHistory.xlsx')
  }

  async function exportTransferCertificate(tx) {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Tyre Transfer Certificate', `Serial: ${tx.serial}`, company, brand)

    doc.setTextColor(30, 41, 59)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Transfer Details', 14, 34)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 40,
      body: [
        ['Serial Number', tx.serial],
        ['Brand / Size', `${tx.brand} / ${tx.size}`],
        ['Transfer Type', tx.transferType],
        ['Transfer Date', fmtDate(tx.transferDate)],
        ['From Asset', tx.fromAsset],
        ['To Asset', tx.toAsset],
        ['From Site', tx.fromSite],
        ['To Site', tx.toSite],
        ['KM at Transfer', tx.kmAtTransfer != null ? tx.kmAtTransfer.toLocaleString() : '-'],
        ['Tread at Transfer', tx.treadAtTransfer != null ? `${tx.treadAtTransfer} mm` : '-'],
        ['Category', tx.category],
      ],
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 60 },
        1: { cellWidth: 120 },
      },
      margin: { left: 14, right: 14 },
    })

    const finalY = doc.lastAutoTable.finalY + 20
    doc.setFontSize(9)
    doc.setTextColor(107, 114, 128)
    doc.text('Authorised By: ___________________________', 14, finalY)
    doc.text('Date: _______________', 140, finalY)
    doc.text('Signature: ___________________________', 14, finalY + 12)
    doc.text('Stamp:', 140, finalY + 12)

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`TyrePulse_Transfer_Certificate_${tx.serial}.pdf`)
  }

  // ── Render helpers ────────────────────────────────────────────────────────────
  function transferTypeBadge(type) {
    const map = {
      'Inter-Vehicle': 'bg-blue-900/50 text-blue-300 border-blue-700/50',
      'Inter-Site': 'bg-purple-900/50 text-purple-300 border-purple-700/50',
      Retread: 'bg-green-900/50 text-green-300 border-green-700/50',
      Repair: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border ${map[type] || 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
        {type}
      </span>
    )
  }

  function riskBadge(level) {
    const map = {
      critical: 'text-red-400',
      high: 'text-orange-400',
      medium: 'text-yellow-400',
      low: 'text-green-400',
    }
    return <span className={map[(level || '').toLowerCase()] || 'text-[var(--text-muted)]'}>{level || '-'}</span>
  }

  function pendingDaysClass(days) {
    if (!days) return 'text-[var(--text-muted)]'
    if (days > 60) return 'text-red-400 font-semibold'
    if (days > 30) return 'text-yellow-400 font-semibold'
    return 'text-[var(--text-secondary)]'
  }

  function flowCellColor(value) {
    if (!value || maxFlowValue === 0) return ''
    const intensity = value / maxFlowValue
    if (intensity > 0.75) return 'bg-blue-700/70 text-white'
    if (intensity > 0.5) return 'bg-blue-700/45 text-blue-100'
    if (intensity > 0.25) return 'bg-blue-700/25 text-blue-200'
    return 'bg-blue-700/10 text-blue-300'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="mr-3"
        >
          <RefreshCw size={20} />
        </motion.div>
        Loading transfer data...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Exchange & Transfer Management"
        subtitle="Track tyre movements across fleet and locations"
        icon={ArrowLeftRight}
        actions={
          <div className="flex gap-2">
            <button
              onClick={exportTransfersPdf}
              className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg text-sm transition-colors"
            >
              <FileText size={15} /> PDF
            </button>
            <button
              onClick={exportTransfersExcel}
              className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg text-sm transition-colors"
            >
              <FileSpreadsheet size={15} /> Excel
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Inter-Vehicle Transfers',
            value: kpis.interVehicle.toLocaleString(),
            icon: ArrowLeftRight,
            color: 'text-blue-400',
            bg: 'bg-blue-900/20 border-blue-800/50',
            sub: 'Serials on 2+ vehicles',
          },
          {
            label: 'Inter-Site Transfers',
            value: kpis.interSite.toLocaleString(),
            icon: MapPin,
            color: 'text-purple-400',
            bg: 'bg-purple-900/20 border-purple-800/50',
            sub: 'Serials on 2+ sites',
          },
          {
            label: 'Retread Send-Outs',
            value: kpis.retreadCount.toLocaleString(),
            icon: RefreshCw,
            color: 'text-green-400',
            bg: 'bg-green-900/20 border-green-800/50',
            sub: 'Category: Retread',
          },
          {
            label: 'Avg KM at Transfer',
            value: kpis.avgKm > 0 ? kpis.avgKm.toLocaleString() : '-',
            icon: TrendingUp,
            color: 'text-yellow-400',
            bg: 'bg-yellow-900/20 border-yellow-800/50',
            sub: 'Mean km at removal',
          },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className={`rounded-xl border p-4 ${kpi.bg}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">{kpi.label}</p>
                <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{kpi.sub}</p>
              </div>
              <kpi.icon size={20} className={`${kpi.color} opacity-70 mt-1`} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-[var(--input-border)]">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--input-bg)] text-[var(--text-primary)] border-b-2 border-blue-500'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-gray-800/50'
              }`}
            >
              <Icon size={14} />
              {tab.label}
              {tab.id === 'pending' && pendingReturns.length > 0 && (
                <span className="ml-1 bg-red-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {pendingReturns.filter(p => p.daysPending > 30).length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {/* ── Transfer History ── */}
          {activeTab === 'transfers' && (
            <div className="space-y-4">
              {/* Filter bar */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Filter size={15} />
                    Filters
                    <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    {hasActiveFilter && (
                      <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5 ml-1">Active</span>
                    )}
                  </button>
                  {hasActiveFilter && (
                    <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                      <X size={12} /> Clear
                    </button>
                  )}
                </div>
                <AnimatePresence>
                  {showFilters && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">From Site</label>
                          <select
                            value={filterFromSite}
                            onChange={e => { setFilterFromSite(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">All Sites</option>
                            {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">To Site</label>
                          <select
                            value={filterToSite}
                            onChange={e => { setFilterToSite(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">All Sites</option>
                            {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">Brand</label>
                          <select
                            value={filterBrand}
                            onChange={e => { setFilterBrand(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">All Brands</option>
                            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">Transfer Type</label>
                          <select
                            value={filterTransferType}
                            onChange={e => { setFilterTransferType(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">All Types</option>
                            {['Inter-Vehicle', 'Inter-Site', 'Retread', 'Repair'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">Category</label>
                          <select
                            value={filterCategory}
                            onChange={e => { setFilterCategory(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">All Categories</option>
                            {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">Date From</label>
                          <input
                            type="date"
                            value={filterDateFrom}
                            onChange={e => { setFilterDateFrom(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-muted)] mb-1 block">Date To</label>
                          <input
                            type="date"
                            value={filterDateTo}
                            onChange={e => { setFilterDateTo(e.target.value); setTxPage(1) }}
                            className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Table */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                  <span className="text-sm text-[var(--text-secondary)] font-medium">
                    {filteredTransfers.length.toLocaleString()} transfer{filteredTransfers.length !== 1 ? 's' : ''} detected
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Page {txPage} of {txTotalPages}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800/50 text-[var(--text-muted)] text-xs uppercase">
                        <th className="text-left px-4 py-3">Serial</th>
                        <th className="text-left px-4 py-3">Brand</th>
                        <th className="text-left px-4 py-3">Size</th>
                        <th className="text-left px-4 py-3">From Asset</th>
                        <th className="text-left px-4 py-3">To Asset</th>
                        <th className="text-left px-4 py-3">From Site</th>
                        <th className="text-left px-4 py-3">To Site</th>
                        <th className="text-left px-4 py-3">Transfer Date</th>
                        <th className="text-right px-4 py-3">KM</th>
                        <th className="text-left px-4 py-3">Type</th>
                        <th className="text-right px-4 py-3">Tread</th>
                        <th className="text-center px-4 py-3">Cert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txPagedData.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="text-center py-12 text-[var(--text-muted)]">
                            {transfers.length === 0
                              ? 'No inter-vehicle or inter-site transfers detected in the current data set.'
                              : 'No transfers match the active filters.'}
                          </td>
                        </tr>
                      ) : (
                        txPagedData.map(t => (
                          <tr key={t.id} className="border-t border-[var(--input-border)] hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-blue-400 text-xs">{t.serial}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{t.brand}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{t.size}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{t.fromAsset}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{t.toAsset}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{t.fromSite}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{t.toSite}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">{fmtDate(t.transferDate)}</td>
                            <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                              {t.kmAtTransfer != null ? t.kmAtTransfer.toLocaleString() : '-'}
                            </td>
                            <td className="px-4 py-3">{transferTypeBadge(t.transferType)}</td>
                            <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                              {t.treadAtTransfer != null ? `${t.treadAtTransfer}mm` : '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => exportTransferCertificate(t)}
                                className="text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                                title="Download Transfer Certificate"
                              >
                                <FileText size={14} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {txTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--input-border)]">
                    <button
                      onClick={() => setTxPage(p => Math.max(1, p - 1))}
                      disabled={txPage === 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={15} /> Previous
                    </button>
                    <div className="flex gap-1">
                      {Array.from({ length: Math.min(7, txTotalPages) }, (_, i) => {
                        let page
                        if (txTotalPages <= 7) page = i + 1
                        else if (txPage <= 4) page = i + 1
                        else if (txPage >= txTotalPages - 3) page = txTotalPages - 6 + i
                        else page = txPage - 3 + i
                        return (
                          <button
                            key={page}
                            onClick={() => setTxPage(page)}
                            className={`w-8 h-8 rounded text-sm ${
                              page === txPage
                                ? 'bg-blue-600 text-white'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
                            }`}
                          >
                            {page}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setTxPage(p => Math.min(txTotalPages, p + 1))}
                      disabled={txPage === txTotalPages}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Retread Tracking ── */}
          {activeTab === 'retreads' && (
            <div className="space-y-4">
              {/* Summary row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Sent', value: retreads.length, color: 'text-blue-400' },
                  { label: 'Returned', value: retreads.filter(r => r.returnStatus === 'Returned').length, color: 'text-green-400' },
                  { label: 'Pending Return', value: retreads.filter(r => r.returnStatus === 'Pending Return').length, color: 'text-yellow-400' },
                  { label: 'Overdue (>60 days)', value: retreads.filter(r => r.overdue).length, color: 'text-red-400' },
                ].map(s => (
                  <div key={s.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                    <p className="text-xs text-[var(--text-muted)] mb-1">{s.label}</p>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {retreads.filter(r => r.overdue).length > 0 && (
                <div className="flex items-start gap-3 bg-red-900/20 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {retreads.filter(r => r.overdue).length} tyre{retreads.filter(r => r.overdue).length !== 1 ? 's' : ''} sent for retreading &gt;60 days ago with no return record detected.
                    Investigate with workshop immediately.
                  </span>
                </div>
              )}

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--input-border)] text-sm text-[var(--text-secondary)] font-medium">
                  Retread Send-Out History ({retreads.length} records)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800/50 text-[var(--text-muted)] text-xs uppercase">
                        <th className="text-left px-4 py-3">Serial</th>
                        <th className="text-left px-4 py-3">Brand</th>
                        <th className="text-left px-4 py-3">Size</th>
                        <th className="text-left px-4 py-3">Sent From Asset</th>
                        <th className="text-left px-4 py-3">Site</th>
                        <th className="text-left px-4 py-3">Send Date</th>
                        <th className="text-right px-4 py-3">KM at Removal</th>
                        <th className="text-right px-4 py-3">Tread Sent</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Return Date</th>
                        <th className="text-left px-4 py-3">Return Asset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retreads.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center py-12 text-[var(--text-muted)]">
                            No retread records found. Records with category containing &quot;Retread&quot; will appear here.
                          </td>
                        </tr>
                      ) : (
                        retreads.map((r, idx) => (
                          <tr key={`${r.serial}-${idx}`} className={`border-t border-[var(--input-border)] hover:bg-gray-800/30 transition-colors ${r.overdue ? 'bg-red-900/10' : ''}`}>
                            <td className="px-4 py-3 font-mono text-blue-400 text-xs">{r.serial}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{r.brand}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{r.size}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{r.sentFromAsset}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{r.sentFromSite}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">{fmtDate(r.sendDate)}</td>
                            <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                              {r.kmAtRemoval != null ? r.kmAtRemoval.toLocaleString() : '-'}
                            </td>
                            <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                              {r.treadAtSend != null ? `${r.treadAtSend}mm` : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs border flex items-center gap-1 w-fit ${
                                r.returnStatus === 'Returned'
                                  ? 'bg-green-900/50 text-green-300 border-green-700/50'
                                  : r.overdue
                                  ? 'bg-red-900/50 text-red-300 border-red-700/50'
                                  : 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50'
                              }`}>
                                {r.overdue && <AlertTriangle size={10} />}
                                {r.returnStatus}
                                {r.overdue && ` (${r.daysSent}d)`}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">{fmtDate(r.returnDate)}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{r.returnAsset || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Chain of Custody ── */}
          {activeTab === 'custody' && (
            <div className="space-y-6">
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <label className="text-sm text-[var(--text-secondary)] font-medium mb-2 block">
                  Search Serial Number
                </label>
                <div className="flex gap-2 max-w-lg">
                  <input
                    type="text"
                    value={custodyInput}
                    onChange={e => setCustodyInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        setCustodySerial(custodyInput.trim())
                        setCustodySearched(true)
                      }
                    }}
                    placeholder="Enter serial number..."
                    className="flex-1 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      setCustodySerial(custodyInput.trim())
                      setCustodySearched(true)
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                  >
                    <Search size={15} /> Search
                  </button>
                  {custodySerial && (
                    <button
                      onClick={() => { setCustodySerial(''); setCustodyInput(''); setCustodySearched(false) }}
                      className="px-3 py-2.5 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] text-[var(--text-muted)] rounded-lg text-sm transition-colors"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>

              {custodySearched && !custodySerial && (
                <div className="text-center py-12 text-[var(--text-muted)]">Enter a serial number to view custody chain.</div>
              )}

              {custodySerial && custodyChain.length === 0 && (
                <div className="text-center py-12 text-[var(--text-muted)]">
                  No records found for serial: <span className="text-blue-400 font-mono">{custodySerial}</span>
                </div>
              )}

              {custodyChain.length > 0 && (
                <div className="space-y-4">
                  {/* Summary bar */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 flex flex-wrap gap-6">
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Serial</p>
                      <p className="text-sm font-mono text-blue-400 font-semibold">{custodySerial}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Brand</p>
                      <p className="text-sm text-[var(--text-secondary)]">{custodyChain[0]?.brand || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Size</p>
                      <p className="text-sm text-[var(--text-secondary)]">{custodyChain[0]?.size || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Records</p>
                      <p className="text-sm text-[var(--text-secondary)]">{custodyChain.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Unique Vehicles</p>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {new Set(custodyChain.map(r => r.asset_no).filter(Boolean)).size}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Unique Sites</p>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {new Set(custodyChain.map(r => r.site).filter(Boolean)).size}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">First Seen</p>
                      <p className="text-sm text-[var(--text-secondary)]">{fmtDate(custodyChain[0]?.issue_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">Last Record</p>
                      <p className="text-sm text-[var(--text-secondary)]">{fmtDate(custodyChain[custodyChain.length - 1]?.issue_date)}</p>
                    </div>
                  </div>

                  {/* Tyre Replacement Approval — Approval & Workflow Engine.
                      Smart rule: replacement_cost > 5000 SAR routes to Fleet Manager. */}
                  {replacementRecord && (
                    <EntityApprovalPanel
                      entityType="tyre_change"
                      entityId={replacementRecord.id}
                      entityLabel={replacementRecord.serial}
                      context={{
                        replacement_cost: replacementRecord.replacement_cost,
                        reason: replacementRecord.reason,
                        asset_no: replacementRecord.asset_no,
                        position: replacementRecord.position,
                        site: replacementRecord.site,
                      }}
                      onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
                      title="Tyre Replacement Approval"
                    />
                  )}

                  {wfLocked && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                      <Lock size={12} />
                      Locked, in approval. This record’s return / write-off actions are disabled until the workflow completes.
                    </div>
                  )}

                  {/* Horizontal timeline */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-6 overflow-x-auto">
                    <div className="flex items-start gap-0 min-w-max">
                      {custodyChain.map((r, idx) => {
                        const isLast = idx === custodyChain.length - 1
                        const cat = (r.category || '').toLowerCase()
                        const dotColor =
                          cat.includes('scrap') ? 'bg-red-500' :
                          cat.includes('retread') ? 'bg-green-500' :
                          cat.includes('repair') ? 'bg-yellow-500' :
                          idx === 0 ? 'bg-blue-500' : 'bg-gray-500'
                        return (
                          <div key={r.id || idx} className="flex items-start">
                            <div className="flex flex-col items-center">
                              <div className={`w-4 h-4 rounded-full ${dotColor} ring-2 ring-[var(--surface-1)] z-10 mt-6`} />
                              {!isLast && <div className="h-0.5 w-24 bg-[var(--input-border)] mt-1.5" style={{ transform: 'translateX(50%)' }} />}
                            </div>
                            <div className="ml-[-8px] mt-10 mr-8 w-40">
                              <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg p-3 text-xs space-y-1">
                                <p className="text-[var(--text-muted)] font-medium">{fmtDate(r.issue_date)}</p>
                                <p className="text-blue-400 font-semibold">{r.asset_no || 'No Asset'}</p>
                                <p className="text-[var(--text-muted)]">{r.site || '-'}</p>
                                <p className="text-[var(--text-muted)]">Pos: {r.position || '-'}</p>
                                {r.km_at_fitment != null && (
                                  <p className="text-[var(--text-muted)]">Start: {r.km_at_fitment.toLocaleString()} km</p>
                                )}
                                {r.km_at_removal != null && (
                                  <p className="text-[var(--text-muted)]">End: {r.km_at_removal.toLocaleString()} km</p>
                                )}
                                {r.tread_depth != null && (
                                  <p className="text-[var(--text-muted)]">Tread: {r.tread_depth}mm</p>
                                )}
                                {r.category && (
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                                    cat.includes('scrap') ? 'bg-red-900/50 text-red-300' :
                                    cat.includes('retread') ? 'bg-green-900/50 text-green-300' :
                                    'bg-gray-700 text-[var(--text-secondary)]'
                                  }`}>
                                    {r.category}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {/* Legend */}
                    <div className="flex gap-4 mt-6 text-xs text-[var(--text-muted)]">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> First fitment</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-500 inline-block" /> Transfer</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Retread</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> Repair</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Scrap</span>
                    </div>
                  </div>

                  {/* Detailed table */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--input-border)] text-sm text-[var(--text-secondary)] font-medium">
                      Full Record History
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-800/50 text-[var(--text-muted)] text-xs uppercase">
                            <th className="text-left px-4 py-3">#</th>
                            <th className="text-left px-4 py-3">Fitment Date</th>
                            <th className="text-left px-4 py-3">Asset</th>
                            <th className="text-left px-4 py-3">Site</th>
                            <th className="text-left px-4 py-3">Position</th>
                            <th className="text-right px-4 py-3">KM Start</th>
                            <th className="text-right px-4 py-3">KM End</th>
                            <th className="text-right px-4 py-3">KM Run</th>
                            <th className="text-right px-4 py-3">Tread</th>
                            <th className="text-left px-4 py-3">Category</th>
                            <th className="text-left px-4 py-3">Risk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {custodyChain.map((r, idx) => {
                            const kmRun = r.km_at_fitment != null && r.km_at_removal != null
                              ? r.km_at_removal - r.km_at_fitment : null
                            return (
                              <tr key={r.id || idx} className="border-t border-[var(--input-border)] hover:bg-gray-800/30">
                                <td className="px-4 py-3 text-[var(--text-muted)]">{idx + 1}</td>
                                <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">{fmtDate(r.issue_date)}</td>
                                <td className="px-4 py-3 text-blue-400">{r.asset_no || '-'}</td>
                                <td className="px-4 py-3 text-[var(--text-muted)]">{r.site || '-'}</td>
                                <td className="px-4 py-3 text-[var(--text-muted)]">{r.position || '-'}</td>
                                <td className="px-4 py-3 text-right text-[var(--text-muted)]">
                                  {r.km_at_fitment != null ? r.km_at_fitment.toLocaleString() : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-[var(--text-muted)]">
                                  {r.km_at_removal != null ? r.km_at_removal.toLocaleString() : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                                  {kmRun != null ? kmRun.toLocaleString() : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                                  {r.tread_depth != null ? `${r.tread_depth}mm` : '-'}
                                </td>
                                <td className="px-4 py-3 text-[var(--text-muted)]">{r.category || '-'}</td>
                                <td className="px-4 py-3">{riskBadge(r.risk_level)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {!custodySearched && (
                <div className="text-center py-16 text-[var(--text-muted)]">
                  <History size={40} className="mx-auto mb-3 opacity-30" />
                  <p>Search a tyre serial number to view its complete chain of custody.</p>
                  <p className="text-xs mt-1 text-[var(--text-dim)]">Every fitment, transfer, and removal event will be shown in chronological order.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Pending Returns ── */}
          {activeTab === 'pending' && (
            <div className="space-y-4">
              {pendingReturns.filter(p => p.daysPending > 60).length > 0 && (
                <div className="flex items-start gap-3 bg-red-900/20 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {pendingReturns.filter(p => p.daysPending > 60).length} tyre{pendingReturns.filter(p => p.daysPending > 60).length !== 1 ? 's' : ''} pending return for over 60 days.
                    These should be investigated or written off.
                  </span>
                </div>
              )}

              {markError && (
                <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-300 text-sm">{markError}</div>
              )}

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                  <span className="text-sm text-[var(--text-secondary)] font-medium">
                    Pending Returns ({pendingReturns.length})
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Removed (Retread/Repair) with no subsequent fitment
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800/50 text-[var(--text-muted)] text-xs uppercase">
                        <th className="text-left px-4 py-3">Serial</th>
                        <th className="text-left px-4 py-3">Brand</th>
                        <th className="text-left px-4 py-3">Size</th>
                        <th className="text-left px-4 py-3">Removed From</th>
                        <th className="text-left px-4 py-3">Site</th>
                        <th className="text-left px-4 py-3">Removal Date</th>
                        <th className="text-left px-4 py-3">Category</th>
                        <th className="text-right px-4 py-3">Days Pending</th>
                        <th className="text-center px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingReturns.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center py-12 text-[var(--text-muted)]">
                            No pending returns found. All retreaded/repaired tyres have subsequent fitment records.
                          </td>
                        </tr>
                      ) : (
                        pendingReturns.map((p, idx) => (
                          <tr key={`${p.serial}-${idx}`} className={`border-t border-[var(--input-border)] hover:bg-gray-800/30 transition-colors ${
                            p.daysPending > 60 ? 'bg-red-900/5' : p.daysPending > 30 ? 'bg-yellow-900/5' : ''
                          }`}>
                            <td className="px-4 py-3 font-mono text-blue-400 text-xs">{p.serial}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{p.brand}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{p.size}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{p.removedFrom}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)]">{p.site}</td>
                            <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">{fmtDate(p.removalDate)}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)] rounded-full text-xs">
                                {p.category}
                              </span>
                            </td>
                            <td className={`px-4 py-3 text-right ${pendingDaysClass(p.daysPending)}`}>
                              {p.daysPending != null ? (
                                <span className="flex items-center justify-end gap-1">
                                  {p.daysPending > 60 && <AlertTriangle size={12} />}
                                  {p.daysPending > 30 && p.daysPending <= 60 && <AlertCircle size={12} />}
                                  {p.daysPending}d
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3">
                              {(() => {
                                const rowLocked = wfLocked && p.serial === replacementRecord?.serial
                                return (
                                  <div className="flex items-center justify-center gap-2">
                                    {rowLocked && (
                                      <span
                                        className="flex items-center gap-1 text-[var(--accent)]"
                                        title="Locked, in approval"
                                      >
                                        <Lock size={12} />
                                      </span>
                                    )}
                                    <button
                                      onClick={() => markReturned(p.serial)}
                                      disabled={rowLocked}
                                      className="flex items-center gap-1 px-2.5 py-1.5 bg-green-900/50 hover:bg-green-800/60 border border-green-700/50 text-green-300 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-900/50"
                                      title={rowLocked ? 'Locked, in approval' : 'Mark as Returned'}
                                    >
                                      <CheckSquare size={12} /> Returned
                                    </button>
                                    <button
                                      onClick={() => markWrittenOff(p.serial)}
                                      disabled={rowLocked}
                                      className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 text-red-300 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-900/50"
                                      title={rowLocked ? 'Locked, in approval' : 'Write Off'}
                                    >
                                      <XCircle size={12} /> Write Off
                                    </button>
                                  </div>
                                )
                              })()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {(returnedSerials.length > 0 || writtenOffSerials.length > 0) && (
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <p className="text-sm text-[var(--text-muted)] mb-2">Session Actions</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {returnedSerials.length > 0 && (
                      <span className="flex items-center gap-1.5 text-green-400">
                        <CheckCircle size={12} /> {returnedSerials.length} marked as returned this session
                      </span>
                    )}
                    {writtenOffSerials.length > 0 && (
                      <span className="flex items-center gap-1.5 text-red-400">
                        <XCircle size={12} /> {writtenOffSerials.length} written off this session
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setReturnedSerials([])
                        setWrittenOffSerials([])
                        localStorage.removeItem('tp_tyre_returns')
                        localStorage.removeItem('tp_tyre_writeoffs')
                      }}
                      className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Transfer Analytics ── */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Transfers per Month (Last 12 Months)</h3>
                  {transfers.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
                      No transfer data available
                    </div>
                  ) : (
                    <div className="h-56">
                      <Bar data={monthlyBarData} options={BAR_OPTS} />
                    </div>
                  )}
                </div>
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Transfer Types Breakdown</h3>
                  {transfers.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
                      No transfer data available
                    </div>
                  ) : (
                    <div className="h-56">
                      <Doughnut data={transferTypeDonut} options={DONUT_OPTS} />
                    </div>
                  )}
                </div>
              </div>

              {/* Top transferred serials */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Most Transferred Serials</h3>
                {(() => {
                  const counts = {}
                  for (const t of transfers) {
                    counts[t.serial] = (counts[t.serial] || 0) + 1
                  }
                  const top = Object.entries(counts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                  if (top.length === 0) {
                    return <p className="text-sm text-[var(--text-muted)]">No data available.</p>
                  }
                  const maxCount = top[0]?.[1] || 1
                  return (
                    <div className="space-y-2">
                      {top.map(([serial, count]) => {
                        const rec = records.find(r => (r.serial_number || r.serial_no) === serial)
                        return (
                          <div key={serial} className="flex items-center gap-3">
                            <span className="font-mono text-blue-400 text-xs w-32 truncate">{serial}</span>
                            <span className="text-xs text-[var(--text-muted)] w-28 truncate">{rec?.brand || '-'}</span>
                            <div className="flex-1 bg-[var(--input-bg)] rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full"
                                style={{ width: `${(count / maxCount) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-[var(--text-secondary)] w-12 text-right">{count} transfers</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>

              {/* Transfer stats by brand */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Transfers by Brand</h3>
                {(() => {
                  const counts = {}
                  for (const t of transfers) {
                    const b = t.brand || 'Unknown'
                    counts[b] = (counts[b] || 0) + 1
                  }
                  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
                  if (sorted.length === 0) return <p className="text-sm text-[var(--text-muted)]">No data.</p>
                  const max = sorted[0]?.[1] || 1
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {sorted.map(([brand, count]) => (
                        <div key={brand} className="flex items-center gap-3">
                          <span className="text-xs text-[var(--text-secondary)] w-28 truncate">{brand}</span>
                          <div className="flex-1 bg-[var(--input-bg)] rounded-full h-2">
                            <div
                              className="bg-purple-600 h-2 rounded-full"
                              style={{ width: `${(count / max) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-[var(--text-muted)] w-10 text-right">{count}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* ── Site Flow Matrix ── */}
          {activeTab === 'flow' && (
            <div className="space-y-4">
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <div className="flex items-start gap-3 text-sm text-[var(--text-muted)] mb-4">
                  <Truck size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <span>
                    Each cell shows the number of tyre transfers from the row site (source) to the column site (destination).
                    Color intensity indicates transfer volume. Higher values = darker cells.
                    Sites acting as net senders will have higher row totals; net receivers will have higher column totals.
                  </span>
                </div>

                {siteFlowMatrix.sites.length === 0 ? (
                  <EmptyState
                    illustration="module/inventory"
                    icon={Truck}
                    title="No inter-site transfers"
                    description="No inter-site transfers detected in the current data set."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium bg-[var(--input-bg)] border border-[var(--input-border)] min-w-[120px]">
                            From ↓ / To →
                          </th>
                          {siteFlowMatrix.sites.map(site => (
                            <th key={site} className="px-3 py-2 text-[var(--text-muted)] font-medium bg-[var(--input-bg)] border border-[var(--input-border)] min-w-[80px] text-center">
                              {site}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-[var(--text-muted)] font-medium bg-gray-800/80 border border-[var(--input-border)] text-center">
                            Total Out
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteFlowMatrix.sites.map(fromSite => {
                          const rowTotal = siteFlowMatrix.sites.reduce(
                            (s, toSite) => s + (siteFlowMatrix.matrix[fromSite]?.[toSite] || 0), 0
                          )
                          return (
                            <tr key={fromSite}>
                              <td className="px-3 py-2 text-[var(--text-secondary)] font-medium bg-gray-800/40 border border-[var(--input-border)]">
                                {fromSite}
                              </td>
                              {siteFlowMatrix.sites.map(toSite => {
                                const val = siteFlowMatrix.matrix[fromSite]?.[toSite] || 0
                                const isSelf = fromSite === toSite
                                return (
                                  <td
                                    key={toSite}
                                    className={`px-3 py-2 text-center border border-[var(--input-border)] font-medium ${
                                      isSelf ? 'bg-gray-800/20 text-[var(--text-dim)]' : val > 0 ? flowCellColor(val) : 'text-[var(--text-dim)]'
                                    }`}
                                  >
                                    {isSelf ? '-' : val > 0 ? val : '·'}
                                  </td>
                                )
                              })}
                              <td className="px-3 py-2 text-center border border-[var(--input-border)] text-blue-400 font-semibold bg-gray-800/30">
                                {rowTotal || '-'}
                              </td>
                            </tr>
                          )
                        })}
                        {/* Column totals */}
                        <tr className="bg-gray-800/30">
                          <td className="px-3 py-2 text-[var(--text-muted)] font-medium border border-[var(--input-border)]">Total In</td>
                          {siteFlowMatrix.sites.map(toSite => {
                            const colTotal = siteFlowMatrix.sites.reduce(
                              (s, fromSite) => s + (siteFlowMatrix.matrix[fromSite]?.[toSite] || 0), 0
                            )
                            return (
                              <td key={toSite} className="px-3 py-2 text-center border border-[var(--input-border)] text-purple-400 font-semibold">
                                {colTotal || '-'}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 border border-[var(--input-border)]" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Net flow analysis */}
              {siteFlowMatrix.sites.length > 0 && (
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Net Flow Analysis: Site Roles</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[var(--text-muted)] text-xs uppercase border-b border-[var(--input-border)]">
                          <th className="text-left py-2 pr-4">Site</th>
                          <th className="text-right py-2 px-4">Transfers Out</th>
                          <th className="text-right py-2 px-4">Transfers In</th>
                          <th className="text-right py-2 px-4">Net Flow</th>
                          <th className="text-left py-2 pl-4">Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteFlowMatrix.sites.map(site => {
                          const out = siteFlowMatrix.sites.reduce(
                            (s, to) => s + (siteFlowMatrix.matrix[site]?.[to] || 0), 0
                          )
                          const inp = siteFlowMatrix.sites.reduce(
                            (s, from) => s + (siteFlowMatrix.matrix[from]?.[site] || 0), 0
                          )
                          const net = inp - out
                          const role = net > 2 ? 'Net Receiver' : net < -2 ? 'Net Sender' : 'Balanced'
                          const roleColor = role === 'Net Receiver' ? 'text-green-400' : role === 'Net Sender' ? 'text-orange-400' : 'text-[var(--text-muted)]'
                          return (
                            <tr key={site} className="border-t border-[var(--input-border)] hover:bg-gray-800/20">
                              <td className="py-2.5 pr-4 text-[var(--text-secondary)] font-medium">{site}</td>
                              <td className="py-2.5 px-4 text-right text-orange-400">{out}</td>
                              <td className="py-2.5 px-4 text-right text-green-400">{inp}</td>
                              <td className={`py-2.5 px-4 text-right font-semibold ${net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                                {net > 0 ? `+${net}` : net}
                              </td>
                              <td className={`py-2.5 pl-4 ${roleColor}`}>{role}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
