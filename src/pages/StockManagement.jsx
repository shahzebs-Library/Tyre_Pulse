import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { stock } from '../lib/api'
import { listSites } from '../lib/api/sites'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  Plus, Save, History, FileText, Download, ArrowLeftRight, Package, Lock, RefreshCw, Search, X,
  AlertTriangle, Boxes, Clock, MapPin, ShoppingCart, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import StatTile from '../components/ui/StatTile'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import StockQuickEntry from '../components/stock/StockQuickEntry'
import { transferStockEntry } from '../lib/api/stockQuickEntry'
import { stockItem } from '../lib/stockQuickEntry'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { useLanguage } from '../contexts/LanguageContext'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { loadAutoTable } from '../lib/pdfEngine'
import { sortRows, nextSort } from '../lib/consoleTable'
import {
  deriveStatus, buildVelocityMap, enrichStock, filterStock, summarizeStock, timelineByDate,
  timelineSummary, coverBand, stockExportRows, STOCK_EXPORT_COLS, STOCK_EXPORT_HEADERS, STATUSES,
  todayStr, offsetDate, firstOfMonth, velocitySince, localDay, summarizeTyreStock, summarizeTyreStockBySite, tyreChangeSummary,
} from '../lib/stockManagementAnalytics'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const STATUS_BADGE = {
  OK:       'border-green-500/40 text-green-500',
  Low:      'border-amber-500/40 text-amber-500',
  Critical: 'border-red-500/40 text-red-500',
}

const EMPTY_FORM = {
  site: '', description: '', stock_qty: 0, min_level: 5, critical_level: 3, management_action: '',
}

// Canonical ledger movement types (the server RPC derives +/- direction from these).
const MOVEMENT_TYPES = ['receipt', 'return', 'transfer_in', 'adjustment_up', 'issue', 'transfer_out', 'scrap', 'adjustment_down']
const ADD_TYPES = new Set(['receipt', 'return', 'transfer_in', 'adjustment_up', 'in', 'reorder', 'initial'])

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const CTRL = `min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg px-3 ${FOCUS}`

// Cover band -> text colour. The day count is always printed beside it.
const COVER_TONE = {
  unknown: 'text-[var(--text-muted)]',
  healthy: 'text-green-500 font-semibold',
  watch: 'text-amber-500 font-semibold',
  urgent: 'text-red-500 font-bold',
}

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * EnterpriseTable over the shared pager. Sorting runs over the FULL row set
 * before paging (usePagedRows), so a sort never re-orders only the visible page.
 */
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, loading, error, onRetry, pageSize }) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find(c => c.id === sort?.key)
    return col?.sort ? sortRows(rows, sort, { [col.id]: col.sort }) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted, pageSize ? { pageSize } : undefined)
  const tableColumns = useMemo(() => columns.map(c => ({
    id: c.id,
    accessorFn: c.sort || (r => r[c.id]),
    header: c.sort
      ? () => <SortButton label={c.header} align={c.align} active={sort?.key === c.id} dir={sort?.dir}
          onClick={() => setSort(s => nextSort(s, c.id, c.firstDir || 'desc'))} />
      : c.header,
    cell: c.cell ? ({ row }) => c.cell(row.original) : undefined,
    size: c.size,
    enableSorting: false,
    meta: { align: c.align, export: c.id !== 'actions' },
  })), [columns, sort])
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={tableColumns}
        data={pager.pageRows}
        getRowId={getRowId}
        loading={loading}
        error={error || null}
        onRetry={onRetry}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        emptyMessage={emptyMessage}
      />
      {!loading && !error && <TablePagination {...pager} />}
    </div>
  )
}

export default function StockManagement() {
  const { t } = useLanguage()
  const { profile, hasCapability } = useAuth()
  const { appSettings, activeCountry, workingContext } = useSettings()
  const { branding } = useTenant()
  const stockScope = `${activeCountry}|${profile?.organisation_id || profile?.org_id}|${profile?.id}`
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryMessage, setEntryMessage] = useState('')
  const [form, setForm]             = useState(EMPTY_FORM)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [historyFor, setHistoryFor] = useState(null)
  const [movements, setMovements]   = useState([])
  const [loadingMov, setLoadingMov] = useState(false)
  const [movError, setMovError]     = useState('')
  const [adjForm, setAdjForm]       = useState(null)
  // Approval-engine gate: locks the ledger-post (issuance/adjustment) control for
  // the open record while its workflow is active (pending/in_review/returned) or
  // locked (approved). Reset whenever a different record's history is opened.
  const [wfLocked, setWfLocked]     = useState(false)
  // Approval-engine gate for a Tyre Return ledger post (movement_type === 'return')
  // in the history/adjust modal. Independent of the general stock_issue lock so a
  // return-specific workflow can block only the return post it authorises.
  const [returnWfLocked, setReturnWfLocked] = useState(false)

  // Velocity state
  const [velocityMap, setVelocityMap] = useState({})

  // Timeline tab state
  const [activeTab, setActiveTab]       = useState('stock')
  const [tlFrom, setTlFrom]             = useState(offsetDate(-6))
  const [tlTo, setTlTo]                 = useState(todayStr())
  const [tlRecords, setTlRecords]       = useState([])
  const [tlLoading, setTlLoading]       = useState(false)
  const [tlError, setTlError]           = useState('')

  // Compact company-wide tyre picture above the stock filters.
  const [tyreChangeRows, setTyreChangeRows] = useState([])
  const [tyreChangeLoading, setTyreChangeLoading] = useState(true)
  const [tyreChangeError, setTyreChangeError] = useState('')

  // Transfer tab state
  const [transferForm, setTransferForm] = useState({ fromSite: '', toSite: '', fromId: '', toId: '', qty: 1, notes: '' })
  const [transferring, setTransferring] = useState(false)
  const [transferMsg, setTransferMsg]   = useState('')
  const [transferError, setTransferError] = useState('')
  // Approval-engine gate for the inter-site transfer post. Locks the "Transfer
  // stock" control while the tyre_transfer workflow is active/locked.
  const [transferWfLocked, setTransferWfLocked] = useState(false)

  // Reset the approval lock whenever a different record (or none) is opened in the
  // history modal; EntityApprovalPanel re-reports the true state via onStateChange.
  useEffect(() => { setWfLocked(false); setReturnWfLocked(false) }, [historyFor?.id])

  const [loadError, setLoadError] = useState('')
  const [search, setSearch]           = useState('')
  const [siteFilter, setSiteFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [siteSizeSearch, setSiteSizeSearch] = useState('')
  const [siteMasterRows, setSiteMasterRows] = useState([])
  const [siteSizeLocation, setSiteSizeLocation] = useState('all')

  const latestTyreSummary = useLatestRequest()
  const loadTyreSummary = useCallback(async () => {
    const stale = latestTyreSummary.begin()
    setTyreChangeLoading(true)
    setTyreChangeError('')
    const today = new Date()
    const from = localDay(new Date(today.getFullYear(), today.getMonth() - 5, 1))
    try {
      const rows = await stock.listTyreIssuesInRange({ from, to: todayStr(today), country: activeCountry })
      if (stale()) return
      setTyreChangeRows(rows || [])
    } catch (err) {
      if (stale()) return
      setTyreChangeRows([])
      setTyreChangeError(toUserMessage(err, 'Tyre change summary could not be loaded.'))
    } finally {
      if (!stale()) setTyreChangeLoading(false)
    }
  }, [activeCountry, latestTyreSummary])

  useEffect(() => { loadTyreSummary() }, [loadTyreSummary, stockScope])

  const latestStock = useLatestRequest()
  const load = useCallback(async () => {
    const stale = latestStock.begin()
    setRecords([])
    setVelocityMap({})
    setLoading(true)
    setLoadError('')
    try {
      const stockRecords = await stock.listStockRecords({ country: activeCountry }) ?? []
      if (stale()) return
      setRecords(stockRecords)
      // Velocity from tyre issues over the last 3 months. Best-effort: a failed
      // velocity read leaves cover as N/A instead of failing the stock register.
      let velData = []
      try { velData = await stock.listTyreIssuesSince(velocitySince(new Date(), 3)) ?? [] } catch { velData = null }
      if (stale()) return
      const countsBySite = stockRecords.reduce((out, row) => { out[row.site] = (out[row.site] || 0) + 1; return out }, {})
      const legacyAggregates = stockRecords.filter(row => !row.custom_data?.stock_item && countsBySite[row.site] === 1)
      setVelocityMap(velData ? buildVelocityMap(legacyAggregates, velData, 3) : {})
    } catch (err) {
      if (stale()) return
      // A failed read must never render as an empty register.
      setRecords([])
      setLoadError(toUserMessage(err, t('stock.errors.loadFailed')))
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [activeCountry, t, latestStock])

  useEffect(() => { load() }, [load, stockScope])

  useEffect(() => {
    if (activeTab !== 'by-site') return undefined
    let cancelled = false
    listSites({ country: activeCountry, activeOnly: true })
      .then(rows => { if (!cancelled) setSiteMasterRows(rows || []) })
      .catch(() => { if (!cancelled) setSiteMasterRows([]) })
    return () => { cancelled = true }
  }, [activeTab, activeCountry])

  // Stable identities on purpose. Modal's behaviour hook lists `onClose` in its
  // dependency array, so an inline arrow re-runs the effect on EVERY render of
  // this page. The movement-history dialog carries text inputs whose keystrokes
  // re-render the page, and a re-run re-focuses the panel - the field would lose
  // focus after each character.
  const closeHistory = useCallback(() => setHistoryFor(null), [])
  const closeForm = useCallback(() => setShowForm(false), [])

  function startAdd() { setEntryOpen(true); setEntryMessage('') }
  function startEdit(r) {
    setForm({
      site: r.site, description: r.description ?? '',
      stock_qty: r.stock_qty, min_level: r.min_level, critical_level: r.critical_level,
      management_action: r.management_action ?? '',
    })
    setEditId(r.id)
    setShowForm(true)
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const prevRecord = editId ? records.find(r => r.id === editId) : null
    const prevQty    = prevRecord?.stock_qty ?? 0
    const newQty     = +form.stock_qty
    const status     = deriveStatus(form)

    const payload = {
      ...form,
      stock_qty: newQty,
      stock_status: status,
      updated_by: profile?.id,
      updated_at: new Date().toISOString(),
    }

    let stockId = editId
    try {
      if (editId) {
        const { stock_qty: _qty, stock_status: _status, ...details } = payload
        await stock.updateStockRecord(editId, details)
      } else {
        const ins = await stock.insertStockRecord(payload)
        stockId = ins.id
      }
    } catch (err) { setError(toUserMessage(err)); setSaving(false); return }

    const qtyChange = editId ? 0 : newQty
    if (qtyChange !== 0 || !editId) {
      // Best-effort audit movement - original ignored insert errors here.
      try {
        await stock.insertStockMovement({
          stock_id:      stockId,
          site:          form.site,
          description:   form.description || null,
          movement_type: editId ? (qtyChange > 0 ? 'In' : 'Out') : 'Initial',
          qty_before:    editId ? prevQty : 0,
          qty_change:    qtyChange,
          qty_after:     newQty,
          reason:        editId ? 'Manual edit' : 'Initial stock entry',
          created_by:    profile?.id ?? null,
        })
      } catch { /* audit is best-effort; do not block the save */ }
    }

    setShowForm(false)
    load()
    setSaving(false)
  }

  async function saveAdjustment() {
    // Block the ledger post while the record's approval workflow is active/locked.
    // A Tyre Return post is additionally gated by its own return-authorization lock.
    if (wfLocked) return
    if (adjForm?.movement_type === 'return' && returnWfLocked) return
    if (!adjForm || !adjForm.qty_change) return
    const rec = historyFor
    setSaving(true); setError('')
    // Atomic, guarded, audited ledger post. The server computes qty_before/after
    // and blocks a negative balance - no client-side stock math.
    let data
    try {
      data = await stock.postStockMovement({
        stockId:   rec.id,
        type:      adjForm.movement_type,
        qty:       adjForm.qty_change,
        reason:    adjForm.reason,
        reference: adjForm.reference_no,
      })
    } catch (aErr) { setError(toUserMessage(aErr)); setSaving(false); return }
    const newQty = data?.qty_after ?? rec.stock_qty
    setAdjForm(null)
    await load()
    await openHistory({ ...rec, stock_qty: newQty })
    setSaving(false)
  }

  async function openHistory(rec) {
    setHistoryFor(rec)
    setLoadingMov(true)
    setMovError('')
    let data = []
    try { data = await stock.listStockMovements(rec.id, 50) } catch (e) {
      data = []
      setMovError(toUserMessage(e, 'Could not load movement history.'))
    }
    setMovements(data || [])
    setLoadingMov(false)
  }

  // ── Inter-site Transfer ─────────────────────────────────────────────────────
  const transferRecord = side => {
    const selected = transferForm[side + 'Id']
    const choices = records.filter(r => r.site === transferForm[side + 'Site'])
    return selected ? choices.find(r => String(r.id) === selected) : choices.length === 1 ? choices[0] : null
  }
  const transferRequest = useRef(null)
  async function submitTransfer(e) {
    e.preventDefault()
    setTransferError('')
    setTransferMsg('')

    // Block the transfer post while its approval workflow is active/locked.
    if (transferWfLocked) { setTransferError('Transfer is locked pending approval.'); return }

    const { fromSite, toSite, qty, notes } = transferForm
    const transferQty = +qty

    if (!fromSite || !toSite) { setTransferError(t('stock.transfer.errors.selectBoth')); return }
    if (fromSite === toSite)  { setTransferError(t('stock.transfer.errors.sameSite')); return }
    if (transferQty < 1)      { setTransferError(t('stock.transfer.errors.minQty')); return }

    const fromRecord = transferRecord('from')
    const toRecord   = transferRecord('to')

    if (!fromRecord) { setTransferError(t('stock.transfer.errors.noRecordForSite', { site: fromSite })); return }
    if (!toRecord)   { setTransferError(t('stock.transfer.errors.noRecordForSite', { site: toSite })); return }
    if (transferQty > fromRecord.stock_qty) {
      setTransferError(t('stock.transfer.errors.insufficientStock', { site: fromSite, qty: fromRecord.stock_qty }))
      return
    }

    setTransferring(true)

    const transferPayload = JSON.stringify([fromRecord.id, toRecord.id, transferQty, notes, fromRecord.stock_qty, toRecord.stock_qty])
    if (transferRequest.current?.payload !== transferPayload) transferRequest.current = { payload: transferPayload, id: crypto.randomUUID() }
    try {
      await transferStockEntry({ requestId: transferRequest.current.id, from: fromRecord, to: toRecord, quantity: transferQty, notes })
    } catch (err) { setTransferError(toUserMessage(err)); setTransferring(false); return }
    transferRequest.current = null

    setTransferMsg(t('stock.transfer.successMsg', { qty: transferQty, fromSite, toSite }))
    setTransferForm({ fromSite: '', toSite: '', fromId: '', toId: '', qty: 1, notes: '' })
    setTransferring(false)
    await load()
  }

  // ── Timeline data load ──────────────────────────────────────────────────────
  // Moving either timeline date starts a new read over the old one; without this
  // the slower earlier answer lands last and charts the previous window.
  const latestTimeline = useLatestRequest()

  const loadTimeline = useCallback(async () => {
    const stale = latestTimeline.begin()
    setTlLoading(true)
    setTlError('')
    let data = []
    let failed = null
    try { data = await stock.listTyreIssuesInRange({ from: tlFrom, to: tlTo, country: activeCountry }) } catch (e) { failed = e }
    // A superseded read must not paint its rows or clear the newer spinner: the
    // timeline chart would otherwise plot the previous window under new dates.
    if (stale()) return
    if (failed) {
      setTlRecords([])
      setTlError(toUserMessage(failed, 'Could not load the stock timeline.'))
    } else {
      setTlRecords(data ?? [])
    }
    setTlLoading(false)
  }, [activeCountry, latestTimeline, tlFrom, tlTo])

  useEffect(() => {
    if (activeTab === 'timeline') loadTimeline()
  }, [activeTab, loadTimeline])

  const now = useMemo(() => new Date(), [])
  const tlDays = useMemo(() => timelineByDate(tlRecords), [tlRecords])
  const tlSummary = useMemo(() => timelineSummary(tlDays, new Date()), [tlDays])

  const enriched = useMemo(() => enrichStock(records, velocityMap), [records, velocityMap])
  const visibleStock = useMemo(
    () => filterStock(enriched, { search, site: siteFilter, status: statusFilter }),
    [enriched, search, siteFilter, statusFilter],
  )
  const kpis = useMemo(() => summarizeStock(visibleStock), [visibleStock])
  const tyreStock = useMemo(() => summarizeTyreStock(records), [records])
  const tyreSiteStock = useMemo(() => summarizeTyreStockBySite(records), [records])
  const selectedTyreSiteRows = useMemo(() => siteSizeLocation === 'all'
    ? tyreSiteStock.sites
    : tyreSiteStock.sites.filter(row => row.key === siteSizeLocation), [siteSizeLocation, tyreSiteStock])
  const siteViewSizes = useMemo(() => [...new Set(selectedTyreSiteRows.flatMap(row => row.bySize.map(item => item.size)))].sort((a, b) => a.localeCompare(b)), [selectedTyreSiteRows])
  const siteViewTotal = useMemo(() => selectedTyreSiteRows.reduce((sum, row) => sum + row.total, 0), [selectedTyreSiteRows])
  const visibleTyreSites = useMemo(() => {
    const q = siteSizeSearch.trim().toLowerCase()
    if (!q) return selectedTyreSiteRows
    return selectedTyreSiteRows.filter(row => `${row.site} ${row.country}`.toLowerCase().includes(q) || row.bySize.some(item => item.size.toLowerCase().includes(q)))
  }, [selectedTyreSiteRows, siteSizeSearch])
  const tyreChanges = useMemo(() => tyreChangeSummary(tyreChangeRows, new Date()), [tyreChangeRows])
  const maxMonthlyChanges = Math.max(1, ...tyreChanges.months.map(month => month.quantity))
  const filtersActive = search.trim() !== '' || siteFilter !== 'all' || statusFilter !== 'all'
  const clearFilters = () => { setSearch(''); setSiteFilter('all'); setStatusFilter('all') }

  const tlChartData = useMemo(() => ({
    labels: tlDays.map(d => d.date),
    datasets: [{
      label: t('stock.timeline.netChangeLabel'),
      data: tlDays.map(d => d.net),
      backgroundColor: tlDays.map(d => (d.net > 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)')),
      borderRadius: 4,
    }],
  }), [tlDays, t])

  // Reorder request PDF
  async function generateReorderPdf(rec) {
    const { pdfFooter, pdfHeader, pdfTableTheme, resolvePdfBrand } = await loadExportUtils()
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
    pdfHeader(doc, 'Reorder Request', `${rec.site} | Stock Report`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['Field', 'Value']],
      body: [
        ['Site',            rec.site],
        ['Description',     rec.description || 'N/A'],
        ['Current Stock',   String(rec.stock_qty)],
        ['Critical Level',  String(rec.critical_level)],
        ['Min Level',       String(rec.min_level)],
        ['Reorder Qty',     String(Math.max(0, (rec.min_level || 5) * 3 - rec.stock_qty))],
        ['Status',          deriveStatus(rec)],
        ['Requested By',    profile?.full_name || profile?.username || 'N/A'],
        ['Date',            formatDate(new Date())],
      ],
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`reorder-${rec.site.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
  }

  async function exportExcel() {
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      await exportToExcel(stockExportRows(visibleStock), STOCK_EXPORT_COLS, STOCK_EXPORT_HEADERS,
        reportFileName('Stock Management', activeCountry, todayStr(now)), 'Stock')
    } catch (e) { setLoadError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  async function exportPdf() {
    try {
      const { exportToPdf, reportFileName } = await loadExportUtils()
      const keys = ['site', 'description', 'stock_qty', 'min_level', 'critical_level', 'status', 'days_left', 'suggestion']
      await exportToPdf(
        stockExportRows(visibleStock),
        keys.map(k => ({ key: k, header: STOCK_EXPORT_HEADERS[STOCK_EXPORT_COLS.indexOf(k)] })),
        'Stock Management',
        reportFileName('Stock Management', activeCountry, todayStr(now)),
        'landscape',
        '',
        { subtitleNote: `${visibleStock.length} of ${records.length} items` },
      )
    } catch (e) { setLoadError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  async function exportTimeline() {
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      await exportToExcel(tlDays, ['date', 'in', 'out', 'net'], ['Date', 'Items In', 'Items Out', 'Net Change'],
        reportFileName('Stock Timeline', tlFrom, 'to', tlTo), 'Timeline')
    } catch (e) { setTlError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const sites = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])
  const siteLocations = useMemo(() => {
    const locations = new Map()
    const add = (country, name) => {
      const site = String(name || '').trim()
      if (!site) return
      const c = String(country || '').trim()
      if (activeCountry !== 'All' && c && c.toLowerCase() !== activeCountry.toLowerCase()) return
      const key = JSON.stringify([c, site])
      if (!locations.has(key)) locations.set(key, { key, country: c, name: site })
    }
    for (const row of siteMasterRows) add(row.country, row.name)
    for (const row of records) add(row.country, row.site)
    return [...locations.values()].sort((a, b) => a.name.localeCompare(b.name) || a.country.localeCompare(b.country))
  }, [activeCountry, records, siteMasterRows])
  useEffect(() => {
    if (!workingContext?.site) { setSiteSizeLocation('all'); return }
    const wantedCountry = activeCountry === 'All' ? String(workingContext.country || '') : activeCountry
    const match = siteLocations.find(site => site.name === workingContext.site && (!wantedCountry || site.country.toLowerCase() === wantedCountry.toLowerCase()))
      || siteLocations.find(site => site.name === workingContext.site)
    setSiteSizeLocation(match?.key || 'all')
  }, [activeCountry, siteLocations, workingContext?.country, workingContext?.site])
  const selectedSiteName = siteLocations.find(site => site.key === siteSizeLocation)?.name || ''

  // Tabs: show Transfer only if >= 2 sites
  const tabs = useMemo(() => {
    const base = [['stock', t('stock.tabs.stock')], ['by-site', t('stock.tabs.bySite')], ['timeline', t('stock.tabs.timeline')]]
    if (sites.length >= 2) return [['stock', t('stock.tabs.stock')], ['by-site', t('stock.tabs.bySite')], ['transfer', t('stock.tabs.transfer')], ['timeline', t('stock.tabs.timeline')]]
    return base
  }, [sites, t])

  const openMovement = useCallback((r) => {
    openHistory(r)
    setAdjForm({ qty_change: 0, reason: '', movement_type: 'adjustment_up', reference_no: '' })
  }, [])

  const stockColumns = useMemo(() => [
    { id: 'site', header: t('stock.table.columns.site'), sort: r => r.site, size: 130, firstDir: 'asc',
      cell: r => <span className="font-medium text-[var(--text-primary)]">{r.site || 'N/A'}</span> },
    { id: 'description', header: t('stock.table.columns.description'), sort: r => r.description, size: 200, firstDir: 'asc',
      cell: r => <div><span className="font-medium text-[var(--text-primary)]">{stockItem(r).code || r.description || 'N/A'}</span>{stockItem(r).code && <p className="text-xs text-[var(--text-muted)] mt-1">{r.description}</p>}{stockItem(r).unit && <p className="text-xs text-[var(--text-muted)] mt-1">{stockItem(r).condition} · {stockItem(r).unit}{stockItem(r).bin ? ` · ${stockItem(r).bin}` : ''}</p>}</div> },
    { id: 'stock_qty', header: t('stock.table.columns.stock'), sort: r => r.stock_qty, size: 90, align: 'right',
      cell: r => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{r.stock_qty ?? 'N/A'}</span> },
    { id: 'min_level', header: t('stock.table.columns.min'), sort: r => r.min_level, size: 80, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.min_level ?? 'N/A'}</span> },
    { id: 'critical_level', header: t('stock.table.columns.critical'), sort: r => r.critical_level, size: 90, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.critical_level ?? 'N/A'}</span> },
    { id: 'reorder_qty', header: t('stock.table.columns.reorderQty'), sort: r => r.reorder_qty, size: 100, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.reorder_qty ?? 'N/A'}</span> },
    { id: 'status', header: t('stock.table.columns.status'), sort: r => STATUSES.indexOf(r.status), size: 100, firstDir: 'desc',
      cell: r => <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[r.status]}`}>{t(`stock.statuses.${r.status}`)}</span> },
    { id: 'avgPerMonth', header: t('stock.table.columns.velocity'), sort: r => r.avgPerMonth, size: 100, align: 'right',
      cell: r => <span className="tabular-nums text-xs text-[var(--text-secondary)]">{r.avgPerMonth > 0 ? `${r.avgPerMonth}/mo` : 'None recorded'}</span> },
    { id: 'daysRemaining', header: t('stock.table.columns.daysLeft'), sort: r => r.daysRemaining, size: 100, align: 'right', firstDir: 'asc',
      cell: r => (
        <span className={`tabular-nums text-xs ${COVER_TONE[coverBand(r.daysRemaining)]}`}
          title={r.daysRemaining === null ? 'No consumption recorded at this site, so cover cannot be measured' : undefined}>
          {r.daysRemaining === null ? 'N/A' : `${r.daysRemaining}d`}
        </span>
      ) },
    { id: 'action', header: t('stock.table.columns.action'), sort: r => r.management_action, size: 200,
      cell: r => (
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)] max-w-xs">
          {r.management_action ? <span className="truncate" title={r.management_action}>{r.management_action}</span> : <span className="text-[var(--text-dim)]">None</span>}
          {r.suggestion !== null && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border border-amber-500/40 text-amber-500 whitespace-nowrap w-fit">
              {t('stock.table.reorderBadge', { qty: r.suggestion })}
            </span>
          )}
        </div>
      ) },
    { id: 'actions', header: '', size: 150,
      cell: r => (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => startEdit(r)}
            className={`min-h-[44px] px-2 rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`}>
            {t('stock.table.edit')}
          </button>
          <button type="button" onClick={() => openMovement(r)}
            aria-label={`${t('stock.table.movementHistoryTooltip')}: ${r.site}`} title={t('stock.table.movementHistoryTooltip')}
            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`}>
            <History size={16} aria-hidden="true" />
          </button>
          {r.status === 'Critical' && (
            <button type="button" onClick={() => generateReorderPdf(r)}
              aria-label={`${t('stock.table.generateReorderPdfTooltip')}: ${r.site}`} title={t('stock.table.generateReorderPdfTooltip')}
              className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`}>
              <FileText size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      ) },
  // startEdit / generateReorderPdf are plain handlers over current state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, openMovement])

  const timelineColumns = useMemo(() => [
    { id: 'date', header: t('stock.timeline.columns.date'), sort: r => r.date, size: 130,
      cell: r => <span className="font-medium text-[var(--text-primary)]">{r.date}</span> },
    { id: 'in', header: t('stock.timeline.columns.itemsIn'), sort: r => r.in, size: 110, align: 'right',
      cell: r => <span className="tabular-nums">{r.in}</span> },
    { id: 'out', header: t('stock.timeline.columns.itemsOut'), sort: r => r.out, size: 110, align: 'right',
      cell: r => <span className="tabular-nums">{r.out}</span> },
    { id: 'net', header: t('stock.timeline.columns.netChange'), sort: r => r.net, size: 120, align: 'right',
      cell: r => (
        <span className={`tabular-nums font-semibold ${r.net > 0 ? 'text-green-500' : r.net < 0 ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
          {r.net > 0 ? '+' : ''}{r.net}
        </span>
      ) },
  ], [t])

  const movementColumns = useMemo(() => [
    { id: 'created_at', header: t('stock.historyModal.columns.date'), sort: m => m.created_at, size: 120,
      cell: m => <span className="text-[var(--text-muted)]">{formatDate(m.created_at)}</span> },
    { id: 'movement_type', header: t('stock.historyModal.columns.type'), sort: m => m.movement_type, size: 120,
      cell: m => {
        const t0 = String(m.movement_type).toLowerCase()
        const add = ADD_TYPES.has(t0)
        return (
          <span className={`px-1.5 py-0.5 rounded text-xs border ${add ? 'border-green-500/40 text-green-500' : t0 !== 'adjustment' ? 'border-red-500/40 text-red-500' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
            {m.movement_type}
          </span>
        )
      } },
    { id: 'qty_before', header: t('stock.historyModal.columns.before'), sort: m => m.qty_before, size: 80, align: 'right',
      cell: m => <span className="tabular-nums text-[var(--text-muted)]">{m.qty_before ?? 'N/A'}</span> },
    { id: 'qty_change', header: t('stock.historyModal.columns.change'), sort: m => m.qty_change, size: 80, align: 'right',
      cell: m => <span className={`tabular-nums font-medium ${m.qty_change > 0 ? 'text-green-500' : 'text-red-500'}`}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</span> },
    { id: 'qty_after', header: t('stock.historyModal.columns.after'), sort: m => m.qty_after, size: 80, align: 'right',
      cell: m => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{m.qty_after ?? 'N/A'}</span> },
    { id: 'reason', header: t('stock.historyModal.columns.reason'), sort: m => m.reason, size: 180,
      cell: m => <span className="text-[var(--text-muted)]">{m.reason || 'None'}</span> },
    { id: 'reference_no', header: t('stock.historyModal.columns.ref'), sort: m => m.reference_no, size: 120,
      cell: m => <span className="text-[var(--text-muted)]">{m.reference_no || 'None'}</span> },
  ], [t])

  if (entryOpen) return <StockQuickEntry
    key={`${activeCountry}|${profile?.organisation_id || profile?.org_id}|${profile?.id}`}
    records={records.filter(r => r.country === activeCountry)}
    initialSite={selectedSiteName || (siteFilter === 'all' ? workingContext?.site || '' : siteFilter)}
    onClose={() => setEntryOpen(false)}
    onSaved={result => { setEntryOpen(false); setEntryMessage(`${result.items.length} stock item${result.items.length === 1 ? '' : 's'} saved with movement history.`); load() }}
  />

  return (
    <div className="stock-workspace space-y-4">
      <PageHeader
        className="stock-register-heading"
        title={t('stock.title')}
        subtitle={t('stock.subtitle', { count: records.length })}
        icon={Package}
        actions={
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={exportExcel} disabled={loading || visibleStock.length === 0}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <Download size={14} aria-hidden="true" /> {t('stock.actions.excel')}
            </button>
            <button type="button" onClick={exportPdf} disabled={loading || visibleStock.length === 0}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <FileText size={14} aria-hidden="true" /> {t('stock.actions.pdf')}
            </button>
            <button type="button" onClick={startAdd}
              disabled={typeof hasCapability !== 'function' || (!hasCapability('stock', 'create') && !hasCapability('stock', 'edit'))}
              className={`btn-primary min-h-[44px] flex items-center gap-2 text-sm ${FOCUS}`}>
              <Plus size={16} aria-hidden="true" /> {t('stock.actions.addStock')}
            </button>
          </div>
        }
      />

      {entryMessage && <p role="status" className="stock-notice">{entryMessage}</p>}
      <p className="text-xs text-[var(--text-muted)]">Add Stock lets you search MIS / ERP and DTR items, confirm details and record what is physically in your store. New deliveries use a separate receipt entry.</p>
      {loadError && (
        <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
          <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Stock could not be loaded</p>
            <p className="text-sm text-[var(--text-muted)]">{loadError}</p>
          </div>
          <button type="button" onClick={load} className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 ${FOCUS}`}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Stock views">
        {tabs.map(([val, label]) => (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={activeTab === val}
            onClick={() => setActiveTab(val)}
            className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${FOCUS} ${
              activeTab === val ? 'bg-[var(--accent)] text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── STOCK LEVELS TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'stock' && (
        <>
          <section className="grid grid-cols-1 xl:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.1fr)_minmax(300px,1fr)] gap-3" aria-label={t('stock.companyTyres.title')}>
            <div className="card p-4 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{t('stock.companyTyres.title')}</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--text-primary)]">{loading ? '…' : tyreStock.pcs.toLocaleString()}</p>
                  <p className="text-sm text-[var(--text-secondary)]">{t('stock.companyTyres.piecesOnHand')}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{activeCountry === 'All' ? t('stock.companyTyres.allCountries') : activeCountry}</p>
                </div>
                <Boxes size={19} className="text-[var(--accent)]" aria-hidden="true" />
              </div>
              {tyreStock.nonPcsLines > 0 && <p className="mt-3 text-xs text-amber-600">{t('stock.companyTyres.unitExcluded', { count: tyreStock.nonPcsLines })}</p>}
              {tyreStock.bySize.length > 0 && (
                <div className="mt-4 border-t border-[var(--input-border)] pt-3">
                  <p className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">{t('stock.companyTyres.currentBySize')}</p>
                  <div className="max-h-32 space-y-1 overflow-auto">
                    {tyreStock.bySize.map(item => <div key={item.size} className="flex justify-between gap-3 text-xs">
                      <span className="truncate text-[var(--text-secondary)]">{item.size}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">{item.quantity.toLocaleString()} PCS</span>
                    </div>)}
                  </div>
                </div>
              )}
            </div>

            <div className="card p-4 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{t('stock.companyTyres.changeTimeline')}</p>
                  <p className="text-xs text-[var(--text-muted)]">{t('stock.companyTyres.lastSixMonths')} · {tyreChangeLoading ? '…' : tyreChanges.total.toLocaleString()} {t('stock.companyTyres.recordedChanges')}</p>
                </div>
                <Clock size={17} className="text-[var(--accent)]" aria-hidden="true" />
              </div>
              {tyreChangeError ? <p role="status" className="mt-4 text-xs text-amber-600">{tyreChangeError}</p> : (
                <div className="mt-4 flex h-28 items-end justify-between gap-2" role="img" aria-label={t('stock.companyTyres.monthlyChartLabel', { total: tyreChanges.total })}>
                  {tyreChanges.months.map(month => (
                    <div key={month.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{month.quantity || ''}</span>
                      <div className="w-full max-w-9 rounded-t bg-[var(--accent)]" style={{ height: Math.max(month.quantity ? 8 : 2, (month.quantity / maxMonthlyChanges) * 66) + 'px', opacity: month.quantity ? 0.9 : 0.2 }} />
                      <span className="text-[10px] text-[var(--text-muted)]">{month.label}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">{t('stock.companyTyres.changeDefinition')}</p>
            </div>

            <div className="card p-4 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{t('stock.companyTyres.changedBySize')}</p>
                  <p className="text-xs text-[var(--text-muted)]">{t('stock.companyTyres.lastSixMonths')}</p>
                </div>
                <button type="button" onClick={() => setActiveTab('timeline')} className={`text-xs font-medium text-[var(--accent)] ${FOCUS}`}>{t('stock.companyTyres.openTimeline')} →</button>
              </div>
              {tyreChangeLoading ? <p className="mt-4 text-sm text-[var(--text-muted)]">{t('stock.timeline.loading')}</p>
                : tyreChangeError ? <p className="mt-4 text-xs text-amber-600">{t('stock.companyTyres.unavailable')}</p>
                  : tyreChanges.bySize.length ? <div className="mt-3 max-h-36 space-y-2 overflow-auto">
                    {tyreChanges.bySize.map(item => <div key={item.size} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-[var(--text-secondary)]">{item.size}</span>
                      <span className="shrink-0 rounded-full bg-[var(--input-bg)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[var(--text-primary)]">{item.quantity.toLocaleString()} {t('stock.companyTyres.changed')}</span>
                    </div>)}
                  </div> : <p className="mt-4 text-sm text-[var(--text-muted)]">{t('stock.companyTyres.noChanges')}</p>}
            </div>
          </section>

          {/* KPI strip (covers the filtered view) */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile icon={Boxes} label="Stock items" value={loading ? '...' : kpis.items.toLocaleString()}
              sub="Balances are shown per item and unit" />
            <StatTile icon={AlertTriangle} label={t('stock.statuses.Critical')} value={kpis.counts.Critical.toLocaleString()}
              sub="At or below critical level" tone={kpis.counts.Critical > 0 ? 'crit' : 'neutral'} />
            <StatTile icon={AlertTriangle} label={t('stock.statuses.Low')} value={kpis.counts.Low.toLocaleString()}
              sub="At or below minimum level" tone={kpis.counts.Low > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={Clock} label="Avg days of cover"
              value={kpis.avgCoverDays === null ? 'N/A' : `${kpis.avgCoverDays}d`}
              sub={kpis.measuredCover ? `${kpis.measuredCover} items with consumption` : 'No consumption recorded'} tone="info" />
            <StatTile icon={ShoppingCart} label="Suggested reorder" value={kpis.toReorder.toLocaleString()}
              sub={`${kpis.atRisk} items under 30 days`} tone={kpis.atRisk > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={MapPin} label="Sites" value={kpis.sites.toLocaleString()}
              sub={`${kpis.stockouts} stocked out`} />
          </div>

          {/* Filters */}
          <section className="card p-4" aria-label="Filters">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <label className="block lg:col-span-2">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Search</span>
                <span className="relative block">
                  <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Site, item code, description or brand" className={`w-full ps-9 ${CTRL}`} />
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.table.columns.site')}</span>
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="all">All sites</option>
                  {sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.table.columns.status')}</span>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="all">All statuses</option>
                  {STATUSES.map(st => <option key={st} value={st}>{t(`stock.statuses.${st}`)}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-dim)]" aria-live="polite">
              <span>{loading ? 'Loading stock...' : `${visibleStock.length.toLocaleString()} of ${records.length.toLocaleString()} items`}</span>
              {filtersActive && (
                <button type="button" onClick={clearFilters}
                  className={`min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`}>
                  <X size={12} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
          </section>

          <SortedPagedTable
            columns={stockColumns}
            rows={visibleStock}
            defaultSort={{ key: 'status', dir: 'desc' }}
            getRowId={r => String(r.id)}
            loading={loading}
            error={loadError || null}
            onRetry={load}
            emptyMessage={records.length === 0 ? t('stock.table.emptyTitle') : 'No stock items match these filters'}
          />
        </>
      )}

      {/* ── TYRE STOCK BY SITE AND SIZE ──────────────────────────────────────── */}
      {activeTab === 'by-site' && (
        <section className="space-y-4" aria-labelledby="tyre-stock-by-site-title">
          <div className="card p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="tyre-stock-by-site-title" className="text-lg font-semibold text-[var(--text-primary)]">{t('stock.tyreBySite.title')}</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{t('stock.tyreBySite.subtitle')}</p>
              </div>
              <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
                <label className="block min-w-56">
                  <span className="mb-1 block text-xs text-[var(--text-muted)]">{t('stock.tyreBySite.siteStore')}</span>
                  <select className={`input min-h-[44px] w-full ${FOCUS}`} value={siteSizeLocation} onChange={e => setSiteSizeLocation(e.target.value)}>
                    <option value="all">{t('stock.tyreBySite.allLocations')}</option>
                    {siteLocations.map(site => <option key={site.key} value={site.key}>{site.name}{activeCountry === 'All' && site.country ? ` · ${site.country}` : ''}</option>)}
                  </select>
                </label>
                <label className="relative block min-w-56 self-end">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input className={`input min-h-[44px] pl-9 ${FOCUS}`} value={siteSizeSearch} onChange={e => setSiteSizeSearch(e.target.value)} placeholder={t('stock.tyreBySite.search')} aria-label={t('stock.tyreBySite.search')} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatTile icon={Boxes} label={t('stock.tyreBySite.total')} value={loading ? '…' : siteViewTotal.toLocaleString()} sub="PCS" />
              <StatTile icon={MapPin} label={t('stock.tyreBySite.sites')} value={loading ? '…' : selectedTyreSiteRows.length.toLocaleString()} sub={t('stock.tyreBySite.sitesWithStock')} />
              <StatTile icon={Package} label={t('stock.tyreBySite.sizes')} value={loading ? '…' : siteViewSizes.length.toLocaleString()} sub={t('stock.tyreBySite.distinctSizes')} />
            </div>

            {tyreStock.nonPcsLines > 0 && <p className="text-xs text-amber-600">{t('stock.companyTyres.unitExcluded', { count: tyreStock.nonPcsLines })}</p>}

            {loadError ? <p role="alert" className="text-sm text-red-500">{loadError}</p> : loading ? <p role="status" className="text-sm text-[var(--text-muted)]">{t('stock.timeline.loading')}</p>
              : selectedTyreSiteRows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--text-muted)]">{t('stock.tyreBySite.empty')}</p>
                : <div className="overflow-x-auto rounded-lg border border-[var(--input-border)]">
                  <table className="w-full min-w-max border-collapse text-sm" aria-label={t('stock.tyreBySite.tableLabel')}>
                    <thead className="bg-[var(--input-bg)] text-xs text-[var(--text-secondary)]">
                      <tr>
                        <th scope="col" className="sticky left-0 z-10 min-w-48 bg-[var(--input-bg)] px-3 py-3 text-left font-semibold">{t('stock.tyreBySite.site')}</th>
                        {siteViewSizes.map(size => <th key={size} scope="col" className="min-w-28 px-3 py-3 text-right font-semibold">{size}</th>)}
                        <th scope="col" className="min-w-28 px-3 py-3 text-right font-semibold">{t('stock.tyreBySite.total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTyreSites.map(row => {
                        const sizeQty = new Map(row.bySize.map(item => [item.size, item.quantity]))
                        return <tr key={row.site} className="border-t border-[var(--input-border)] hover:bg-[var(--input-bg)]/50">
                          <th scope="row" className="sticky left-0 bg-[var(--panel-bg)] px-3 py-3 text-left font-medium text-[var(--text-primary)]">{row.site}{activeCountry === 'All' && row.country ? <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">{row.country}</span> : null}</th>
                          {siteViewSizes.map(size => <td key={size} className="px-3 py-3 text-right tabular-nums text-[var(--text-secondary)]">{(sizeQty.get(size) || 0).toLocaleString()}</td>)}
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-[var(--text-primary)]">{row.total.toLocaleString()}</td>
                        </tr>
                      })}
                      {visibleTyreSites.length === 0 && <tr><td colSpan={siteViewSizes.length + 2} className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">{t('stock.tyreBySite.noMatch')}</td></tr>}
                    </tbody>
                    <tfoot className="border-t-2 border-[var(--input-border)] bg-[var(--input-bg)] font-semibold text-[var(--text-primary)]">
                      <tr>
                        <th scope="row" className="sticky left-0 bg-[var(--input-bg)] px-3 py-3 text-left">{siteSizeLocation === 'all' ? t('stock.tyreBySite.companyTotal') : t('stock.tyreBySite.locationTotal')}</th>
                        {siteViewSizes.map(size => <td key={size} className="px-3 py-3 text-right tabular-nums">{selectedTyreSiteRows.reduce((sum, row) => sum + (row.bySize.find(item => item.size === size)?.quantity || 0), 0).toLocaleString()}</td>)}
                        <td className="px-3 py-3 text-right tabular-nums">{siteViewTotal.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>}
          </div>
        </section>
      )}

      {/* ── TRANSFER TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'transfer' && (
        <div className="max-w-lg">
          <Card className="space-y-[var(--space-5)]">
            <CardHeader
              level={2}
              icon={ArrowLeftRight}
              title={t('stock.transfer.heading')}
              description={t('stock.transfer.subtitle')}
            />

            {transferMsg && (
              <div role="status" className="border border-green-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-3 text-sm">
                {transferMsg}
              </div>
            )}
            {transferError && (
              <div role="alert" className="border border-red-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-3 text-sm">
                {transferError}
              </div>
            )}

            <form onSubmit={submitTransfer} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('stock.transfer.fromSite')}</label>
                  <select
                    className="input"
                    value={transferForm.fromSite}
                    onChange={e => {
                      const fromSite = e.target.value
                      setTransferError('')
                      setTransferMsg('')
                      setTransferForm(f => ({
                        ...f,
                        fromSite, fromId: '', toId: '',
                        toSite: f.toSite === fromSite ? '' : f.toSite,
                        qty: 1,
                      }))
                    }}
                    required
                  >
                    <option value="">{t('stock.transfer.selectOption')}</option>
                    {sites.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.fromSite && (() => {
                    const rec = transferRecord('from')
                    return rec ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('stock.transfer.availablePrefix')} <span className="text-[var(--text-secondary)] font-medium">{rec.stock_qty}</span> {t('stock.transfer.unitsSuffix')}</p>
                    ) : null
                  })()}
                </div>
                <div>
                  <label className="label">{t('stock.transfer.toSite')}</label>
                  <select
                    className="input"
                    value={transferForm.toSite}
                    onChange={e => {
                      setTransferError('')
                      setTransferMsg('')
                      setTransferForm(f => ({ ...f, toSite: e.target.value, toId: '' }))
                    }}
                    required
                  >
                    <option value="">{t('stock.transfer.selectOption')}</option>
                    {sites.filter(s => s !== transferForm.fromSite).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.toSite && (() => {
                    const rec = transferRecord('to')
                    return rec ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('stock.transfer.currentPrefix')} <span className="text-[var(--text-secondary)] font-medium">{rec.stock_qty}</span> {t('stock.transfer.unitsSuffix')}</p>
                    ) : null
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {['from', 'to'].map(side => <label key={side} className="label">{side === 'from' ? 'Source item' : 'Destination item'}
                  <select className="input" aria-label={side === 'from' ? 'Source item' : 'Destination item'} required
                    value={transferRecord(side)?.id || ''} onChange={e => setTransferForm(f => ({ ...f, [side + 'Id']: e.target.value }))}>
                    <option value="">Choose an item at this site</option>
                    {records.filter(r => r.site === transferForm[side + 'Site']).map(r => <option key={r.id} value={r.id}>{stockItem(r).code ? `${stockItem(r).code} · ` : ''}{r.description || r.site} · {r.stock_qty} {stockItem(r).unit || 'units'}{stockItem(r).bin ? ` · ${stockItem(r).bin}` : ''}</option>)}
                  </select>
                </label>)}
              </div>
              <div>
                <label className="label">{t('stock.transfer.quantity')}</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={transferRecord('from')?.stock_qty ?? undefined}
                  value={transferForm.qty}
                  onChange={e => {
                    setTransferError('')
                    setTransferForm(f => ({ ...f, qty: +e.target.value }))
                  }}
                  required
                />
              </div>

              <div>
                <label className="label">{t('stock.transfer.notes')}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t('stock.transfer.notesPlaceholder')}
                  value={transferForm.notes}
                  onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Transfer preview */}
              {transferForm.fromSite && transferForm.toSite && transferForm.qty > 0 && (
                <div className="bg-[var(--input-bg)]/50 border border-[var(--input-border)] rounded-lg p-3 text-xs text-[var(--text-muted)] space-y-1">
                  <p className="text-[var(--text-secondary)] font-medium text-xs mb-2">{t('stock.transfer.previewTitle')}</p>
                  {(() => {
                    const from = transferRecord('from')
                    const to   = transferRecord('to')
                    const qty  = +transferForm.qty
                    return (
                      <>
                        <div className="flex justify-between">
                          <span>{transferForm.fromSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{from?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1" aria-hidden="true">→</span><span className="sr-only"> to </span>
                            <span className={from && from.stock_qty - qty < from.critical_level ? 'text-red-400' : 'text-green-400'}>
                              {from ? from.stock_qty - qty : '?'}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{transferForm.toSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{to?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1" aria-hidden="true">→</span><span className="sr-only"> to </span>
                            <span className="text-green-400">{to ? to.stock_qty + qty : '?'}</span>
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Inter-site Transfer Approval — gates the "Transfer stock" post below.
                  Mounted only once a valid source stock record + transfer context
                  exists. The second workflow step conditions on context.qty
                  (auto-skips when qty < 10), so qty MUST be numeric. */}
              {(() => {
                const fromRecord = transferRecord('from')
                if (!fromRecord || !transferForm.toSite || +transferForm.qty < 1) return null
                return (
                  <div className="space-y-2">
                    <EntityApprovalPanel
                      entityType="tyre_transfer"
                      entityId={fromRecord.id}
                      entityLabel={`${transferForm.fromSite} → ${transferForm.toSite}`}
                      context={{
                        qty: Number(transferForm.qty) || 0,
                        from_site: transferForm.fromSite,
                        to_site: transferForm.toSite,
                        country: activeCountry,
                        description: fromRecord.description || transferForm.notes || null,
                      }}
                      title="Inter-site Transfer Approval"
                      onStateChange={({ isActive, isLocked }) => setTransferWfLocked(!!(isActive || isLocked))}
                    />
                    {transferWfLocked && (
                      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Lock size={12} /> Locked, in approval
                      </div>
                    )}
                  </div>
                )
              })()}

              <button
                type="submit"
                disabled={transferring || transferWfLocked || !transferForm.fromSite || !transferForm.toSite || !transferRecord('from') || !transferRecord('to') || transferForm.qty < 1}
                title={transferWfLocked ? 'Locked, in approval' : undefined}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {transferWfLocked ? <Lock size={16} /> : <ArrowLeftRight size={16} />}
                {transferring ? t('stock.transfer.transferring') : t('stock.transfer.transferStock')}
              </button>
            </form>
          </Card>
        </div>
      )}

      {/* ── TIMELINE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {/* Date range */}
          <section className="card p-4 space-y-3" aria-label="Timeline date range">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.timeline.from')}</span>
                <input type="date" className={`w-44 ${CTRL}`} value={tlFrom} max={tlTo} onChange={e => setTlFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.timeline.to')}</span>
                <input type="date" className={`w-44 ${CTRL}`} value={tlTo} min={tlFrom} onChange={e => setTlTo(e.target.value)} />
              </label>
              <button type="button" onClick={exportTimeline} disabled={tlLoading || tlDays.length === 0}
                className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
                <Download size={14} aria-hidden="true" /> Excel
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">
              {[
                { label: t('stock.timeline.chips.today'),      from: todayStr(now),       to: todayStr(now) },
                { label: t('stock.timeline.chips.yesterday'),  from: offsetDate(-1, now), to: offsetDate(-1, now) },
                { label: t('stock.timeline.chips.last7Days'),  from: offsetDate(-6, now), to: todayStr(now) },
                { label: t('stock.timeline.chips.last30Days'), from: offsetDate(-29, now), to: todayStr(now) },
                { label: t('stock.timeline.chips.thisMonth'),  from: firstOfMonth(now),   to: todayStr(now) },
              ].map(({ label, from, to }) => {
                const on = tlFrom === from && tlTo === to
                return (
                  <button key={label} type="button" aria-pressed={on}
                    onClick={() => { setTlFrom(from); setTlTo(to) }}
                    className={`min-h-[44px] text-xs px-3 rounded-full border transition-colors ${FOCUS} ${
                      on ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                        : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}>{label}</button>
                )
              })}
            </div>
          </section>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label={t('stock.timeline.today')} value={tlSummary.todayIssues.toLocaleString()} sub={t('stock.timeline.issues')} />
            <StatTile label={t('stock.timeline.yesterday')} value={tlSummary.yesterdayIssues.toLocaleString()} sub={t('stock.timeline.issues')} />
            <StatTile label={t('stock.timeline.change')}
              value={tlSummary.changePct === null ? 'N/A' : `${tlSummary.changePct > 0 ? '+' : ''}${tlSummary.changePct.toFixed(1)}%`}
              sub={tlSummary.changePct === null ? 'No issues yesterday to compare' : 'Today vs yesterday'}
              tone={tlSummary.changePct > 0 ? 'warn' : 'neutral'} />
            <StatTile label={t('stock.timeline.columns.itemsIn')} value={tlSummary.totalIn.toLocaleString()} sub="In the selected range" />
            <StatTile label={t('stock.timeline.columns.itemsOut')} value={tlSummary.totalOut.toLocaleString()} sub="In the selected range" />
            <StatTile label="Busiest day" value={tlSummary.busiest ? tlSummary.busiest.date : 'N/A'}
              sub={tlSummary.busiest ? `${tlSummary.busiest.out} out` : 'No issues in range'} />
          </div>

          {tlError && (
            <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
              <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
              <p className="text-sm text-[var(--text-muted)] flex-1 min-w-0">{tlError}</p>
              <button type="button" onClick={loadTimeline} className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 ${FOCUS}`}>
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          )}

          {/* Bar chart */}
          {!tlError && tlDays.length > 0 && (
            <Card>
              <CardHeader level={2} title={t('stock.timeline.chartTitle')} />
              <CardBody style={{ height: 220 }}>
                <div className="h-full" role="img"
                  aria-label={`Daily net stock change from ${tlFrom} to ${tlTo}. ${tlSummary.totalIn} in, ${tlSummary.totalOut} out.`}>
                  <Bar
                    data={tlChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
                        y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' }, beginAtZero: true },
                      },
                    }}
                  />
                </div>
              </CardBody>
            </Card>
          )}

          <SortedPagedTable
            columns={timelineColumns}
            rows={tlDays}
            defaultSort={{ key: 'date', dir: 'desc' }}
            getRowId={r => r.date}
            loading={tlLoading}
            error={tlError || null}
            onRetry={loadTimeline}
            emptyMessage={t('stock.timeline.emptyPeriod')}
          />
        </div>
      )}

      {/* Movement History Modal */}
      {historyFor && (
        <Modal
          open
          onClose={closeHistory}
          size="lg"
          title={t('stock.historyModal.title', { site: historyFor.site })}
          subtitle={t('stock.historyModal.subtitle', { description: historyFor.description || '', qty: historyFor.stock_qty })}
          bodyClassName="space-y-[var(--space-4)]"
        >
          {/* Approval & Workflow Engine — status, immutable trail, approver action, start picker.
              Gates the ledger-post (stock issuance/adjustment) control below via onStateChange. */}
          <div>
              <EntityApprovalPanel
                entityType="stock_issue"
                entityId={historyFor.id}
                entityLabel={historyFor.description || historyFor.site || historyFor.id}
                context={{
                  quantity: historyFor.stock_qty,
                  value: historyFor.reorder_qty ?? historyFor.min_level,
                  movement_type: adjForm?.movement_type,
                  site: historyFor.site,
                }}
                onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
                title="Stock Issuance Approval"
              />
              {wfLocked && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                  <Lock size={12} /> Locked, in approval
                </div>
              )}

              {/* Tyre Return Authorization — shown only when the pending movement is a
                  return. Gates the return ledger-post via returnWfLocked, keyed on the
                  same stock record so it is independent of the stock_issue panel. */}
              {adjForm?.movement_type === 'return' && (
                <div className="mt-3">
                  <EntityApprovalPanel
                    entityType="tyre_return"
                    entityId={historyFor.id}
                    entityLabel={historyFor.description || historyFor.site || historyFor.id}
                    context={{
                      qty: Number(adjForm?.qty_change) || 0,
                      site: historyFor.site,
                      country: activeCountry,
                      description: historyFor.description || null,
                    }}
                    onStateChange={({ isActive, isLocked }) => setReturnWfLocked(!!(isActive || isLocked))}
                    title="Tyre Return Authorization"
                  />
                  {returnWfLocked && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                      <Lock size={12} /> Return locked, in approval
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick adjustment form */}
            {adjForm && (
              <div className="p-4 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/30">
                <p className="text-xs text-[var(--text-muted)] mb-3">{t('stock.historyModal.logMovement')}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.type')}</label>
                    <select className="input text-xs py-1.5"
                      value={adjForm.movement_type}
                      onChange={e => setAdjForm(f => ({ ...f, movement_type: e.target.value }))}>
                      {MOVEMENT_TYPES.map(mt => <option key={mt} value={mt}>{t(`stock.movementTypes.${mt}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.qtyChange')}</label>
                    <input type="number" className="input text-xs py-1.5"
                      value={adjForm.qty_change}
                      onChange={e => setAdjForm(f => ({ ...f, qty_change: +e.target.value }))}
                      placeholder={t('stock.historyModal.qtyChangePlaceholder')} />
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.reason')}</label>
                    <input className="input text-xs py-1.5" value={adjForm.reason}
                      onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder={t('stock.historyModal.reasonPlaceholder')} />
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.refNo')}</label>
                    <input className="input text-xs py-1.5" value={adjForm.reference_no}
                      onChange={e => setAdjForm(f => ({ ...f, reference_no: e.target.value }))}
                      placeholder={t('stock.historyModal.refNoPlaceholder')} />
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveAdjustment}
                    disabled={saving || adjForm.qty_change === 0 || wfLocked || (adjForm.movement_type === 'return' && returnWfLocked)}
                    title={wfLocked || (adjForm.movement_type === 'return' && returnWfLocked) ? 'Locked, in approval' : undefined}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {(wfLocked || (adjForm.movement_type === 'return' && returnWfLocked)) && <Lock size={12} />}
                    {saving ? t('stock.historyModal.saving') : t('stock.historyModal.logMovementBtn')}
                  </button>
                  <span className="text-xs text-[var(--text-muted)] self-center">
                    {t('stock.historyModal.newQty', { qty: historyFor.stock_qty + (adjForm.qty_change || 0) })}
                  </span>
                </div>
              </div>
            )}

            {/* History table. The dialog body is the scroll container now, so
                the sticky header still pins and there is no nested scroller. */}
            <div>
              {error && <div role="alert" className="border border-red-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-2 mb-3 text-sm">{error}</div>}
              <SortedPagedTable
                columns={movementColumns}
                rows={movements}
                defaultSort={{ key: 'created_at', dir: 'desc' }}
                getRowId={m => String(m.id)}
                loading={loadingMov}
                error={movError || null}
                onRetry={() => openHistory(historyFor)}
                emptyMessage={t('stock.historyModal.emptyHistory')}
              />
            </div>
        </Modal>
      )}

      {/* Add/Edit Form modal */}
      <Modal
        open={showForm}
        onClose={closeForm}
        size="md"
        title={editId ? t('stock.form.editTitle') : t('stock.form.addTitle')}
      >
        {error && <div role="alert" className="border border-red-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
        <form onSubmit={save} className="space-y-3">
              <div>
                <label className="label">{t('stock.form.site')}</label>
                <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required list="stock-sites" />
                <datalist id="stock-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">{t('stock.form.description')}</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={t('stock.form.descriptionPlaceholder')} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="label">{t('stock.form.stockQty')}</label><input type="number" className="input" value={form.stock_qty} readOnly title="Use Add Stock to record a physical count or receipt." min={0} /></div>
                <div><label className="label">{t('stock.form.minLevel')}</label><input type="number" className="input" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} min={0} /></div>
                <div><label className="label">{t('stock.form.criticalLevel')}</label><input type="number" className="input" value={form.critical_level} onChange={e => setForm(f => ({ ...f, critical_level: +e.target.value }))} min={0} /></div>
              </div>
              <div>
                <label className="label">{t('stock.form.managementAction')}</label>
                <input className="input" value={form.management_action} onChange={e => setForm(f => ({ ...f, management_action: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? t('stock.form.saving') : t('stock.form.save')}
                </button>
                <button type="button" onClick={closeForm} className="btn-secondary">{t('stock.form.cancel')}</button>
              </div>
        </form>
      </Modal>
    </div>
  )
}
