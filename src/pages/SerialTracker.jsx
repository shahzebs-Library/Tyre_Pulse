/**
 * SerialTracker (route /serial-tracker) - track and trace tyre serial numbers,
 * rebuilt on the shared page kit to the owner's light reference design.
 *
 * Layout: hero with "Scan Serial Number" (a keyboard-wedge / typed entry, no
 * camera), six KPI tiles from exact server counts, a server-paged serial
 * register with filters, a details rail for the selected serial (status,
 * identity, current assignment, photos, scrap actions, exports), movement
 * history and tyre life and usage.
 *
 * Kept from the previous page: single serial search (escaped ilike, padding
 * tolerant), bulk lookup from Excel/CSV with status chips and exports, the
 * scrapped register with Edit reason / Undo scrap, the scrap badge, and the
 * server-decided scrap rights (tyre_scrap_allowed / tyre_unscrap_allowed via
 * scrap_tyre_by_serial / unscrap_tyre_by_serial).
 *
 * Honest gaps: tyre_records carries no pattern, load index, speed rating, DOT,
 * manufacturing date, temperature, fitter name, stock or repair status. Those
 * blocks say "N/A" or "not recorded" rather than inventing a value. A serial is
 * not a unique tyre id: the register lists fitment records.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ScanLine, Search, FileText, Upload, AlertTriangle, Trash2, RotateCcw, FileSpreadsheet,
  ClipboardList, UserX, CalendarClock, Hash, CheckCircle2, Package, Wrench, Ban,
  EyeOff, Eye, ExternalLink, X, ImageOff, ArrowRight, QrCode,
} from 'lucide-react'
import { findSerialRecords, listSerialRegister, getSerialKpis, listSizeOptions } from '../lib/api/serialTracker'
import { listFilterOptions } from '../lib/api/tyreRecords'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  Card, CardState, Kpi, PageHero, Pager, KitTable, Tabs, VehicleThumb, useCard, fmtInt,
} from '../components/commandCenter/kit'
import { toUserMessage } from '../lib/safeError'
import { safeImageSrc } from '../lib/safeUrl'
import { resolveStorageUrls } from '../lib/storageRefs'
import { useAuth } from '../contexts/AuthContext'
import { scrapTyreBySerial, unscrapTyreBySerial, getScrapMark, listScrapMarks, listScrappedTyres, updateScrapReason, getScrapPermissions } from '../lib/api/tyreExchange'
import { COUNTRY_CURRENCY } from '../lib/api/assetMaster'
import {
  serialStats, summarizeBulkSerial, bulkSummary as summarizeBulk,
  filterBulkResults, filterScrapList, scrapRegisterSummary, recordPrice,
} from '../lib/serialTrackerAnalytics'
import {
  STATUS_OPTIONS, statusMeta, cleanSerial, sameSerial, currentAssignment, historyEvents,
  filterEvents, eventCounts, HISTORY_TABS, USAGE_TABS, lifeUsage, sparkPath, recordPhotos,
} from '../lib/serialTrackerView'
import { compareValues } from '../lib/consoleTable'
import './SerialTracker.css'

// EnterpriseTable sorts through the shared console comparator, so blanks sort
// last and numeric strings compare as numbers on every column.
const sortCompare = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const moneyFor = (n, country) => (n == null ? 'N/A' : formatCurrencyCompact(n, COUNTRY_CURRENCY[country] || 'SAR'))
const fmtKm = (n) => (n == null ? 'N/A' : `${Math.round(n).toLocaleString('en-US')} km`)
const dateOrNA = (v) => (v ? formatDate(v) : 'N/A')

const BULK_TONE = { 'Not Found': 'muted', Active: 'good', Scrapped: 'bad', Retired: 'muted' }
const REGISTER_PAGE_SIZES = [10, 25, 50]

/** Plain tyre glyph: an illustration, never presented as a photo of the tyre. */
function TyreGlyph({ size = 30 }) {
  return (
    <svg className="st-tyre" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="#1f2937" />
      <circle cx="20" cy="20" r="18" fill="none" stroke="#4b5563" strokeWidth="2" strokeDasharray="3 2.4" />
      <circle cx="20" cy="20" r="9" fill="#9ca3af" />
      <circle cx="20" cy="20" r="3.2" fill="#374151" />
    </svg>
  )
}

function StatusPill({ status, scrapped }) {
  const m = statusMeta(status, { scrapped })
  return <span className={`cc-pill ${m.tone}`}>{m.label}</span>
}

function Field({ label, children }) {
  return (
    <div className="st-field">
      <dt>{label}</dt>
      <dd>{children ?? <span className="cc-na">N/A</span>}</dd>
    </div>
  )
}

/** Small line chart for one usage series. Draws nothing below two points. */
function UsageChart({ points, unit }) {
  const W = 320; const H = 130
  const geo = sparkPath(points, { width: W, height: H, pad: 14 })
  if (!geo) return null
  const area = `${geo.coords[0][0]},${H - 14} ${geo.line} ${geo.coords[geo.coords.length - 1][0]},${H - 14}`
  return (
    <svg className="st-chart" viewBox={`0 0 ${W} ${H + 18}`} role="img"
      aria-label={points.map((p) => `${formatDate(p.date)} ${p.value} ${unit}`).join(', ')}>
      <line x1="14" x2={W - 14} y1={H - 14} y2={H - 14} className="st-axis" />
      <polygon points={area} className="st-area" />
      <polyline points={geo.line} className="st-line" />
      {geo.coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" className="st-dot" />)}
      <text x="14" y="10" className="st-axis-label">{Math.round(geo.max).toLocaleString('en-US')} {unit}</text>
      <text x="14" y={H + 12} className="st-axis-label">{formatDate(points[0].date)}</text>
      <text x={W - 14} y={H + 12} textAnchor="end" className="st-axis-label">{formatDate(points[points.length - 1].date)}</text>
    </svg>
  )
}

/** Scan entry: a handheld scanner types into the focused box and sends Enter. */
function ScanModal({ onClose, onSubmit }) {
  const [value, setValue] = useState('')
  const input = useRef(null)
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 30); return () => clearTimeout(t) }, [])
  const submit = () => { const v = cleanSerial(value); if (v) onSubmit(v) }
  return (
    <Modal open onClose={onClose} title="Scan serial number" size="sm"
      footer={<>
        <button type="button" className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50" disabled={!cleanSerial(value)} onClick={submit}><Search size={14} aria-hidden="true" /> Find tyre</button>
      </>}>
      <p className="text-sm text-[var(--text-secondary)] mb-3">
        Scan the serial barcode with a handheld scanner, or type the serial and press Enter.
      </p>
      <label className="st-scan">
        <Hash size={18} aria-hidden="true" />
        <input ref={input} type="text" autoComplete="off" spellCheck={false} aria-label="Serial number"
          placeholder="Serial number" value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
      </label>
    </Modal>
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

  const [activeTab, setActiveTab] = useState('register')

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
  async function search(serialArg) {
    const q = cleanSerial(typeof serialArg === 'string' ? serialArg : serialInput)
    if (!q) return
    setSerialInput(q)
    setLoading(true)
    setSearched(false)
    setError(null)
    const request = ++queryId.current
    setBulkLoading(false)
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
      cell: ({ getValue }) => <span className={`cc-pill ${BULK_TONE[getValue()] || 'muted'}`}>{getValue()}</span>,
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
                className="cc-btn-primary">
                {rowBusy === r.serial ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditSerial(null); setEditReason('') }} disabled={rowBusy === r.serial}
                className="cc-btn-ghost">Cancel</button>
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
                className="cc-btn-ghost">Edit reason</button>
            )}
            {canUndo && (
              <button onClick={() => undoScrapRow(r.serial)} disabled={rowBusy === r.serial}
                className="cc-btn-ghost">
                <RotateCcw size={12} aria-hidden="true" /> {rowBusy === r.serial ? 'Working...' : 'Undo scrap'}
              </button>
            )}
          </div>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- row handlers are recreated each render; the edit/busy state they read is listed.
  ], [editSerial, editReason, rowBusy, canScrap, canUndo, lastQuery, scrapMark])


  // ── Serial register (server paged) ────────────────────────────────────────
  const [scanOpen, setScanOpen] = useState(false)
  const [regSearch, setRegSearch] = useState('')
  const [regSearchDebounced, setRegSearchDebounced] = useState('')
  const [brand, setBrand] = useState('')
  const [size, setSize] = useState('')
  const [status, setStatus] = useState('')
  const [site, setSite] = useState('')
  const [regPage, setRegPage] = useState(0)
  const [regSize, setRegSize] = useState(10)
  const [historyTab, setHistoryTab] = useState('all')
  const [usageTab, setUsageTab] = useState('km')
  const [photoUrls, setPhotoUrls] = useState({ loading: false, urls: [] })

  useEffect(() => {
    const t = setTimeout(() => setRegSearchDebounced(regSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [regSearch])
  // Any filter change starts the register from its first page.
  useEffect(() => { setRegPage(0) }, [regSearchDebounced, brand, size, status, site, regSize, activeCountry])

  const kpis = useCard(() => getSerialKpis(activeCountry), [activeCountry])
  const options = useCard(async () => {
    const [f, sizes] = await Promise.all([listFilterOptions(activeCountry), listSizeOptions(activeCountry)])
    return { brands: f.brands, sites: f.sites, sizes }
  }, [activeCountry])
  const register = useCard(
    () => listSerialRegister({ page: regPage, pageSize: regSize, search: regSearchDebounced, brand, size, status, site, country: activeCountry }),
    [regPage, regSize, regSearchDebounced, brand, size, status, site, activeCountry],
  )
  const regRows = register.data?.rows || []
  const regTotal = register.data?.total ?? 0
  const filtersOn = !!(regSearch || brand || size || status || site)
  const clearFilters = () => { setRegSearch(''); setBrand(''); setSize(''); setStatus(''); setSite('') }

  // Open the first serial of the register once, so the details rail is never blank on arrival.
  const autoPicked = useRef(false)
  useEffect(() => { autoPicked.current = false }, [activeCountry])
  useEffect(() => {
    if (autoPicked.current || lastQuery || loading) return
    const first = regRows.find((r) => cleanSerial(r.serial_no))
    if (first) { autoPicked.current = true; search(first.serial_no) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- search reads current state; only a new register page should trigger this.
  }, [regRows])

  function openSerial(serial) {
    const s = cleanSerial(serial)
    if (!s) return
    setHistoryTab('all')
    search(s)
  }

  const assignment = useMemo(() => currentAssignment(records), [records])
  const usage = useMemo(() => lifeUsage(records), [records])
  const events = useMemo(() => historyEvents(records, { scrapMark }), [records, scrapMark])
  const counts = useMemo(() => eventCounts(events), [events])
  const shownEvents = useMemo(() => filterEvents(events, historyTab), [events, historyTab])
  const photoRefs = useMemo(() => recordPhotos(records), [records])

  useEffect(() => {
    let cancelled = false
    if (!photoRefs.length) { setPhotoUrls({ loading: false, urls: [] }); return undefined }
    setPhotoUrls({ loading: true, urls: [] })
    resolveStorageUrls(photoRefs)
      .then((urls) => { if (!cancelled) setPhotoUrls({ loading: false, urls: urls.map(safeImageSrc).filter(Boolean) }) })
      .catch(() => { if (!cancelled) setPhotoUrls({ loading: false, urls: [] }) })
    return () => { cancelled = true }
  }, [photoRefs])

  const k = kpis.data
  const registerColumns = [
    { key: 'n', header: '#', sortable: false, cell: (r) => <span className="st-muted">{regPage * regSize + regRows.indexOf(r) + 1}</span> },
    { key: 'tyre', header: '', sortable: false, cell: () => <TyreGlyph size={28} /> },
    {
      key: 'serial_no', header: 'Serial number', cell: (r) => {
        const s = cleanSerial(r.serial_no)
        if (!s) return <span className="cc-na">No serial</span>
        return (
          <button type="button" className={`st-serial ${sameSerial(s, lastQuery) ? 'is-active' : ''}`} onClick={(e) => { e.stopPropagation(); openSerial(s) }}>
            {s}
          </button>
        )
      },
    },
    { key: 'brand', header: 'Tyre brand', cell: (r) => r.brand || <span className="cc-na">N/A</span> },
    { key: 'size', header: 'Size', cell: (r) => r.size || <span className="cc-na">N/A</span> },
    {
      key: 'asset_no', header: 'Vehicle / asset', cell: (r) => r.asset_no ? (
        <span className="cc-vehicle">
          <VehicleThumb row={r} size="sm" />
          <span><span className="cc-strong">{r.asset_no}</span><span className="cc-sub">{r.vehicle_type || 'Type not recorded'}</span></span>
        </span>
      ) : <span className="cc-na">Not fitted</span>,
    },
    { key: 'site', header: 'Current location', cell: (r) => r.site || <span className="cc-na">N/A</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    { key: 'issue_date', header: 'Installed date', cell: (r) => dateOrNA(r.issue_date || r.fitment_date) },
    {
      key: 'actions', header: 'Actions', sortable: false, align: 'right', cell: (r) => {
        const s = cleanSerial(r.serial_no)
        return (
          <span className="st-actions">
            <button type="button" className="cc-icon-btn" aria-label={`View ${s || 'record'}`} disabled={!s} onClick={(e) => { e.stopPropagation(); openSerial(s) }}><Eye size={14} aria-hidden="true" /></button>
            {s && <Link className="cc-icon-btn" to={`/tyre-passport/${encodeURIComponent(s)}`} aria-label={`Tyre passport for ${s}`} onClick={(e) => e.stopPropagation()}><ExternalLink size={14} aria-hidden="true" /></Link>}
          </span>
        )
      },
    },
  ]

  const eventColumns = [
    { key: 'date', header: 'Date', cell: (e) => dateOrNA(e.date) },
    { key: 'label', header: 'Event type', cell: (e) => <span className={`st-event st-event-${e.type}`}>{e.label}</span> },
    { key: 'from', header: 'From', cell: (e) => e.from || <span className="cc-na">N/A</span> },
    { key: 'to', header: 'To', cell: (e) => e.to || <span className="cc-na">N/A</span> },
    { key: 'vehicle', header: 'Vehicle / asset', cell: (e) => e.vehicle ? <>{e.vehicle}{e.position && <span className="cc-sub">{e.position}</span>}</> : <span className="cc-na">N/A</span> },
    { key: 'by', header: 'Performed by', cell: (e) => e.by || <span className="cc-na">Not recorded</span> },
    { key: 'remarks', header: 'Remarks', cell: (e) => e.remarks || <span className="cc-na">None</span> },
  ]

  const EMPTY_HISTORY = {
    inspection: 'Inspection readings are not linked to tyre serials yet.',
    repair: 'Tyre repairs are not recorded against serials yet.',
    disposal: 'This tyre has not been disposed.',
  }
  const selectedStatusScrapped = !!scrapMark || stats?.scrapped
  const usagePoints = usage.series[usageTab] || []
  const USAGE_UNIT = { km: 'km', wear: 'mm', pressure: 'psi', temperature: 'C' }

  const detailsState = { loading: loading && !stats, data: stats, error: error && !loading && !stats ? error : null, retry: () => search(lastQuery || serialInput) }

  return (
    <div className="cc st-page">
      <PageHero
        title="Serial Tracker"
        lead="Track and trace tyre serial numbers, installation history, movement, inspections and current location"
        imgLight="/dashboard/hero-tyres-light.webp"
        imgDark="/dashboard/hero-tyres-dark.webp"
      />
      <div className="st-hero-actions">
        <button type="button" className="cc-btn-primary" onClick={() => setScanOpen(true)}><ScanLine size={15} aria-hidden="true" /> Scan Serial Number</button>
      </div>

      <div className="cc-kpis">
        <Kpi icon={Hash} tone="t-green" value={k?.total} loading={kpis.loading} label="Total serial numbers"
          title="Tyre records that carry a serial. One tyre has one record per fitment, so this counts records, not distinct tyres." />
        <Kpi icon={CheckCircle2} tone="t-green" value={k?.installed} loading={kpis.loading} label="Currently installed"
          onClick={() => { setActiveTab('register'); setStatus('Active') }} title="Records with status Active. Click to filter the register." />
        <Kpi icon={Package} tone="t-blue" display="N/A" label="In stock" title="Tyre records carry no stock status. Stock lives in Stock Management." />
        <Kpi icon={Wrench} tone="t-amber" display="N/A" label="In repair" title="Tyre records carry no repair status." />
        <Kpi icon={Ban} tone="t-red" value={k?.disposed} loading={kpis.loading} label="Disposed"
          onClick={() => { setActiveTab('register'); setStatus('Scrapped') }} title="Records with status Scrapped. Click to filter the register." />
        <Kpi icon={EyeOff} tone="t-purple" value={k?.notTracked} loading={kpis.loading} label="Not tracked"
          title="Tyre records with no serial number, so they cannot be traced by serial." />
      </div>
      {kpis.error && (
        <div className="cc-card st-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /><span>{kpis.error}</span>
          <button type="button" className="cc-btn-ghost" onClick={kpis.retry}>Try again</button>
        </div>
      )}

      <div className="st-layout">
        <div className="st-main">
          <Card>
            <Tabs variant="line" label="Serial tracker views" value={activeTab}
              onChange={(key) => { setActiveTab(key); if (key === 'scrapped') loadScrapList() }}
              tabs={[{ key: 'register', label: 'Serial register' }, { key: 'bulk', label: 'Bulk lookup' }, { key: 'scrapped', label: 'Scrapped' }]} />
            <div className="st-tabbody" />
            {activeTab === 'register' && (
              <>
                <div className="cc-filters st-filters">
                  <label className="cc-search">
                    <Search size={15} aria-hidden="true" />
                    <input type="search" aria-label="Search by serial number or asset" placeholder="Search by serial number or asset"
                      value={regSearch} onChange={(e) => setRegSearch(e.target.value)} />
                  </label>
                  <select className="cc-select" aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
                    <option value="">All brands</option>
                    {(options.data?.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)}>
                    <option value="">All sizes</option>
                    {(options.data?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All status</option>
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Location" value={site} onChange={(e) => setSite(e.target.value)}>
                    <option value="">All locations</option>
                    {(options.data?.sites || []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {filtersOn && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
                </div>
                {options.error && <p className="st-muted">Filter options could not load. <button type="button" className="cc-link cc-link-btn" onClick={options.retry}>Try again</button></p>}
                <p className="st-muted st-note">One row per fitment record. Tyre pattern is not recorded, so there is no pattern filter.</p>
                <CardState state={register} lines={6} empty={!register.loading && !register.error && regRows.length === 0
                  ? (filtersOn ? 'No tyre records match these filters.' : 'No tyre records in this country yet.') : null}>
                  <KitTable className="st-table" manualPagination showPagination={false} enableSorting={false}
                    pageIndex={regPage} pageSize={regSize} pageCount={Math.max(1, Math.ceil(regTotal / regSize))}
                    totalRows={regTotal} getRowId={(r) => String(r.id)} onRowClick={(r) => openSerial(r?.serial_no)}
                    rows={regRows} columns={registerColumns} />
                  <Pager page={regPage} pageSize={regSize} total={regTotal} noun="records"
                    onPage={setRegPage} onPageSize={setRegSize} sizes={REGISTER_PAGE_SIZES} />
                </CardState>
              </>
            )}

            {activeTab === 'bulk' && (
              <div className="st-stack">
                <div
                  className={`st-drop ${bulkDragOver ? 'is-over' : ''}`}
                  onDragOver={e => { e.preventDefault(); setBulkDragOver(true) }}
                  onDragLeave={() => setBulkDragOver(false)}
                  onDrop={handleBulkDrop}
                >
                  <input ref={bulkFileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleBulkFileInput} />
                  <Upload size={28} aria-hidden="true" />
                  <p className="st-strong">{bulkFileName ? bulkFileName : 'Drop an Excel or CSV file here'}</p>
                  <p className="st-muted">
                    File must have a column: <code>serial_no</code>, <code>Serial No</code>, <code>Serial Number</code>, or <code>serial</code>
                  </p>
                  <button type="button" className="cc-btn-ghost" onClick={() => bulkFileRef.current?.click()}>Browse file</button>
                </div>

                {bulkLoading && <div className="cc-empty">Processing serial numbers...</div>}

                {error && !bulkLoading && (
                  <div className="st-alert" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" /><span>{error}</span>
                    <button onClick={() => bulkFileRef.current?.click()} className="cc-btn-ghost">Choose file again</button>
                  </div>
                )}

                {bulkDone && !bulkLoading && !error && (
                  <>
                    {bulkSummary && (
                      <div className="st-bulkbar">
                        <div className="st-chips">
                          {[
                            { label: 'Found',   value: bulkSummary.total,    key: null,        active: statusFilter === null },
                            { label: 'Active',  value: bulkSummary.active,   key: 'Active',    active: statusFilter === 'Active' },
                            { label: 'Retired', value: bulkSummary.retired,  key: 'Retired',   active: statusFilter === 'Retired' },
                            { label: 'Scrapped', value: bulkSummary.scrapped, key: 'Scrapped', active: statusFilter === 'Scrapped' },
                            { label: 'Missing', value: bulkSummary.notFound, key: 'Not Found', active: statusFilter === 'Not Found' },
                          ].map(chip => (
                            <button key={chip.label} type="button" aria-pressed={chip.active} className="st-chip"
                              onClick={() => setStatusFilter(chip.active && chip.key !== null ? null : chip.key)}>
                              <b>{chip.value}</b> {chip.label}
                            </button>
                          ))}
                        </div>
                        <div className="st-chips">
                          <label className="cc-search st-mini-search">
                            <Search size={14} aria-hidden="true" />
                            <input type="search" aria-label="Filter bulk results" placeholder="Filter results..." value={bulkSearch} onChange={e => setBulkSearch(e.target.value)} />
                          </label>
                          <button onClick={exportBulkExcel} disabled={filteredBulkResults.length === 0} className="cc-btn-ghost"><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                          <button onClick={exportBulkPdf} disabled={filteredBulkResults.length === 0} className="cc-btn-ghost"><FileText size={14} aria-hidden="true" /> PDF</button>
                        </div>
                        {(statusFilter || bulkSearch.trim()) && (
                          <p className="st-muted">
                            Showing {filteredBulkResults.length} of {bulkResults.length} results
                            {statusFilter && <> · filtered by <b>{statusFilter}</b></>}
                            {bulkSearch.trim() && <> · matching <b>"{bulkSearch}"</b></>}
                            <button onClick={() => { setStatusFilter(null); setBulkSearch('') }} className="cc-link cc-link-btn" style={{ marginLeft: 8 }}>Clear</button>
                          </p>
                        )}
                      </div>
                    )}

                    {bulkResults.length === 0 ? (
                      <div className="cc-empty">No serial numbers could be extracted from the file. Check that it has a recognised column header.</div>
                    ) : filteredBulkResults.length === 0 ? (
                      <div className="cc-empty">No results match the current filter.</div>
                    ) : (
                      <EnterpriseTable
                        className="cc-et"
                        columns={bulkColumns}
                        data={filteredBulkResults}
                        getRowId={r => r.serial}
                        enableGlobalFilter={false}
                        enableColumnFilters={false}
                        enableExport={false}
                        enableColumnVisibility={false}
                        stickyHeader={false}
                        initialPageSize={50}
                        onRowClick={(r) => { if (r && r.status !== 'Not Found') { setActiveTab('register'); openSerial(r.serial) } }}
                        emptyMessage="No results match the current filter."
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === 'scrapped' && (
              <div className="st-stack">
                <div className="st-scrap-head">
                  <p className="st-muted">
                    {scrapListLoad ? 'Loading...' : `${scrapList.length} tyre${scrapList.length !== 1 ? 's' : ''} marked as scrap`}
                    {canUndo ? ' · edit the reason or undo a mistaken scrap'
                      : canScrap ? ' · edit the reason' : ''}
                  </p>
                  <div className="st-chips">
                    <label className="cc-search st-mini-search">
                      <Search size={14} aria-hidden="true" />
                      <input type="search" aria-label="Filter scrapped tyres" placeholder="Filter serial / reason..." value={scrapListSearch} onChange={e => setScrapListSearch(e.target.value)} />
                    </label>
                    <button onClick={exportScrapExcel} disabled={scrapListLoad || !!scrapListErr || filteredScrapList.length === 0} className="cc-btn-ghost"><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                    <button onClick={exportScrapPdf} disabled={scrapListLoad || !!scrapListErr || filteredScrapList.length === 0} className="cc-btn-ghost"><FileText size={14} aria-hidden="true" /> PDF</button>
                    <button onClick={loadScrapList} disabled={scrapListLoad} className="cc-btn-ghost"><RotateCcw size={14} aria-hidden="true" /> Refresh</button>
                  </div>
                </div>
                {!canScrap ? (
                  <p className="st-muted"><AlertTriangle size={12} aria-hidden="true" /> You can view scrapped tyres. Marking one as scrap needs the tyre scrap permission, which an admin grants in Access Control.</p>
                ) : !canUndo ? (
                  <p className="st-muted"><AlertTriangle size={12} aria-hidden="true" /> You can mark a tyre as scrap and edit the reason. Undoing a scrap is an administrator action.</p>
                ) : null}

                <div className="st-mini-kpis">
                  {[
                    { label: 'Scrapped tyres', value: scrapSummary.total, icon: Trash2, sub: 'marked as scrap' },
                    { label: 'Last 30 days', value: scrapSummary.last30, icon: CalendarClock, sub: 'newly scrapped' },
                    { label: 'With a reason', value: scrapSummary.reasonRate == null ? 'N/A' : `${Math.round(scrapSummary.reasonRate * 100)}%`, icon: ClipboardList, sub: `${scrapSummary.withReason} of ${scrapSummary.total}` },
                    { label: 'No actor recorded', value: scrapSummary.unattributed, icon: UserX, sub: 'bulk-scrapped from the tyre grid' },
                  ].map(kk => (
                    <div key={kk.label} className="st-mini-kpi">
                      <span><kk.icon size={14} aria-hidden="true" /> {kk.label}</span>
                      <b>{scrapListLoad ? '...' : scrapListErr ? 'N/A' : kk.value}</b>
                      <small>{kk.sub}</small>
                    </div>
                  ))}
                </div>

                {scrapListErr && (
                  <div className="st-alert" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" /><span>{scrapListErr}</span>
                    <button onClick={loadScrapList} className="cc-btn-ghost">Retry</button>
                  </div>
                )}

                {scrapListLoad ? (
                  <div className="cc-empty">Loading scrapped tyres...</div>
                ) : scrapListErr ? null : scrapList.length === 0 ? (
                  <div className="cc-empty">No scrapped tyres. Tyres you mark as scrap will appear here.</div>
                ) : filteredScrapList.length === 0 ? (
                  <div className="cc-empty">No scrapped tyres match "{scrapListSearch}". <button onClick={() => setScrapListSearch('')} className="cc-link cc-link-btn">Clear filter</button></div>
                ) : (
                  <EnterpriseTable
                    className="cc-et"
                    columns={scrapColumns}
                    data={filteredScrapList}
                    getRowId={r => r.serial}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    enableKeyboard={false}
                    enableColumnVisibility={false}
                    stickyHeader={false}
                    initialPageSize={50}
                    emptyMessage="No scrapped tyres match this filter."
                  />
                )}
              </div>
            )}
          </Card>

          <div className="st-bottom">
            <Card title="Movement & history" sub={stats ? `Serial ${lastQuery}` : undefined}>
              <Tabs label="History type" value={historyTab} onChange={setHistoryTab}
                tabs={HISTORY_TABS.map((t) => ({ ...t, count: t.key === 'records' ? records.length : t.key === 'all' ? counts.all : counts[t.key] }))} />
              <div className="st-tabbody">
                <CardState state={detailsState} lines={4} empty={!stats && !loading ? 'Select a serial to see its movement.' : null}>
                  {historyTab === 'records' ? (
                    <EnterpriseTable
                      className="cc-et"
                      columns={recordColumns}
                      data={records}
                      getRowId={r => String(r.id)}
                      enableColumnFilters={false}
                      enableExport={false}
                      enableKeyboard={false}
                      enableColumnVisibility={false}
                      stickyHeader={false}
                      initialPageSize={25}
                      searchPlaceholder="Search this tyre's records"
                      emptyMessage="No records."
                    />
                  ) : shownEvents.length === 0 ? (
                    <div className="cc-empty">{EMPTY_HISTORY[historyTab] || 'No events of this type for this tyre.'}</div>
                  ) : (
                    <KitTable compact rows={shownEvents} columns={eventColumns} getRowId={(e) => e.id} />
                  )}
                </CardState>
              </div>
            </Card>

            <Card title="Tyre life & usage">
              <Tabs label="Usage view" value={usageTab} onChange={setUsageTab} tabs={USAGE_TABS} />
              <CardState state={detailsState} lines={3} empty={!stats && !loading ? 'Select a serial to see its life and usage.' : null}>
                <div className="st-usage-stats">
                  <div><span>Total life</span><b>{fmtKm(usage.totalKm)}</b><small>{usage.measured} of {usage.records} fitments measured</small></div>
                  <div><span>Current km</span><b>{fmtKm(usage.currentKm)}</b><small>{usage.currentKm == null ? 'Not fitted or not measured' : 'This fitment'}</small></div>
                  <div><span>Remaining</span><b>N/A</b><small>No expected life recorded for this tyre</small></div>
                </div>
                {usageTab === 'temperature' ? (
                  <div className="cc-empty">Tyre temperature is not recorded.</div>
                ) : usagePoints.length < 2 ? (
                  <div className="cc-empty">Not enough readings to draw a trend ({usagePoints.length} recorded).</div>
                ) : (
                  <UsageChart points={usagePoints} unit={USAGE_UNIT[usageTab]} />
                )}
              </CardState>
            </Card>
          </div>
        </div>

        <aside className="st-rail">
          <Card title="Serial number details" action={stats ? (
            <span className="st-head-actions">
              <button type="button" className="cc-btn-ghost" onClick={exportLifecycleExcel}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-primary" onClick={exportLifecyclePdf}><FileText size={14} aria-hidden="true" /> Export</button>
            </span>
          ) : null}>
            {!loading && error && !stats ? (
              <div className="cc-empty" role="alert"><div>{error}<br /><button type="button" className="cc-btn" onClick={() => search(lastQuery || serialInput)}>Try again</button></div></div>
            ) : loading ? (
              <div style={{ display: 'grid', gap: 10 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 26 }} />)}</div>
            ) : searched && records.length === 0 ? (
              <div className="cc-empty">No tyre records match serial "{lastQuery}" in the selected country. Check the spelling, or switch the country scope.</div>
            ) : !stats ? (
              <div className="cc-empty">
                <div>Select a serial in the register, or scan one.<br />
                  <button type="button" className="cc-btn" onClick={() => setScanOpen(true)}>Scan Serial Number</button>
                </div>
              </div>
            ) : (
              <>
                <div className="st-identity">
                  <TyreGlyph size={84} />
                  <div>
                    <StatusPill status={stats.last.status} scrapped={selectedStatusScrapped} />
                    <h3 className="st-serial-big">{lastQuery}</h3>
                    <p className="st-muted">{[stats.brand, stats.description].filter(Boolean).join(' · ') || 'Brand not recorded'}</p>
                    {scrapMark && <p className="st-bad">Scrapped {formatDate(scrapMark.created_at)}{scrapMark.reason ? ` · ${scrapMark.reason}` : ''}</p>}
                  </div>
                  <Link className="cc-icon-btn st-qr" to={`/tyre-passport/${encodeURIComponent(lastQuery)}`} aria-label="Open tyre passport"><QrCode size={16} aria-hidden="true" /></Link>
                </div>
                <dl className="st-fields">
                  <Field label="Size">{records[records.length - 1]?.size || null}</Field>
                  <Field label="First fitted">{stats.first.issue_date ? formatDate(stats.first.issue_date) : null}</Field>
                  <Field label="Days in service">{stats.days == null ? null : stats.days.toLocaleString('en-US')}</Field>
                  <Field label="Records">{fmtInt(stats.records)}</Field>
                  <Field label="Vehicles used">{fmtInt(stats.assets)}</Field>
                  <Field label="Sites">{fmtInt(stats.sites)}</Field>
                  <Field label="Current life">{usage.totalKm == null ? null : fmtKm(usage.totalKm)}</Field>
                  <Field label="Expected life">{null}</Field>
                  <Field label="Price per tyre">{moneyFor(stats.price, stats.country)}</Field>
                </dl>
                <p className="st-muted st-note">
                  Pattern, load index, speed rating, DOT and manufacturing date are not recorded on tyre records.
                  {' '}{stats.price == null
                    ? 'No purchase price is recorded on any record of this tyre.'
                    : `Price taken from the latest priced record (${stats.pricedRecords} of ${stats.records} records carry a price).`}
                </p>
                <div className="st-scrap-actions">
                  {scrapMark ? (canUndo && (
                    <button onClick={undoScrap} disabled={scrapBusy} className="cc-btn-ghost"><RotateCcw size={14} aria-hidden="true" /> {scrapBusy ? 'Working...' : 'Undo scrap'}</button>
                  )) : (canScrap && (
                    <button onClick={() => { setScrapErr(null); setScrapReason(''); setScrapOpen(true) }} className="cc-btn-ghost st-danger"><Trash2 size={14} aria-hidden="true" /> Mark as Scrap</button>
                  ))}
                </div>
                {scrapErr && <p className="st-bad" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {scrapErr}</p>}
              </>
            )}
          </Card>

          <Card title="Current assignment">
            {!stats ? <div className="cc-empty">No serial selected.</div> : !assignment ? (
              <div className="cc-empty">This tyre is not fitted to a vehicle now.</div>
            ) : (
              <>
                <div className="cc-vehicle st-assign">
                  <VehicleThumb row={assignment} size="md" />
                  <div><b>{assignment.asset_no || 'Asset not recorded'}</b><span className="cc-sub">{assignment.vehicle_type || 'Type not recorded'}</span></div>
                </div>
                <dl className="st-fields">
                  <Field label="Position">{assignment.position}</Field>
                  <Field label="Installed date">{assignment.installed ? formatDate(assignment.installed) : null}</Field>
                  <Field label="Installed by">{'Not recorded'}</Field>
                  <Field label="Site">{assignment.site}</Field>
                </dl>
                {assignment.asset_no && (
                  <Link className="cc-link" to={`/asset-management/${encodeURIComponent(assignment.asset_no)}`}>View vehicle details <ArrowRight size={13} aria-hidden="true" /></Link>
                )}
              </>
            )}
          </Card>

          <Card title="Photos & documents">
            {!stats ? <div className="cc-empty">No serial selected.</div> : photoUrls.loading ? (
              <div className="st-photos">{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 72 }} />)}</div>
            ) : photoUrls.urls.length === 0 ? (
              <div className="cc-empty"><div><ImageOff size={18} aria-hidden="true" /><br />No photos or documents are recorded on this tyre's records.</div></div>
            ) : (
              <div className="st-photos">
                {photoUrls.urls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="Tyre record" loading="lazy" /></a>)}
              </div>
            )}
          </Card>
        </aside>
      </div>

      {scanOpen && (
        <ScanModal onClose={() => setScanOpen(false)} onSubmit={(v) => { setScanOpen(false); setActiveTab('register'); openSerial(v) }} />
      )}

      {/* Scrap confirmation. The scrap RPC call itself is untouched. */}
      {scrapOpen && (
        <Modal
          open
          onClose={closeScrap}
          title="Mark tyre as scrap"
          subtitle={lastQuery}
          size="sm"
          footer={
            <>
              <button onClick={closeScrap} disabled={scrapBusy} className="btn-secondary text-sm disabled:opacity-50">Cancel</button>
              <button onClick={confirmScrap} disabled={scrapBusy} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                <Trash2 size={14} aria-hidden="true" /> {scrapBusy ? 'Marking...' : 'Confirm scrap'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)] mb-3">
            This flags the tyre and all {records.length} of its record{records.length !== 1 ? 's' : ''} as Scrapped, removing it from active and pool counts. You can undo this later.
          </p>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="scrap-reason">Reason (optional)</label>
          <textarea
            id="scrap-reason"
            className="input w-full text-sm min-h-[72px]"
            placeholder="e.g. Worn beyond limit, sidewall damage, retread failed..."
            value={scrapReason}
            onChange={e => setScrapReason(e.target.value)}
          />
          {scrapErr && <p className="mt-2 flex items-center gap-2 text-sm text-red-400"><AlertTriangle size={14} aria-hidden="true" /> {scrapErr}</p>}
        </Modal>
      )}
    </div>
  )
}
