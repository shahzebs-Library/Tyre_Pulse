/**
 * TyreExchange (route /tyre-exchange) - tyre transfers, retreads, chain of
 * custody and pending returns, all derived from tyre_records grouped by serial.
 *
 * Every derivation lives in the pure `tyreExchangeAnalytics` engine; this page
 * is presentation and orchestration only. Registers render through the shared
 * EnterpriseTable. Honest states: a failed read says so with a Retry, a value
 * that was never recorded reads "N/A", never 0.
 *
 * The return / write-off marks are persisted in tyre_status_marks (V62) through
 * the exchange service; that write path and its approval lock are unchanged.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ArrowLeftRight, RefreshCw, Clock, Search, Filter, X,
  FileText, FileSpreadsheet, CheckCircle, AlertTriangle, AlertCircle, History,
  TrendingUp, Truck, CheckSquare, XCircle, ChevronDown, Lock,
  Wrench, CircleOff, Sparkles,
} from 'lucide-react'
import { PageHero, Kpi, Card, CardState, Tabs, useCard, fmtInt } from '../components/commandCenter/kit'
import ExchangeRegister from '../components/tyreExchange/ExchangeRegister'
import ExchangeInsights from '../components/tyreExchange/ExchangeInsights'
import NewExchangePanel from '../components/tyreExchange/NewExchangePanel'
import { listServiceEvents, createServiceEvent } from '../lib/api/tyreServiceEvents'
import {
  deriveExchanges, filterExchanges, exchangeOptions, exchangeKpis as exchangeViewKpis, assetChoices,
  defaultRange, registerExportRows, REGISTER_EXPORT_COLUMNS,
  EMPTY_FILTERS as EMPTY_EXCHANGE_FILTERS, hasFilters as hasExchangeFilters, isExchangeEvent,
} from '../lib/tyreExchangeView'
import ExchangeDetailModal from '../components/tyreExchange/ExchangeDetailModal'
import './TyreExchange.css'
import * as exchangeApi from '../lib/api/tyreExchange'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  exportToPdf, exportToExcel, reportFileName, reportDateLabel,
  resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme,
} from '../lib/exportUtils'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { usePagedRows, TablePagination } from '../components/ui/TablePagination'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import {
  deriveTransfers, deriveCustody, deriveRetreads, derivePendingReturns, excludeMarked,
  exchangeKpis, transferFilterOptions, filterTransfers, hasTransferFilters, EMPTY_TRANSFER_FILTERS,
  siteFlowMatrix, siteNetFlow, flowIntensity, monthlyTransferCounts, transferTypeCounts,
  topTransferredSerials, transfersByBrand, custodySummary, custodyRows, retreadSummary,
  pendingSummary, pendingBand, transferExportView, exportRows, TRANSFER_TYPES,
  RETREAD_EXPORT_COLUMNS, PENDING_EXPORT_COLUMNS, NET_FLOW_EXPORT_COLUMNS,
  RETREAD_OVERDUE_DAYS, PENDING_CRITICAL_DAYS,
} from '../lib/tyreExchangeAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const GRID = { color: 'var(--panel-2)' }
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

const btnCls = 'flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-gray-700 border border-[var(--input-border)] '
  + 'text-[var(--text-secondary)] rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const selectCls = 'w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm'

function fmtDate(d) {
  if (!d) return 'N/A'
  return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}
const na = (v) => (v == null || v === '' ? 'N/A' : v)
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtMm = (v) => (v == null ? 'N/A' : `${v}mm`)

const FLOW_CELL = ['', 'bg-blue-700/10 text-blue-300', 'bg-blue-700/25 text-blue-200', 'bg-blue-700/45 text-blue-100', 'bg-blue-700/70 text-white']

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
  const map = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400' }
  return <span className={map[(level || '').toLowerCase()] || 'text-[var(--text-muted)]'}>{na(level)}</span>
}

const PENDING_CLASS = {
  critical: 'text-red-400 font-semibold',
  warn: 'text-yellow-400 font-semibold',
  ok: 'text-[var(--text-secondary)]',
  unknown: 'text-[var(--text-muted)]',
}

/** EnterpriseTable over the shared page contract (usePagedRows) - the pager owns paging. */
function PagedTable({ columns, rows, emptyMessage }) {
  return (
    <EnterpriseTable
      columns={columns}
      data={rows}
      getRowId={(r) => r._key}
      enableGlobalFilter={false}
      enableColumnFilters={false}
      enableSorting={false}
      enableExport={false}
      virtual
      maxHeight={560}
      emptyMessage={emptyMessage}
    />
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  )
}

export default function TyreExchange() {
  const { appSettings, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [activeTab, setActiveTab] = useState('transfers')

  // Transfer history filters
  const [filters, setFilters] = useState({ ...EMPTY_TRANSFER_FILTERS })
  const [txPage, setTxPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setTxPage(1) }

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
  }, [reloadKey])

  // ── Data Loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const { data: recData, error } = await exchangeApi.listExchangeTyreRecords({ country: activeCountry })
        if (cancelled) return   // a newer country selection superseded this load
        if (error) {
          setLoadError(toUserMessage(error, 'Could not load the tyre records.'))
          setRecords([])
          return
        }
        setRecords(recData || [])
        setLoadedAt(new Date())
      } catch (err) {
        if (!cancelled) {
          setLoadError(toUserMessage(err, 'Could not load the tyre records.'))
          setRecords([])
        }
      } finally {
        if (!cancelled) setLoading(false)   // never leave the spinner stuck
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // ── Derived data (all in the engine) ──────────────────────────────────────────
  const now = loadedAt || new Date()
  const transfers = useMemo(() => deriveTransfers(records), [records])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const retreads = useMemo(() => deriveRetreads(records, { now }), [records, loadedAt])
  const pendingReturns = useMemo(
    () => excludeMarked(derivePendingReturns(records, { now }), returnedSerials, writtenOffSerials),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, returnedSerials, writtenOffSerials, loadedAt],
  )
  const custodyChain = useMemo(() => (custodySerial ? deriveCustody(records, custodySerial) : []), [records, custodySerial])
  const custody = useMemo(() => custodySummary(custodyChain), [custodyChain])
  const custodyTable = useMemo(() => custodyRows(custodyChain), [custodyChain])

  /**
   * THE TWO DERIVED REGISTERS ARE READ A PAGE AT A TIME.
   *
   * Both are derived from every tyre record the country holds - 11,200 rows -
   * with no ceiling of their own, so either can become a single unbroken table
   * the moment retreading starts being recorded. The KPI tiles and the exports
   * still cover `retreads`/`pendingReturns` in full.
   */
  const retreadPager = usePagedRows(retreads)
  const pendingPager = usePagedRows(pendingReturns)

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

  const kpis = useMemo(() => exchangeKpis(records, transfers, retreads, pendingReturns), [records, transfers, retreads, pendingReturns])
  const retreadStats = useMemo(() => retreadSummary(retreads), [retreads])
  const pendingStats = useMemo(() => pendingSummary(pendingReturns), [pendingReturns])
  const options = useMemo(() => transferFilterOptions(records, transfers), [records, transfers])

  // ── Filtered transfers ────────────────────────────────────────────────────────
  const filteredTransfers = useMemo(
    () => filterTransfers(transfers, filters).map(transferExportView),
    [transfers, filters],
  )
  const hasActiveFilter = hasTransferFilters(filters)

  const txTotalPages = Math.max(1, Math.ceil(filteredTransfers.length / PAGE_SIZE))
  const txPagedData = useMemo(() => {
    const start = (txPage - 1) * PAGE_SIZE
    return filteredTransfers.slice(start, start + PAGE_SIZE)
  }, [filteredTransfers, txPage])

  const flow = useMemo(() => siteFlowMatrix(transfers), [transfers])
  const netFlow = useMemo(() => siteNetFlow(flow), [flow])

  // ── Analytics Charts ──────────────────────────────────────────────────────────
  const monthly = useMemo(
    () => monthlyTransferCounts(transfers, { now }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transfers, loadedAt],
  )
  const monthlyBarData = useMemo(() => ({
    labels: monthly.map(m => m.label),
    datasets: [{ label: 'Transfers', data: monthly.map(m => m.count), backgroundColor: '#2563eb', borderRadius: 4 }],
  }), [monthly])

  const transferTypeDonut = useMemo(() => {
    const counts = transferTypeCounts(transfers)
    return {
      labels: TRANSFER_TYPES,
      datasets: [{
        data: TRANSFER_TYPES.map((t) => counts[t]),
        backgroundColor: ['#2563eb', '#7c3aed', '#16a34a', '#d97706'],
        borderWidth: 0,
      }],
    }
  }, [transfers])
  const topSerials = useMemo(() => topTransferredSerials(transfers, records, 10), [transfers, records])
  const byBrand = useMemo(() => transfersByBrand(transfers, 8), [transfers])

  // ── Actions ───────────────────────────────────────────────────────────────────
  // Optimistic update + DB persist; rolled back with a visible error on failure
  // so a rejected write can never silently pretend to be saved.
  async function persistMark(serial, markType, list, setList) {
    setMarkError('')
    // Locked - this record is mid-approval; edits are blocked (server also enforces).
    if (wfLocked && serial === replacementRecord?.serial) {
      setMarkError(`${serial} is locked: an approval is in progress for this record.`)
      return
    }
    const prev = list
    setList([...list, serial])
    const { error } = await exchangeApi.upsertTyreStatusMark(serial, markType)
    if (error) {
      setList(prev)
      setMarkError(toUserMessage(error, `Could not save the ${markType.replace('_', '-')} mark for ${serial}.`))
    }
  }

  function markReturned(serial) { persistMark(serial, 'returned', returnedSerials, setReturnedSerials) }

  function markWrittenOff(serial) { persistMark(serial, 'written_off', writtenOffSerials, setWrittenOffSerials) }

  function clearFilters() {
    setFilters({ ...EMPTY_TRANSFER_FILTERS })
    setTxPage(1)
  }

  // ── Export functions ──────────────────────────────────────────────────────────
  // Every export carries the FULL filtered set, never the page on screen.
  function exportTransfersPdf() {
    exportToPdf(
      filteredTransfers,
      [
        { key: 'serial', header: 'Serial' },
        { key: 'x_brand', header: 'Brand' },
        { key: 'x_size', header: 'Size' },
        { key: 'x_fromAsset', header: 'From Asset' },
        { key: 'x_toAsset', header: 'To Asset' },
        { key: 'x_fromSite', header: 'From Site' },
        { key: 'x_toSite', header: 'To Site' },
        { key: 'x_date', header: 'Transfer Date' },
        { key: 'x_km', header: 'KM at Transfer' },
        { key: 'transferType', header: 'Type' },
        { key: 'x_tread', header: 'Tread' },
      ],
      'Tyre Transfer History',
      reportFileName('Tyre Transfer History', reportDateLabel()),
      'landscape',
      company,
      { branding },
    )
  }

  async function exportTransfersExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const transferSheet = XLSX.utils.json_to_sheet(filteredTransfers.map(t => ({
      Serial: t.serial,
      Brand: na(t.brand),
      Size: na(t.size),
      'From Asset': na(t.fromAsset),
      'To Asset': na(t.toAsset),
      'From Site': na(t.fromSite),
      'To Site': na(t.toSite),
      'Transfer Date': na(t.transferDate),
      'KM at Transfer': na(t.kmAtTransfer),
      'Transfer Type': t.transferType,
      Category: na(t.category),
      'Tread at Transfer': na(t.treadAtTransfer),
    })))
    XLSX.utils.book_append_sheet(wb, transferSheet, 'Transfers')

    if (custodyTable.length > 0) {
      const custodySheet = XLSX.utils.json_to_sheet(custodyTable.map(r => ({
        Serial: custodySerial,
        'Fitment Date': na(r.date),
        Asset: na(r.asset),
        Site: na(r.site),
        Position: na(r.position),
        'KM Start': na(r.kmStart),
        'KM End': na(r.kmEnd),
        'KM Run': na(r.kmRun),
        'Tread (mm)': na(r.tread),
        Category: na(r.category),
        'Risk Level': na(r.risk),
      })))
      XLSX.utils.book_append_sheet(wb, custodySheet, 'Custody Chain')
    }

    XLSX.writeFile(wb, `${reportFileName('Tyre Transfer History', reportDateLabel())}.xlsx`)
  }

  function exportRegister(kind, format) {
    const spec = {
      retreads: { rows: retreads, cols: RETREAD_EXPORT_COLUMNS, title: 'Retread Send Out History' },
      pending: { rows: pendingReturns, cols: PENDING_EXPORT_COLUMNS, title: 'Tyre Pending Returns' },
      netflow: { rows: netFlow, cols: NET_FLOW_EXPORT_COLUMNS, title: 'Tyre Site Net Flow' },
    }[kind]
    const data = exportRows(spec.rows, spec.cols)
    const name = reportFileName(spec.title, reportDateLabel())
    if (format === 'excel') {
      exportToExcel(data, spec.cols.map(c => c.key), spec.cols.map(c => c.header), name)
    } else {
      exportToPdf(data, spec.cols.map(c => ({ key: c.key, header: c.header })), spec.title, name, 'landscape', company, { branding })
    }
  }

  async function exportTransferCertificate(tx) {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
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
        ['Brand / Size', `${na(tx.brand)} / ${na(tx.size)}`],
        ['Transfer Type', tx.transferType],
        ['Transfer Date', fmtDate(tx.transferDate)],
        ['From Asset', na(tx.fromAsset)],
        ['To Asset', na(tx.toAsset)],
        ['From Site', na(tx.fromSite)],
        ['To Site', na(tx.toSite)],
        ['KM at Transfer', fmtNum(tx.kmAtTransfer)],
        ['Tread at Transfer', tx.treadAtTransfer != null ? `${tx.treadAtTransfer} mm` : 'N/A'],
        ['Category', na(tx.category)],
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

    doc.save(`${reportFileName('Tyre Transfer Certificate', tx.serial)}.pdf`)
  }

  // ── Exchange register (tyreExchangeView engine) ───────────────────────────────
  const [xFilters, setXFilters] = useState(() => ({ ...EMPTY_EXCHANGE_FILTERS, ...defaultRange() }))
  const setXFilter = (k, v) => setXFilters((f) => ({ ...f, [k]: v }))
  const [selectedId, setSelectedId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const openExchange = useCallback((id) => { setSelectedId(id); setDetailOpen(true) }, [])
  const exchanges = useMemo(() => deriveExchanges(records), [records])
  const xOptions = useMemo(() => exchangeOptions(exchanges), [exchanges])
  const xFiltered = useMemo(() => filterExchanges(exchanges, xFilters), [exchanges, xFilters])
  const xKpis = useMemo(() => exchangeViewKpis(xFiltered), [xFiltered])
  const selectedExchange = useMemo(() => exchanges.find((e) => e.id === selectedId) || null, [exchanges, selectedId])
  const assetList = useMemo(() => assetChoices(records), [records])
  const rangeLabel = xFilters.from || xFilters.to
    ? `${xFilters.from || 'the start'} to ${xFilters.to || 'today'}`
    : 'all dates'

  // Recently recorded exchange events (tyre_service_events), loaded on their own.
  const recentState = useCard(
    () => listServiceEvents({ country: activeCountry, limit: 200 })
      .then((rows) => (rows || []).filter(isExchangeEvent)),
    [activeCountry, reloadKey],
  )
  const technicians = useMemo(
    () => [...new Set((recentState.data || []).map((r) => r.technician).filter(Boolean))].sort(),
    [recentState.data],
  )

  async function saveExchange(payload) {
    await createServiceEvent(payload)
    recentState.retry()
  }

  function exportExchanges(format, selection) {
    const list = selection && selection.length ? selection : xFiltered
    const data = registerExportRows(list)
    const cols = REGISTER_EXPORT_COLUMNS
    const name = reportFileName('Tyre Exchange Register', reportDateLabel())
    if (format === 'excel') {
      exportToExcel(data, cols.map((c) => c.key), cols.map((c) => c.header), name)
    } else {
      exportToPdf(data, cols.map((c) => ({ key: c.key, header: c.header })), 'Tyre Exchange Register', name, 'landscape', company, { branding })
    }
  }

  // ── Table columns ─────────────────────────────────────────────────────────────
  const transferColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (t) => t.serial, cell: ({ row }) => <span className="font-mono text-blue-400 text-xs">{row.original.serial}</span> },
    { id: 'brand', header: 'Brand', accessorFn: (t) => na(t.brand) },
    { id: 'size', header: 'Size', accessorFn: (t) => na(t.size) },
    { id: 'fromAsset', header: 'From Asset', accessorFn: (t) => na(t.fromAsset) },
    { id: 'toAsset', header: 'To Asset', accessorFn: (t) => na(t.toAsset) },
    { id: 'fromSite', header: 'From Site', accessorFn: (t) => na(t.fromSite) },
    { id: 'toSite', header: 'To Site', accessorFn: (t) => na(t.toSite) },
    { id: 'date', header: 'Transfer Date', accessorFn: (t) => t.transferDate || '', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.transferDate)}</span> },
    { id: 'km', header: 'KM', accessorFn: (t) => t.kmAtTransfer ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.kmAtTransfer) },
    { id: 'type', header: 'Type', accessorFn: (t) => t.transferType, cell: ({ row }) => transferTypeBadge(row.original.transferType) },
    { id: 'tread', header: 'Tread', accessorFn: (t) => t.treadAtTransfer ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtMm(row.original.treadAtTransfer) },
    {
      id: 'cert', header: 'Cert', enableSorting: false, meta: { export: false, align: 'center' },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => exportTransferCertificate(row.original)}
          className="text-[var(--text-muted)] hover:text-blue-400 transition-colors"
          title="Download Transfer Certificate"
          aria-label={`Download transfer certificate for ${row.original.serial}`}
        >
          <FileText size={14} />
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [branding, company])

  const retreadColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', cell: ({ row }) => <span className="font-mono text-blue-400 text-xs">{row.original.serial}</span> },
    { id: 'brand', header: 'Brand', cell: ({ row }) => na(row.original.brand) },
    { id: 'size', header: 'Size', cell: ({ row }) => na(row.original.size) },
    { id: 'from', header: 'Sent From Asset', cell: ({ row }) => na(row.original.sentFromAsset) },
    { id: 'site', header: 'Site', cell: ({ row }) => na(row.original.sentFromSite) },
    { id: 'send', header: 'Send Date', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.sendDate)}</span> },
    { id: 'km', header: 'KM at Removal', meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.kmAtRemoval) },
    { id: 'tread', header: 'Tread Sent', meta: { align: 'right' }, cell: ({ row }) => fmtMm(row.original.treadAtSend) },
    {
      id: 'status', header: 'Status',
      cell: ({ row }) => {
        const r = row.original
        return (
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
        )
      },
    },
    { id: 'rdate', header: 'Return Date', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.returnDate)}</span> },
    { id: 'rasset', header: 'Return Asset', cell: ({ row }) => na(row.original.returnAsset) },
  ], [])

  const custodyColumns = useMemo(() => [
    { id: 'seq', header: '#', accessorKey: 'seq' },
    { id: 'date', header: 'Fitment Date', accessorFn: (r) => r.date || '', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.date)}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => na(r.asset), cell: ({ row }) => <span className="text-blue-400">{na(row.original.asset)}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => na(r.site) },
    { id: 'position', header: 'Position', accessorFn: (r) => na(r.position) },
    { id: 'kmStart', header: 'KM Start', accessorFn: (r) => r.kmStart ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.kmStart) },
    { id: 'kmEnd', header: 'KM End', accessorFn: (r) => r.kmEnd ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.kmEnd) },
    { id: 'kmRun', header: 'KM Run', accessorFn: (r) => r.kmRun ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.kmRun) },
    { id: 'tread', header: 'Tread', accessorFn: (r) => r.tread ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtMm(row.original.tread) },
    { id: 'category', header: 'Category', accessorFn: (r) => na(r.category) },
    { id: 'risk', header: 'Risk', accessorFn: (r) => na(r.risk), cell: ({ row }) => riskBadge(row.original.risk) },
  ], [])

  const pendingColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', cell: ({ row }) => <span className="font-mono text-blue-400 text-xs">{row.original.serial}</span> },
    { id: 'brand', header: 'Brand', cell: ({ row }) => na(row.original.brand) },
    { id: 'size', header: 'Size', cell: ({ row }) => na(row.original.size) },
    { id: 'from', header: 'Removed From', cell: ({ row }) => na(row.original.removedFrom) },
    { id: 'site', header: 'Site', cell: ({ row }) => na(row.original.site) },
    { id: 'date', header: 'Removal Date', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.removalDate)}</span> },
    {
      id: 'category', header: 'Category',
      cell: ({ row }) => (
        <span className="px-2 py-0.5 bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)] rounded-full text-xs">
          {na(row.original.category)}
        </span>
      ),
    },
    {
      id: 'days', header: 'Days Pending', meta: { align: 'right' },
      cell: ({ row }) => {
        const d = row.original.daysPending
        const band = pendingBand(d)
        return (
          <span className={`flex items-center justify-end gap-1 ${PENDING_CLASS[band]}`}>
            {band === 'critical' && <AlertTriangle size={12} />}
            {band === 'warn' && <AlertCircle size={12} />}
            {d == null ? 'N/A' : `${d}d`}
          </span>
        )
      },
    },
    {
      id: 'actions', header: 'Actions', meta: { export: false, align: 'center' },
      cell: ({ row }) => {
        const p = row.original
        const rowLocked = wfLocked && p.serial === replacementRecord?.serial
        return (
          <div className="flex items-center justify-center gap-2">
            {rowLocked && (
              <span className="flex items-center gap-1 text-[var(--accent)]" title="Locked, in approval">
                <Lock size={12} />
              </span>
            )}
            <button
              type="button"
              onClick={() => markReturned(p.serial)}
              disabled={rowLocked}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-900/50 hover:bg-green-800/60 border border-green-700/50 text-green-300 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-900/50"
              title={rowLocked ? 'Locked, in approval' : 'Mark as Returned'}
            >
              <CheckSquare size={12} /> Returned
            </button>
            <button
              type="button"
              onClick={() => markWrittenOff(p.serial)}
              disabled={rowLocked}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 text-red-300 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-900/50"
              title={rowLocked ? 'Locked, in approval' : 'Write Off'}
            >
              <XCircle size={12} /> Write Off
            </button>
          </div>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [wfLocked, replacementRecord, returnedSerials, writtenOffSerials])

  const flowColumns = useMemo(() => [
    {
      id: 'from', header: 'From (row) / To (column)',
      cell: ({ row }) => <span className={`font-medium ${row.original.isTotal ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>{row.original.site}</span>,
    },
    ...flow.sites.map((to) => ({
      id: `to_${to}`, header: to, meta: { align: 'center' },
      cell: ({ row }) => {
        const r = row.original
        if (r.isTotal) return <span className="text-purple-400 font-semibold">{flow.totalIn[to] || 0}</span>
        if (r.site === to) return <span className="text-[var(--text-dim)]">N/A</span>
        const v = flow.matrix[r.site]?.[to] || 0
        const band = flowIntensity(v, flow.max)
        return v > 0
          ? <span className={`inline-block px-2 py-0.5 rounded font-medium ${FLOW_CELL[band]}`}>{v}</span>
          : <span className="text-[var(--text-dim)]">0</span>
      },
    })),
    {
      id: 'totalOut', header: 'Total Out', meta: { align: 'center' },
      cell: ({ row }) => (row.original.isTotal ? '' : <span className="text-blue-400 font-semibold">{flow.totalOut[row.original.site] || 0}</span>),
    },
  ], [flow])

  const flowRows = useMemo(() => [
    ...flow.sites.map((s) => ({ site: s, key: s })),
    ...(flow.sites.length ? [{ site: 'Total In', key: '__total', isTotal: true }] : []),
  ], [flow])

  const netColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorKey: 'site', cell: ({ row }) => <span className="font-medium text-[var(--text-secondary)]">{row.original.site}</span> },
    { id: 'out', header: 'Transfers Out', accessorKey: 'out', meta: { align: 'right' }, cell: ({ row }) => <span className="text-orange-400">{row.original.out}</span> },
    { id: 'in', header: 'Transfers In', accessorKey: 'in', meta: { align: 'right' }, cell: ({ row }) => <span className="text-green-400">{row.original.in}</span> },
    {
      id: 'net', header: 'Net Flow', accessorKey: 'net', meta: { align: 'right' },
      cell: ({ row }) => {
        const net = row.original.net
        return <span className={`font-semibold ${net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{net > 0 ? `+${net}` : net}</span>
      },
    },
    {
      id: 'role', header: 'Role', accessorKey: 'role',
      cell: ({ row }) => {
        const role = row.original.role
        return <span className={role === 'Net Receiver' ? 'text-green-400' : role === 'Net Sender' ? 'text-orange-400' : 'text-[var(--text-muted)]'}>{role}</span>
      },
    },
  ], [])

  const exportButtons = (onExcel, onPdf, disabled) => (
    <div className="flex gap-2">
      <button type="button" onClick={onExcel} disabled={disabled} className={btnCls}><FileSpreadsheet size={15} /> Excel</button>
      <button type="button" onClick={onPdf} disabled={disabled} className={btnCls}><FileText size={15} /> PDF</button>
    </div>
  )

  const listState = { loading, error: loadError, retry: reload, data: loading ? null : records }
  const kitTabs = TABS.map((t) => ({
    key: t.id,
    label: t.label,
    count: t.id === 'pending' && pendingStats.over30 > 0 ? pendingStats.over30 : undefined,
    countTone: 'red',
  }))

  return (
    <div className="cc tx-page">
      <PageHero
        title="Tyre Exchange"
        lead="Record and manage tyre fitting, removal, replacement and interchange between vehicles."
        imgLight="/dashboard/hero-exchange-light.webp"
        imgDark="/dashboard/hero-exchange-dark.webp"
        stat={loading || loadError ? null : { value: fmtInt(xKpis.total), lines: ['exchanges', rangeLabel] }}
      />

      {loadError && (
        <div className="cc-card tx-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>{loadError}</div>
          <button type="button" className="cc-btn-ghost" onClick={reload}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      <div className="cc-kpis">
        <Kpi icon={ArrowLeftRight} tone="t-green" value={loadError ? null : xKpis.total} loading={loading} label="Total exchanges" title={`Every exchange derived from the tyre register, ${rangeLabel}`} onClick={() => setXFilter('type', '')} />
        <Kpi icon={Wrench} tone="t-blue" value={loadError ? null : xKpis.fittings} loading={loading} label="Fittings (installed)" title="Every tyre put onto a vehicle, including replacements, transfers and interchanges" />
        <Kpi icon={CircleOff} tone="t-red" value={loadError ? null : xKpis.removals} loading={loading} label="Removals (off)" title="Tyres taken off a position, including the tyre replaced by a new one" onClick={() => setXFilter('type', 'Removal')} />
        <Kpi icon={Truck} tone="t-orange" value={loadError ? null : xKpis.transfers} loading={loading} label="Inter-vehicle transfer" title="A serial fitted on a vehicle after it was last on another vehicle" onClick={() => setXFilter('type', 'Transfer')} />
        <Kpi icon={Sparkles} tone="t-purple" value={loadError ? null : xKpis.newFitted} loading={loading} label="New tyres fitted" title="Fitted tyres whose serial has no earlier record and is not marked retread" />
        <Kpi icon={RefreshCw} tone="t-amber" value={loadError ? null : xKpis.retreadFitted} loading={loading} label="Retreaded fitted" title="Fitted tyres whose record category says retread" />
      </div>

      <div className="tx-layout">
        <div className="tx-main">
          <ExchangeRegister
            rows={xFiltered}
            total={exchanges.length}
            options={xOptions}
            filters={xFilters}
            setFilter={setXFilter}
            setRange={(r) => setXFilters((f) => ({ ...f, from: r.from, to: r.to }))}
            clearFilters={() => setXFilters((f) => ({ ...EMPTY_EXCHANGE_FILTERS, from: f.from, to: f.to }))}
            filtersOn={hasExchangeFilters(xFilters)}
            state={listState}
            onSelect={openExchange}
            onExport={exportExchanges}
            onOpenCustody={(serial) => { setCustodyInput(serial); setCustodySerial(serial); setCustodySearched(true); setActiveTab('custody') }}
          />
          <ExchangeInsights
            events={exchanges}
            state={listState}
            selected={selectedExchange}
            custom={{ from: xFilters.from, to: xFilters.to }}
            onPickType={(t) => setXFilter('type', t)}
          />
        </div>
        <aside className="tx-rail">
          <NewExchangePanel
            assets={assetList}
            sites={xOptions.sites}
            records={records}
            technicians={technicians}
            country={activeCountry}
            onSave={saveExchange}
            recent={recentState}
          />
        </aside>
      </div>

      <ExchangeDetailModal
        open={detailOpen && !!selectedExchange}
        exchange={selectedExchange}
        onClose={() => setDetailOpen(false)}
        onOpenCustody={(serial) => { setDetailOpen(false); setCustodyInput(serial); setCustodySerial(serial); setCustodySearched(true); setActiveTab('custody') }}
      />

      <Card
        title="Transfer analysis"
        sub={loading || loadError ? 'Transfers, retreads, chain of custody and pending returns from the tyre register.' : `${fmtNum(kpis.transfers)} transfers across ${fmtNum(kpis.serials)} serials. ${fmtNum(kpis.interVehicle)} serials on 2 or more vehicles, ${fmtNum(kpis.interSite)} on 2 or more sites, ${fmtNum(kpis.retreadCount)} retread send-outs, ${fmtNum(kpis.pendingReturns)} pending returns. Average km at transfer ${kpis.avgKm == null ? 'N/A (no removal km recorded)' : fmtNum(kpis.avgKm)}.`}
        action={exportButtons(exportTransfersExcel, exportTransfersPdf, filteredTransfers.length === 0)}
      >
      <Tabs tabs={kitTabs} value={activeTab} onChange={setActiveTab} label="Transfer analysis" variant="line" />
      <div className="tx-legacy">
      {/* A failed or pending read must not render as "no transfers". */}
      <CardState state={listState} lines={5}>
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
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="relative flex-1 min-w-[220px] max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      value={filters.search}
                      onChange={e => setFilter('search', e.target.value)}
                      placeholder="Search serial, asset, site or brand..."
                      aria-label="Search transfers"
                      className={`${selectCls} pl-9`}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
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
                      <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                        <X size={12} /> Clear
                      </button>
                    )}
                  </div>
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
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">From Site</span>
                          <select value={filters.fromSite} onChange={e => setFilter('fromSite', e.target.value)} className={selectCls}>
                            <option value="">All Sites</option>
                            {options.sites.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">To Site</span>
                          <select value={filters.toSite} onChange={e => setFilter('toSite', e.target.value)} className={selectCls}>
                            <option value="">All Sites</option>
                            {options.sites.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">Brand</span>
                          <select value={filters.brand} onChange={e => setFilter('brand', e.target.value)} className={selectCls}>
                            <option value="">All Brands</option>
                            {options.brands.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">Transfer Type</span>
                          <select value={filters.transferType} onChange={e => setFilter('transferType', e.target.value)} className={selectCls}>
                            <option value="">All Types</option>
                            {TRANSFER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">Category</span>
                          <select value={filters.category} onChange={e => setFilter('category', e.target.value)} className={selectCls}>
                            <option value="">All Categories</option>
                            {options.categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">Date From</span>
                          <input type="date" value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)} className={selectCls} />
                        </label>
                        <label className="text-xs text-[var(--text-muted)] space-y-1">
                          <span className="block">Date To</span>
                          <input type="date" value={filters.dateTo} onChange={e => setFilter('dateTo', e.target.value)} className={selectCls} />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Table */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                  <span className="text-sm text-[var(--text-secondary)] font-medium">
                    {filteredTransfers.length.toLocaleString()} of {transfers.length.toLocaleString()} transfer{transfers.length !== 1 ? 's' : ''} shown
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Page {txPage} of {txTotalPages}
                  </span>
                </div>
                <div className="p-3">
                  <EnterpriseTable
                    columns={transferColumns}
                    data={txPagedData.map(t => ({ ...t }))}
                    getRowId={(t) => t.id}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableSorting={false}
                    enableExport={false}
                    manualPagination
                    pageIndex={txPage - 1}
                    pageCount={txTotalPages}
                    pageSize={PAGE_SIZE}
                    totalRows={filteredTransfers.length}
                    onPageChange={(p) => setTxPage(p + 1)}
                    emptyMessage={transfers.length === 0
                      ? 'No inter-vehicle or inter-site transfers detected in the current data set.'
                      : 'No transfers match the active filters.'}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Retread Tracking ── */}
          {activeTab === 'retreads' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Total Sent" value={fmtNum(retreadStats.total)} tone="text-blue-400" />
                <Stat label="Returned" value={fmtNum(retreadStats.returned)} tone="text-green-400" />
                <Stat label="Pending Return" value={fmtNum(retreadStats.pending)} tone="text-yellow-400" />
                <Stat label={`Overdue (over ${RETREAD_OVERDUE_DAYS} days)`} value={fmtNum(retreadStats.overdue)} tone="text-red-400" />
              </div>

              {retreadStats.overdue > 0 && (
                <div className="flex items-start gap-3 bg-red-900/20 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {retreadStats.overdue} tyre{retreadStats.overdue !== 1 ? 's' : ''} sent for retreading over {RETREAD_OVERDUE_DAYS} days ago with no return record detected.
                    Investigate with workshop immediately.
                  </span>
                </div>
              )}

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                  <span className="text-sm text-[var(--text-secondary)] font-medium">Retread Send-Out History ({retreads.length} records)</span>
                  {exportButtons(() => exportRegister('retreads', 'excel'), () => exportRegister('retreads', 'pdf'), retreads.length === 0)}
                </div>
                <div className="p-3">
                  <PagedTable
                    columns={retreadColumns}
                    rows={retreadPager.pageRows.map((r, idx) => ({ ...r, _key: `${r.serial}-${idx}` }))}
                    emptyMessage='No retread records found. Records with category containing "Retread" will appear here.'
                  />
                  <TablePagination {...retreadPager} />
                </div>
              </div>
            </div>
          )}

          {/* ── Chain of Custody ── */}
          {activeTab === 'custody' && (
            <div className="space-y-6">
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <label htmlFor="custody-serial" className="text-sm text-[var(--text-secondary)] font-medium mb-2 block">
                  Search Serial Number
                </label>
                <div className="flex gap-2 max-w-lg">
                  <input
                    id="custody-serial"
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
                    type="button"
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
                      type="button"
                      aria-label="Clear serial search"
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

              {custody && (
                <div className="space-y-4">
                  {/* Summary bar */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 flex flex-wrap gap-6">
                    {[
                      ['Serial', <span key="s" className="font-mono text-blue-400 font-semibold">{custodySerial}</span>],
                      ['Brand', na(custody.brand)],
                      ['Size', na(custody.size)],
                      ['Records', custody.records],
                      ['Unique Vehicles', custody.uniqueVehicles],
                      ['Unique Sites', custody.uniqueSites],
                      ['First Seen', fmtDate(custody.firstSeen)],
                      ['Last Record', fmtDate(custody.lastRecord)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs text-[var(--text-muted)]">{label}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Tyre Replacement Approval - Approval & Workflow Engine.
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
                      Locked, in approval. This record&apos;s return and write-off actions are disabled until the workflow completes.
                    </div>
                  )}

                  {/* Horizontal timeline */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-6 overflow-x-auto">
                    <div className="flex items-start gap-0 min-w-max">
                      {custodyTable.map((r, idx) => {
                        const isLast = idx === custodyTable.length - 1
                        const c = (r.category || '').toLowerCase()
                        const dotColor =
                          c.includes('scrap') ? 'bg-red-500' :
                          c.includes('retread') ? 'bg-green-500' :
                          c.includes('repair') ? 'bg-yellow-500' :
                          idx === 0 ? 'bg-blue-500' : 'bg-gray-500'
                        return (
                          <div key={r.key} className="flex items-start">
                            <div className="flex flex-col items-center">
                              <div className={`w-4 h-4 rounded-full ${dotColor} ring-2 ring-[var(--surface-1)] z-10 mt-6`} />
                              {!isLast && <div className="h-0.5 w-24 bg-[var(--input-border)] mt-1.5" style={{ transform: 'translateX(50%)' }} />}
                            </div>
                            <div className="ml-[-8px] mt-10 mr-8 w-40">
                              <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg p-3 text-xs space-y-1">
                                <p className="text-[var(--text-muted)] font-medium">{fmtDate(r.date)}</p>
                                <p className="text-blue-400 font-semibold">{r.asset || 'No Asset'}</p>
                                <p className="text-[var(--text-muted)]">{na(r.site)}</p>
                                <p className="text-[var(--text-muted)]">Pos: {na(r.position)}</p>
                                {r.kmStart != null && <p className="text-[var(--text-muted)]">Start: {r.kmStart.toLocaleString()} km</p>}
                                {r.kmEnd != null && <p className="text-[var(--text-muted)]">End: {r.kmEnd.toLocaleString()} km</p>}
                                {r.tread != null && <p className="text-[var(--text-muted)]">Tread: {r.tread}mm</p>}
                                {r.category && (
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                                    c.includes('scrap') ? 'bg-red-900/50 text-red-300' :
                                    c.includes('retread') ? 'bg-green-900/50 text-green-300' :
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
                    <div className="flex flex-wrap gap-4 mt-6 text-xs text-[var(--text-muted)]">
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
                    <div className="p-3">
                      <EnterpriseTable
                        columns={custodyColumns}
                        data={custodyTable}
                        getRowId={(r) => String(r.key)}
                        enableColumnFilters={false}
                        enableExport={false}
                        searchPlaceholder="Search this history..."
                        emptyMessage="No records for this serial."
                      />
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Pending Returns" value={fmtNum(pendingStats.total)} tone="text-blue-400" />
                <Stat label="Over 30 days" value={fmtNum(pendingStats.over30)} tone="text-yellow-400" />
                <Stat label={`Over ${PENDING_CRITICAL_DAYS} days`} value={fmtNum(pendingStats.over60)} tone="text-red-400" />
                <Stat label="No removal date" value={fmtNum(pendingStats.undated)} tone="text-[var(--text-muted)]" />
              </div>

              {pendingStats.over60 > 0 && (
                <div className="flex items-start gap-3 bg-red-900/20 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {pendingStats.over60} tyre{pendingStats.over60 !== 1 ? 's' : ''} pending return for over {PENDING_CRITICAL_DAYS} days.
                    These should be investigated or written off.
                  </span>
                </div>
              )}

              {markError && (
                <div role="alert" className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-300 text-sm">{markError}</div>
              )}

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--input-border)]">
                  <div>
                    <span className="text-sm text-[var(--text-secondary)] font-medium">Pending Returns ({pendingReturns.length})</span>
                    <p className="text-xs text-[var(--text-muted)]">Removed (Retread, Repair or Scrap) with no subsequent fitment</p>
                  </div>
                  {exportButtons(() => exportRegister('pending', 'excel'), () => exportRegister('pending', 'pdf'), pendingReturns.length === 0)}
                </div>
                <div className="p-3">
                  <PagedTable
                    columns={pendingColumns}
                    rows={pendingPager.pageRows.map((p, idx) => ({ ...p, _key: `${p.serial}-${idx}` }))}
                    emptyMessage="No pending returns found. All retreaded or repaired tyres have subsequent fitment records."
                  />
                  <TablePagination {...pendingPager} />
                </div>
              </div>

              {(returnedSerials.length > 0 || writtenOffSerials.length > 0) && (
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <p className="text-sm text-[var(--text-muted)] mb-2">Recorded marks</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {returnedSerials.length > 0 && (
                      <span className="flex items-center gap-1.5 text-green-400">
                        <CheckCircle size={12} /> {returnedSerials.length} marked as returned
                      </span>
                    )}
                    {writtenOffSerials.length > 0 && (
                      <span className="flex items-center gap-1.5 text-red-400">
                        <XCircle size={12} /> {writtenOffSerials.length} written off
                      </span>
                    )}
                    <button
                      type="button"
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
                    <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">No transfer data available</div>
                  ) : (
                    <div className="h-56"><Bar data={monthlyBarData} options={BAR_OPTS} /></div>
                  )}
                </div>
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Transfer Types Breakdown</h3>
                  {transfers.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">No transfer data available</div>
                  ) : (
                    <div className="h-56"><Doughnut data={transferTypeDonut} options={DONUT_OPTS} /></div>
                  )}
                </div>
              </div>

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Most Transferred Serials</h3>
                {topSerials.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No data available.</p>
                ) : (
                  <div className="space-y-2">
                    {topSerials.map(({ serial, count, brand }) => (
                      <div key={serial} className="flex items-center gap-3">
                        <span className="font-mono text-blue-400 text-xs w-32 truncate">{serial}</span>
                        <span className="text-xs text-[var(--text-muted)] w-28 truncate">{na(brand)}</span>
                        <div className="flex-1 bg-[var(--input-bg)] rounded-full h-2">
                          <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${(count / topSerials[0].count) * 100}%` }} />
                        </div>
                        <span className="text-xs text-[var(--text-secondary)] w-20 text-right">{count} transfers</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">Transfers by Brand</h3>
                {byBrand.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No data.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {byBrand.map(({ brand, count }) => (
                      <div key={brand} className="flex items-center gap-3">
                        <span className="text-xs text-[var(--text-secondary)] w-28 truncate">{brand}</span>
                        <div className="flex-1 bg-[var(--input-bg)] rounded-full h-2">
                          <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${(count / byBrand[0].count) * 100}%` }} />
                        </div>
                        <span className="text-xs text-[var(--text-muted)] w-10 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
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

                {flow.sites.length === 0 ? (
                  <EmptyState
                    illustration="module/inventory"
                    icon={Truck}
                    title="No inter-site transfers"
                    description="No inter-site transfers detected in the current data set."
                  />
                ) : (
                  <EnterpriseTable
                    columns={flowColumns}
                    data={flowRows}
                    getRowId={(r) => r.key}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableSorting={false}
                    enableExport={false}
                    stickyFirstColumn
                    virtual
                    maxHeight={520}
                  />
                )}
              </div>

              {netFlow.length > 0 && (
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h3 className="text-sm font-medium text-[var(--text-secondary)]">Net Flow Analysis: Site Roles</h3>
                    {exportButtons(() => exportRegister('netflow', 'excel'), () => exportRegister('netflow', 'pdf'), false)}
                  </div>
                  <EnterpriseTable
                    columns={netColumns}
                    data={netFlow}
                    getRowId={(r) => r.site}
                    enableColumnFilters={false}
                    enableExport={false}
                    searchPlaceholder="Search sites..."
                  />
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      </CardState>
      </div>
      </Card>
    </div>
  )
}
