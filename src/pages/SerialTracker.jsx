import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { findSerialRecords } from '../lib/api/serialTracker'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import { ScanLine, Search, FileText, Upload, AlertTriangle, Trash2, RotateCcw, FileSpreadsheet, ClipboardList, UserX, CalendarClock } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmptyState from '../components/EmptyState'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import { scrapTyreBySerial, unscrapTyreBySerial, getScrapMark, listScrapMarks, listScrappedTyres, updateScrapReason, getScrapPermissions } from '../lib/api/tyreExchange'
import { COUNTRY_CURRENCY } from '../lib/api/assetMaster'
import {
  serialStats, serialTimeline, summarizeBulkSerial, bulkSummary as summarizeBulk,
  filterBulkResults, filterScrapList, scrapRegisterSummary, recordPrice,
} from '../lib/serialTrackerAnalytics'
import { compareValues } from '../lib/consoleTable'

// EnterpriseTable sorts through the shared console comparator, so blanks sort
// last and numeric strings compare as numbers on every column.
const sortCompare = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const moneyFor = (n, country) => (n == null ? 'N/A' : formatCurrencyCompact(n, COUNTRY_CURRENCY[country] || 'SAR'))

const BULK_TONE = {
  'Not Found': 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border-bright)]',
  Active: 'bg-green-900/30 text-green-400 border-green-700/50',
  Scrapped: 'bg-red-900/30 text-red-400 border-red-700/50',
  Retired: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]',
}

function SearchSkeleton() {
  return (
    <>
      <Card className="animate-pulse">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-8 w-40 bg-[var(--surface-2)] rounded-md" />
              <div className="h-6 w-16 bg-[var(--surface-2)] rounded-full" />
            </div>
            <div className="h-4 w-56 bg-[var(--surface-2)] rounded" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-20 bg-[var(--surface-2)] rounded-md" />
            <div className="h-8 w-16 bg-[var(--surface-2)] rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[var(--surface-2)] rounded-lg p-3 text-center space-y-2">
              <div className="h-6 w-12 bg-[var(--surface-3)] rounded mx-auto" />
              <div className="h-3 w-20 bg-[var(--surface-3)] rounded mx-auto" />
            </div>
          ))}
        </div>
        <div className="h-4 w-32 bg-[var(--surface-2)] rounded mt-3" />
      </Card>

      <Card className="animate-pulse">
        <div className="h-5 w-32 bg-[var(--surface-2)] rounded mb-4" />
        <div className="space-y-4">
          {[...Array(3)].map((_, gi) => (
            <div key={gi}>
              <div className="h-4 w-28 bg-[var(--surface-2)] rounded mb-2" />
              <div className="space-y-2 pl-3 border-l border-[var(--border-dim)]">
                {[...Array(2)].map((_, ri) => (
                  <div key={ri} className="flex items-start gap-3 py-2">
                    <div className="h-3 w-20 bg-[var(--surface-2)] rounded flex-shrink-0 mt-1" />
                    <div className="flex-1 space-y-1.5">
                      <div className="flex gap-3">
                        <div className="h-3 w-16 bg-[var(--surface-2)] rounded" />
                        <div className="h-3 w-12 bg-[var(--surface-2)] rounded" />
                        <div className="h-3 w-10 bg-[var(--surface-2)] rounded" />
                      </div>
                      <div className="h-3 w-36 bg-[var(--surface-2)] rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

export default function SerialTracker() {
  const { activeCountry } = useSettings()
  const queryId = useRef(0)
  const { profile, isSuperAdmin, grantedModules } = useAuth()
  // MARKING a scrap and UNDOING one are two different rights, and the server is
  // the one that decides both. Marking is a field observation and reaches the
  // tyre roles (including Tyre Data Collector); undoing is a correction to the
  // record and stays with an administrator.
  //
  // These are asked of the database rather than derived from profile.role,
  // because a role string cannot see a per-user capability grant, and a button
  // shown on a guess is a button the RPC then refuses.
  const [perms, setPerms] = useState({ canScrap: false, canUndo: false })
  useEffect(() => {
    let cancelled = false
    getScrapPermissions()
      .then((p) => { if (!cancelled) setPerms(p) })
      .catch(() => { /* fail closed: perms stay false */ })
    return () => { cancelled = true }
  }, [profile?.id, isSuperAdmin])
  // The legacy 'serial_tracker:scrap' grant still opens the mark action, so an
  // existing grant keeps working; the server gate is the authority either way.
  const canScrap = perms.canScrap
    || (typeof grantedModules?.has === 'function' && grantedModules.has('serial_tracker:scrap'))
  const canUndo = perms.canUndo

  const [activeTab, setActiveTab] = useState('single')

  // ── Single Search state ───────────────────────────────────────────────────
  const [serialInput, setSerialInput] = useState('')
  const [records, setRecords]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [searched, setSearched]       = useState(false)
  const [lastQuery, setLastQuery]     = useState('')
  const [error, setError]             = useState(null)

  // ── Scrap workflow state ──────────────────────────────────────────────────
  const [scrapMark, setScrapMark]     = useState(null)   // { serial, reason, created_at } | null
  const [scrapOpen, setScrapOpen]     = useState(false)
  const [scrapReason, setScrapReason] = useState('')
  const [scrapBusy, setScrapBusy]     = useState(false)
  const [scrapErr, setScrapErr]       = useState(null)
  // One named close, carrying the in-flight guard, because the dialog is closed
  // from four places: Escape, the backdrop, the X and Cancel. The guard matters
  // here specifically - closing mid-RPC would hide a scrap that is still being
  // written. `useCallback` is belt and braces: `useDialogBehavior` deliberately
  // holds `onClose` in a ref and keeps it out of its dependency array so a
  // re-created callback cannot steal focus from the reason textarea.
  const closeScrap = useCallback(() => { if (!scrapBusy) setScrapOpen(false) }, [scrapBusy])

  // ── Bulk Lookup state ─────────────────────────────────────────────────────
  const [bulkResults, setBulkResults]   = useState([])
  const [bulkLoading, setBulkLoading]   = useState(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.
  useEffect(() => { queryId.current++; setRecords([]); setBulkResults([]); setSearched(false); setLoading(false); setBulkLoading(false); setBulkDone(false); return () => { queryId.current++ } }, [activeCountry])
  const [bulkFileName, setBulkFileName] = useState('')
  const [bulkDragOver, setBulkDragOver] = useState(false)
  const [bulkDone, setBulkDone]         = useState(false)
  const [bulkSearch, setBulkSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState(null)
  const bulkFileRef = useRef(null)

  // ── Scrapped register (list) state ────────────────────────────────────────
  const [scrapList, setScrapList]       = useState([])
  const [scrapListLoad, setScrapListLoad] = useState(false)
  const [scrapListErr, setScrapListErr] = useState(null)
  const [scrapListSearch, setScrapListSearch] = useState('')
  const [editSerial, setEditSerial]     = useState(null)   // serial being reason-edited
  const [editReason, setEditReason]     = useState('')
  const [rowBusy, setRowBusy]           = useState(null)    // serial with an in-flight action

  async function loadScrapList() {
    setScrapListLoad(true)
    setScrapListErr(null)
    try {
      // Through the register RPC, not the bare marks: it resolves created_by to
      // a person, which is the trace this list was missing. Falls back to the
      // plain marks on a backend that predates it so the tab never goes blank.
      const res = await listScrappedTyres({})
      setScrapList(res.ok
        ? res.rows.map((r) => ({ ...r, created_at: r.scrapped_at }))
        : await listScrapMarks())
    } catch (err) {
      setScrapListErr(toUserMessage(err, 'Could not load scrapped tyres.'))
      setScrapList([])
    } finally {
      setScrapListLoad(false)
    }
  }

  async function undoScrapRow(serial) {
    setRowBusy(serial)
    setScrapListErr(null)
    try {
      await unscrapTyreBySerial(serial)
      setScrapList(prev => prev.filter(r => r.serial !== serial))
      if (lastQuery === serial) setScrapMark(null)
    } catch (err) {
      setScrapListErr(toUserMessage(err, 'Could not remove the scrap mark.'))
    } finally {
      setRowBusy(null)
    }
  }

  async function saveEditReason(serial) {
    setRowBusy(serial)
    setScrapListErr(null)
    try {
      await updateScrapReason(serial, editReason)
      const clean = editReason.trim() || null
      setScrapList(prev => prev.map(r => (r.serial === serial ? { ...r, reason: clean } : r)))
      if (lastQuery === serial && scrapMark) setScrapMark({ ...scrapMark, reason: clean })
      setEditSerial(null)
      setEditReason('')
    } catch (err) {
      setScrapListErr(toUserMessage(err, 'Could not update the reason.'))
    } finally {
      setRowBusy(null)
    }
  }

  const filteredScrapList = useMemo(() => filterScrapList(scrapList, scrapListSearch), [scrapList, scrapListSearch])
  const scrapSummary = useMemo(() => scrapRegisterSummary(scrapList), [scrapList])

  // ── Single search ─────────────────────────────────────────────────────────
  async function search() {
    if (!serialInput.trim()) return
    setLoading(true)
    setSearched(false)
    setError(null)
    const request = ++queryId.current
    setBulkLoading(false)
    const q = serialInput.trim()
    setScrapMark(null)
    setScrapErr(null)
    try {
      const data = await findSerialRecords(q, { country: activeCountry })
      if (request !== queryId.current) return
      setRecords(data || [])
      if ((data || []).length) {
        try { const mark = await getScrapMark(q); if (request === queryId.current) setScrapMark(mark) } catch { /* scrap flag is best-effort */ }
      }
    } catch (err) {
      if (request !== queryId.current) return
      setError(toUserMessage(err, 'Could not search for that serial.'))
      setRecords([])
    } finally {
      if (request !== queryId.current) return
      setLastQuery(q)
      setSearched(true)
      setLoading(false)
    }
  }

  // ── Mark / unmark scrap ────────────────────────────────────────────────────
  async function confirmScrap() {
    setScrapBusy(true)
    setScrapErr(null)
    try {
      const country = records[0]?.country || null
      await scrapTyreBySerial(lastQuery, { reason: scrapReason, country })
      setRecords(prev => prev.map(r => ({ ...r, status: 'Scrapped' })))
      setScrapMark({ serial: lastQuery, reason: scrapReason.trim() || null, created_at: new Date().toISOString() })
      setScrapOpen(false)
      setScrapReason('')
    } catch (err) {
      setScrapErr(toUserMessage(err, 'Could not mark this tyre as scrap.'))
    } finally {
      setScrapBusy(false)
    }
  }

  async function undoScrap() {
    setScrapBusy(true)
    setScrapErr(null)
    try {
      await unscrapTyreBySerial(lastQuery)
      setRecords(prev => prev.map(r => (r.status === 'Scrapped' ? { ...r, status: 'Active' } : r)))
      setScrapMark(null)
    } catch (err) {
      setScrapErr(toUserMessage(err, 'Could not remove the scrap mark.'))
    } finally {
      setScrapBusy(false)
    }
  }

  // All lifecycle maths live in serialTrackerAnalytics. `cost` was never a
  // tyre_records column, so the old sum always read zero; the price is now the
  // tyre's recorded per-tyre price, and null (N/A) when none was recorded.
  const stats = useMemo(() => serialStats(records), [records])
  const timeline = useMemo(() => serialTimeline(records), [records])

  // Lifecycle rows as exported: every record, with the price and dates
  // rendered, never a blank that reads as zero.
  const lifecycleRows = useMemo(() => records.map(r => ({
    issue_date: r.issue_date ? formatDate(r.issue_date) : 'N/A',
    removal_date: r.removal_date ? formatDate(r.removal_date) : 'N/A',
    asset_no: r.asset_no || 'N/A',
    site: r.site || 'N/A',
    position: r.position || r.tyre_position || 'N/A',
    brand: r.brand || 'N/A',
    description: r.description || 'N/A',
    risk_level: r.risk_level || 'N/A',
    status: r.status || 'N/A',
    price: recordPrice(r) == null ? 'N/A' : recordPrice(r),
    remarks: r.remarks || '',
  })), [records])

  function exportLifecyclePdf() {
    try {
      exportToPdf(
        lifecycleRows,
        [
          { key: 'issue_date',   header: 'Fitted' },
          { key: 'removal_date', header: 'Removed' },
          { key: 'asset_no',     header: 'Asset No' },
          { key: 'site',         header: 'Site' },
          { key: 'position',     header: 'Position' },
          { key: 'brand',        header: 'Brand' },
          { key: 'description',  header: 'Description' },
          { key: 'risk_level',   header: 'Risk' },
          { key: 'status',       header: 'Status' },
          { key: 'price',        header: 'Price per tyre' },
        ],
        `Serial Lifecycle: ${lastQuery}`,
        reportFileName('TyrePulse Serial', lastQuery),
        'landscape'
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  function exportLifecycleExcel() {
    try {
      exportToExcel(
        lifecycleRows,
        ['issue_date','removal_date','asset_no','site','position','brand','description','risk_level','status','price','remarks'],
        ['Fitted','Removed','Asset No','Site','Position','Brand','Description','Risk','Status','Price per tyre','Remarks'],
        reportFileName('TyrePulse Serial', lastQuery)
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const riskColor = r => {
    if (!r) return 'text-[var(--text-muted)]'
    const l = r.toLowerCase()
    if (l === 'critical') return 'text-red-400'
    if (l === 'high')     return 'text-orange-400'
    if (l === 'medium')   return 'text-yellow-400'
    return 'text-green-400'
  }

  // ── Bulk Lookup ───────────────────────────────────────────────────────────
  const SERIAL_HEADERS = ['serial_no', 'Serial No', 'Serial Number', 'serial']

  function extractSerialsFromSheet(wb, XLSX) {
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    if (rows.length === 0) return []
    const firstRow = rows[0]
    const matchedKey = SERIAL_HEADERS.find(h => h in firstRow)
    if (!matchedKey) return []
    const serials = rows.map(r => String(r[matchedKey] || '').trim()).filter(Boolean)
    return [...new Set(serials)]
  }

  async function processBulkFile(file) {
    const request = ++queryId.current
    setLoading(false)
    setBulkFileName(file.name)
    setBulkLoading(true)
    setBulkDone(false)
    setBulkResults([])
    setBulkSearch('')
    setStatusFilter(null)
    setError(null)

    try {
      const XLSX = await import('xlsx')
      if (request !== queryId.current) return
      const arrayBuffer = await file.arrayBuffer()
      const wb = XLSX.read(arrayBuffer, { type: 'array' })
      const serials = extractSerialsFromSheet(wb, XLSX)

      if (serials.length === 0) {
        setBulkLoading(false)
        setBulkDone(true)
        return
      }

      const results = []
      const BATCH_SIZE = 10

      for (let i = 0; i < serials.length; i += BATCH_SIZE) {
        if (request !== queryId.current) return
        const batch = serials.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async serial => {
            const data = await findSerialRecords(serial, { country: activeCountry, columns: 'serial_no, issue_date, removal_date, asset_no, site, status, country, cost:cost_per_tyre' })
            return summarizeBulkSerial(serial, data)
          })
        )
        results.push(...batchResults)
      }

      if (request !== queryId.current) return
      setBulkResults(results)
    } catch (err) {
      if (request !== queryId.current) return
      setError(toUserMessage(err, 'Could not process that file.'))
      setBulkResults([])
    } finally {
      if (request !== queryId.current) return
      setBulkLoading(false)
      setBulkDone(true)
    }
  }

  function handleBulkFileInput(e) {
    const file = e.target.files?.[0]
    if (file) processBulkFile(file)
  }

  function handleBulkDrop(e) {
    e.preventDefault()
    setBulkDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processBulkFile(file)
  }

  function exportBulkExcel() {
    try {
      exportToExcel(
        filteredBulkResults,
        ['serial', 'first_seen', 'last_asset', 'total_records', 'cost', 'status'],
        ['Serial No', 'First Seen', 'Last Asset', 'Records', 'Cost', 'Status'],
        reportFileName('TyrePulse Bulk Serial Lookup')
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  function exportBulkPdf() {
    try {
      exportToPdf(
        filteredBulkResults.map(r => ({
          serial: r.serial,
          first_seen: r.first_seen ? formatDate(r.first_seen) : 'N/A',
          last_asset: r.last_asset || 'N/A',
          total_records: r.total_records,
          cost: moneyFor(r.cost, r.country),
          status: r.status,
        })),
        [
          { key: 'serial', header: 'Serial No' },
          { key: 'first_seen', header: 'First Seen' },
          { key: 'last_asset', header: 'Last Asset' },
          { key: 'total_records', header: 'Records' },
          { key: 'cost', header: 'Price per tyre' },
          { key: 'status', header: 'Status' },
        ],
        'Bulk Serial Lookup',
        reportFileName('TyrePulse Bulk Serial Lookup'),
        'landscape'
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // The scrapped register exports the FILTERED list, never a page.
  const scrapExportRows = () => filteredScrapList.map(r => ({
    serial: r.serial,
    asset_no: r.asset_no || 'N/A',
    position: r.tyre_position || 'N/A',
    reason: r.reason || 'No reason given',
    scrapped_by: r.marked === false ? 'Not recorded' : (r.scrapped_by_name || 'Unknown user'),
    created_at: r.created_at ? formatDate(r.created_at) : 'N/A',
  }))
  const SCRAP_COLS = ['serial', 'asset_no', 'position', 'reason', 'scrapped_by', 'created_at']
  const SCRAP_HEADERS = ['Serial No', 'Asset', 'Position', 'Reason', 'Scrapped By', 'Scrapped On']
  function exportScrapExcel() {
    try {
      exportToExcel(scrapExportRows(), SCRAP_COLS, SCRAP_HEADERS, reportFileName('TyrePulse Scrapped Tyres'))
    } catch (err) {
      setScrapListErr(toUserMessage(err, 'Could not export. Try again.'))
    }
  }
  function exportScrapPdf() {
    try {
      exportToPdf(scrapExportRows(), SCRAP_COLS.map((k, i) => ({ key: k, header: SCRAP_HEADERS[i] })),
        'Scrapped Tyres', reportFileName('TyrePulse Scrapped Tyres'), 'landscape')
    } catch (err) {
      setScrapListErr(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const bulkSummary = useMemo(() => summarizeBulk(bulkResults), [bulkResults])

  const filteredBulkResults = useMemo(
    () => filterBulkResults(bulkResults, { status: statusFilter, query: bulkSearch }),
    [bulkResults, bulkSearch, statusFilter],
  )

  /**
   * ALL THREE LISTS ARE READ A PAGE AT A TIME by EnterpriseTable.
   *
   * A bulk lookup is a pasted file - it is routinely hundreds of serials - and
   * the scrapped register is the whole scrap history. Each table is handed the
   * FULL FILTERED list and pages + sorts it itself, so the status chips still
   * count `bulkResults`, the "N of M" captions still quote the filtered totals,
   * and every export writes every filtered row rather than one page.
   */
  const recordColumns = useMemo(() => [
    { id: 'issue_date', accessorFn: r => blankToUndef(r.issue_date), header: 'Fitted', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() ? formatDate(getValue()) : 'N/A' },
    { id: 'removal_date', accessorFn: r => blankToUndef(r.removal_date), header: 'Removed', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() ? formatDate(getValue()) : 'N/A' },
    { id: 'asset_no', accessorFn: r => blankToUndef(r.asset_no), header: 'Asset', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="font-mono text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'site', accessorFn: r => blankToUndef(r.site), header: 'Site', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'position', accessorFn: r => blankToUndef(r.position || r.tyre_position), header: 'Position', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="font-mono">{getValue() || 'N/A'}</span> },
    { id: 'risk_level', accessorFn: r => blankToUndef(r.risk_level), header: 'Risk', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className={riskColor(getValue())}>{getValue() || 'N/A'}</span> },
    { id: 'status', accessorFn: r => blankToUndef(r.status), header: 'Status', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'price', accessorFn: r => recordPrice(r) ?? undefined, header: 'Price per tyre', sortingFn: sortCompare, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ row, getValue }) => moneyFor(getValue() ?? null, row.original.country) },
  ], [])

  const bulkColumns = useMemo(() => [
    { accessorKey: 'serial', header: 'Serial No', sortingFn: sortCompare, cell: ({ getValue }) => <span className="font-mono text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'first_seen', accessorFn: r => blankToUndef(r.first_seen), header: 'First Seen', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() ? formatDate(getValue()) : 'N/A' },
    { id: 'last_asset', accessorFn: r => blankToUndef(r.last_asset), header: 'Last Asset', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="font-mono">{getValue() || 'N/A'}</span> },
    { accessorKey: 'total_records', header: 'Records', sortingFn: sortCompare, meta: { align: 'right' } },
    { id: 'cost', accessorFn: r => r.cost ?? undefined, header: 'Price per tyre', sortingFn: sortCompare, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ row, getValue }) => moneyFor(getValue() ?? null, row.original.country) },
    {
      accessorKey: 'status', header: 'Status', sortingFn: sortCompare,
      cell: ({ getValue }) => <span className={`text-xs px-2 py-0.5 rounded-full border ${BULK_TONE[getValue()] || BULK_TONE.Retired}`}>{getValue()}</span>,
    },
  ], [])

  const scrapColumns = useMemo(() => [
    { accessorKey: 'serial', header: 'Serial No', sortingFn: sortCompare, cell: ({ getValue }) => <span className="font-mono text-[var(--text-primary)]">{getValue()}</span> },
    {
      id: 'asset_no', accessorFn: r => blankToUndef(r.asset_no), header: 'Asset', sortingFn: sortCompare, sortUndefined: 'last',
      cell: ({ row, getValue }) => (
        <span className="whitespace-nowrap">
          {getValue() || <span className="text-[var(--text-muted)]">N/A</span>}
          {row.original.tyre_position ? <span className="text-xs text-[var(--text-muted)] ml-1.5">{row.original.tyre_position}</span> : null}
        </span>
      ),
    },
    {
      id: 'reason', accessorFn: r => blankToUndef(r.reason), header: 'Reason', sortingFn: sortCompare, sortUndefined: 'last', size: 260,
      cell: ({ row }) => {
        const r = row.original
        return editSerial === r.serial ? (
          <div className="flex flex-col gap-2 min-w-[220px]">
            <label className="sr-only" htmlFor={`reason-${r.serial}`}>Reason for {r.serial}</label>
            <textarea
              id={`reason-${r.serial}`}
              className="input w-full text-sm min-h-[52px]"
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              placeholder="Reason (optional)"
            />
            <div className="flex gap-2">
              <button onClick={() => saveEditReason(r.serial)} disabled={rowBusy === r.serial}
                className="btn-primary text-xs px-3 min-h-[36px] disabled:opacity-50">
                {rowBusy === r.serial ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditSerial(null); setEditReason('') }} disabled={rowBusy === r.serial}
                className="btn-secondary text-xs px-3 min-h-[36px] disabled:opacity-50">Cancel</button>
            </div>
          </div>
        ) : (
          <span className={r.reason ? '' : 'text-[var(--text-muted)] italic'}>{r.reason || 'No reason given'}</span>
        )
      },
    },
    {
      id: 'scrapped_by', header: 'Scrapped By', sortingFn: sortCompare, sortUndefined: 'last',
      accessorFn: r => (r.marked === false ? 'Not recorded' : blankToUndef(r.scrapped_by_name)),
      // A row with marked === false was bulk-scrapped from the tyre grid, which
      // saves no name. Say so rather than leave a blank that reads like missing data.
      cell: ({ row }) => row.original.marked === false
        ? <span className="text-amber-400 text-xs">Not recorded</span>
        : <span className="text-xs">{row.original.scrapped_by_name || 'Unknown user'}</span>,
    },
    { id: 'created_at', accessorFn: r => blankToUndef(r.created_at), header: 'Scrapped On', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="text-xs whitespace-nowrap">{getValue() ? formatDate(getValue()) : 'N/A'}</span> },
    {
      id: 'actions', header: 'Actions', enableSorting: false, meta: { align: 'right', export: false },
      cell: ({ row }) => {
        const r = row.original
        if (editSerial === r.serial) return <span className="text-xs text-[var(--text-muted)]">Editing...</span>
        if (!canScrap && !canUndo) return <span className="text-xs text-[var(--text-muted)]">View only</span>
        return (
          <div className="inline-flex gap-2 whitespace-nowrap">
            {canScrap && (
              <button onClick={() => { setEditSerial(r.serial); setEditReason(r.reason || '') }}
                disabled={rowBusy === r.serial}
                className="btn-secondary text-xs px-2.5 min-h-[36px] disabled:opacity-50">Edit reason</button>
            )}
            {canUndo && (
              <button onClick={() => undoScrapRow(r.serial)} disabled={rowBusy === r.serial}
                className="flex items-center gap-1 text-xs px-2.5 min-h-[36px] rounded-md font-medium border border-green-700/50 bg-green-900/20 text-green-400 hover:bg-green-900/40 transition-colors disabled:opacity-50">
                <RotateCcw size={12} aria-hidden="true" /> {rowBusy === r.serial ? 'Working...' : 'Undo scrap'}
              </button>
            )}
          </div>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- row handlers are recreated each render; the edit/busy state they read is listed.
  ], [editSerial, editReason, rowBusy, canScrap, canUndo, lastQuery, scrapMark])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Serial Tracker"
        subtitle="Search a tyre by serial number, trace its history, and mark it as scrap"
        icon={ScanLine}
      />

      <div className="flex flex-wrap gap-1 p-1 bg-[var(--surface-2)] rounded-lg w-fit max-w-full" role="tablist" aria-label="Serial tracker views">
        {[['single', 'Single Search'], ['bulk', 'Bulk Lookup'], ['scrapped', 'Scrapped']].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => { setActiveTab(key); if (key === 'scrapped') loadScrapList() }}
            className={`min-h-[44px] px-4 rounded-md text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              activeTab === key ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Single Search tab ──────────────────────────────────────────────── */}
      {activeTab === 'single' && (
        <>
          {/* Deliberately NOT clipped: this is the page's search control. */}
          <Card>
            <div className="flex flex-col sm:flex-row gap-3">
              <label htmlFor="serial-search" className="sr-only">Serial number</label>
              <input
                id="serial-search"
                type="search"
                className="input flex-1 text-base min-h-[44px]"
                placeholder="Enter a serial number"
                value={serialInput}
                onChange={e => setSerialInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
              />
              <button onClick={search} disabled={loading || !serialInput.trim()}
                className="btn-primary flex items-center justify-center gap-2 px-5 min-h-[44px] disabled:opacity-50">
                <Search size={16} />
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </Card>

          {loading && <SearchSkeleton />}

          {!loading && error && (
            /* Card is flex-col by default and Tailwind emits .flex-col after
               .flex-row, so a row-direction card sets its direction through
               `style`, where Card spreads it last and it deterministically wins. */
            <Card tone="crit" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-400 flex-1">{error}</p>
              <button onClick={search} className="btn-secondary text-xs px-3 min-h-[44px]">Retry</button>
            </Card>
          )}

          {!loading && !error && searched && records.length === 0 && (
            <Card>
              <EmptyState
                illustration="state/search-empty"
                icon={ScanLine}
                title="No records found"
                description={`No tyre records match serial "${lastQuery}" in the selected country. Check the spelling, or switch the country scope.`}
              />
            </Card>
          )}

          {!loading && stats && (
            <>
              <Card>
                <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-2xl font-bold font-mono text-[var(--text-primary)]">{lastQuery}</span>
                      {scrapMark ? (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium border bg-red-900/30 text-red-400 border-red-700/50 flex items-center gap-1">
                          <Trash2 size={12} /> Scrapped
                        </span>
                      ) : (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                          stats.active
                            ? 'bg-green-900/30 text-green-400 border-green-700/50'
                            : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                        }`}>
                          {stats.active ? 'Active' : 'Retired'}
                        </span>
                      )}
                    </div>
                    {(stats.brand || stats.description) && (
                      <p className="text-[var(--text-secondary)] text-sm">{[stats.brand, stats.description].filter(Boolean).join(' · ')}</p>
                    )}
                    {scrapMark && (
                      <p className="text-xs text-red-400/80 mt-1">
                        Scrapped {formatDate(scrapMark.created_at)}{scrapMark.reason ? ` · ${scrapMark.reason}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {/* Undo is admin only, marking is not, so they are gated
                        separately rather than by one flag. */}
                    {scrapMark ? (canUndo && (
                      <button onClick={undoScrap} disabled={scrapBusy}
                        className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
                        <RotateCcw size={14} /> {scrapBusy ? 'Working...' : 'Undo scrap'}
                      </button>
                    )) : (canScrap && (
                      <button onClick={() => { setScrapErr(null); setScrapReason(''); setScrapOpen(true) }}
                        className="flex items-center gap-1.5 text-sm px-3 min-h-[44px] rounded-md font-medium border border-red-700/50 bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors">
                        <Trash2 size={14} /> Mark as Scrap
                      </button>
                    ))}
                    <button onClick={exportLifecycleExcel} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px]">
                      <FileSpreadsheet size={14} aria-hidden="true" /> Excel
                    </button>
                    <button onClick={exportLifecyclePdf} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px]">
                      <FileText size={14} /> PDF
                    </button>
                  </div>
                </div>
                {scrapErr && (
                  <div className="mb-3 -mt-1 flex items-center gap-2 text-sm text-red-400">
                    <AlertTriangle size={14} className="shrink-0" /> {scrapErr}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'First Used',      value: stats.first.issue_date ? formatDate(stats.first.issue_date) : 'N/A' },
                    { label: 'Total Records',   value: stats.records },
                    { label: 'Vehicles Used',   value: stats.assets },
                    { label: 'Sites',           value: stats.sites },
                    { label: 'Days in Service', value: stats.days == null ? 'N/A' : stats.days.toLocaleString() },
                    { label: 'Price per tyre',  value: moneyFor(stats.price, stats.country) },
                  ].map(s => (
                    <div key={s.label} className="bg-[var(--surface-2)] rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums">{s.value}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-3">
                  {stats.price == null
                    ? 'No purchase price is recorded on any record of this tyre.'
                    : `Price taken from the latest priced record (${stats.pricedRecords} of ${stats.records} records carry a price). Moves are not summed: one tyre is bought once.`}
                </p>
              </Card>

              <Card>
                <CardHeader level={2} title="Record history" description={`All ${stats.records} tyre record${stats.records !== 1 ? 's' : ''} for this serial. Sort any column.`} />
                <EnterpriseTable
                  columns={recordColumns}
                  data={records}
                  getRowId={r => String(r.id)}
                  enableColumnFilters={false}
                  enableExport={false}
                  enableKeyboard={false}
                  initialPageSize={25}
                  searchPlaceholder="Search this tyre's records"
                  emptyMessage="No records."
                />
              </Card>

              <Card>
                <CardHeader level={2} title="Service Timeline" />
                <div className="space-y-4">
                  {timeline.map((group, gi) => (
                    <div key={gi}>
                      {gi > 0 && (
                        <div className="flex items-center gap-2 py-1 px-3 rounded-md text-xs text-blue-400 bg-blue-900/20 border border-blue-800/40 mb-3 w-fit">
                          Transferred to {group.asset || 'unknown'}
                        </div>
                      )}
                      <div className="mb-1">
                        <span className="text-sm font-semibold text-[var(--text-primary)] font-mono">{group.asset || 'Unknown Asset'}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-2">{group.records.length} record{group.records.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-2 pl-3 border-l border-[var(--border-bright)]">
                        {group.records.map(r => (
                          <div key={r.id} className="flex items-start gap-3 py-2">
                            <div className="text-xs font-mono text-[var(--text-muted)] w-24 flex-shrink-0 pt-0.5">{formatDate(r.issue_date)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                <span className="text-[var(--text-secondary)]">{r.site || 'N/A'}</span>
                                {r.position && <span className="text-[var(--text-muted)]">Pos: <span className="text-[var(--text-primary)] font-mono">{r.position}</span></span>}
                                {r.risk_level && <span className={riskColor(r.risk_level)}>{r.risk_level}</span>}
                                {recordPrice(r) != null && <span className="text-[var(--text-muted)]">{moneyFor(recordPrice(r), r.country)}</span>}
                              </div>
                              {r.description && <p className="text-xs text-[var(--text-dim)] mt-0.5 truncate">{r.description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </>
      )}

      {/* ── Bulk Lookup tab ────────────────────────────────────────────────── */}
      {activeTab === 'bulk' && (
        <div className="space-y-4">
          {/* The whole surface is the drop target and is genuinely clickable, so
              it takes `interactive`. Card sets `border` INLINE and inline beats a
              class, so the dashed drop affordance is set through `style` - a
              `border-2 border-dashed` class here would be silently dead. */}
          <Card
            interactive
            className="transition-all cursor-pointer"
            style={{
              border: bulkDragOver ? '2px dashed rgb(34 197 94)' : '2px dashed var(--border-bright)',
              ...(bulkDragOver ? { background: 'rgba(20, 83, 45, 0.10)' } : {}),
            }}
            onDragOver={e => { e.preventDefault(); setBulkDragOver(true) }}
            onDragLeave={() => setBulkDragOver(false)}
            onDrop={handleBulkDrop}
            onClick={() => bulkFileRef.current?.click()}
          >
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleBulkFileInput}
            />
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center pointer-events-none">
              <Upload size={32} className={bulkDragOver ? 'text-green-400' : 'text-[var(--text-muted)]'} />
              <p className="text-[var(--text-primary)] font-medium">
                {bulkFileName ? bulkFileName : 'Drop an Excel or CSV file here'}
              </p>
              <p className="text-[var(--text-muted)] text-sm">
                File must have a column: <span className="font-mono text-[var(--text-secondary)]">serial_no</span>, <span className="font-mono text-[var(--text-secondary)]">Serial No</span>, <span className="font-mono text-[var(--text-secondary)]">Serial Number</span>, or <span className="font-mono text-[var(--text-secondary)]">serial</span>
              </p>
              <button
                className="btn-secondary text-sm px-4 min-h-[44px] pointer-events-auto"
                onClick={e => { e.stopPropagation(); bulkFileRef.current?.click() }}
              >
                Browse File
              </button>
            </div>
          </Card>

          {/* `py-10` would be DEAD on a Card - Card sets padding inline and
              inline beats a class - so the state's breathing room is a spacing
              token instead. */}
          {bulkLoading && (
            <Card className="text-center" style={{ paddingBlock: 'var(--space-10)' }}>
              <div className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-[var(--text-secondary)]">Processing serial numbers...</p>
            </Card>
          )}

          {error && !bulkLoading && (
            <Card tone="crit" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
              <AlertTriangle size={18} className="text-red-400 shrink-0" aria-hidden="true" />
              <p className="text-sm text-red-400 flex-1">{error}</p>
              <button onClick={() => bulkFileRef.current?.click()} className="btn-secondary text-xs px-3 min-h-[44px]">Choose file again</button>
            </Card>
          )}

          {bulkDone && !bulkLoading && !error && (
            <>
              {bulkSummary && (
                <div className="rounded-xl px-5 py-4 space-y-3"
                  style={{ background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.3)' }}>
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Found',   value: bulkSummary.total,    key: null,         active: statusFilter === null, color: 'green' },
                        { label: 'Active',  value: bulkSummary.active,   key: 'Active',     active: statusFilter === 'Active',   color: 'emerald' },
                        { label: 'Retired', value: bulkSummary.retired,  key: 'Retired',    active: statusFilter === 'Retired',  color: 'gray' },
                        { label: 'Scrapped', value: bulkSummary.scrapped, key: 'Scrapped',  active: statusFilter === 'Scrapped',  color: 'red' },
                        { label: 'Missing', value: bulkSummary.notFound, key: 'Not Found',  active: statusFilter === 'Not Found', color: 'red' },
                      ].map(chip => (
                        <button
                          key={chip.label}
                          aria-pressed={chip.active}
                          onClick={() => setStatusFilter(chip.active && chip.key !== null ? null : chip.key)}
                          className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-sm font-medium border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            chip.active && chip.key === null
                              ? 'bg-green-900/40 text-green-300 border-green-600/50'
                              : chip.active
                                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] border-gray-500'
                                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)] hover:border-gray-500 hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className={`text-base font-bold ${
                            chip.label === 'Found'   ? 'text-green-400' :
                            chip.label === 'Active'  ? 'text-emerald-400' :
                            chip.label === 'Missing' || chip.label === 'Scrapped' ? 'text-red-400' : 'text-[var(--text-secondary)]'
                          }`}>{chip.value}</span>
                          <span>{chip.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                        <input
                          type="search"
                          aria-label="Filter bulk results"
                          className="input text-sm pl-7 pr-3 min-h-[44px] w-44"
                          placeholder="Filter results..."
                          value={bulkSearch}
                          onChange={e => setBulkSearch(e.target.value)}
                        />
                      </div>
                      <button onClick={exportBulkExcel} disabled={filteredBulkResults.length === 0} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
                        <FileSpreadsheet size={14} aria-hidden="true" /> Excel
                      </button>
                      <button onClick={exportBulkPdf} disabled={filteredBulkResults.length === 0} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
                        <FileText size={14} aria-hidden="true" /> PDF
                      </button>
                    </div>
                  </div>
                  {(statusFilter || bulkSearch.trim()) && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Showing {filteredBulkResults.length} of {bulkResults.length} results
                      {statusFilter && <> · filtered by <span className="text-[var(--text-secondary)]">{statusFilter}</span></>}
                      {bulkSearch.trim() && <> · matching <span className="text-[var(--text-secondary)]">"{bulkSearch}"</span></>}
                      <button onClick={() => { setStatusFilter(null); setBulkSearch('') }} className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Clear</button>
                    </p>
                  )}
                </div>
              )}

              {bulkResults.length === 0 ? (
                <Card>
                  <EmptyState
                    illustration="state/search-empty"
                    icon={FileText}
                    title="No serials found"
                    description="No serial numbers could be extracted from the file. Check that it has a recognised column header."
                  />
                </Card>
              ) : filteredBulkResults.length === 0 ? (
                <Card className="text-center" style={{ paddingBlock: 'var(--space-10)' }}>
                  <p className="text-[var(--text-secondary)]">No results match the current filter.</p>
                  <button onClick={() => { setStatusFilter(null); setBulkSearch('') }} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline mt-1">Clear filters</button>
                </Card>
              ) : (
                <Card>
                  <EnterpriseTable
                    columns={bulkColumns}
                    data={filteredBulkResults}
                    getRowId={r => r.serial}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    initialPageSize={50}
                    emptyMessage="No results match the current filter."
                  />
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Scrapped register tab ──────────────────────────────────────────── */}
      {activeTab === 'scrapped' && (
        <div className="space-y-4">
          {/* Deliberately NOT clipped: this card hosts the filter input. */}
          <Card>
            <CardHeader
              level={2}
              title="Scrapped tyres"
              description={<>
                {scrapListLoad ? 'Loading...' : `${scrapList.length} tyre${scrapList.length !== 1 ? 's' : ''} marked as scrap`}
                {canUndo ? ' · edit the reason or undo a mistaken scrap'
                  : canScrap ? ' · edit the reason' : ''}
              </>}
              actions={
                <>
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Filter scrapped tyres"
                      className="input text-sm pl-7 pr-3 min-h-[44px] w-48"
                      placeholder="Filter serial / reason..."
                      value={scrapListSearch}
                      onChange={e => setScrapListSearch(e.target.value)}
                    />
                  </div>
                  <button onClick={exportScrapExcel} disabled={scrapListLoad || !!scrapListErr || filteredScrapList.length === 0}
                    className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
                    <FileSpreadsheet size={14} aria-hidden="true" /> Excel
                  </button>
                  <button onClick={exportScrapPdf} disabled={scrapListLoad || !!scrapListErr || filteredScrapList.length === 0}
                    className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
                    <FileText size={14} aria-hidden="true" /> PDF
                  </button>
                  <button onClick={loadScrapList} disabled={scrapListLoad}
                    className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
                    <RotateCcw size={14} aria-hidden="true" /> Refresh
                  </button>
                </>
              }
            />
            <CardBody>
              {!canScrap ? (
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <AlertTriangle size={12} /> You can view scrapped tyres. Marking one as scrap needs the tyre scrap permission, which an admin grants in Access Control.
                </p>
              ) : !canUndo ? (
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <AlertTriangle size={12} /> You can mark a tyre as scrap and edit the reason. Undoing a scrap is an administrator action.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {/* KPI strip. A failed read shows N/A, never zeros. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Scrapped tyres', value: scrapSummary.total, icon: Trash2, sub: 'marked as scrap' },
              { label: 'Last 30 days', value: scrapSummary.last30, icon: CalendarClock, sub: 'newly scrapped' },
              { label: 'With a reason', value: scrapSummary.reasonRate == null ? 'N/A' : `${Math.round(scrapSummary.reasonRate * 100)}%`, icon: ClipboardList, sub: `${scrapSummary.withReason} of ${scrapSummary.total}` },
              { label: 'No actor recorded', value: scrapSummary.unattributed, icon: UserX, sub: 'bulk-scrapped from the tyre grid' },
            ].map(k => (
              <Card key={k.label}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                  <k.icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">{scrapListLoad ? '...' : scrapListErr ? 'N/A' : k.value}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>
              </Card>
            ))}
          </div>

          {scrapListErr && (
            <Card tone="crit" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-400 flex-1">{scrapListErr}</p>
              <button onClick={loadScrapList} className="btn-secondary text-xs px-3 min-h-[44px]">Retry</button>
            </Card>
          )}

          {scrapListLoad ? (
            <Card className="text-center" style={{ paddingBlock: 'var(--space-10)' }}>
              <div className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-[var(--text-secondary)]">Loading scrapped tyres...</p>
            </Card>
          ) : scrapListErr ? null : scrapList.length === 0 ? (
            <Card>
              <EmptyState
                illustration="state/search-empty"
                icon={Trash2}
                title="No scrapped tyres"
                description="Tyres you mark as scrap from Single Search will appear here."
              />
            </Card>
          ) : filteredScrapList.length === 0 ? (
            <Card className="text-center" style={{ paddingBlock: 'var(--space-10)' }}>
              <p className="text-[var(--text-secondary)]">No scrapped tyres match "{scrapListSearch}".</p>
              <button onClick={() => setScrapListSearch('')} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline mt-1">Clear filter</button>
            </Card>
          ) : (
            <Card>
              <EnterpriseTable
                columns={scrapColumns}
                data={filteredScrapList}
                getRowId={r => r.serial}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                enableKeyboard={false}
                initialPageSize={50}
                emptyMessage="No scrapped tyres match this filter."
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Scrap confirmation modal ─────────────────────────────────────────
          No <form> here, so the actions belong in the Modal footer. The scrap
          RPC call itself is untouched. */}
      {scrapOpen && (
        <Modal
          open
          onClose={closeScrap}
          title="Mark tyre as scrap"
          subtitle={lastQuery}
          size="sm"
          footer={
            <>
              <button onClick={closeScrap} disabled={scrapBusy} className="btn-secondary text-sm px-4 min-h-[44px] disabled:opacity-50">Cancel</button>
              <button onClick={confirmScrap} disabled={scrapBusy}
                className="flex items-center gap-1.5 text-sm px-4 min-h-[44px] rounded-md font-medium border border-red-700/50 bg-red-600/80 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                <Trash2 size={14} /> {scrapBusy ? 'Marking...' : 'Confirm scrap'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 rounded-lg bg-red-900/30 text-red-400 shrink-0"><Trash2 size={18} /></div>
            <p className="text-sm text-[var(--text-secondary)]">
              This flags the tyre and all {records.length} of its record{records.length !== 1 ? 's' : ''} as Scrapped, removing it from active and pool counts. You can undo this later.
            </p>
          </div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="scrap-reason">Reason (optional)</label>
          <textarea
            id="scrap-reason"
            className="input w-full text-sm min-h-[72px]"
            placeholder="e.g. Worn beyond limit, sidewall damage, retread failed..."
            value={scrapReason}
            onChange={e => setScrapReason(e.target.value)}
          />
          {scrapErr && (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle size={14} className="shrink-0" /> {scrapErr}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
