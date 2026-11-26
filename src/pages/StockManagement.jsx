import DateField from '../components/ui/DateField'
import { classifyMovement } from '../lib/stockLedger'
import StockMovementsPanel from '../components/stock/StockMovementsPanel'
import ReorderLevelsPanel from '../components/stock/ReorderLevelsPanel'
import { useSearchParams } from 'react-router-dom'
import InventoryHub from '../components/inventory/InventoryHub'
import { resolveSection } from '../lib/inventory/hubSections'
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
import {
  buildCatalogIndex, buildUsageIndex, buildErpVelocityMap, catalogFor, registerCoverage, registerItemCode, USAGE_MONTHS,
} from '../lib/stockRegisterDetail'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

// Stock text only adds information when it is more than the catalogue name plus a
// trailing part number; compare letters and digits only.
const squash = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const sameText = (stockText, name) => squash(stockText).startsWith(squash(name))

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const STATUS_BADGE = {
  OK:       'border-green-500/40 text-green-500',
  Low:      'border-amber-500/40 text-amber-500',
  Critical: 'border-red-500/40 text-red-500',
}

const EMPTY_FORM = {
  site: '', description: '', stock_qty: 0, min_level: 5, critical_level: 3, management_action: '',
}

// Movements the generic dialog may still post (the server RPC derives +/-
// direction from the type). Receipts, transfers, supplier returns, scrap and
// returns need their own document, so they are posted through their workflows
// (goods receipt, transfer dispatch/receive, supplier return, scrap request,
// job card materials) and are never offered here. Adjustments need the
// adjustment approval right; the database refuses everyone else anyway.
const ISSUE_TYPES = ['issue']
const ADJUSTMENT_TYPES = ['adjustment_up', 'adjustment_down']
function allowedMovementTypes(canAdjust) {
  return canAdjust ? [...ISSUE_TYPES, ...ADJUSTMENT_TYPES] : ISSUE_TYPES
}

// Where each documented movement lives in the Inventory Control Center.
const WORKFLOW_LINKS = [
  { key: 'receive', section: 'receiving' },
  { key: 'transfers', section: 'movements', tab: 'transfers' },
  { key: 'supplierReturns', section: 'purchasing', tab: 'returns' },
  { key: 'scrap', section: 'custody', tab: 'warranty' },
  { key: 'jobMaterials', section: 'floor', tab: 'jobmaterials' },
  { key: 'physical', section: 'physical' },
]

const isPermissionDenied = (err) => {
  const code = String(err?.code || err?.cause?.code || '')
  return code === '42501' || code === 'PGRST301' || err?.status === 403
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
// Filter controls use the app's shared `.input` style (same as every other register).
const CTRL = `input min-h-[44px] ${FOCUS}`

// Cover band -> text colour. The day count is always printed beside it.
const COVER_TONE = {
  unknown: 'text-[var(--text-muted)]',
  healthy: 'text-green-500 font-semibold',
  watch: 'text-amber-500 font-semibold',
  urgent: 'text-red-500 font-bold',
}

function SortButton({ label, active, dir, onClick, align }) {
  const { t } = useLanguage()
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={active
        ? t(dir === 'asc' ? 'wmsissue.stockreg.sortAsc' : 'wmsissue.stockreg.sortDesc', { label })
        : t('wmsissue.stockreg.sortBy', { label })}
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

/**
 * Inventory Control Center (`/stock`). One hub, fifteen sections in five
 * groups (docs/inventory/07). The section lives in `?section=`. The Stock
 * register section is the original stock register below, kept whole so every
 * existing workflow (quick entry, transfers, approvals, timeline) still works.
 */
export default function StockManagement() {
  const [params, setParams] = useSearchParams()
  const section = resolveSection(params.get('section'))
  const tab = params.get('tab') || null
  // onSection(section, tab?): a link may also name the tab inside the section
  // ("Open evidence" -> Controls > Opening balances). Changing section without a
  // tab clears it, so the next section opens on its own default tab.
  const onSection = useCallback((next, nextTab) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (!next || next === 'overview') p.delete('section')
      else p.set('section', next)
      if (nextTab) p.set('tab', nextTab)
      else p.delete('tab')
      return p
    }, { replace: false })
  }, [setParams])
  const onTab = useCallback((nextTab) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (nextTab) p.set('tab', nextTab)
      else p.delete('tab')
      return p
    }, { replace: true })
  }, [setParams])
  return <InventoryHub section={section} tab={tab} onSection={onSection} onTab={onTab} renderRegister={() => <StockRegisterView embedded />} />
}

/** The stock register (formerly the whole /stock page). */
function StockRegisterView({ embedded = false }) {
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const { profile, isSuperAdmin, hasCapability } = useAuth()
  const [, setHubParams] = useSearchParams()
  // Owner decision 2026-11-24: count adjustments are posted only by the super
  // admin or an Admin (enforced in the database too); the capability alone is not enough.
  const canAdjust = !!isSuperAdmin || String(profile?.role || '').toLowerCase() === 'admin'
  const movementTypes = useMemo(() => allowedMovementTypes(canAdjust), [canAdjust])
  const goToWorkflow = useCallback((link) => {
    setHubParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('section', link.section)
      if (link.tab) p.set('tab', link.tab)
      else p.delete('tab')
      return p
    }, { replace: false })
  }, [setHubParams])
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

  // Velocity state
  const [velocityMap, setVelocityMap] = useState({})
  // Material Master facts + ERP consumption for the register. Loaded after the
  // register paints; a failure leaves the extra columns at N/A, never blocks stock.
  const [catalogIdx, setCatalogIdx] = useState(null)
  const [usageIdx, setUsageIdx] = useState(null)
  const [detailState, setDetailState] = useState('loading')

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
  useEffect(() => { setWfLocked(false) }, [historyFor?.id])

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
      setTyreChangeError(toUserMessage(err, t('wmsissue.stockreg.tyreSummaryError')))
    } finally {
      if (!stale()) setTyreChangeLoading(false)
    }
    // t is read only for the error fallback; a language switch must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // The two reads are independent, so they go out together: each is a full
      // round trip to the database region, and awaiting them one after the
      // other doubled the wait. Velocity from tyre issues over the last 3
      // months stays best-effort: a failed velocity read leaves cover as N/A
      // instead of failing the stock register, exactly as before.
      const velocityRead = Promise.resolve()
        .then(() => stock.listTyreIssuesSince(velocitySince(new Date(), 3)))
        .then((rows) => rows ?? [], () => null)
      const stockRecords = await stock.listStockRecords({ country: activeCountry }) ?? []
      if (stale()) return
      setRecords(stockRecords)
      const velData = await velocityRead
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

  // Usage is read only for the item codes the register holds, not for every
  // issue line in the country (up to 150k rows per country change).
  const registerCodesKey = useMemo(() => {
    const codes = new Set()
    for (const r of records) {
      const code = registerItemCode(r)
      if (code) codes.add(code)
      if (r?.item?.item_code) codes.add(String(r.item.item_code).trim())
    }
    return [...codes].sort().join('\n')
  }, [records])

  useEffect(() => {
    let cancelled = false
    setDetailState('loading')
    setUsageIdx(null)
    if (loading) return () => { cancelled = true }
    const since = offsetDate(-Math.round(USAGE_MONTHS * 30.4))
    const itemCodes = registerCodesKey ? registerCodesKey.split('\n') : []
    Promise.allSettled([
      catalogIdx ? Promise.resolve(null) : stock.listRegisterCatalog(),
      stock.listConsumptionSince(since, { country: activeCountry, itemCodes }),
    ]).then(([cat, use]) => {
      if (cancelled) return
      if (cat.status === 'fulfilled' && cat.value) {
        setCatalogIdx(buildCatalogIndex(cat.value.canonical, cat.value.variants, cat.value.aliases))
      }
      if (use.status === 'fulfilled') setUsageIdx(buildUsageIndex(use.value))
      setDetailState(cat.status === 'rejected' || use.status === 'rejected' ? 'partial' : 'ready')
    })
    return () => { cancelled = true }
  // catalogIdx is read once; re-reading it on every load would refetch 6k rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, stockScope, registerCodesKey, loading])

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

  // Edits item details and levels only. Quantities move through the ledger (Add
  // Stock, receipts, issues, counts); stock_records balances cannot be written
  // directly (inv_balance_guard), so this form never sends a quantity and never
  // writes a movement. The old create/movement branch here was refused by the
  // ledger and its error was swallowed; new stock goes through Add Stock.
  async function save(e) {
    e.preventDefault()
    if (!editId) { setError(t('wmsissue.stockreg.useAddStock')); return }
    setSaving(true)
    setError('')

    const { stock_qty: _qty, ...details } = form
    try {
      await stock.updateStockRecord(editId, {
        ...details,
        updated_by: profile?.id,
        updated_at: new Date().toISOString(),
      })
    } catch (err) { setError(toUserMessage(err)); setSaving(false); return }

    setShowForm(false)
    load()
    setSaving(false)
  }

  async function saveAdjustment() {
    // Block the ledger post while the record's approval workflow is active/locked.
    // A Tyre Return post is additionally gated by its own return-authorization lock.
    if (wfLocked) return
    if (!adjForm || !adjForm.qty_change) return
    if (!movementTypes.includes(adjForm.movement_type)) {
      setError(t('stock.historyModal.refused'))
      return
    }
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
    } catch (aErr) {
      setError(isPermissionDenied(aErr) ? t('stock.historyModal.refused') : toUserMessage(aErr))
      setSaving(false)
      return
    }
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
      setMovError(toUserMessage(e, t('wmsissue.stockreg.historyError')))
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
    if (transferWfLocked) { setTransferError(t('wmsissue.stockreg.transferLocked')); return }

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
      setTlError(toUserMessage(failed, t('wmsissue.stockreg.timelineError')))
    } else {
      setTlRecords(data ?? [])
    }
    setTlLoading(false)
    // t is read only for the error fallback; a language switch must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, latestTimeline, tlFrom, tlTo])

  useEffect(() => {
    if (activeTab === 'timeline') loadTimeline()
  }, [activeTab, loadTimeline])

  const now = useMemo(() => new Date(), [])
  const tlDays = useMemo(() => timelineByDate(tlRecords), [tlRecords])
  const tlSummary = useMemo(() => timelineSummary(tlDays, new Date()), [tlDays])

  const erpVelocity = useMemo(() => buildErpVelocityMap(records, usageIdx), [records, usageIdx])
  const enriched = useMemo(
    () => enrichStock(records.map(r => ({ ...r, cat: catalogFor(r, catalogIdx) })), { ...velocityMap, ...erpVelocity }),
    [records, velocityMap, erpVelocity, catalogIdx],
  )
  const coverage = useMemo(() => registerCoverage(records, catalogIdx, usageIdx), [records, catalogIdx, usageIdx])
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
  const tyreSiteTableData = useMemo(() => {
    const rows = visibleTyreSites.map(row => ({
      id: row.site,
      label: row.site,
      country: row.country,
      qty: new Map(row.bySize.map(item => [item.size, item.quantity])),
      total: row.total,
    }))
    if (rows.length === 0) return rows
    const qty = new Map(siteViewSizes.map(size => [size, selectedTyreSiteRows.reduce((sum, row) => sum + (row.bySize.find(item => item.size === size)?.quantity || 0), 0)]))
    return [...rows, { id: '__total__', label: siteSizeLocation === 'all' ? t('stock.tyreBySite.companyTotal') : t('stock.tyreBySite.locationTotal'), isTotal: true, qty, total: siteViewTotal }]
  }, [visibleTyreSites, siteViewSizes, selectedTyreSiteRows, siteSizeLocation, siteViewTotal, t])

  const tyreSiteColumns = useMemo(() => [
    {
      id: 'site',
      header: t('stock.tyreBySite.site'),
      accessorFn: row => row.label,
      cell: ({ row: { original: r } }) => (
        <span className={r.isTotal ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-primary)]'}>
          {r.label}{!r.isTotal && activeCountry === 'All' && r.country ? <span className="ms-2 text-xs font-normal text-[var(--text-muted)]">{r.country}</span> : null}
        </span>
      ),
    },
    ...siteViewSizes.map(size => ({
      id: `size:${size}`,
      header: size,
      accessorFn: row => row.qty.get(size) || 0,
      cell: ({ getValue, row: { original: r } }) => <span className={`tabular-nums ${r.isTotal ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{getValue().toLocaleString()}</span>,
      meta: { align: 'right' },
    })),
    {
      id: 'total',
      header: t('stock.tyreBySite.total'),
      accessorFn: row => row.total,
      cell: ({ getValue }) => <span className="font-semibold tabular-nums text-[var(--text-primary)]">{getValue().toLocaleString()}</span>,
      meta: { align: 'right' },
    },
  ], [siteViewSizes, activeCountry, t])

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
    } catch (e) { setLoadError(toUserMessage(e, t('wmsissue.stockreg.exportError'))) }
  }

  async function exportPdf() {
    try {
      const { exportToPdf, reportFileName } = await loadExportUtils()
      const keys = ['site', 'item_code', 'item_name', 'brand', 'part_type', 'stock_qty', 'status', 'velocity', 'days_left', 'suggestion']
      await exportToPdf(
        stockExportRows(visibleStock),
        keys.map(k => ({ key: k, header: STOCK_EXPORT_HEADERS[STOCK_EXPORT_COLS.indexOf(k)] })),
        'Stock Management',
        reportFileName('Stock Management', activeCountry, todayStr(now)),
        'landscape',
        '',
        { subtitleNote: `${visibleStock.length} of ${records.length} items` },
      )
    } catch (e) { setLoadError(toUserMessage(e, t('wmsissue.stockreg.exportError'))) }
  }

  async function exportTimeline() {
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      await exportToExcel(tlDays, ['date', 'in', 'out', 'net'], ['Date', 'Items In', 'Items Out', 'Net Change'],
        reportFileName('Stock Timeline', tlFrom, 'to', tlTo), 'Timeline')
    } catch (e) { setTlError(toUserMessage(e, t('wmsissue.stockreg.exportError'))) }
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
    const reorder = ['reorder', t('stock.tabs.reorder')]
    const base = [['stock', t('stock.tabs.stock')], ['movements', t('stock.tabs.movements')], ['by-site', t('stock.tabs.bySite')], reorder, ['timeline', t('stock.tabs.timeline')]]
    if (sites.length >= 2) return [['stock', t('stock.tabs.stock')], ['movements', t('stock.tabs.movements')], ['by-site', t('stock.tabs.bySite')], ['transfer', t('stock.tabs.transfer')], reorder, ['timeline', t('stock.tabs.timeline')]]
    return base
  }, [sites, t])

  const openMovement = useCallback((r) => {
    openHistory(r)
    setAdjForm({ qty_change: 0, reason: '', movement_type: 'issue', reference_no: '' })
  }, [])

  const stockColumns = useMemo(() => [
    { id: 'site', header: t('stock.table.columns.site'), sort: r => r.site, size: 130, firstDir: 'asc',
      cell: r => <span className="font-medium text-[var(--text-primary)]">{r.site || na}</span> },
    { id: 'description', header: t('stock.table.columns.item'), sort: r => r.item?.item_code || r.description, size: 320, firstDir: 'asc',
      cell: r => {
        const code = r.item?.item_code || stockItem(r).code
        const name = r.cat?.name || r.item?.item_name
        return (
          <div className="min-w-0">
            {code
              ? <span className="font-mono text-xs font-semibold text-[var(--text-primary)]" dir="ltr">{code}</span>
              : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border border-amber-500/40 text-amber-500">{t('wmsissue.stockreg.noItemCode')}</span>}
            <p className="text-sm text-[var(--text-primary)] mt-0.5">{name || r.description || na}</p>
            {name && r.description && !sameText(r.description, name) && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5" title={t('wmsissue.stockreg.stockTextTitle')}>{t('wmsissue.stockreg.stockText', { text: r.description })}</p>
            )}
            {(stockItem(r).unit || r.uom || r.condition) && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{[stockItem(r).condition || r.condition, stockItem(r).unit || r.uom, stockItem(r).bin].filter(Boolean).join(' · ')}</p>
            )}
          </div>
        )
      } },
    { id: 'brand', header: t('stock.table.columns.brand'), sort: r => r.cat?.brand || r.brand, size: 130, firstDir: 'asc',
      cell: r => <span className="text-xs text-[var(--text-secondary)]">{r.cat?.brand || r.brand || <span className="text-[var(--text-dim)]">{na}</span>}</span> },
    { id: 'partType', header: t('stock.table.columns.partType'), sort: r => r.cat?.partType, size: 120,
      cell: r => {
        const pt = r.cat?.partType
        if (!pt || pt === 'not_stated') return <span className="text-xs text-[var(--text-dim)]">{r.cat ? t('wmsissue.stockreg.notStated') : na}</span>
        const tone = pt === 'genuine' || pt === 'oes' ? 'border-green-500/40 text-green-500' : 'border-amber-500/40 text-amber-500'
        return <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${tone}`}>{pt === 'oes' ? 'OES' : pt}</span>
      } },
    { id: 'category', header: t('stock.table.columns.category'), sort: r => r.cat?.category || r.item?.category, size: 130, firstDir: 'asc',
      cell: r => <span className="text-xs text-[var(--text-secondary)]">{r.cat?.category || r.item?.category || <span className="text-[var(--text-dim)]">{na}</span>}</span> },
    { id: 'oem', header: t('stock.table.columns.oem'), sort: r => (r.cat?.oem || [])[0], size: 130,
      cell: r => (r.cat?.oem?.length
        ? <span className="font-mono text-xs text-[var(--text-secondary)]" dir="ltr" title={r.cat.oem.join(', ')}>{r.cat.oem[0]}{r.cat.oem.length > 1 ? ` +${r.cat.oem.length - 1}` : ''}</span>
        : <span className="text-xs text-[var(--text-dim)]">{na}</span>) },
    { id: 'stock_qty', header: t('stock.table.columns.stock'), sort: r => r.stock_qty, size: 90, align: 'right',
      cell: r => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{r.stock_qty ?? na}</span> },
    { id: 'min_level', header: t('stock.table.columns.min'), sort: r => r.min_level, size: 80, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.min_level ?? na}</span> },
    { id: 'critical_level', header: t('stock.table.columns.critical'), sort: r => r.critical_level, size: 90, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.critical_level ?? na}</span> },
    { id: 'reorder_qty', header: t('stock.table.columns.reorderQty'), sort: r => r.reorder_qty, size: 100, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.reorder_qty ?? na}</span> },
    { id: 'status', header: t('stock.table.columns.status'), sort: r => STATUSES.indexOf(r.status), size: 100, firstDir: 'desc',
      cell: r => <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[r.status]}`}>{t(`stock.statuses.${r.status}`)}</span> },
    { id: 'avgPerMonth', header: t('stock.table.columns.velocity'), sort: r => r.avgPerMonth, size: 100, align: 'right',
      cell: r => {
        if (r.avgPerMonth > 0) {
          return (
            <span className="tabular-nums text-xs text-[var(--text-secondary)]"
              title={r.usageScope === 'country' ? t('wmsissue.stockreg.velocityCountryTitle') : t('wmsissue.stockreg.velocitySiteTitle', { months: USAGE_MONTHS })}>
              {t('wmsissue.stockreg.perMonth', { value: r.avgPerMonth })}{r.usageScope === 'country' ? ` ${t('wmsissue.stockreg.countryTag')}` : ''}
            </span>
          )
        }
        if (r.avgPerMonth === null) return <span className="text-xs text-[var(--text-dim)]">{detailState === 'loading' ? '...' : na}</span>
        return <span className="text-xs text-[var(--text-dim)]">{t('wmsissue.stockreg.noIssuesMonths', { months: USAGE_MONTHS })}</span>
      } },
    { id: 'daysRemaining', header: t('stock.table.columns.daysLeft'), sort: r => r.daysRemaining, size: 100, align: 'right', firstDir: 'asc',
      cell: r => (
        <span className={`tabular-nums text-xs ${COVER_TONE[coverBand(r.daysRemaining)]}`}
          title={r.daysRemaining === null ? (r.usageScope === 'country' ? t('wmsissue.stockreg.coverCountryTitle') : t('wmsissue.stockreg.coverNoneTitle')) : undefined}>
          {r.daysRemaining === null ? na : t('wmsissue.stockreg.days', { count: r.daysRemaining })}
        </span>
      ) },
    { id: 'action', header: t('stock.table.columns.action'), sort: r => r.management_action, size: 200,
      cell: r => (
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)] max-w-xs">
          {r.management_action ? <span className="truncate" title={r.management_action}>{r.management_action}</span> : (r.suggestion === null ? <span className="text-[var(--text-dim)]">{na}</span> : null)}
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
  ], [t, na, openMovement, detailState])

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
        const group = classifyMovement(m.movement_type).group
        return (
          <span className={`px-1.5 py-0.5 rounded text-xs border ${group === 'received' ? 'border-green-500/40 text-green-500' : group === 'utilised' ? 'border-red-500/40 text-red-500' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
            {m.movement_type}
          </span>
        )
      } },
    { id: 'qty_before', header: t('stock.historyModal.columns.before'), sort: m => m.qty_before, size: 80, align: 'right',
      cell: m => <span className="tabular-nums text-[var(--text-muted)]">{m.qty_before ?? na}</span> },
    { id: 'qty_change', header: t('stock.historyModal.columns.change'), sort: m => m.qty_change, size: 80, align: 'right',
      cell: m => <span className={`tabular-nums font-medium ${m.qty_change > 0 ? 'text-green-500' : 'text-red-500'}`}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</span> },
    { id: 'qty_after', header: t('stock.historyModal.columns.after'), sort: m => m.qty_after, size: 80, align: 'right',
      cell: m => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{m.qty_after ?? na}</span> },
    { id: 'reason', header: t('stock.historyModal.columns.reason'), sort: m => m.reason, size: 180,
      cell: m => <span className="text-[var(--text-muted)]">{m.reason || t('wmsissue.stockreg.none')}</span> },
    { id: 'reference_no', header: t('stock.historyModal.columns.ref'), sort: m => m.reference_no, size: 120,
      cell: m => <span className="text-[var(--text-muted)]" dir="auto">{m.reference_no || t('wmsissue.stockreg.none')}</span> },
  ], [t, na])

  if (entryOpen) return <StockQuickEntry
    key={`${activeCountry}|${profile?.organisation_id || profile?.org_id}|${profile?.id}`}
    records={records.filter(r => r.country === activeCountry)}
    initialSite={selectedSiteName || (siteFilter === 'all' ? workingContext?.site || '' : siteFilter)}
    onClose={() => setEntryOpen(false)}
    onSaved={result => { setEntryOpen(false); setEntryMessage(t(result.items.length === 1 ? 'wmsissue.stockreg.savedOne' : 'wmsissue.stockreg.savedMany', { count: result.items.length })); load() }}
  />

  return (
    <div className="stock-workspace space-y-4">
      <PageHeader
        className="stock-register-heading"
        // Embedded in the Inventory Control Center, whose header already names
        // this section: no second h1.
        title={embedded ? null : t('stock.title')}
        subtitle={t('stock.subtitle', { count: records.length })}
        icon={Package}
        actions={
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> {t('wmsissue.common.refresh')}
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
      <p className="text-xs text-[var(--text-muted)]">{t('wmsissue.stockreg.addStockHelp')}</p>
      {loadError && (
        <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
          <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{t('wmsissue.stockreg.loadError')}</p>
            <p className="text-sm text-[var(--text-muted)]">{loadError}</p>
          </div>
          <button type="button" onClick={load} className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 ${FOCUS}`}>
            <RefreshCw size={14} aria-hidden="true" /> {t('wmsissue.common.retry')}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label={t('wmsissue.stockreg.views')}>
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
                <button type="button" onClick={() => setActiveTab('timeline')} className={`text-xs font-medium text-[var(--accent)] ${FOCUS}`}>{t('stock.companyTyres.openTimeline')} <span className="inline-block rtl-flip" aria-hidden="true">→</span></button>
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
            <StatTile icon={Boxes} label={t('wmsissue.stockreg.stockItems')} value={loading ? '...' : kpis.items.toLocaleString()}
              sub={t('wmsissue.stockreg.stockItemsSub')} />
            <StatTile icon={AlertTriangle} label={t('stock.statuses.Critical')} value={kpis.counts.Critical.toLocaleString()}
              sub={t('wmsissue.stockreg.criticalSub')} tone={kpis.counts.Critical > 0 ? 'crit' : 'neutral'} />
            <StatTile icon={AlertTriangle} label={t('stock.statuses.Low')} value={kpis.counts.Low.toLocaleString()}
              sub={t('wmsissue.stockreg.lowSub')} tone={kpis.counts.Low > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={Clock} label={t('wmsissue.stockreg.avgCover')}
              value={kpis.avgCoverDays === null ? na : t('wmsissue.stockreg.days', { count: kpis.avgCoverDays })}
              sub={kpis.measuredCover ? t('wmsissue.stockreg.withConsumption', { count: kpis.measuredCover }) : t('wmsissue.stockreg.noConsumption')} tone="info" />
            <StatTile icon={ShoppingCart} label={t('wmsissue.stockreg.suggestedReorder')} value={kpis.toReorder.toLocaleString()}
              sub={t('wmsissue.stockreg.under30', { count: kpis.atRisk })} tone={kpis.atRisk > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={MapPin} label={t('wmsissue.stockreg.sites')} value={kpis.sites.toLocaleString()}
              sub={t('wmsissue.stockreg.stockedOut', { count: kpis.stockouts })} />
          </div>

          {/* Filters */}
          <section className="card p-4" aria-label={t('wmsissue.stockreg.filters')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <label className="block lg:col-span-2">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('wmsissue.filters.search')}</span>
                <span className="relative block">
                  <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={t('wmsissue.stockreg.searchPlaceholder')} className={`w-full ps-9 ${CTRL}`} />
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.table.columns.site')}</span>
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="all">{t('wmsissue.filters.allSites')}</option>
                  {sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.table.columns.status')}</span>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="all">{t('wmsissue.stockreg.allStatuses')}</option>
                  {STATUSES.map(st => <option key={st} value={st}>{t(`stock.statuses.${st}`)}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-dim)]" aria-live="polite">
              <span>{loading ? t('wmsissue.stockreg.loadingStock') : t('wmsissue.stockreg.itemsOf', { shown: visibleStock.length.toLocaleString(), total: records.length.toLocaleString() })}</span>
              {!loading && records.length > 0 && (
                <span>
                  {detailState === 'loading' ? t('wmsissue.stockreg.loadingDetails')
                    : t('wmsissue.stockreg.coverage', { linked: coverage.catalogued.toLocaleString(), used: coverage.withUsage.toLocaleString(), months: USAGE_MONTHS })
                      + (coverage.noCode ? ` · ${t('wmsissue.stockreg.coverageNoCode', { count: coverage.noCode })}` : '')
                      + (detailState === 'partial' ? ` · ${t('wmsissue.stockreg.coveragePartial')}` : '')}
                </span>
              )}
              {filtersActive && (
                <button type="button" onClick={clearFilters}
                  className={`min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`}>
                  <X size={12} aria-hidden="true" /> {t('wmsissue.common.clearFilters')}
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
            emptyMessage={records.length === 0 ? t('stock.table.emptyTitle') : t('wmsissue.stockreg.noMatch')}
          />
        </>
      )}

      {/* ── TYRE STOCK BY SITE AND SIZE ──────────────────────────────────────── */}
      {activeTab === 'movements' && <StockMovementsPanel records={records} country={activeCountry} site={siteFilter} />}

      {activeTab === 'reorder' && (
        <ReorderLevelsPanel
          records={records}
          usageIdx={usageIdx}
          detailState={detailState}
          canApply={typeof hasCapability === 'function' && hasCapability('stock', 'edit')}
          userId={profile?.id ?? null}
          onApplied={load}
        />
      )}

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
                  <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input className={`input min-h-[44px] ps-9 ${FOCUS}`} value={siteSizeSearch} onChange={e => setSiteSizeSearch(e.target.value)} placeholder={t('stock.tyreBySite.search')} aria-label={t('stock.tyreBySite.search')} />
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
                : <EnterpriseTable
                  columns={tyreSiteColumns}
                  data={tyreSiteTableData}
                  getRowId={row => row.id}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  enableSorting={false}
                  enableColumnVisibility={false}
                  stickyFirstColumn
                  pageSizeOptions={[500]}
                  initialPageSize={500}
                  showPagination={false}
                  emptyMessage={t('stock.tyreBySite.noMatch')}
                  exportFileName="tyre_stock_by_site"
                />}
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
                {['from', 'to'].map(side => <label key={side} className="label">{side === 'from' ? t('wmsissue.stockreg.sourceItem') : t('wmsissue.stockreg.destinationItem')}
                  <select className="input" aria-label={side === 'from' ? t('wmsissue.stockreg.sourceItem') : t('wmsissue.stockreg.destinationItem')} required
                    value={transferRecord(side)?.id || ''} onChange={e => setTransferForm(f => ({ ...f, [side + 'Id']: e.target.value }))}>
                    <option value="">{t('wmsissue.stockreg.chooseItemAtSite')}</option>
                    {records.filter(r => r.site === transferForm[side + 'Site']).map(r => <option key={r.id} value={r.id}>{stockItem(r).code ? `${stockItem(r).code} · ` : ''}{r.description || r.site} · {r.stock_qty} {stockItem(r).unit || t('wmsissue.quick.units')}{stockItem(r).bin ? ` · ${stockItem(r).bin}` : ''}</option>)}
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
                            <span className="text-[var(--text-dim)] mx-1 inline-block rtl-flip" aria-hidden="true">→</span><span className="sr-only"> {t('wmsissue.reorder.toNew')} </span>
                            <span className={from && from.stock_qty - qty < from.critical_level ? 'text-red-400' : 'text-green-400'}>
                              {from ? from.stock_qty - qty : '?'}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{transferForm.toSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{to?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1 inline-block rtl-flip" aria-hidden="true">→</span><span className="sr-only"> {t('wmsissue.reorder.toNew')} </span>
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
                      title={t('wmsissue.stockreg.transferApproval')}
                      onStateChange={({ isActive, isLocked }) => setTransferWfLocked(!!(isActive || isLocked))}
                    />
                    {transferWfLocked && (
                      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Lock size={12} aria-hidden="true" /> {t('wmsissue.stockreg.locked')}
                      </div>
                    )}
                  </div>
                )
              })()}

              <button
                type="submit"
                disabled={transferring || transferWfLocked || !transferForm.fromSite || !transferForm.toSite || !transferRecord('from') || !transferRecord('to') || transferForm.qty < 1}
                title={transferWfLocked ? t('wmsissue.stockreg.locked') : undefined}
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
                <DateField className="w-44" ariaLabel={t('stock.timeline.from')} value={tlFrom} onChange={setTlFrom} placeholder={t('wmsissue.movements.selectDate')} />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.timeline.to')}</span>
                <DateField className="w-44" ariaLabel={t('stock.timeline.to')} value={tlTo} onChange={setTlTo} min={tlFrom} placeholder={t('wmsissue.movements.selectDate')} />
              </label>
              <button type="button" onClick={exportTimeline} disabled={tlLoading || tlDays.length === 0}
                className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
                <Download size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('wmsissue.movements.quickRanges')}>
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
              value={tlSummary.changePct === null ? na : `${tlSummary.changePct > 0 ? '+' : ''}${tlSummary.changePct.toFixed(1)}%`}
              sub={tlSummary.changePct === null ? t('wmsissue.stockreg.noYesterday') : t('wmsissue.stockreg.todayVsYesterday')}
              tone={tlSummary.changePct > 0 ? 'warn' : 'neutral'} />
            <StatTile label={t('stock.timeline.columns.itemsIn')} value={tlSummary.totalIn.toLocaleString()} sub={t('wmsissue.stockreg.inRange')} />
            <StatTile label={t('stock.timeline.columns.itemsOut')} value={tlSummary.totalOut.toLocaleString()} sub={t('wmsissue.stockreg.inRange')} />
            <StatTile label={t('wmsissue.stockreg.busiestDay')} value={tlSummary.busiest ? tlSummary.busiest.date : na}
              sub={tlSummary.busiest ? t('wmsissue.stockreg.outCount', { count: tlSummary.busiest.out }) : t('wmsissue.stockreg.noIssuesInRange')} />
          </div>

          {tlError && (
            <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
              <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
              <p className="text-sm text-[var(--text-muted)] flex-1 min-w-0">{tlError}</p>
              <button type="button" onClick={loadTimeline} className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 ${FOCUS}`}>
                <RefreshCw size={14} aria-hidden="true" /> {t('wmsissue.common.retry')}
              </button>
            </div>
          )}

          {/* Bar chart */}
          {!tlError && tlDays.length > 0 && (
            <Card>
              <CardHeader level={2} title={t('stock.timeline.chartTitle')} />
              <CardBody style={{ height: 220 }}>
                <div className="h-full" role="img"
                  aria-label={t('wmsissue.stockreg.chartAria', { from: tlFrom, to: tlTo, totalIn: tlSummary.totalIn, totalOut: tlSummary.totalOut })}>
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
                title={t('wmsissue.stockreg.issuanceApproval')}
              />
              {wfLocked && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                  <Lock size={12} aria-hidden="true" /> {t('wmsissue.stockreg.locked')}
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
                      {movementTypes.map(mt => <option key={mt} value={mt}>{t(`stock.movementTypes.${mt}`)}</option>)}
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
                    disabled={saving || adjForm.qty_change === 0 || wfLocked}
                    title={wfLocked ? t('wmsissue.stockreg.locked') : undefined}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {wfLocked && <Lock size={12} />}
                    {saving ? t('stock.historyModal.saving') : t('stock.historyModal.logMovementBtn')}
                  </button>
                  <span className="text-xs text-[var(--text-muted)] self-center">
                    {t('stock.historyModal.newQty', { qty: historyFor.stock_qty + (adjForm.qty_change || 0) })}
                  </span>
                </div>
                {!canAdjust && (
                  <p className="text-xs text-[var(--text-muted)] mt-3">{t('stock.historyModal.noAdjustRight')}</p>
                )}
                <div className="mt-3">
                  <p className="text-xs text-[var(--text-muted)] mb-2">{t('stock.historyModal.documentedOnly')}</p>
                  <div className="flex flex-wrap gap-2">
                    {WORKFLOW_LINKS.map(link => (
                      <button key={link.key} type="button"
                        onClick={() => { closeHistory(); goToWorkflow(link) }}
                        className={`btn-secondary min-h-[44px] text-xs px-3 ${FOCUS}`}>
                        {t(`stock.historyModal.links.${link.key}`)}
                      </button>
                    ))}
                  </div>
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
                <div><label className="label">{t('stock.form.stockQty')}</label><input type="number" className="input" value={form.stock_qty} readOnly title={t('wmsissue.stockreg.qtyReadOnly')} min={0} /></div>
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
