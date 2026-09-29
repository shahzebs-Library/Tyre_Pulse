/**
 * GatePass (route /gate-pass) - Gate Pass station, rebuilt on the shared page
 * kit to the owner's light reference design.
 *
 * Two kinds of pass live in `gate_passes`:
 *   - OUTWARD (exit) passes: the original safety rule stands. No vehicle may
 *     leave the site without a completed tyre inspection on the same day. The
 *     New Gate Pass panel's Outward mode checks today's inspection and any
 *     open critical safety items, and issues or denies the pass. Release is
 *     routed through the safety-gated `gatePasses.createGatePass` path and the
 *     approval engine (EntityApprovalPanel) can lock it while a workflow runs.
 *   - INWARD passes: a vehicle, equipment or delivery arriving at the site.
 *     Recorded with driver, purpose and expected times in the row's existing
 *     `custom_data` (no migration). With pre-approval required it waits as
 *     Pending until approved and checked in; otherwise it is checked in at
 *     once. Checking an inward vehicle OUT runs the same outward clearance, and
 *     the issued exit pass stamps the inward pass as checked out.
 *
 * Status, overstay and timeline rules live in src/lib/gatePassView.js and are
 * stated on screen. Kept from the previous page: the day's "Today by Site"
 * breakdown (correct by design), hourly flow, top denial reasons, searchable
 * log (EnterpriseTable), Excel / PDF export of the log as filtered, printable
 * policy, 60 second auto-refresh for gate station use. Dates are LOCAL
 * calendar days (never toISOString, which is UTC).
 */
import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, LogIn, LogOut, Warehouse, AlarmClock, XCircle, Eye, Pencil, Printer, QrCode,
  Upload, FileSpreadsheet, BarChart3, ChevronLeft, ChevronRight, SlidersHorizontal, Plus,
  Search, X, AlertTriangle, ShieldCheck, Ban, Lock, CheckCircle2, Paperclip, RefreshCw,
} from 'lucide-react'
import * as gatePassPageApi from '../lib/api/gatePassPage'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import ActionMenu from '../components/ui/ActionMenu'
import Modal from '../components/ui/Modal'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { Card, CardState, Kpi, PageHero, Tabs, VehicleThumb, fmtInt, useCard } from '../components/commandCenter/kit'
import { gatePasses } from '../lib/api'
import { logAudit } from '../lib/audit'
import { publish } from '../lib/events'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { localIsoDate, passTime, siteBreakdown, hourlyProfile, denialReasons } from '../lib/gatePassAnalytics'
import {
  TABS, VIEW_STATUS_META, PURPOSES, OVERSTAY_RULE, DIRECTION_RULE, direction, passRef, viewStatus,
  gateKpis, tabCounts, filterGatePasses, initials, timeline, actorIds, newPassCustomData,
  validateNewPass, GATE_EXPORT_COLUMNS, gateExportRows, shiftRange, expectedOutAt, expectedInAt,
  checkedOutAt, isInYard,
} from '../lib/gatePassView'
import './GatePass.css'

const AssetIdentifyScanner = lazy(() => import('../components/accidents/AssetIdentifyScanner'))

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const LONG_DATE = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
const EMPTY_FORM = {
  direction: 'inward', assetNo: '', driverName: '', driverId: '', site: '', purpose: '',
  expectedIn: '', expectedOut: '', remarks: '', preApproval: false,
}
const NA = <span className="cc-na">N/A</span>

function fmtStamp(ms) {
  if (ms == null) return 'N/A'
  const d = new Date(ms)
  return `${formatDate(d, 'All', { day: 'numeric', month: 'short', year: 'numeric' })} ${passTime(d)}`
}
const toLocalInput = (ms) => {
  if (ms == null) return ''
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function StatusPill({ status }) {
  const m = VIEW_STATUS_META[status] || VIEW_STATUS_META.pending
  return <span className={`cc-pill ${m.tone}`}>{m.label}</span>
}
function TypePill({ pass }) {
  return direction(pass) === 'inward' ? <span className="cc-pill good">Inward</span> : <span className="cc-pill info">Outward</span>
}
function vehicleLine(f) {
  if (!f) return 'Not in the fleet register'
  return [f.make, f.model || f.vehicle_type].filter(Boolean).join(' ') || f.vehicle_type || 'Class not recorded'
}

/** A table cell value that stays on one line and shows the full text on hover. */
function Clip({ value }) {
  if (!value) return NA
  return <span className="gp-cell-clip" title={value}>{value}</span>
}

function Person({ name, id, large }) {
  if (!name && !id) return NA
  return (
    <span className="gp-person">
      <span className={`gp-avatar ${large ? 'lg' : ''}`} aria-hidden="true">{initials(name)}</span>
      <span className="gp-clip"><b title={name || undefined}>{name || 'Name not recorded'}</b>{id && <small title={`ID: ${id}`}>ID: {id}</small>}</span>
    </span>
  )
}

export default function GatePass() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()

  const today = localIsoDate(new Date())
  const todayDisplay = formatDate(`${today}T00:00:00`, 'All', LONG_DATE)
  const [now, setNow] = useState(() => Date.now())

  // Register range + filters
  const [range, setRange] = useState(() => ({ from: localIsoDate(new Date(), -6), to: localIsoDate(new Date()) }))
  const [siteFilter, setSiteFilter] = useState('')
  const [tab, setTab] = useState('all')
  const [moreOpen, setMoreOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [purposeFilter, setPurposeFilter] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)

  const [rows, setRows] = useState([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [rowsError, setRowsError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [todayPasses, setTodayPasses] = useState([])
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayError, setTodayError] = useState('')
  const [sites, setSites] = useState([])
  const [sitesError, setSitesError] = useState('')
  const [names, setNames] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const refreshRef = useRef(null)

  // New Gate Pass panel
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [checkoutFor, setCheckoutFor] = useState(null) // inward pass being checked out
  const panelRef = useRef(null)
  // Outward clearance
  const [checkResult, setCheckResult] = useState(null) // null | 'found' | 'not-found'
  const [inspection, setInspection] = useState(null)
  const [blockers, setBlockers] = useState(null)
  const [blockersUnknown, setBlockersUnknown] = useState(false)
  const [checking, setChecking] = useState(false)
  const [denialReason, setDenialReason] = useState('')
  const [showDenialInput, setShowDenialInput] = useState(false)
  const [wfLocked, setWfLocked] = useState(false)

  // Edit / reject dialogs
  const [editPass, setEditPass] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [rejectPass, setRejectPass] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const fleet = useCard(async () => {
    const { data, error } = await gatePassPageApi.listGateFleet()
    if (error) throw error
    return data || []
  }, [])
  const fleetByAsset = useMemo(() => {
    const m = new Map()
    for (const f of fleet.data || []) {
      const k = String(f.asset_no || '').toUpperCase()
      if (!k) continue
      m.set(`${f.country || ''}|${k}`, f)
      if (!m.has(k)) m.set(k, f)
    }
    return m
  }, [fleet.data])
  const fleetRow = useCallback((p) => {
    const k = String(p?.asset_no || '').toUpperCase()
    return fleetByAsset.get(`${p?.country || ''}|${k}`) || fleetByAsset.get(k) || null
  }, [fleetByAsset])
  const assetOptions = useMemo(() => {
    const seen = new Set()
    return (fleet.data || []).filter((f) => (activeCountry === 'All' || !f.country || f.country === activeCountry))
      .map((f) => f.asset_no).filter((a) => a && !seen.has(a) && seen.add(a))
  }, [fleet.data, activeCountry])

  const loadSites = useCallback(async () => {
    setSitesError('')
    try {
      const { data, error } = await gatePassPageApi.listGatePassSites()
      if (error) throw error
      if (data) setSites([...new Set(data.map(r => r.site).filter(Boolean))].sort())
    } catch (error) {
      setSitesError(toUserMessage(error, 'Could not load the site list.'))
    }
  }, [])

  const loadRows = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRowsLoading(true)
    setRowsError('')
    try {
      const { data, error, truncated: t } = await gatePassPageApi.listGatePassesRange({ from: range.from, to: range.to, site: siteFilter })
      if (error) throw error
      setRows(data || [])
      setTruncated(!!t)
      setNow(Date.now())
    } catch (error) {
      setRowsError(toUserMessage(error, 'Could not load gate passes for this period.'))
    } finally {
      if (!silent) setRowsLoading(false)
    }
  }, [range.from, range.to, siteFilter])

  const loadToday = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setTodayLoading(true)
    setTodayError('')
    try {
      const { data, error } = await gatePassPageApi.listGatePasses({ date: today, site: siteFilter })
      if (error) throw error
      setTodayPasses(data || [])
    } catch (error) {
      setTodayError(toUserMessage(error, "Could not load today's gate passes."))
    } finally {
      if (!silent) setTodayLoading(false)
    }
  }, [siteFilter, today])

  const reloadAll = useCallback(() => { loadRows(); loadToday() }, [loadRows, loadToday])

  useEffect(() => { loadSites() }, [loadSites])
  useEffect(() => {
    loadRows(); loadToday()
    // Auto-refresh every 60 s for gate station use
    clearInterval(refreshRef.current)
    refreshRef.current = setInterval(() => { loadToday({ silent: true }); if (range.to >= today) loadRows({ silent: true }) }, 60_000)
    return () => clearInterval(refreshRef.current)
  }, [activeCountry, loadRows, loadToday, range.to, today])

  // Names of the people recorded on the passes (best effort: a failed lookup
  // leaves the timeline without names, never with a wrong one).
  useEffect(() => {
    const ids = actorIds(rows).filter((id) => !(id in names))
    if (!ids.length) return
    let live = true
    gatePassPageApi.listActorNames(ids).then((m) => { if (live) setNames((n) => ({ ...n, ...m })) }).catch(() => {})
    return () => { live = false }
  }, [rows, names])

  useEffect(() => { setWfLocked(false) }, [inspection?.id])

  // Derived
  const kpis = useMemo(() => gateKpis(rows, now), [rows, now])
  const counts = useMemo(() => tabCounts(rows, now), [rows, now])
  const filtered = useMemo(() => filterGatePasses(rows, { tab, search, purpose: purposeFilter, pendingOnly }, now), [rows, tab, search, purposeFilter, pendingOnly, now])
  const selected = useMemo(() => filtered.find((p) => p.id === selectedId) || filtered[0] || null, [filtered, selectedId])
  const bySite = useMemo(() => siteBreakdown(todayPasses), [todayPasses])
  const hourly = useMemo(() => hourlyProfile(rows), [rows])
  const reasons = useMemo(() => denialReasons(rows), [rows])
  const activeHours = useMemo(() => hourly.hours.filter((h) => h.cleared + h.denied > 0), [hourly])
  const hourMax = Math.max(1, ...hourly.hours.map((h) => h.cleared + h.denied))
  const rangeLabel = range.from === range.to ? range.from : `${range.from} to ${range.to}`
  const filtersOn = !!(search || purposeFilter || pendingOnly)

  // ---------- outward clearance ----------
  function resetClearance() {
    setCheckResult(null); setInspection(null); setShowDenialInput(false); setBlockers(null)
    setBlockersUnknown(false); setDenialReason('')
  }

  async function checkClearance(assetArg) {
    const asset = String(assetArg ?? form.assetNo).trim()
    if (!asset) return
    setChecking(true); resetClearance(); setFormError('')
    // Safety gate: surface open critical defects for this asset before release.
    // A failed lookup is reported, never read as "no blockers"; the release
    // path re-checks server-side regardless.
    gatePasses.listGatePassBlockers({ assetNo: asset, country: activeCountry })
      .then(setBlockers).catch(() => { setBlockers(null); setBlockersUnknown(true) })
    try {
      const { data, error } = await gatePassPageApi.findAssetInspectionForClearance({ assetNo: asset, date: today })
      if (error) throw error
      if (data?.[0]) {
        setInspection(data[0])
        setCheckResult('found')
        if (data[0].site) setForm((f) => (f.site ? f : { ...f, site: data[0].site }))
      } else {
        setCheckResult('not-found')
      }
    } catch (error) {
      setFormError(toUserMessage(error, 'Could not check clearance. Try again.'))
    } finally {
      setChecking(false)
    }
  }

  async function issueExit(status) {
    if (wfLocked) return
    const asset = form.assetNo.trim()
    setSaving(true); setFormError('')
    const nowIso = new Date().toISOString()
    const values = {
      asset_no: asset,
      site: form.site || inspection?.site || siteFilter || null,
      country: activeCountry !== 'All' ? activeCountry : null,
      pass_date: today,
      status,
      inspection_id: inspection?.id || null,
      cleared_by: status === 'Cleared' ? (profile?.id || null) : null,
      cleared_at: status === 'Cleared' ? nowIso : null,
      denial_reason: status === 'Denied' ? (denialReason || null) : null,
      notes: form.remarks.trim() || null,
      custom_data: newPassCustomData({ ...form, direction: 'outward' }, { userId: profile?.id, nowIso }),
    }
    let exitId = null
    try {
      if (status === 'Cleared') {
        // Route release through the safety gate - refuses when critical defects are open.
        const { pass, blockers: b } = await gatePasses.createGatePass(values)
        exitId = pass?.id || null
        if (b) setBlockers(b)
        logAudit({ action: 'CREATE', entity: 'gate_passes', entityId: `${values.asset_no}|${values.pass_date}`, after: values })
        publish('gatepass.issued', { asset_no: values.asset_no, site: values.site, pass_date: values.pass_date, inspection_id: values.inspection_id })
      } else {
        const { error } = await gatePassPageApi.insertGatePass(values) // denials are never blocked
        if (error) throw error
        logAudit({ action: 'CREATE', entity: 'gate_passes', entityId: `${values.asset_no}|${values.pass_date}`, after: values })
        publish('gatepass.denied', { asset_no: values.asset_no, site: values.site, pass_date: values.pass_date, denial_reason: values.denial_reason })
      }
      // An exit that releases an in-yard vehicle closes its inward pass.
      if (status === 'Cleared' && checkoutFor) {
        const { error } = await gatePassPageApi.updateGatePass(checkoutFor.id, {
          status: 'Checked out',
          custom_data: { ...(checkoutFor.custom_data || {}), checked_out_at: nowIso, checked_out_by: profile?.id || null, exit_pass_id: exitId },
        })
        if (error) setActionError(toUserMessage(error, 'The exit pass was issued but the inward pass could not be marked checked out.'))
      }
    } catch (err) {
      if (err?.code === 'BLOCKED') { setBlockers(err.blockers); setFormError(err.message) } else setFormError(toUserMessage(err, 'Could not issue the pass.'))
      setSaving(false)
      return
    }
    setSaving(false)
    setForm({ ...EMPTY_FORM, direction: 'outward' })
    setCheckoutFor(null)
    resetClearance()
    reloadAll()
  }

  // ---------- inward ----------
  async function createInward() {
    const err = validateNewPass(form)
    if (err) { setFormError(err); return }
    setSaving(true); setFormError('')
    const nowIso = new Date().toISOString()
    const values = {
      asset_no: form.assetNo.trim(),
      site: form.site || siteFilter || null,
      country: activeCountry !== 'All' ? activeCountry : null,
      pass_date: today,
      status: form.preApproval ? 'Pending' : 'Checked in',
      notes: form.remarks.trim() || null,
      custom_data: newPassCustomData(form, { userId: profile?.id, nowIso }),
    }
    try {
      const { error } = await gatePassPageApi.insertGatePass(values)
      if (error) throw error
      logAudit({ action: 'CREATE', entity: 'gate_passes', entityId: `${values.asset_no}|${values.pass_date}`, after: values })
      setForm(EMPTY_FORM)
      reloadAll()
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not create the gate pass.'))
    } finally {
      setSaving(false)
    }
  }

  // ---------- row actions ----------
  async function patchPass(pass, patch, label) {
    setBusyId(pass.id); setActionError('')
    try {
      const { error } = await gatePassPageApi.updateGatePass(pass.id, patch)
      if (error) throw error
      logAudit({ action: 'UPDATE', entity: 'gate_passes', entityId: pass.id, before: pass, after: patch })
      await loadRows({ silent: true }); loadToday({ silent: true })
    } catch (e) {
      setActionError(toUserMessage(e, `Could not ${label}.`))
    } finally {
      setBusyId(null)
    }
  }
  const approve = (p) => patchPass(p, { status: 'Approved', cleared_by: profile?.id || null, cleared_at: new Date().toISOString() }, 'approve the pass')
  const checkIn = (p) => patchPass(p, { status: 'Checked in', custom_data: { ...(p.custom_data || {}), checked_in_at: new Date().toISOString(), checked_in_by: profile?.id || null } }, 'check the vehicle in')
  function startCheckout(p) {
    setCheckoutFor(p)
    setForm({ ...EMPTY_FORM, direction: 'outward', assetNo: p.asset_no || '', site: p.site || '', driverName: p.custom_data?.driver_name || '', driverId: p.custom_data?.driver_id || '', purpose: p.custom_data?.purpose || '' })
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    checkClearance(p.asset_no || '')
  }
  async function confirmReject() {
    const p = rejectPass
    await patchPass(p, { status: 'Denied', denial_reason: rejectReason.trim() || null }, 'reject the pass')
    setRejectPass(null); setRejectReason('')
  }
  function openEdit(p) {
    const c = p.custom_data || {}
    setEditPass(p)
    setEditForm({ driverName: c.driver_name || '', driverId: c.driver_id || '', purpose: c.purpose || '', expectedIn: toLocalInput(expectedInAt(p)), expectedOut: toLocalInput(expectedOutAt(p)), remarks: p.notes || '' })
  }
  async function saveEdit() {
    const f = editForm
    const err = validateNewPass({ assetNo: editPass.asset_no || 'x', expectedIn: f.expectedIn, expectedOut: f.expectedOut })
    if (err) { setActionError(err); return }
    await patchPass(editPass, {
      notes: f.remarks.trim() || null,
      custom_data: {
        ...(editPass.custom_data || {}),
        driver_name: f.driverName.trim() || null, driver_id: f.driverId.trim() || null, purpose: f.purpose || null,
        expected_in_at: f.expectedIn ? new Date(f.expectedIn).toISOString() : null,
        expected_out_at: f.expectedOut ? new Date(f.expectedOut).toISOString() : null,
      },
    }, 'save the changes')
    setEditPass(null)
  }

  function actionsFor(p) {
    const s = viewStatus(p, now)
    const inward = direction(p) === 'inward'
    return [
      { label: 'View details', icon: Eye, onClick: () => setSelectedId(p.id) },
      { label: 'Edit details', icon: Pencil, onClick: () => openEdit(p) },
      inward && s === 'pending' && { label: 'Approve', icon: CheckCircle2, onClick: () => approve(p) },
      inward && (s === 'pending' || s === 'approved') && { label: 'Check in', icon: LogIn, onClick: () => checkIn(p) },
      inward && isInYard(p) && { label: 'Check out (clearance)', icon: LogOut, onClick: () => startCheckout(p) },
      (s === 'pending' || s === 'approved') && { label: 'Reject', icon: XCircle, danger: true, onClick: () => { setRejectPass(p); setRejectReason('') } },
      { label: 'Print gate pass', icon: Printer, onClick: () => printPass(p) },
    ]
  }

  // ---------- exports ----------
  const exportCols = GATE_EXPORT_COLUMNS
  async function doExcel(list = filtered) {
    setActionError('')
    try { await exportToExcel(gateExportRows(list, now), exportCols.map((c) => c.key), exportCols.map((c) => c.header), reportFileName('TyrePulse Gate Pass', range.from, range.to)) } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  async function doPdf() {
    setActionError('')
    try {
      await exportToPdf(gateExportRows(filtered, now), exportCols, `Gate Pass Log: ${rangeLabel} (${siteFilter || 'All sites'}${filtersOn || tab !== 'all' ? ', filtered' : ''})`, reportFileName('TyrePulse Gate Pass', range.from, range.to), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  function printPass(p) {
    if (!p) return
    const c = p.custom_data || {}
    const tl = timeline(p, names)
    const rowsOut = [
      { field: 'Gate pass no', value: passRef(p) },
      { field: 'Type', value: direction(p) === 'inward' ? 'Inward' : 'Outward' },
      { field: 'Status', value: VIEW_STATUS_META[viewStatus(p, now)].label },
      { field: 'Vehicle / asset', value: p.asset_no || 'N/A' },
      { field: 'Driver / operator', value: [c.driver_name, c.driver_id ? `ID ${c.driver_id}` : ''].filter(Boolean).join(', ') || 'N/A' },
      { field: 'Site', value: p.site || 'N/A' },
      { field: 'Purpose', value: c.purpose || 'N/A' },
      { field: 'Pass date', value: p.pass_date || 'N/A' },
      { field: 'Expected in', value: fmtStamp(expectedInAt(p)) },
      { field: 'Expected out', value: fmtStamp(expectedOutAt(p)) },
      ...tl.map((s) => ({ field: s.label, value: s.state === 'done' ? `${fmtStamp(s.at)}${s.by ? `, ${s.by}` : ''}` : (s.note || 'Not reached') })),
      { field: 'Denial reason', value: p.denial_reason || 'N/A' },
      { field: 'Remarks', value: p.notes || 'N/A' },
    ]
    exportToPdf(rowsOut, [{ key: 'field', header: 'Field' }, { key: 'value', header: 'Value' }], `Gate Pass ${passRef(p)}`, reportFileName('TyrePulse Gate Pass', passRef(p)), 'portrait')
      .catch((e) => setActionError(toUserMessage(e, 'Could not print the gate pass. Try again.')))
  }
  function printPolicy() {
    const policyRows = [
      { section: 'POLICY', text: 'No vehicle may leave the site without a completed daily tyre inspection on the same date.' },
      { section: 'STEP 1', text: 'Driver presents vehicle at gate.' },
      { section: 'STEP 2', text: 'Gate officer enters asset number in the TyrePulse Gate Pass system.' },
      { section: 'STEP 3', text: 'System checks for a tyre inspection completed today for that vehicle.' },
      { section: 'STEP 4', text: 'If cleared: issue pass and log exit time.' },
      { section: 'STEP 5', text: 'If not cleared: deny exit and notify supervisor.' },
      { section: 'CONSEQUENCE 1', text: 'First offence: written warning to driver and supervisor.' },
      { section: 'CONSEQUENCE 2', text: 'Second offence: vehicle grounded until inspection is completed.' },
      { section: 'CONSEQUENCE 3', text: 'Third offence: disciplinary action per company HR policy.' },
    ]
    exportToPdf(policyRows, [{ key: 'section', header: 'Section' }, { key: 'text', header: 'Policy Statement' }],
      `Tyre Gate Pass Policy, effective ${todayDisplay}`, reportFileName('TyrePulse Gate Pass Policy'), 'portrait')
      .catch((e) => setActionError(toUserMessage(e, 'Could not print the policy. Try again.')))
  }

  // ---------- table ----------
  const columns = useMemo(() => [
    { id: 'ref', header: 'Gate pass no.', accessorFn: (p) => passRef(p), sortingFn: valueSort, size: 150, cell: ({ row }) => <span className="gp-ref">{passRef(row.original)}</span> },
    {
      id: 'dt', header: 'Date & time', accessorFn: (p) => p.created_at || p.pass_date, sortingFn: valueSort, size: 130,
      cell: ({ row }) => <span className="gp-dt">{row.original.pass_date || 'N/A'}<small>{passTime(row.original.created_at) || 'Time not recorded'}</small></span>,
    },
    { id: 'type', header: 'Type', accessorFn: (p) => direction(p), sortingFn: valueSort, size: 90, cell: ({ row }) => <TypePill pass={row.original} /> },
    {
      id: 'asset', header: 'Vehicle / asset', accessorFn: (p) => p.asset_no || undefined, sortingFn: valueSort, sortUndefined: 'last', size: 190,
      cell: ({ row }) => {
        const f = fleetRow(row.original)
        return (
          <span className="gp-veh">
            <VehicleThumb row={f || { asset_no: row.original.asset_no }} size="sm" />
            <span className="gp-clip">
              {row.original.asset_no
                ? <Link to={`/asset-management/${encodeURIComponent(row.original.asset_no)}`} onClick={(e) => e.stopPropagation()} className="gp-link" title={row.original.asset_no}><b>{row.original.asset_no}</b></Link>
                : <b>N/A</b>}
              <small title={vehicleLine(f)}>{vehicleLine(f)}</small>
            </span>
          </span>
        )
      },
    },
    {
      id: 'driver', header: 'Driver / operator', accessorFn: (p) => p.custom_data?.driver_name || undefined, sortingFn: valueSort, sortUndefined: 'last', size: 170,
      cell: ({ row }) => <Person name={row.original.custom_data?.driver_name} id={row.original.custom_data?.driver_id} />,
    },
    { id: 'site', header: 'Site', accessorFn: (p) => p.site || undefined, sortingFn: valueSort, sortUndefined: 'last', size: 120, cell: ({ getValue }) => <Clip value={getValue()} /> },
    { id: 'purpose', header: 'Purpose', accessorFn: (p) => p.custom_data?.purpose || undefined, sortingFn: valueSort, sortUndefined: 'last', size: 140, cell: ({ getValue }) => <Clip value={getValue()} /> },
    {
      id: 'status', header: 'Status', accessorFn: (p) => VIEW_STATUS_META[viewStatus(p, now)].label, sortingFn: valueSort, size: 120,
      cell: ({ row }) => <StatusPill status={viewStatus(row.original, now)} />,
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, size: 130,
      cell: ({ row }) => (
        <span className="gp-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="cc-icon-btn" aria-label={`View ${passRef(row.original)}`} onClick={() => setSelectedId(row.original.id)}><Eye size={14} /></button>
          <button type="button" className="cc-icon-btn" aria-label={`Edit ${passRef(row.original)}`} onClick={() => openEdit(row.original)}><Pencil size={14} /></button>
          <ActionMenu label="More" items={actionsFor(row.original)} disabled={busyId === row.original.id} />
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [now, fleetRow, busyId, names, activeCountry, profile, today])

  const inward = form.direction === 'inward'
  const selStatus = selected ? viewStatus(selected, now) : null
  const selTl = selected ? timeline(selected, names) : []
  const selFleet = selected ? fleetRow(selected) : null
  const selC = selected?.custom_data || {}

  return (
    <div className="cc gp-page">
      <PageHero
        title="Gate Pass"
        lead="Control and monitor vehicle, equipment and material movement in and out of sites"
        imgLight="/dashboard/hero-gatepass-light.webp"
        imgDark="/dashboard/hero-gatepass-dark.webp"
      />

      {actionError && (
        <div className="cc-card gp-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>{actionError}</div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="gp-layout">
        <div className="gp-main">
          <div className="cc-kpis gp-kpis">
            <Kpi icon={FileText} tone="t-green" value={rowsError ? null : kpis.total} label="Total gate passes" loading={rowsLoading} onClick={() => setTab('all')} title={`All passes dated ${rangeLabel}`} />
            <Kpi icon={LogIn} tone="t-green" value={rowsError ? null : kpis.checkedIn} label="Checked in" loading={rowsLoading} onClick={() => setTab('inward')} title="Inward passes with a recorded check-in" />
            <Kpi icon={LogOut} tone="t-blue" value={rowsError ? null : kpis.checkedOut} label="Checked out" loading={rowsLoading} onClick={() => setTab('outward')} title="Exit clearances issued plus inward passes checked out" />
            <Kpi icon={Warehouse} tone="t-blue" value={rowsError ? null : kpis.inYard} label="In yard" loading={rowsLoading} onClick={() => setTab('in_yard')} title="Checked in on an inward pass and not yet checked out" />
            <Kpi icon={AlarmClock} tone="t-red" value={rowsError ? null : kpis.overstay} label="Overstay" loading={rowsLoading} danger={kpis.overstay > 0} onClick={() => setTab('overstay')} title={OVERSTAY_RULE} />
            <Kpi icon={XCircle} tone="t-red" value={rowsError ? null : kpis.rejected} label="Rejected" loading={rowsLoading} onClick={() => setTab('rejected')} title="Passes denied at the gate" />
          </div>

          <Card title="Gate passes" sub={`${fmtInt(filtered.length)} of ${fmtInt(rows.length)} passes dated ${rangeLabel}${kpis.pending ? `. ${fmtInt(kpis.pending)} awaiting approval or arrival` : ''}.`}
            action={
              <div className="gp-actions">
                <button type="button" className="cc-btn-ghost" onClick={() => doExcel()} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!filtered.length}><Printer size={14} aria-hidden="true" /> Log PDF</button>
                <button type="button" className="cc-icon-btn" onClick={reloadAll} aria-label="Refresh"><RefreshCw size={14} /></button>
              </div>
            }>
            <Tabs label="Gate pass status" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, count: rowsError ? null : counts[t.key], countTone: t.key === 'overstay' || t.key === 'rejected' ? 'bad' : '' }))} />
            <div className="gp-toolbar" style={{ marginTop: 10 }}>
              <div className="gp-range">
                <button type="button" className="cc-icon-btn" aria-label="Previous period" onClick={() => setRange((r) => shiftRange(r.from, r.to, -1))}><ChevronLeft size={15} /></button>
                <input type="date" aria-label="From date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
                <span>to</span>
                <input type="date" aria-label="To date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
                <button type="button" className="cc-icon-btn" aria-label="Next period" onClick={() => setRange((r) => shiftRange(r.from, r.to, 1))}><ChevronRight size={15} /></button>
                <button type="button" className="cc-btn-ghost" onClick={() => setRange({ from: today, to: today })}>Today</button>
              </div>
              <div className="gp-range">
                <select className="cc-select" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                  <option value="">All sites</option>
                  {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button type="button" className="cc-btn-ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}><SlidersHorizontal size={14} aria-hidden="true" /> More filters{filtersOn ? ' (on)' : ''}</button>
              </div>
            </div>
            {sitesError && <p className="gp-note">Site list unavailable. Passes still load for every site.</p>}
            {moreOpen && (
              <div className="gp-more">
                <div className="cc-search">
                  <Search size={14} aria-hidden="true" />
                  <input aria-label="Search gate passes" placeholder="Search pass no, asset, driver, site, purpose, reason..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <select className="cc-select" aria-label="Purpose" value={purposeFilter} onChange={(e) => setPurposeFilter(e.target.value)}>
                  <option value="">All purposes</option>
                  {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <label className="gp-check"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Awaiting approval or arrival only</label>
                {filtersOn && <button type="button" className="cc-btn-ghost" onClick={() => { setSearch(''); setPurposeFilter(''); setPendingOnly(false) }}><X size={13} aria-hidden="true" /> Clear</button>}
              </div>
            )}
            {truncated && <p className="gp-note">Showing the newest 20,000 passes in this period. Narrow the dates to see the rest.</p>}
            <div style={{ marginTop: 10 }}>
              <EnterpriseTable
                className="cc-et gp-table"
                columns={columns}
                data={filtered}
                getRowId={(p) => String(p.id)}
                loading={rowsLoading}
                error={rowsError || null}
                onRetry={() => loadRows()}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                enableColumnVisibility={false}
                stickyHeader={false}
                enableRowSelection
                bulkActions={(sel, clear) => (
                  <>
                    <button type="button" className="cc-btn-ghost" onClick={() => doExcel(sel)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected ({sel.length})</button>
                    <button type="button" className="cc-btn-ghost" onClick={clear}>Clear selection</button>
                  </>
                )}
                onRowClick={(p) => setSelectedId(p.id)}
                viewKey="gate-pass-log"
                initialPageSize={25}
                emptyMessage={filtersOn || tab !== 'all' ? 'No passes match these filters.' : `No gate passes dated ${rangeLabel}.`}
              />
            </div>
            <p className="gp-note">{DIRECTION_RULE} Gate pass numbers are derived from each record&apos;s id.</p>
          </Card>

          <div className="gp-bottom">
            <Card title="Gate pass details" sub={selected ? undefined : 'Select a pass in the table.'}>
              <CardState state={{ loading: rowsLoading, data: rows.length ? rows : null, error: rowsError, retry: () => loadRows() }} empty={!selected ? 'No pass selected.' : null}>
                {selected && (
                  <>
                    <div className="gp-detail-head">
                      <div className="gp-clip"><span className="cc-card-sub">Gate pass no.</span><br /><b>{passRef(selected)}</b></div>
                      <span className="gp-pills"><TypePill pass={selected} /><StatusPill status={selStatus} /></span>
                    </div>
                    <dl className="gp-details">
                      <div className="gp-wide gp-who">
                        <div><dt>Vehicle / asset</dt><dd className="gp-veh"><VehicleThumb row={selFleet || { asset_no: selected.asset_no }} size="md" /><span><b>{selected.asset_no || 'N/A'}</b><small>{selFleet ? [selFleet.make, selFleet.model, selFleet.vehicle_type].filter(Boolean).join(' ') : 'Not in the fleet register'}</small></span></dd></div>
                        <div><dt>Driver / operator</dt><dd><Person name={selC.driver_name} id={selC.driver_id} large /></dd></div>
                      </div>
                      <div><dt>Date & time</dt><dd>{fmtStamp(selected.created_at ? Date.parse(selected.created_at) : null)}</dd></div>
                      <div><dt>Site</dt><dd>{selected.site || 'N/A'}</dd></div>
                      <div><dt>Purpose</dt><dd>{selC.purpose || 'N/A'}</dd></div>
                      <div><dt>Expected in time</dt><dd>{fmtStamp(expectedInAt(selected))}</dd></div>
                      <div><dt>Expected out time</dt><dd>{fmtStamp(expectedOutAt(selected))}</dd></div>
                      <div><dt>Actual out time</dt><dd>{fmtStamp(checkedOutAt(selected))}</dd></div>
                      {selected.denial_reason && <div className="gp-wide"><dt>Denial reason</dt><dd>{selected.denial_reason}</dd></div>}
                      {selected.notes && <div className="gp-wide"><dt>Remarks</dt><dd>{selected.notes}</dd></div>}
                    </dl>
                    <div className="gp-detail-actions">
                      {actionsFor(selected).filter(Boolean).slice(1).map((a) => (
                        <button key={a.label} type="button" className="cc-btn-ghost" disabled={busyId === selected.id} onClick={a.onClick}><a.icon size={14} aria-hidden="true" /> {a.label}</button>
                      ))}
                    </div>
                  </>
                )}
              </CardState>
            </Card>

            <div className="gp-main">
              <Card title="Photos & documents">
                <CardState state={{ loading: rowsLoading, data: rows.length ? rows : null, error: rowsError, retry: () => loadRows() }} empty={!selected ? 'No pass selected.' : null}>
                  {selected && (
                    <div className="gp-evidence">
                      <Paperclip size={16} aria-hidden="true" />
                      <div>
                        Gate passes do not store photos or documents yet, so nothing is shown here.
                        {selected.inspection_id
                          ? <> The evidence for this exit is the day&apos;s tyre inspection: <Link className="gp-link" to="/inspections">open Inspections</Link> (inspection recorded for {selected.asset_no || "this asset"} on {selected.pass_date || "the pass date"}).</>
                          : ' No tyre inspection is linked to this pass.'}
                      </div>
                    </div>
                  )}
                </CardState>
              </Card>
              <Card title="Gate pass timeline" sub="Steps are shown only from recorded times.">
                <CardState state={{ loading: rowsLoading, data: rows.length ? rows : null, error: rowsError, retry: () => loadRows() }} empty={!selected ? 'No pass selected.' : null}>
                  {selected && (
                    <ol className="gp-timeline">
                      {selTl.map((s) => (
                        <li key={s.key} className={`${s.state} ${s.tone || ''}`}>
                          <i aria-hidden="true">{s.state === 'done' && <CheckCircle2 size={11} color="#fff" />}</i>
                          <b>{s.label}</b>
                          <span>{s.state === 'done' ? fmtStamp(s.at) : (s.note || 'Not reached')}</span>
                          {s.state === 'done' && s.by && <span className="gp-by" title={s.by}>{s.by}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardState>
              </Card>
            </div>
          </div>

          <div className="gp-three">
            <Card title="Today by site" sub={todayDisplay}>
              <CardState state={{ loading: todayLoading, data: todayPasses, error: todayError, retry: () => loadToday() }} empty={!todayPasses.length ? 'No gate passes recorded today yet.' : null}>
                <ul className="cc-list">
                  {bySite.map((s) => (
                    <li key={s.site} className="cc-row">
                      <div className="cc-row-main"><div className="cc-row-title" title={s.site}>{s.site}</div><div className="cc-row-meta">{s.cleared} cleared, {s.denied} denied{s.other ? `, ${s.other} other` : ''}</div></div>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
            <Card title="Exit flow by hour" sub={`Cleared and denied exits, ${rangeLabel}`}>
              <CardState state={{ loading: rowsLoading, data: rows, error: rowsError, retry: () => loadRows() }} empty={!activeHours.length ? 'No exits decided in this period.' : null}>
                <ul className="gp-flow" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {activeHours.map((h) => (
                    <li key={h.hour}>
                      <span className="gp-h">{h.label}</span>
                      <span className="gp-track" aria-hidden="true">
                        <span style={{ width: `${(h.cleared / hourMax) * 100}%`, background: 'var(--cc-green)' }} />
                        <span style={{ width: `${(h.denied / hourMax) * 100}%`, background: 'var(--cc-red)' }} />
                      </span>
                      <span className="gp-n" title={`${h.cleared} cleared, ${h.denied} denied`}><b>{h.cleared}</b> cleared, <b>{h.denied}</b> denied</span>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
            <Card title="Top denial reasons" sub={rangeLabel}>
              <CardState state={{ loading: rowsLoading, data: rows, error: rowsError, retry: () => loadRows() }} empty={!reasons.top.length && !reasons.unstated ? 'No exits were denied in this period.' : null}>
                <ul className="cc-list">
                  {reasons.top.map((r) => (
                    <li key={r.reason} className="cc-row"><div className="cc-row-main"><div className="cc-row-title" title={r.reason}>{r.reason}</div></div><b>{r.count}</b></li>
                  ))}
                  {reasons.unstated > 0 && <li className="cc-row"><div className="cc-row-main"><div className="cc-row-meta">No reason given</div></div><b>{reasons.unstated}</b></li>}
                </ul>
              </CardState>
            </Card>
          </div>
        </div>

        <aside className="gp-rail">
          <div ref={panelRef}>
            <Card title="New gate pass" action={checkoutFor || form.assetNo ? <button type="button" className="cc-icon-btn" aria-label="Clear the form" onClick={() => { setForm(EMPTY_FORM); setCheckoutFor(null); resetClearance(); setFormError('') }}><X size={14} /></button> : null}>
              <form className="gp-form" onSubmit={(e) => { e.preventDefault(); if (inward) createInward() }}>
                <div className="gp-seg" role="group" aria-label="Pass type">
                  <button type="button" aria-pressed={inward} onClick={() => { setForm((f) => ({ ...f, direction: 'inward' })); setCheckoutFor(null); resetClearance() }}>Inward</button>
                  <button type="button" aria-pressed={!inward} onClick={() => { setForm((f) => ({ ...f, direction: 'outward' })); resetClearance() }}>Outward</button>
                </div>
                {checkoutFor && <p className="gp-note" style={{ marginTop: 0 }}>Checking out {checkoutFor.asset_no} ({passRef(checkoutFor)}). The exit clearance below closes the inward pass.</p>}
                <label>
                  <span>Vehicle / asset <em>*</em></span>
                  <span className="gp-inline">
                    <input list="gp-assets" value={form.assetNo} placeholder="Select vehicle or asset" autoComplete="off"
                      onChange={(e) => { setForm((f) => ({ ...f, assetNo: e.target.value })); resetClearance() }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !inward) { e.preventDefault(); checkClearance() } }} />
                    <button type="button" className="cc-icon-btn" aria-label="Scan QR code" onClick={() => setScanOpen(true)}><QrCode size={15} /></button>
                  </span>
                  <datalist id="gp-assets">{assetOptions.map((a) => <option key={a} value={a} />)}</datalist>
                  {fleet.error && <small className="gp-note">Asset list unavailable. Type the asset number.</small>}
                </label>
                <div className="gp-row2">
                  <label><span>Driver / operator {inward && <em>*</em>}</span><input value={form.driverName} placeholder="Name" onChange={(e) => setForm((f) => ({ ...f, driverName: e.target.value }))} /></label>
                  <label><span>Employee ID</span><input value={form.driverId} placeholder="ID" onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} /></label>
                </div>
                <label><span>Site</span>
                  <select value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))}>
                    <option value="">Select site</option>
                    {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label><span>Purpose {inward && <em>*</em>}</span>
                  <select value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}>
                    <option value="">Select purpose</option>
                    {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <div className="gp-row2 gp-when">
                  <label><span>Expected in time</span><input type="datetime-local" value={form.expectedIn} onChange={(e) => setForm((f) => ({ ...f, expectedIn: e.target.value }))} /></label>
                  <label><span>Expected out time</span><input type="datetime-local" value={form.expectedOut} onChange={(e) => setForm((f) => ({ ...f, expectedOut: e.target.value }))} /></label>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--cc-ink-2)', fontWeight: 500 }}>Documents</span>
                  <div className="gp-upload" aria-disabled="true"><Upload size={16} aria-hidden="true" /><br />Document upload is not available yet: gate passes have no document storage.</div>
                </div>
                <label><span>Remarks</span><textarea rows={2} value={form.remarks} placeholder="Enter remarks" onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></label>

                {inward ? (
                  <>
                    <label className="gp-check" style={{ flexDirection: 'row' }}><input type="checkbox" checked={form.preApproval} onChange={(e) => setForm((f) => ({ ...f, preApproval: e.target.checked }))} /> Pre-approval required</label>
                    <p className="gp-note" style={{ marginTop: 0 }}>{form.preApproval ? 'The pass waits as pending until it is approved and the vehicle checks in.' : 'The vehicle is checked in now.'}</p>
                    {formError && <p className="gp-err" role="alert">{formError}</p>}
                    <div className="gp-form-actions">
                      <button type="button" className="cc-btn-ghost" onClick={() => { setForm(EMPTY_FORM); setFormError('') }}>Cancel</button>
                      <button type="submit" className="cc-btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create gate pass'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="gp-note" style={{ marginTop: 0 }}>No vehicle may leave the site without a completed tyre inspection today.</p>
                    <button type="button" className="cc-btn-primary" style={{ justifyContent: 'center' }} onClick={() => checkClearance()} disabled={checking || !form.assetNo.trim()}>
                      <ShieldCheck size={15} aria-hidden="true" /> {checking ? 'Checking...' : 'Check clearance'}
                    </button>
                    {formError && checkResult == null && <p className="gp-err" role="alert">{formError}</p>}
                    {checkResult === 'found' && inspection && (
                      <div className="gp-result good" role="status">
                        <b>Cleared: tyre inspection completed today</b>
                        <p>{inspection.inspection_type || 'Inspection'} by {inspection.inspector || 'an unrecorded inspector'} at {passTime(inspection.created_at) || 'N/A'}</p>
                        {blockersUnknown && <p>Open safety items could not be checked here. Release is re-checked against open critical items when the pass is issued.</p>}
                        {blockers?.blocked && (
                          <div className="gp-result bad" style={{ marginTop: 8 }} role="alert">
                            <b><Ban size={13} aria-hidden="true" /> Release blocked: {blockers.total} open critical safety item(s)</b>
                            <ul>
                              {blockers.corrective_actions?.map((c) => <li key={c.id}>Corrective action: {c.title} ({c.status})</li>)}
                              {blockers.tyres?.map((t) => <li key={t.id}>Critical tyre {t.serial_no || ''} {t.brand ? `(${t.brand})` : ''}</li>)}
                              {blockers.inspections?.map((i) => <li key={i.id}>Critical inspection: {i.title || i.inspection_type} ({i.status})</li>)}
                            </ul>
                            <p>Resolve or close these before the vehicle can be released.</p>
                          </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                          <EntityApprovalPanel
                            entityType="gate_pass"
                            entityId={inspection.id}
                            entityLabel={inspection.asset_no || form.assetNo.trim() || inspection.id}
                            context={{
                              purpose: 'Vehicle handover / gate release',
                              asset_no: form.assetNo.trim() || inspection.asset_no,
                              inspection_id: inspection.id,
                              inspection_type: inspection.inspection_type,
                              destination: null,
                              site: form.site || inspection.site,
                              pass_date: today,
                            }}
                            title="Gate Pass Approval"
                            onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
                          />
                        </div>
                        {wfLocked && <p><Lock size={12} aria-hidden="true" /> Locked, in approval</p>}
                        {formError && !blockers?.blocked && <p className="gp-err" role="alert">{formError}</p>}
                        <button type="button" className="cc-btn-primary" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => issueExit('Cleared')} disabled={saving || wfLocked || blockers?.blocked}>
                          {saving ? 'Issuing...' : wfLocked ? 'Locked, in approval' : blockers?.blocked ? 'Release blocked' : 'Issue gate pass'}
                        </button>
                      </div>
                    )}
                    {checkResult === 'not-found' && (
                      <div className="gp-result bad" role="status">
                        <b>Not cleared: no tyre inspection found for today</b>
                        {formError && <p className="gp-err" role="alert">{formError}</p>}
                        {!showDenialInput ? (
                          <button type="button" className="cc-btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowDenialInput(true)}>Deny exit</button>
                        ) : (
                          <div className="gp-form" style={{ marginTop: 8 }}>
                            <label><span>Denial reason (optional)</span><input value={denialReason} placeholder="e.g. No inspection record found" onChange={(e) => setDenialReason(e.target.value)} /></label>
                            <div className="gp-form-actions">
                              <button type="button" className="cc-btn-ghost" onClick={() => setShowDenialInput(false)}>Cancel</button>
                              <button type="button" className="cc-btn-primary" style={{ background: 'var(--cc-red)', borderColor: 'var(--cc-red)' }} onClick={() => issueExit('Denied')} disabled={saving}>{saving ? 'Saving...' : 'Confirm deny'}</button>
                            </div>
                          </div>
                        )}
                        <p><Link className="gp-link" to="/inspections">Record today&apos;s inspection</Link></p>
                      </div>
                    )}
                  </>
                )}
              </form>
            </Card>
          </div>

          <Card title="Quick actions">
            <ul className="gp-quick">
              <li><button type="button" onClick={() => { setForm(EMPTY_FORM); setCheckoutFor(null); resetClearance(); panelRef.current?.scrollIntoView({ behavior: 'smooth' }) }}><span className="gp-qi"><Plus size={15} aria-hidden="true" /></span><span><b>New gate pass</b><small>Create an inward or outward pass</small></span></button></li>
              <li><button type="button" disabled={!selected} onClick={() => printPass(selected)}><span className="gp-qi"><Printer size={15} aria-hidden="true" /></span><span><b>Print gate pass</b><small>{selected ? `Print ${passRef(selected)}` : 'Select a pass first'}</small></span></button></li>
              <li><button type="button" onClick={() => setScanOpen(true)}><span className="gp-qi"><QrCode size={15} aria-hidden="true" /></span><span><b>Scan QR code</b><small>Scan an asset label at the gate</small></span></button></li>
              <li><Link to="/data-intake"><span className="gp-qi"><Upload size={15} aria-hidden="true" /></span><span><b>Bulk import</b><small>Import gate passes from Excel</small></span></Link></li>
              <li><button type="button" onClick={doPdf} disabled={!filtered.length}><span className="gp-qi"><BarChart3 size={15} aria-hidden="true" /></span><span><b>Gate pass report</b><small>Download the filtered log as PDF</small></span></button></li>
              <li><button type="button" onClick={() => setTab('overstay')}><span className="gp-qi"><AlarmClock size={15} aria-hidden="true" /></span><span><b>Overstay alert</b><small>{rowsError ? 'Not available' : `${fmtInt(kpis.overstay)} vehicle${kpis.overstay === 1 ? '' : 's'} past expected out time`}</small></span></button></li>
              <li><button type="button" onClick={printPolicy}><span className="gp-qi"><FileText size={15} aria-hidden="true" /></span><span><b>Print policy</b><small>The gate pass tyre inspection policy</small></span></button></li>
            </ul>
            <p className="gp-note">{OVERSTAY_RULE}</p>
          </Card>
        </aside>
      </div>

      {scanOpen && (
        <Suspense fallback={null}>
          <AssetIdentifyScanner
            country={activeCountry}
            onResult={(asset) => { setForm((f) => ({ ...f, assetNo: asset?.asset_no || f.assetNo, site: f.site || asset?.site || '' })); resetClearance() }}
            onClose={() => setScanOpen(false)}
          />
        </Suspense>
      )}

      <Modal open={!!editPass} onClose={() => setEditPass(null)} title={editPass ? `Edit ${passRef(editPass)}` : ''} size="sm"
        footer={<><button type="button" className="btn-secondary" onClick={() => setEditPass(null)}>Cancel</button><button type="button" className="btn-primary" onClick={saveEdit} disabled={busyId === editPass?.id}>Save</button></>}>
        {editForm && (
          <div className="cc"><div className="gp-form">
            <div className="gp-row2">
              <label><span>Driver / operator</span><input value={editForm.driverName} onChange={(e) => setEditForm((f) => ({ ...f, driverName: e.target.value }))} /></label>
              <label><span>Employee ID</span><input value={editForm.driverId} onChange={(e) => setEditForm((f) => ({ ...f, driverId: e.target.value }))} /></label>
            </div>
            <label><span>Purpose</span>
              <select value={editForm.purpose} onChange={(e) => setEditForm((f) => ({ ...f, purpose: e.target.value }))}>
                <option value="">Not set</option>
                {[...new Set([...PURPOSES, editForm.purpose].filter(Boolean))].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div className="gp-row2 gp-when">
              <label><span>Expected in time</span><input type="datetime-local" value={editForm.expectedIn} onChange={(e) => setEditForm((f) => ({ ...f, expectedIn: e.target.value }))} /></label>
              <label><span>Expected out time</span><input type="datetime-local" value={editForm.expectedOut} onChange={(e) => setEditForm((f) => ({ ...f, expectedOut: e.target.value }))} /></label>
            </div>
            <label><span>Remarks</span><textarea rows={3} value={editForm.remarks} onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))} /></label>
          </div></div>
        )}
      </Modal>

      <Modal open={!!rejectPass} onClose={() => setRejectPass(null)} title={rejectPass ? `Reject ${passRef(rejectPass)}` : ''} size="sm"
        footer={<><button type="button" className="btn-secondary" onClick={() => setRejectPass(null)}>Cancel</button><button type="button" className="btn-danger" onClick={confirmReject} disabled={busyId === rejectPass?.id}>Reject pass</button></>}>
        <div className="cc"><div className="gp-form">
          <label><span>Reason (optional)</span><input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Not expected at this site" /></label>
        </div></div>
      </Modal>
    </div>
  )
}
