/**
 * VehicleWashing (route /vehicle-washing) - log vehicle washes, correct them,
 * schedule them and report on them.
 *
 * Four tabs:
 *   1. Reporting - date-range + site + area + wash-type filters (with quick
 *      ranges), volume KPI tiles, three charts (monthly trend line, washes by
 *      type doughnut, washes by site bar) and a due-for-wash list.
 *   2. Log - the full record register with its own filters (dates, site, asset,
 *      status, wash type), a downloadable Excel / PDF of exactly what is
 *      filtered on screen, and a row action to correct a record.
 *   3. Schedule - book a wash for a future date, see what is upcoming and what
 *      was scheduled and never done, and close a plan out as completed.
 *   4. Quick Log - a compact create form for a wash that has just happened.
 *
 * TWO RULES THIS PAGE EXISTS TO HOLD:
 *   - A scheduled wash is a PLAN, a different record from a completed one, and
 *     is never counted as work done. The engine enforces it; the UI keeps the
 *     two visually apart as well.
 *   - Washing is done in house at no charge, so it is reported on COMPLIANCE
 *     (was it washed, when, how often), never as a cost driver. Cost appears per
 *     record only, where 0 reads "No charge" and blank reads "Not recorded" -
 *     two different facts that must never be collapsed.
 *
 * Editing goes through correct_wash_record (V534), which records a correction
 * AGAINST the record so the original value stays visible in its history rather
 * than being silently overwritten.
 *
 * All maths live in the pure, unit-tested washAnalytics engine; this page is
 * presentation + orchestration only. Data is org-isolated and country + site
 * scoped by RLS. Honest loading / empty / error states, no fabricated data.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Droplets, LayoutDashboard, ClipboardList, Plus, X,
  MapPin, Layers, Car, TrendingUp, PieChart, BarChart3, CheckCircle2,
  AlertTriangle, Loader2, Save, FileSpreadsheet, FileText, Trash2, ExternalLink,
  ImagePlus, Image as ImageIcon, Pencil, CalendarClock, CalendarPlus, History,
  ListChecks,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import DownloadNotice from '../components/ui/DownloadNotice'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import DateField from '../components/ui/DateField'
import Modal from '../components/ui/Modal'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import ReferencePicker from '../components/checklist/ReferencePicker'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useReportMeta } from '../hooks/useReportMeta'
import { useFilterState } from '../hooks/useFilterState'
import {
  listWashRecords, washExportFleet, createWashRecord, deleteWashRecord, uploadWashPhoto,
  correctWashRecord, listWashCorrections, scheduleWash,
  WASH_TYPES, WASH_STATUSES, WASH_STATUS_CHOICES,
} from '../lib/api/washRecords'
import { getAssetByNo } from '../lib/api/assets'
import {
  summarizeWashes, filterWashes, washDue, overdueSchedules, upcomingSchedules,
  costBasis, formatWashCost, WASH_INTERVAL_DAYS,
} from '../lib/washAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { applyExportPolicy, exportToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { usePagedRows, TablePagination } from '../components/ui/TablePagination'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { resolveStorageUrl } from '../lib/storageRefs'
import { washVehicleKey } from '../lib/washReportPdf'
import { safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import { enrichWashPeople } from '../lib/api/washRecords'
import { entryPerson, emptyWashDetails, checklistSummary, staffWashActivity } from '../lib/washDetails'
import WashDetailsForm from '../components/washing/WashDetailsForm'
import WashRecordViewer from '../components/washing/WashRecordViewer'
import WashAdvancedFilters from '../components/washing/WashAdvancedFilters'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
)

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const WASH_FILTER_DEFAULTS = Object.freeze({
  search: '', status: 'all', site: 'all', area: 'all', type: 'all',
  region: 'all', vehicleType: 'all', enteredBy: 'all', correctedBy: 'all',
  washedBy: 'all', bay: 'all', photos: 'all', chemicals: 'all',
  corrections: 'all', dateBasis: 'wash', from: '', to: '',
})

const TABS = [
  { id: 'reporting', label: 'Reporting', icon: LayoutDashboard },
  { id: 'register', label: 'Log', icon: ListChecks },
  { id: 'staff', label: 'Staff activity', icon: BarChart3 },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'log', label: 'Quick Log', icon: ClipboardList },
]
/** Tabs only a writer may open. Reporting and Log are read surfaces. */
const WRITE_TABS = new Set(['log', 'schedule'])

const EMPTY_FORM = {
  asset_no: '', vehicle_type: '', site: '', area: '',
  wash_date: '', wash_type: 'Full', bay: '', washed_by: '',
  odometer_km: '', status: 'Completed', notes: '', photos: [],
}

const EMPTY_SCHEDULE = {
  asset_no: '', vehicle_type: '', site: '', area: '',
  wash_date: '', wash_type: 'Full', bay: '', notes: '',
}

const MAX_PHOTOS = 6

const STATUS_TONE = {
  Completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Scheduled: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Missed: 'bg-red-500/15 text-red-300 border-red-500/30',
  Cancelled: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

/** Fields the correction dialog can restate, in the order they are shown. */
const EDIT_FIELDS = [
  { key: 'wash_date', label: 'Wash date', type: 'date' },
  { key: 'wash_time', label: 'Wash time', type: 'text', placeholder: 'HH:MM' },
  { key: 'status', label: 'Status', type: 'select', options: WASH_STATUSES },
  { key: 'wash_type', label: 'Wash type', type: 'select', options: WASH_TYPES },
  { key: 'asset_no', label: 'Asset number', type: 'text' },
  { key: 'vehicle_type', label: 'Vehicle type', type: 'text' },
  { key: 'site', label: 'Site', type: 'text' },
  { key: 'area', label: 'Area', type: 'text' },
  { key: 'bay', label: 'Wash bay', type: 'text' },
  { key: 'washed_by', label: 'Operator', type: 'text' },
  { key: 'odometer_km', label: 'Odometer (km)', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'text' },
]
const EDIT_LABEL = { ...Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, f.label])), wash_details: 'Chemicals / checklist' }

/** Current local time as HH:MM (auto-captured at save; not user-editable). */
function nowHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
const todayISO = () => new Date().toISOString().slice(0, 10)
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function fmtStamp(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
/** A stored empty value renders as a word, never as a blank cell. */
function fmtWas(v) {
  return v === null || v === undefined || String(v) === '' ? '(blank)' : String(v)
}

// Date helpers for the quick ranges.
function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function firstOfYear() {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)
}
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// Shared light-legible chart options (grid var resolved by chartVarPlugin).
const AXIS = {
  x: { grid: { display: false }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
  y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 }, precision: 0 } },
}

export default function VehicleWashing() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin, hasPermission } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)
  const canCreate = canWrite || profile?.role === 'Fleet Supervisor'
  const canReadFleet = hasPermission?.('fleet_master') === true
  const reportMeta = useReportMeta('Vehicle Washing Report')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfStatus, setPdfStatus] = useState('')
  const pdfLock = useRef(false)
  const dismissDownload = useCallback(() => setPdfStatus(''), [])

  const [tab, setTab] = useState('reporting')
  const [viewRow, setViewRow] = useState(null)
  const loadTicket = useRef(0)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Reporting, Log and Staff use one URL-backed filter state. A drill-down or
  // browser Back action therefore cannot leave a hidden filter behind on a
  // different tab, and a filtered washing view can be shared like Inspections.
  const [filters, setFilter, clearFilters, , setFilters] = useFilterState(WASH_FILTER_DEFAULTS)

  // Quick-log form.
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, client_uuid: crypto.randomUUID(), wash_date: todayISO(), wash_details: emptyWashDetails() }))
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formOk, setFormOk] = useState('')
  const assetLookupRef = useRef(0)

  // Master context (read-only) for the picked asset.
  const [master, setMaster] = useState(null)

  // Photos: form.photos holds tp-storage:// refs; previews holds resolved signed
  // URLs for the thumbnails (parallel array, keyed by ref).
  const [previews, setPreviews] = useState({})
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const photoInputRef = useRef(null)

  const regFilters = filters
  const setRegFilter = setFilter

  // Schedule form.
  const [sched, setSched] = useState({ ...EMPTY_SCHEDULE })
  const setSchedField = (k, v) => setSched((f) => ({ ...f, [k]: v }))
  const [schedSaving, setSchedSaving] = useState(false)
  const [schedError, setSchedError] = useState('')
  const [schedOk, setSchedOk] = useState('')
  const schedLookupRef = useRef(0)

  // Edit / correction dialog.
  const [editRow, setEditRow] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [editReason, setEditReason] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editOk, setEditOk] = useState('')
  const [corrections, setCorrections] = useState([])
  const [correctionsState, setCorrectionsState] = useState('idle') // idle | loading | ready | error

  // Delete confirm.
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    const ticket = ++loadTicket.current
    setRefreshing(true)
    setError('')
    try {
      const data = await enrichWashPeople(await listWashRecords({ country: activeCountry }))
      const fleet = canReadFleet ? await washExportFleet(data) : []
      const fleetMap = new Map(fleet.map(v => [washVehicleKey(v),v]))
      if (ticket !== loadTicket.current) return
      setRows(data.map(r => ({ ...r, registration_no: fleetMap.get(washVehicleKey(r))?.registration_no, region: fleetMap.get(washVehicleKey(r))?.region })))
      setMissing(false)
      setUpdatedAt(new Date())
    } catch (err) {
      if (ticket !== loadTicket.current) return
      setRows([])
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load wash records.'))
    } finally {
      if (ticket === loadTicket.current) { setLoading(false); setRefreshing(false) }
    }
  }, [activeCountry, canReadFleet])

  useEffect(() => { setLoading(true); setRows([]); setViewRow(null); load() }, [load, profile?.id, profile?.organisation_id])

  // Reporting KPI / chart summary (single pure pass over the reporting filters).
  const summary = useMemo(() => summarizeWashes(rows, filters), [rows, filters])

  // Log register (own filters) + its cost basis.
  const regRows = useMemo(() => filterWashes(rows, regFilters), [rows, regFilters])
  const regCost = useMemo(() => costBasis(regRows), [regRows])
  // Paged, not capped. The register used to render regRows.slice(0, 500), so
  // wash 501 was unreachable. The downloads still cover the whole filtered set.

  // Schedule + due lists. `washDue` is fed the WHOLE record set, not the
  // reporting filter, because "this vehicle has not been washed for 12 days" is
  // a fleet fact and must not change because someone picked a date range.
  const dueList = useMemo(() => washDue(rows, null, {}), [rows])
  const overduePlans = useMemo(() => overdueSchedules(rows, {}), [rows])
  const upcomingPlans = useMemo(() => upcomingSchedules(rows, {}), [rows])

  // ── Chart data ────────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const t = summary.monthlyTrend
    const accent = colorAt(0)
    return {
      labels: t.map((b) => b.label),
      datasets: [{
        label: 'Washes',
        data: t.map((b) => b.count),
        borderColor: accent,
        backgroundColor: withAlpha(accent, 0.15),
        pointBackgroundColor: accent,
        borderWidth: 2,
        tension: 0.35,
        fill: true,
      }],
    }
  }, [summary.monthlyTrend])

  const typeData = useMemo(() => {
    const g = summary.byType
    const colors = categorical(g.length)
    return {
      labels: g.map((x) => x.key),
      datasets: [{ data: g.map((x) => x.count), backgroundColor: colors, borderColor: colors, borderWidth: 1 }],
    }
  }, [summary.byType])

  const siteCountData = useMemo(() => {
    const g = summary.bySite.slice(0, 12)
    const colors = g.map((_, i) => colorAt(i))
    return {
      labels: g.map((x) => x.key),
      datasets: [{ label: 'Washes', data: g.map((x) => x.count), backgroundColor: colors, borderColor: colors, borderWidth: 1, borderRadius: 4 }],
    }
  }, [summary.bySite])

  const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: AXIS }
  const lineOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: AXIS }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '58%',
    plugins: { legend: { position: 'right', labels: { color: 'rgba(148,163,184,0.95)', font: { size: 11 }, boxWidth: 12 } } },
  }

  // ── Quick ranges ──────────────────────────────────────────────────────────
  const quickRanges = [
    { id: 'month', label: 'This month', from: firstOfMonth(), to: todayISO() },
    { id: '30', label: 'Last 30 days', from: daysAgo(30), to: todayISO() },
    { id: 'year', label: 'This year', from: firstOfYear(), to: todayISO() },
    { id: 'all', label: 'All', from: '', to: '' },
  ]

  // ── Asset picker: on select, auto-fill vehicle type + site + country from the
  // fleet master (only when empty, never overwriting a typed value) and show a
  // read-only master context line. ─────────────────────────────────────────────
  const onAssetPick = useCallback(async (value) => {
    const assetNo = String(value || '').trim()
    setForm((f) => ({ ...f, asset_no: assetNo }))
    if (!assetNo) { setMaster(null); return }
    const ticket = ++assetLookupRef.current
    try {
      // Country-scoped: an identical asset code in another country is a
      // different machine (V376) and must not fill this wash record.
      const asset = await getAssetByNo(assetNo, activeCountry)
      if (ticket !== assetLookupRef.current) return
      setMaster(asset || null)
      if (asset) {
        setForm((f) => ({
          ...f,
          vehicle_type: f.vehicle_type || asset.vehicle_type || '',
          site: f.site || asset.site || '',
        }))
      }
    } catch { /* lookup is a convenience; never surface an error */ }
  }, [activeCountry])

  const resetForm = useCallback(() => {
    setForm({ ...EMPTY_FORM, client_uuid: crypto.randomUUID(), wash_date: todayISO(), wash_details: emptyWashDetails() })
    setMaster(null)
    setPreviews({})
    setPhotoError('')
  }, [])

  // ── Photos: validate + upload to the private bucket, storing tp-storage refs ─
  const onAddPhotos = useCallback(async (e) => {
    const files = Array.from(e.target?.files || [])
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (!files.length) return
    setPhotoError('')
    setPhotoBusy(true)
    try {
      let added = 0
      for (const file of files) {
        // Cap using the latest known count to avoid exceeding MAX_PHOTOS.
        if ((form.photos?.length || 0) + added >= MAX_PHOTOS) break
        const ref = await uploadWashPhoto(file, (form.photos?.length || 0) + added)
        added += 1
        let url = null
        try { url = await resolveStorageUrl(ref) } catch { /* preview best-effort */ }
        setForm((f) => ({ ...f, photos: [...(f.photos || []), ref] }))
        setPreviews((p) => ({ ...p, [ref]: url }))
      }
    } catch (err) {
      setPhotoError(toUserMessage(err, 'Could not add the photo.'))
    } finally {
      setPhotoBusy(false)
    }
  }, [form.photos])

  const removePhoto = useCallback((ref) => {
    setForm((f) => ({ ...f, photos: (f.photos || []).filter((r) => r !== ref) }))
    setPreviews((p) => { const n = { ...p }; delete n[ref]; return n })
  }, [])

  const submitForm = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError(''); setFormOk('')
    if (!String(form.asset_no || '').trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const created = await createWashRecord({
        ...form,
        wash_date: form.wash_date || todayISO(),
        wash_time: nowHHMM(),               // captured automatically at save
        country: activeCountry !== 'All' ? activeCountry : null,
      })
      if (created) setRows((r) => [created, ...r.filter(x => x.id !== created.id)])
      setFormOk('Wash logged.')
      resetForm()
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not log the wash.'))
    } finally {
      setSaving(false)
    }
  }, [form, activeCountry, resetForm])

  // ── Schedule a future wash ────────────────────────────────────────────────
  const onSchedAssetPick = useCallback(async (value) => {
    const assetNo = String(value || '').trim()
    setSched((f) => ({ ...f, asset_no: assetNo }))
    if (!assetNo) return
    const ticket = ++schedLookupRef.current
    try {
      const asset = await getAssetByNo(assetNo, activeCountry)
      if (ticket !== schedLookupRef.current || !asset) return
      setSched((f) => ({
        ...f,
        vehicle_type: f.vehicle_type || asset.vehicle_type || '',
        site: f.site || asset.site || '',
      }))
    } catch { /* lookup is a convenience; never surface an error */ }
  }, [activeCountry])

  const submitSchedule = useCallback(async (e) => {
    e?.preventDefault?.()
    setSchedError(''); setSchedOk('')
    if (!String(sched.asset_no || '').trim()) { setSchedError('An asset number is required.'); return }
    if (!sched.wash_date) { setSchedError('Pick the date the wash is planned for.'); return }
    setSchedSaving(true)
    try {
      const created = await scheduleWash({
        ...sched,
        country: activeCountry !== 'All' ? activeCountry : null,
      })
      if (created) setRows((r) => [created, ...r])
      setSchedOk(`Wash scheduled for ${fmtDate(sched.wash_date)}. It is a plan and is not counted as a wash done.`)
      setSched({ ...EMPTY_SCHEDULE })
      setUpdatedAt(new Date())
    } catch (err) {
      setSchedError(toUserMessage(err, 'Could not schedule the wash.'))
    } finally {
      setSchedSaving(false)
    }
  }, [sched, activeCountry])

  // ── Edit / correct ────────────────────────────────────────────────────────
  const openEdit = useCallback(async (row) => {
    if (!row) return
    setEditRow(row)
    setEditError(''); setEditOk(''); setEditReason('')
    const draft = {}
    for (const f of EDIT_FIELDS) {
      const v = row[f.key]
      draft[f.key] = v === null || v === undefined ? '' : String(v).slice(0, f.key === 'wash_date' ? 10 : 4000)
    }
    draft.wash_details = row.wash_details || emptyWashDetails()
    setEditDraft(draft)
    setCorrections([])
    setCorrectionsState('loading')
    try {
      const hist = await listWashCorrections(row.id)
      setCorrections(Array.isArray(hist) ? hist : [])
      setCorrectionsState('ready')
    } catch {
      // "we could not look" is not "nothing was corrected" - say so.
      setCorrectionsState('error')
    }
  }, [])

  const closeEdit = useCallback(() => {
    setEditRow(null); setEditDraft({}); setEditReason('')
    setCorrections([]); setCorrectionsState('idle'); setEditError(''); setEditOk('')
  }, [])

  /** Fields the draft genuinely changes (the RPC skips no-ops too; this keeps the UI honest). */
  const editChanged = useMemo(() => {
    if (!editRow) return []
    return EDIT_FIELDS.filter((f) => {
      const before = editRow[f.key] === null || editRow[f.key] === undefined ? '' : String(editRow[f.key])
      const after = String(editDraft[f.key] ?? '')
      return before.slice(0, f.key === 'wash_date' ? 10 : undefined) !== after
    }).map((f) => f.key).concat(JSON.stringify(editRow.wash_details || emptyWashDetails()) !== JSON.stringify(editDraft.wash_details) ? ['wash_details'] : [])
  }, [editRow, editDraft])

  const saveCorrection = useCallback(async () => {
    if (!editRow) return
    setEditError(''); setEditOk('')
    if (!editChanged.length) { setEditError('Nothing has been changed yet.'); return }
    if (String(editReason || '').trim().length < 4) {
      setEditError('Give a short reason for the correction. It is stored with the change.')
      return
    }
    setEditSaving(true)
    try {
      const patch = {}
      for (const k of editChanged) patch[k] = editDraft[k]
      const res = await correctWashRecord(editRow.id, patch, editReason)
      if (!res || res.ok !== true) {
        const reason = res?.reason
        setEditError(
          reason === 'forbidden' ? 'You do not have permission to correct a wash record.'
            : reason === 'not_found' ? 'That wash record is no longer available.'
              : reason === 'unavailable' ? 'Corrections are not enabled on this database yet.'
                : 'The correction could not be saved.',
        )
        return
      }
      const updated = { ...editRow, ...patch, ...(res.record || {}) }
      setRows((r) => r.map((x) => (x.id === editRow.id ? updated : x)))
      setEditRow(updated)
      setEditOk(res.changed === 1 ? '1 field corrected.' : `${res.changed} fields corrected.`)
      setEditReason('')
      setUpdatedAt(new Date())
      setCorrectionsState('loading')
      try {
        const hist = await listWashCorrections(updated.id)
        setCorrections(Array.isArray(hist) ? hist : [])
        setCorrectionsState('ready')
      } catch { setCorrectionsState('error') }
    } catch (err) {
      setEditError(toUserMessage(err, 'The correction could not be saved.'))
    } finally {
      setEditSaving(false)
    }
  }, [editRow, editDraft, editChanged, editReason])

  /**
   * Close a scheduled wash out as done. This is a STATUS CORRECTION through the
   * same RPC, never a second write path, so completing a plan leaves the same
   * audit trail as any other change.
   */
  const completeSchedule = useCallback(async (row) => {
    await openEdit(row)
    setEditDraft(d => ({ ...d, status: 'Completed', wash_date: todayISO(), wash_time: nowHHMM() }))
    setEditReason('Scheduled wash carried out')
  }, [openEdit])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteWashRecord(confirmDelete.id)
      setRows((r) => r.filter((x) => x.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the record.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Exports (whatever is filtered on screen) ──────────────────────────────
  // Cost is carried as the same words the screen shows: "No charge" for a
  // recorded zero, "Not recorded" for a blank. A downloaded 0 in a money column
  // reads as a measurement failure in a spreadsheet, which it is not.
  const EXPORT_COLS = ['wash_date', 'wash_time', 'asset_no', 'vehicle_type', 'wash_type', 'site', 'area', 'bay', 'washed_by', 'status', 'cost', 'entered_by', 'username', 'received_at', 'chemicals', 'checklist']
  const EXPORT_HEADERS = ['Date', 'Time', 'Asset', 'Vehicle Type', 'Wash Type', 'Site', 'Area', 'Bay', 'Operator', 'Status', 'Cost', 'Entered by', 'Username', 'Received at', 'Chemicals used', 'Checklist']
  const exportRowsFrom = (list) => (Array.isArray(list) ? list : []).map((r) => ({
    wash_date: r.wash_date ? String(r.wash_date).slice(0, 10) : '',
    wash_time: r.wash_time || '',
    asset_no: r.asset_no || '',
    vehicle_type: r.vehicle_type || '',
    wash_type: r.wash_type || '',
    site: r.site || '',
    area: r.area || '',
    bay: r.bay || '',
    washed_by: r.washed_by || '',
    status: r.status || '',
    cost: formatWashCost(r.cost),
    entered_by: entryPerson(r), username: r.entry_username || '', received_at: r.created_at || '',
    chemicals: r.wash_details?.chemical_status === 'none' ? 'No chemical used' : (r.wash_details?.chemicals || []).map(c => [c.name,c.manufacturer,c.quantity,c.unit,c.dilution,c.sds_url].filter(Boolean).join(' / ')).join('; ') || 'Not recorded',
    checklist: (r.wash_details?.checklist || []).map(c => `${c.label}: ${c.result}${c.note ? ` (${c.note})` : ''}`).join('; ') || 'Not recorded',
  }))
  const exportExcel = async (list, label = 'Vehicle Washing') => {
    if (pdfLock.current) return
    pdfLock.current = true; setPdfBusy(true); setPdfStatus('Preparing Excel...')
    try {
      if (applyExportPolicy(list).length !== list.length) throw new Error('This selection exceeds the export limit. Narrow the filters.')
      const name = reportFileName(label, reportDateLabel())
      await exportToExcel(exportRowsFrom(list), EXPORT_COLS, EXPORT_HEADERS, name, 'Washes', { title: label, currency: activeCurrency })
      setPdfStatus(`Excel saved: ${list.length} matching wash records.`)
    } catch (err) { setPdfStatus(toUserMessage(err, 'Could not create the Excel file. Please try again.')) }
    finally { pdfLock.current = false; setPdfBusy(false) }
  }
  const exportPdf = async (list, label = 'Vehicle Washing', selection = regFilters) => {
    if (pdfLock.current) return
    pdfLock.current = true; setPdfBusy(true); setPdfStatus('Preparing company logo and vehicle report...')
    try {
      const { exportVehicleWashPdf } = await import('../lib/washReportPdf')
      let selected = list
      if (hasPermission?.('fleet_master')) {
        const fleet = await washExportFleet(list)
        const identity = new Map(fleet.map(r => [washVehicleKey(r), r]))
        selected = list.map(r => ({ ...r, registration_no: identity.get(washVehicleKey(r))?.registration_no, region: identity.get(washVehicleKey(r))?.region }))
      }
      const result = await exportVehicleWashPdf(selected, { ...reportMeta, filters: selection, filename: reportFileName(label, reportDateLabel()),
        onProgress: (done, total) => setPdfStatus(`Preparing photos ${done} of ${total}...`) })
      setPdfStatus(`PDF saved: ${result.vehicles} vehicle${result.vehicles === 1 ? '' : 's'}, ${result.totalPhotos - result.missingPhotos} attachments included (content not verified).${result.missingPhotos ? ` ${result.missingPhotos} photos were unavailable and are marked in the report.` : ''}`)
    } catch (err) { setPdfStatus(toUserMessage(err, 'Could not create the PDF. Please try again.')) }
    finally { pdfLock.current = false; setPdfBusy(false) }
  }
  const exportVehiclePdf = row => exportPdf(regRows.filter(r => washVehicleKey(r) === washVehicleKey(row)), `Vehicle Washing ${row.asset_no}`, { ...regFilters, assetNo: row.asset_no })

  // Keep the washing register on the shared SaaS table. The final View column
  // is fixed so opening the operational record is always in the same place.
  const washRecordColumns = [
    { id: 'wash_date', header: 'Date', accessorFn: (row) => row.wash_date || '', size: 110,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{fmtDate(row.original.wash_date)}</span> },
    { id: 'asset_no', header: 'Asset', accessorFn: (row) => row.asset_no || '', size: 120,
      cell: ({ row }) => row.original.asset_no ? (
        <Link onClick={(event) => event.stopPropagation()} to={`/asset-management/${encodeURIComponent(row.original.asset_no)}`} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
          {row.original.asset_no} <ExternalLink size={11} className="opacity-70" />
        </Link>
      ) : <span className="text-[var(--text-muted)]">N/A</span> },
    { id: 'wash_type', header: 'Wash type', accessorFn: (row) => row.wash_type || '', size: 140,
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (row) => row.site || '', size: 140,
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'area', header: 'Area', accessorFn: (row) => row.area || '', size: 130,
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'bay', header: 'Bay', accessorFn: (row) => row.bay || '', size: 100,
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'washed_by', header: 'Washed by', accessorFn: (row) => row.washed_by || '', size: 140,
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'entered_by', header: 'Entered by', accessorFn: (row) => entryPerson(row), size: 170,
      cell: ({ row }) => <span>{entryPerson(row.original)}<span className="block text-xs text-[var(--text-muted)]">{fmtStamp(row.original.created_at)}</span></span> },
    { id: 'checklist', header: 'Wash checks', accessorFn: (row) => checklistSummary(row), size: 130,
      cell: ({ getValue }) => getValue() },
    { id: 'cost', header: 'Cost', accessorFn: (row) => Number(row.cost || 0), size: 110,
      cell: ({ row }) => formatWashCost(row.original.cost), meta: { align: 'right' } },
    { id: 'photos', header: 'Photos', accessorFn: (row) => Array.isArray(row.photos) ? row.photos.length : 0, size: 90,
      cell: ({ getValue }) => getValue() > 0 ? <span className="inline-flex items-center gap-1"><ImageIcon size={13} className="opacity-70" /> {getValue()}</span> : <span className="text-[var(--text-muted)]">-</span>, meta: { align: 'center' } },
    { id: 'status', header: 'Status', accessorFn: (row) => row.status || '', size: 110,
      cell: ({ row }) => <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[row.original.status] || STATUS_TONE.Cancelled}`}>{row.original.status || 'N/A'}</span> },
    { id: 'vehicle_pdf', header: 'Report', size: 120, enableSorting: false, enableHiding: false,
      cell: ({ row }) => <button className="btn-secondary text-xs" disabled={pdfBusy || !row.original.asset_no} onClick={(event) => { event.stopPropagation(); exportVehiclePdf(row.original) }} aria-label={`Download PDF for ${row.original.asset_no}`}>PDF + photos</button>, meta: { export: false, pinnable: false } },
    ...(canWrite ? [{ id: 'actions', header: 'Actions', size: 90, enableSorting: false, enableHiding: false,
      cell: ({ row }) => <div className="flex items-center justify-end whitespace-nowrap">
        <button onClick={(event) => { event.stopPropagation(); openEdit(row.original) }} className="p-1.5 rounded hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-300" title="Edit or correct" aria-label={`Edit wash ${row.original.asset_no}`}><Pencil size={14} /></button>
        <button onClick={(event) => { event.stopPropagation(); setConfirmDelete(row.original) }} className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-300" title="Delete" aria-label={`Delete wash ${row.original.asset_no}`}><Trash2 size={14} /></button>
      </div>, meta: { export: false, align: 'right', pinnable: false } }] : []),
    { id: 'view', header: 'View', size: 110, enableSorting: false, enableHiding: false,
      cell: ({ row }) => <button className="btn-secondary text-xs whitespace-nowrap" onClick={(event) => { event.stopPropagation(); setViewRow(row.original) }} aria-label={`View wash ${row.original.asset_no}`}>View record</button>, meta: { export: false, pinnable: false } },
  ]


  const kpis = [
    { label: 'Washes performed', value: fmtNum(summary.totalWashes), icon: Droplets, hint: 'Completed washes only. Plans are not counted.' },
    { label: 'Vehicles washed', value: fmtNum(summary.distinctAssets), icon: Car },
    { label: 'Sites covered', value: fmtNum(summary.bySite.length), icon: MapPin },
    { label: 'Wash types used', value: fmtNum(summary.byType.length), icon: Layers },
  ]

  const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Washing"
        subtitle="Log vehicle washes for quick use and report on them by date range, site, area and wash type. Track wash volume and coverage across the fleet."
        icon={Droplets}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={canCreate && (
          <button onClick={() => setTab('log')} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
            <Plus size={14} /> Log a wash
          </button>
        )}
      />

      {missing && (
        // `border border-amber-800/50` would be DEAD as a class: Card sets border
        // inline and wins, so the tint is carried by `tone`. Card is `flex flex-col`
        // and `.flex-col` is emitted after `.flex-row`, so row direction has to be
        // inline too - Card spreads `style` last.
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle Washing is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V270_WASH_MODULE.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </Card>
      )}

      {/* Nothing has ever been logged: state it above the zeros so an empty
          module is not read as a clean compliance record. */}
      {!loading && !missing && !error && (
        <NotInUseNotice
          count={rows.length}
          label="vehicle washes"
          hint="Records appear once a wash is logged here or from the driver app."
        />
      )}

      <DownloadNotice message={pdfStatus} busy={pdfBusy} onDismiss={dismissDownload} />
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.filter((t) => !WRITE_TABS.has(t.id) || canCreate).map((t) => {
          const on = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ─────────────── REPORTING ─────────────── */}
      {['reporting','register','staff'].includes(tab) && <Card>
        <WashAdvancedFilters
          rows={rows}
          value={filters}
          onChange={setFilters}
          onClear={clearFilters}
          userId={profile?.id}
          scope={`${profile?.organisation_id}:${profile?.id}:${activeCountry}`}
          statuses={WASH_STATUSES}
          resultCount={regRows.length}
          quickRanges={quickRanges}
          canUseFleetFields={canReadFleet}
        />
      </Card>}

      {tab === 'staff' && <div className="card space-y-4">
        <h2 className="font-semibold">Entries by person</h2>
        <p className="text-sm text-[var(--text-muted)]">Each received record counts once. Edits and upload retries do not add entries. These filters are shared with the Log tab.</p>
        <div><button className="btn-secondary" disabled={!regRows.length || pdfBusy} onClick={() => exportExcel(regRows,'Wash staff activity records')}>Export matching entries</button></div>
        {loading ? <p>Loading…</p> : error ? <p role="alert">{error}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Person','Entries submitted','Distinct vehicles','Completed records','Scheduled records','Last received'].map(label => <th className="text-start p-2" key={label}>{label}</th>)}</tr></thead><tbody>{staffWashActivity(regRows).map(p => <tr className="border-t border-[var(--input-border)]" key={p.id}><td className="p-2"><button className="text-blue-400 underline" onClick={() => { setRegFilter('enteredBy',p.id); setTab('register') }}>{p.name}</button></td><td className="p-2">{p.entries}</td><td className="p-2">{p.vehicles}</td><td className="p-2">{p.completed}</td><td className="p-2">{p.scheduled}</td><td className="p-2">{fmtStamp(p.last)}</td></tr>)}</tbody></table>{!regRows.length && <p>No entries match these filters.</p>}</div>}
      </div>}

      {tab === 'reporting' && (
        <div className="space-y-4">
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((k) => {
              const Icon = k.icon
              return (
                <Card key={k.label}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={15} className="text-[var(--text-muted)]" />
                  </div>
                  <p className="text-xl font-bold text-[var(--text-primary)] mt-1">{loading ? '-' : k.value}</p>
                  {k.hint && <p className="text-[10px] text-[var(--text-muted)] mt-1">{k.hint}</p>}
                </Card>
              )
            })}
          </div>

          {/* Plans are shown beside the work, never inside it. */}
          {!loading && (summary.scheduledCount > 0 || summary.missedCount > 0 || summary.cancelledCount > 0) && (
            <p className="text-xs text-[var(--text-muted)]">
              Also in this range: {fmtNum(summary.scheduledCount)} scheduled, {fmtNum(summary.missedCount)} missed,{' '}
              {fmtNum(summary.cancelledCount)} cancelled. None of these count as a wash performed.
            </p>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader icon={TrendingUp} title="Monthly wash trend" />
              <div className="h-[240px]">
                {summary.totalWashes === 0
                  ? <EmptyChart />
                  : <Line data={trendData} options={lineOpts} />}
              </div>
            </Card>
            <Card>
              <CardHeader icon={PieChart} title="Washes by type" />
              <div className="h-[240px]">
                {summary.byType.length === 0
                  ? <EmptyChart />
                  : <Doughnut data={typeData} options={doughnutOpts} />}
              </div>
            </Card>
            <Card>
              <CardHeader icon={BarChart3} title="Washes by site" />
              <div className="h-[240px]">
                {summary.bySite.length === 0
                  ? <EmptyChart />
                  : <Bar data={siteCountData} options={barOpts} />}
              </div>
            </Card>
          </div>

          {/* Compliance: who is overdue for a wash. This reads the WHOLE record
              set, not the filters above, because a vehicle being 12 days
              unwashed is a fleet fact that a date range must not soften. */}
          <Card>
            {/* The basis line moves to CardHeader's `description`, under the title.
                It is what keeps "Due for a wash" honest, so it must keep reading
                next to the heading rather than being dropped in the migration. */}
            <CardHeader
              icon={CalendarClock}
              title="Due for a wash"
              description={`${WASH_INTERVAL_DAYS} day interval, whole fleet history`}
            />
            {loading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
            ) : dueList.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4">
                {rows.length === 0
                  ? 'Nothing can be judged as due yet because no wash has ever been recorded.'
                  : 'No vehicle is past its wash interval.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="py-2 pr-3 font-medium">Asset</th>
                      <th className="py-2 pr-3 font-medium">Site</th>
                      <th className="py-2 pr-3 font-medium">Last washed</th>
                      <th className="py-2 pr-3 font-medium">Due</th>
                      <th className="py-2 pr-3 font-medium text-right">Days overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueList.slice(0, 50).map((d) => (
                      <tr key={d.asset_no} className="border-b border-[var(--input-border)]/60">
                        <td className="py-2 pr-3">
                          <Link to={`/asset-management/${encodeURIComponent(d.asset_no)}`} className="text-blue-400 hover:text-blue-300">{d.asset_no}</Link>
                        </td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{d.site || 'N/A'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">
                          {d.basis === 'never' ? 'Never recorded' : fmtDate(d.last_wash_date)}
                        </td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">
                          {d.next_due_date ? fmtDate(d.next_due_date) : 'N/A'}
                        </td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">
                          {d.days_overdue == null ? 'N/A' : fmtNum(d.days_overdue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dueList.length > 50 && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing the 50 most overdue of {dueList.length}.</p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─────────────── LOG (register) ─────────────── */}
      {tab === 'register' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Every matching record is exported, including plans.</span>
            <div className="ms-auto flex flex-wrap gap-2">
              <button onClick={() => exportExcel(regRows, 'Vehicle Washing Log')} disabled={pdfBusy || regRows.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"><FileSpreadsheet size={14} /> Excel</button>
              <button onClick={() => exportPdf(regRows, 'Vehicle Washing Log')} disabled={pdfBusy || regRows.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"><FileText size={14} /> PDF</button>
            </div>
          </div>

          {/* What the cost column on these records actually says. Washing is not
              reported as a cost driver anywhere; this is a per-record fact. */}
          {!loading && regRows.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">{regCost.note}</p>
          )}

          <section className="space-y-2" aria-labelledby="wash-records-heading">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <h2 id="wash-records-heading" className="font-semibold inline-flex items-center gap-2"><ClipboardList size={16} /> Wash records</h2>
              <span className="text-[11px] text-[var(--text-muted)]">{regRows.length} matched</span>
            </div>
            <EnterpriseTable
              className="tp-register-pro"
              reportMeta={reportMeta}
              columns={washRecordColumns}
              data={regRows}
              getRowId={(row) => String(row.id)}
              onRowClick={setViewRow}
              loading={loading}
              error={error}
              onRetry={load}
              enableGlobalFilter={false}
              enableSorting
              enableExport={false}
              enableColumnVisibility
              initialPageSize={50}
              pageSizeOptions={[25, 50, 100, 200]}
              emptyIcon={<Droplets size={28} className="opacity-50" aria-hidden="true" />}
              emptyMessage={rows.length === 0 ? 'No wash has been recorded yet. The first one will appear here.' : 'No wash records match the selected filters.'}
            />
          </section>
        </div>
      )}

      {/* ─────────────── SCHEDULE ─────────────── */}
      {tab === 'schedule' && canCreate && (
        <div className="space-y-4">
          {/* NOT clipped: ReferencePicker below renders its result list as real DOM
              inside this card, and clipping would cut it off. */}
          <Card>
            {/* The plan-is-not-a-wash rule is the point of this panel, so it keeps
                its place directly under the heading as CardHeader's description. */}
            <CardHeader
              icon={CalendarPlus}
              title="Schedule a wash"
              description="A scheduled wash is a plan for a future date. It is kept as its own record and is never counted as a wash performed."
            />

            {schedOk && (
              <div className="mb-4 rounded-lg border border-emerald-800/50 bg-emerald-500/10 flex items-center gap-2 px-3 py-2">
                <CheckCircle2 size={15} className="text-emerald-400" />
                <span className="text-sm text-emerald-200">{schedOk}</span>
                <button onClick={() => setSchedOk('')} className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
              </div>
            )}
            {schedError && (
              <div className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 flex items-center gap-2 px-3 py-2">
                <AlertTriangle size={15} className="text-red-400" />
                <span className="text-sm text-red-200">{schedError}</span>
              </div>
            )}

            <form onSubmit={submitSchedule} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2 lg:col-span-3">
                <span>Asset number <span className="text-red-400">*</span></span>
                <ReferencePicker
                  source="asset"
                  value={sched.asset_no}
                  onChange={onSchedAssetPick}
                  country={activeCountry}
                  placeholder="Search assets by number..."
                />
              </div>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Planned date <span className="text-red-400">*</span></span>
                <input type="date" value={sched.wash_date} onChange={(e) => setSchedField('wash_date', e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Wash type</span>
                <select value={sched.wash_type} onChange={(e) => setSchedField('wash_type', e.target.value)} className={inputCls}>
                  {WASH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Site</span>
                <input value={sched.site} onChange={(e) => setSchedField('site', e.target.value)} className={inputCls} placeholder="auto-filled from asset" />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Area</span>
                <input value={sched.area} onChange={(e) => setSchedField('area', e.target.value)} className={inputCls} placeholder="e.g. North yard" />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Wash bay</span>
                <input value={sched.bay} onChange={(e) => setSchedField('bay', e.target.value)} className={inputCls} placeholder="e.g. Bay 2" />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Notes <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input value={sched.notes} onChange={(e) => setSchedField('notes', e.target.value)} className={inputCls} placeholder="optional" />
              </label>
              <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-1">
                <button type="submit" disabled={schedSaving || missing} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                  {schedSaving ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} Schedule wash
                </button>
                <button type="button" onClick={() => { setSched({ ...EMPTY_SCHEDULE }); setSchedError(''); setSchedOk('') }} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Clear</button>
              </div>
            </form>
          </Card>

          <SchedulePanel
            title="Scheduled and not done"
            emptyText={upcomingPlans.length === 0 && rows.length === 0
              ? 'No wash has been scheduled yet.'
              : 'Nothing scheduled has been missed.'}
            rows={overduePlans}
            loading={loading}
            lateColumn
            canWrite={canWrite}
            onComplete={completeSchedule}
            onEdit={openEdit}
            tone="warn"
          />

          <SchedulePanel
            title="Upcoming schedules"
            emptyText="Nothing is scheduled ahead."
            rows={upcomingPlans}
            loading={loading}
            canWrite={canWrite}
            onComplete={completeSchedule}
            onEdit={openEdit}
          />
        </div>
      )}

      {/* ─────────────── QUICK LOG ─────────────── */}
      {tab === 'log' && canCreate && (
        // `max-w-*` is not one of the properties Card sets inline, so it still wins.
        // Not clipped: the asset ReferencePicker renders a DOM result list in here.
        <Card className="max-w-4xl">
          <CardHeader icon={Droplets} title="Log a vehicle wash" />

          {formOk && (
            <div className="mb-4 rounded-lg border border-emerald-800/50 bg-emerald-500/10 flex items-center gap-2 px-3 py-2">
              <CheckCircle2 size={15} className="text-emerald-400" />
              <span className="text-sm text-emerald-200">{formOk}</span>
              <button onClick={() => setFormOk('')} className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
            </div>
          )}
          {formError && (
            <div className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 flex items-center gap-2 px-3 py-2">
              <AlertTriangle size={15} className="text-red-400" />
              <span className="text-sm text-red-200">{formError}</span>
            </div>
          )}

          <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Asset picker (searchable) + read-only master context */}
            <div className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2 lg:col-span-3">
              <span>Asset number <span className="text-red-400">*</span></span>
              <ReferencePicker
                source="asset"
                value={form.asset_no}
                onChange={onAssetPick}
                country={activeCountry}
                placeholder="Search assets by number..."
              />
              {master && (
                <p className="text-[11px] text-[var(--text-secondary)] pt-0.5">
                  Master: {[
                    master.vehicle_type,
                    [master.make, master.model].filter(Boolean).join(' '),
                    master.fleet_number ? `Fleet ${master.fleet_number}` : null,
                    master.site,
                  ].filter(Boolean).join(' | ') || 'no additional details'}
                </p>
              )}
            </div>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Vehicle type</span>
              <input value={form.vehicle_type} onChange={(e) => setField('vehicle_type', e.target.value)} className={inputCls} placeholder="auto-filled from asset" />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash type</span>
              <select value={form.wash_type} onChange={(e) => setField('wash_type', e.target.value)} className={inputCls}>
                {WASH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Status</span>
              <select value={form.status} onChange={(e) => setField('status', e.target.value)} className={inputCls}>
                {WASH_STATUS_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash date</span>
              <input type="date" value={form.wash_date} onChange={(e) => setField('wash_date', e.target.value)} className={inputCls} />
            </label>
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash time</span>
              <div className={`${inputCls} flex items-center gap-1.5 text-[var(--text-secondary)]`}>
                <CheckCircle2 size={13} className="text-[var(--text-muted)]" />
                Captured automatically at save
              </div>
            </div>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Operator name <span className="text-[var(--text-muted)]">(optional)</span></span>
              <input value={form.washed_by} onChange={(e) => setField('washed_by', e.target.value)} className={inputCls} placeholder="who washed the vehicle" />
            </label>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Site</span>
              <input value={form.site} onChange={(e) => setField('site', e.target.value)} className={inputCls} placeholder="auto-filled from asset" />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Area</span>
              <input value={form.area} onChange={(e) => setField('area', e.target.value)} className={inputCls} placeholder="e.g. North yard" />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash bay</span>
              <input value={form.bay} onChange={(e) => setField('bay', e.target.value)} className={inputCls} placeholder="e.g. Bay 2" />
            </label>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Odometer (km) <span className="text-[var(--text-muted)]">(optional)</span></span>
              <input type="number" min="0" step="any" value={form.odometer_km} onChange={(e) => setField('odometer_km', e.target.value)} className={inputCls} />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2 lg:col-span-2">
              <span>Notes <span className="text-[var(--text-muted)]">(optional)</span></span>
              <input value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputCls} placeholder="optional" />
            </label>

            {/* Photos */}
            <div className="text-xs text-[var(--text-muted)] space-y-2 sm:col-span-2 lg:col-span-3">
              <span>Photos <span className="text-[var(--text-muted)]">(optional, up to {MAX_PHOTOS})</span></span>
              <div className="flex flex-wrap items-center gap-2">
                {(form.photos || []).map((ref) => {
                  const src = safeImageSrc(previews[ref] || '')
                  return (
                    <div key={ref} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--input-border)] bg-[var(--input-bg)]">
                      {src ? (
                        <img src={src} alt="Wash" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><ImageIcon size={18} className="text-[var(--text-muted)]" /></div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(ref)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/55 text-white hover:bg-black/75"
                        title="Remove photo"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )
                })}
                {(form.photos?.length || 0) < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoBusy}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--input-border)] flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] hover:border-blue-500/50 hover:text-[var(--text-secondary)] disabled:opacity-60"
                  >
                    {photoBusy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                    <span className="text-[10px]">Add photo</span>
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  multiple
                  onChange={onAddPhotos}
                  className="hidden"
                />
              </div>
              {photoError && <p className="text-[11px] text-red-300">{photoError}</p>}
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              {rows.some(r=>r.asset_no === form.asset_no && r.wash_date === form.wash_date && r.status === 'Completed') && <p role="status" className="text-sm text-amber-600 mb-3">A completed wash already exists for this vehicle and date. Check the Log before recording a repeat wash.</p>}
              <p className="text-sm mb-3">Entered by: {profile?.full_name || profile?.username || 'Your signed-in account'}</p><WashDetailsForm value={form.wash_details} onChange={v => setField('wash_details',v)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-1">
              <button type="submit" disabled={saving || missing} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Log wash
              </button>
              <button type="button" onClick={resetForm} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Clear</button>
            </div>
          </form>
        </Card>
      )}

      <WashRecordViewer row={viewRow} onClose={() => setViewRow(null)} />
      {/* Edit / correct */}
      <Modal
        open={!!editRow}
        onClose={closeEdit}
        size="xl"
        title="Edit or correct a wash record"
        subtitle={editRow ? `${editRow.asset_no || 'Unknown asset'} on ${fmtDate(editRow.wash_date)}` : ''}
        footer={(
          <div className="flex items-center gap-3 w-full">
            <span className="text-xs text-[var(--text-muted)]">
              {editChanged.length === 0
                ? 'Change a field to record a correction.'
                : `${editChanged.length} field(s) will be corrected: ${editChanged.map((k) => EDIT_LABEL[k]).join(', ')}.`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={closeEdit} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Close</button>
              <button
                onClick={saveCorrection}
                disabled={editSaving || editChanged.length === 0}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save correction
              </button>
            </div>
          </div>
        )}
      >
        {editRow && (
          <div className="space-y-4">
            <p className="text-xs text-[var(--text-muted)]">
              The original value is kept. Each change is recorded against this record with your reason, so the
              history below always shows what the record said before.
            </p>
            <WashDetailsForm value={editDraft.wash_details} onChange={v => setEditDraft(d => ({ ...d, wash_details: v }))} />

            {editOk && (
              <div className="rounded-lg border border-emerald-800/50 bg-emerald-500/10 flex items-center gap-2 px-3 py-2">
                <CheckCircle2 size={15} className="text-emerald-400" />
                <span className="text-sm text-emerald-200">{editOk}</span>
              </div>
            )}
            {editError && (
              <div className="rounded-lg border border-red-800/50 bg-red-500/10 flex items-center gap-2 px-3 py-2">
                <AlertTriangle size={15} className="text-red-400" />
                <span className="text-sm text-red-200">{editError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {EDIT_FIELDS.map((f) => {
                const changed = editChanged.includes(f.key)
                return (
                  <label key={f.key} className="text-xs text-[var(--text-muted)] space-y-1">
                    <span>{f.label}{changed && <span className="text-amber-400"> (changed)</span>}</span>
                    {f.type === 'select' ? (
                      <select
                        value={editDraft[f.key] ?? ''}
                        onChange={(e) => setEditDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="">Not set</option>
                        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                        value={editDraft[f.key] ?? ''}
                        placeholder={f.placeholder || ''}
                        onChange={(e) => setEditDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        className={inputCls}
                      />
                    )}
                  </label>
                )
              })}
            </div>

            <label className="text-xs text-[var(--text-muted)] space-y-1 block">
              <span>Reason for the correction <span className="text-red-400">*</span></span>
              <input
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                className={inputCls}
                placeholder="e.g. wrong date entered by the operator"
              />
            </label>

            <div className="pt-2 border-t border-[var(--input-border)]">
              <div className="flex items-center gap-2 mb-2">
                <History size={15} className="text-[var(--text-secondary)]" />
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Correction history</h4>
              </div>
              {correctionsState === 'loading' ? (
                <p className="text-xs text-[var(--text-muted)]">Loading the history...</p>
              ) : correctionsState === 'error' ? (
                <p className="text-xs text-amber-300">The correction history could not be read, so this record may have changes not shown here.</p>
              ) : corrections.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">This record has never been corrected.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                        <th className="py-1.5 pr-3 font-medium">Field</th>
                        <th className="py-1.5 pr-3 font-medium">Was</th>
                        <th className="py-1.5 pr-3 font-medium">Now</th>
                        <th className="py-1.5 pr-3 font-medium">Reason</th>
                        <th className="py-1.5 pr-3 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corrections.map((c) => (
                        <tr key={c.id} className="border-b border-[var(--input-border)]/60">
                          <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{EDIT_LABEL[c.field] || c.field}</td>
                          <td className="py-1.5 pr-3 text-[var(--text-muted)] line-through">{fmtWas(c.old_value)}</td>
                          <td className="py-1.5 pr-3 text-[var(--text-primary)]">{fmtWas(c.new_value)}</td>
                          <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{c.reason || 'No reason given'}</td>
                          <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{fmtStamp(c.corrected_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm. Modal's backdrop click calls onClose, which keeps the same
          "a save in flight cannot be dismissed" guard the hand-rolled overlay had. */}
      {confirmDelete && (
        <Modal
          open
          onClose={() => { if (!deleting) setConfirmDelete(null) }}
          size="sm"
          title="Delete wash record"
          footer={(
            <>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-[var(--text-muted)]">
              Delete the wash logged for <span className="text-[var(--text-primary)] font-medium">{confirmDelete.asset_no || 'this asset'}</span> on {fmtDate(confirmDelete.wash_date)}? This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * One list of scheduled washes. Used twice: what was scheduled and never done,
 * and what is still ahead. Marking one completed routes through the same
 * correction RPC as any other edit, so there is no second write path.
 */
function SchedulePanel({ title, rows, emptyText, loading, lateColumn = false, canWrite, onComplete, onEdit, tone = 'default' }) {
  // Paged, not capped. This list used to render rows.slice(0, 200).
  const pager = usePagedRows(rows)
  return (
    // `tone` used to be a border class the caller passed in. On Card that class is
    // dead - the border is set inline - so it is a Card tone token now, and the
    // "scheduled and not done" list keeps its amber edge.
    <Card tone={tone}>
      <CardHeader
        icon={CalendarClock}
        title={title}
        actions={<span className="text-[11px] text-[var(--text-muted)]">{rows.length}</span>}
      />
      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-3">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                <th className="py-2 pr-3 font-medium">Planned date</th>
                <th className="py-2 pr-3 font-medium">Asset</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Site</th>
                <th className="py-2 pr-3 font-medium">Bay</th>
                {lateColumn && <th className="py-2 pr-3 font-medium text-right">Days late</th>}
                {canWrite && <th className="py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--input-border)]/60">
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{fmtDate(r.wash_date)}</td>
                  <td className="py-2 pr-3">
                    {r.asset_no ? (
                      <Link to={`/asset-management/${encodeURIComponent(r.asset_no)}`} className="text-blue-400 hover:text-blue-300">{r.asset_no}</Link>
                    ) : <span className="text-[var(--text-muted)]">N/A</span>}
                  </td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.wash_type || 'N/A'}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.bay || 'N/A'}</td>
                  {lateColumn && <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtNum(r.days_late)}</td>}
                  {canWrite && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => onComplete?.(r)}
                        className="px-2 py-1 text-[11px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-emerald-300"
                        title="Record that this wash was carried out"
                      >
                        Mark completed
                      </button>
                      <button onClick={() => onEdit?.(r)} className="p-1.5 rounded hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-300" title="Edit or correct">
                        <Pencil size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination {...pager} />
        </div>
      )}
    </Card>
  )
}

function EmptyChart({ hint = 'No data for the selected filters.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <Droplets size={26} className="opacity-40 mb-2" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
