// Rotation Schedule (/rotation), rebuilt to the owner's light mockup on the
// Command Center kit. Compliance figures come from rotationScheduleAnalytics;
// the register, KPIs, calendar and plan details come from rotationScheduleView.
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarDays, Clock3, CheckCircle2, AlertOctagon, TrendingUp, Coins, Eye, Pencil, RefreshCw, FileSpreadsheet,
  FileText, Search, X, Lock, ShieldCheck, Trash2, ChevronLeft, ChevronRight, ArrowRight, Sparkles, Settings2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as rotations from '../lib/api/rotations'
import { listAssets } from '../lib/api/assets'
import { listTechnicians } from '../lib/api/workshopLive'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import {
  resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme,
  exportSheetsToExcel, reportFileName, reportDateLabel,
} from '../lib/exportUtils'
import Modal from '../components/ui/Modal'
import SideDrawer from '../components/ui/SideDrawer'
import ActionMenu from '../components/ui/ActionMenu'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { Card, CardState, Kpi, KitTable, PageHero, Tabs, VehicleThumb, fmtInt, useCard } from '../components/commandCenter/kit'
import RotationDrawer from '../components/rotation/RotationDrawer'
import CompliancePanels from '../components/rotation/CompliancePanels'
import RotationPlanForm from '../components/rotation/RotationPlanForm'
import PlanDiagram from '../components/rotation/PlanDiagram'
import RotationAttachments from '../components/rotation/RotationAttachments'
import { fmt, fmtDate, fmtKm, StatusBadge } from '../components/rotation/rotationUi'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import {
  buildRotationAnalytics, filterVehicles, autoScheduleEntries,
  DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL, DUE_SOON_BUFFER, WEAR_IMBALANCE_MM, STATUSES,
} from '../lib/rotationScheduleAnalytics'
import {
  enrichSchedules, filterSchedules, optionsOf, buildScheduleKpis, vehicleHistory, nextRecommendation,
  calendarMonth, fleetHistory, treadByPosition, movesText, STATUS_TONE, VIEW_STATUSES, POSITION_OPTIONS, planOf, attachmentsOf,
} from '../lib/rotationScheduleView'
import './RotationSchedule.css'

const NA = <span className="cc-na">N/A</span>
const TABS = [
  { key: 'schedule', label: 'Schedule view' },
  { key: 'calendar', label: 'Calendar view' },
  { key: 'history', label: 'History' },
  { key: 'status', label: 'Vehicle status' },
  { key: 'compliance', label: 'Compliance and impact' },
]
const EMPTY_FILTERS = { site: 'All', vehicleType: 'All', position: 'All', brand: 'All', status: 'All', from: '', to: '', search: '' }

function ViewStatus({ status }) {
  return <span className={`cc-pill ${STATUS_TONE[status] || 'muted'}`}>{status}</span>
}

export default function RotationSchedule() {
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const { profile } = useAuth()
  const orgId = profile?.organisation_id ?? profile?.org_id ?? null
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const moneyOk = !!activeCountry && activeCountry !== 'All'

  // ── Tyre records (compliance analytics) ───────────────────────────────────
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setRecords((await rotations.listRotationRecords({ country: activeCountry })) || [])
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load rotation data'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])
  useEffect(() => { fetchData() }, [fetchData])

  // ── Schedule rows (tyre_rotations) ────────────────────────────────────────
  const [schedules, setSchedules] = useState([])
  const [schedLoading, setSchedLoading] = useState(true)
  const [schedLoadError, setSchedLoadError] = useState(null)
  const [schedError, setSchedError] = useState(null)
  const [schedBusy, setSchedBusy] = useState(false)
  const mapRow = useCallback((r) => ({
    id: r.id, asset: r.asset_no, site: r.site, scheduledDate: r.scheduled_date, priority: r.priority,
    notes: r.notes, currentKm: r.current_km, status: r.status, createdAt: r.created_at,
    rotationType: r.rotation_type, fromPositions: r.from_positions || [], toPositions: r.to_positions || [],
    technicianId: r.technician_id, technicianName: r.technician_name, attachments: r.attachments || [],
    completedAt: r.completed_at, completedKm: r.completed_km,
  }), [])
  const fetchSchedules = useCallback(async () => {
    setSchedLoading(true); setSchedLoadError(null)
    try {
      setSchedules(((await rotations.listRotations({ country: activeCountry })) || []).map(mapRow))
    } catch (e) {
      setSchedLoadError(toUserMessage(e, 'Failed to load schedule'))
    } finally {
      setSchedLoading(false)
    }
  }, [activeCountry, mapRow])
  useEffect(() => { fetchSchedules() }, [fetchSchedules])

  const fleet = useCard(() => listAssets({ country: activeCountry }), [activeCountry])
  const techs = useCard(async () => {
    const list = await listTechnicians()
    const byName = new Map()
    for (const t of list || []) { const name = String(t.full_name || '').trim(); if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { id: t.id, name }) }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  // ── Approval gate + UI state ──────────────────────────────────────────────
  const [detailSchedule, setDetailSchedule] = useState(null)
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [detailSchedule?.id])
  const [pendingRemoveId, setPendingRemoveId] = useState(null)
  const [drawerVehicle, setDrawerVehicle] = useState(null)
  const [tab, setTab] = useState('schedule')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState(null)
  const [formSeed, setFormSeed] = useState({ nonce: 0 })
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [interval, setInterval] = useState(DEFAULT_INTERVAL)
  const [vSearch, setVSearch] = useState('')
  const [vSite, setVSite] = useState('All')
  const [vStatus, setVStatus] = useState('All')

  // ── Writes ────────────────────────────────────────────────────────────────
  const createSchedules = useCallback(async (entries) => {
    if (!entries.length) return true
    setSchedBusy(true); setSchedError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData?.user?.id ?? null
      const created = await rotations.createRotations(entries.map((e) => ({
        asset_no: e.asset, site: e.site, scheduled_date: e.scheduledDate, priority: e.priority, status: e.status || 'Open',
        ...(e.columns || { notes: e.notes || null }), current_km: e.currentKm ?? null,
        country: moneyOk ? activeCountry : null, created_by: uid,
      })))
      await fetchSchedules()
      return created.length ? created : true
    } catch (e) {
      setSchedError(toUserMessage(e, 'Failed to save schedule'))
      return false
    } finally {
      setSchedBusy(false)
    }
  }, [activeCountry, moneyOk, fetchSchedules])

  const isLocked = useCallback((id) => detailSchedule?.id === id && wfLocked, [detailSchedule?.id, wfLocked])

  const updateSchedule = useCallback(async (id, patch) => {
    if (isLocked(id)) { setSchedError('This rotation is locked. An approval is in progress for it.'); return false }
    setSchedBusy(true); setSchedError(null)
    try {
      await rotations.updateRotation(id, { ...patch, updated_at: new Date().toISOString() })
      await fetchSchedules()
      return true
    } catch (e) {
      setSchedError(toUserMessage(e, 'Failed to update schedule'))
      return false
    } finally {
      setSchedBusy(false)
    }
  }, [fetchSchedules, isLocked])

  const confirmRemoveSchedule = useCallback(async () => {
    const id = pendingRemoveId
    if (!id) return
    setSchedBusy(true); setSchedError(null)
    try {
      await rotations.deleteRotation(id)
      await fetchSchedules()
    } catch (e) {
      setSchedError(toUserMessage(e, 'Failed to remove schedule'))
    } finally {
      setSchedBusy(false); setPendingRemoveId(null)
    }
  }, [fetchSchedules, pendingRemoveId])

  // Uploads the picked files for a saved schedule and appends them to its
  // attachments column. A failed file is reported; the schedule stays saved.
  const uploadFiles = useCallback(async (id, kept, files) => {
    if (!files?.length) return true
    if (!orgId) { setSchedError('The schedule was saved, but files could not be uploaded: your company is not set on your profile.'); return false }
    setSchedBusy(true)
    const added = []
    let failed = 0
    for (const f of files) {
      try { added.push(await rotations.uploadRotationAttachment(f, { orgId, rotationId: id })) } catch { failed++ }
    }
    try {
      if (added.length) await rotations.updateRotation(id, { attachments: [...(kept || []), ...added], updated_at: new Date().toISOString() })
      await fetchSchedules()
    } catch (e) {
      setSchedError(toUserMessage(e, 'The files were uploaded but could not be linked to the schedule.'))
      return false
    } finally {
      setSchedBusy(false)
    }
    if (failed) setSchedError(`The schedule was saved, but ${failed} file${failed > 1 ? 's' : ''} could not be uploaded.`)
    return !failed
  }, [orgId, fetchSchedules])

  const saveForm = useCallback(async (entry, editingId) => {
    let id = editingId
    let ok
    if (editingId) {
      ok = await updateSchedule(editingId, {
        asset_no: entry.asset, site: entry.site, scheduled_date: entry.scheduledDate, priority: entry.priority,
        ...entry.columns, attachments: entry.attachments || [], current_km: entry.currentKm ?? null,
      })
    } else {
      ok = await createSchedules([entry])
      id = Array.isArray(ok) ? ok[0]?.id : null
    }
    if (ok && id && entry.files?.length) await uploadFiles(id, entry.attachments, entry.files)
    if (ok) setFormSeed((s) => ({ nonce: s.nonce + 1 }))
    return !!ok
  }, [createSchedules, updateSchedule, uploadFiles])

  // ── Derived ───────────────────────────────────────────────────────────────
  const analytics = useMemo(() => buildRotationAnalytics(records, interval), [records, interval])
  const vehiclesByAsset = useMemo(() => new Map(analytics.vehicles.map((v) => [v.asset, v])), [analytics])
  const fleetByAsset = useMemo(() => new Map((fleet.data || []).map((a) => [a.asset_no, a])), [fleet.data])
  const recordsByAsset = useMemo(() => {
    const m = new Map()
    for (const r of records) { const a = String(r.asset_no || '').trim(); if (!a) continue; if (!m.has(a)) m.set(a, []); m.get(a).push(r) }
    return m
  }, [records])
  const register = useMemo(() => enrichSchedules(schedules, { fleetByAsset, vehiclesByAsset }), [schedules, fleetByAsset, vehiclesByAsset])
  const shown = useMemo(() => filterSchedules(register, filters), [register, filters])
  const filtersOn = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const kpis = useMemo(() => buildScheduleKpis(schedules, analytics, { country: activeCountry, currency: activeCurrency }), [schedules, analytics, activeCountry, activeCurrency])
  const autoEntries = useMemo(() => autoScheduleEntries(analytics.vehicles, schedules, interval), [analytics, schedules, interval])
  const selected = useMemo(() => shown.find((r) => r.id === selectedId) || shown[0] || null, [shown, selectedId])
  const selVehicle = selected ? vehiclesByAsset.get(selected.asset) || null : null
  const selFleet = selected ? fleetByAsset.get(selected.asset) || null : null
  const treadTotal = useMemo(() => treadByPosition(records), [records])

  const assetOptions = useMemo(() => {
    const m = new Map()
    for (const a of fleet.data || []) m.set(a.asset_no, { asset: a.asset_no, site: a.site, type: a.vehicle_type, currentKm: a.current_km ?? null })
    for (const v of analytics.vehicles) {
      const prev = m.get(v.asset)
      m.set(v.asset, { asset: v.asset, site: prev?.site || v.site, type: prev?.type || null, currentKm: v.currentKm ?? prev?.currentKm ?? null })
    }
    return [...m.values()].sort((a, b) => a.asset.localeCompare(b.asset))
  }, [fleet.data, analytics.vehicles])
  const kmByAsset = useMemo(() => new Map(assetOptions.map((a) => [a.asset, a.currentKm])), [assetOptions])
  const completeSchedule = useCallback((r) => {
    const km = Number(kmByAsset.get(r.asset))
    return updateSchedule(r.id, { status: 'Completed', completed_at: new Date().toISOString(), completed_km: Number.isFinite(km) && km > 0 ? km : null })
  }, [kmByAsset, updateSchedule])
  const siteOptions = useMemo(() => optionsOf([...register, ...analytics.vehicles.filter((v) => v.site !== 'Unassigned'), ...(fleet.data || [])], (r) => r.site), [register, analytics.vehicles, fleet.data])

  const vSites = useMemo(() => ['All', ...[...new Set(analytics.vehicles.map((v) => v.site))].sort()], [analytics])
  const filteredVehicles = useMemo(() => filterVehicles(analytics.vehicles, { site: vSite, status: vStatus, search: vSearch }), [analytics, vSite, vStatus, vSearch])

  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const openCreate = (vehicle) => setFormSeed((s) => ({ nonce: s.nonce + 1, vehicle: vehicle || null }))
  const openEdit = (row) => setFormSeed((s) => ({ nonce: s.nonce + 1, editing: row }))

  // ── Register columns ──────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { key: 'no', header: 'Schedule no.', cell: (r) => <button type="button" className="rs-link" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}>{r.no}</button> },
    { key: 'scheduledDate', header: 'Date', cell: (r) => fmtDate(r.scheduledDate) },
    {
      key: 'asset', header: 'Vehicle / asset',
      cell: (r) => (
        <span className="rs-veh">
          <VehicleThumb row={{ asset_no: r.asset, vehicle_type: r.vehicleType, make: r.make, model: r.model }} size="sm" />
          <span><b>{r.asset}</b><small>{r.vehicleType || 'Type not recorded'}</small></span>
        </span>
      ),
    },
    { key: 'brand', header: 'Tyre brand', cell: (r) => r.brand || NA },
    { key: 'current', header: 'Current position', sortValue: (r) => r.plan.from.join(','), cell: (r) => (r.plan.from.length ? `${r.plan.from.join(', ')} to ${r.plan.to.join(', ')}` : NA) },
    { key: 'newPos', header: 'New position', sortable: false, cell: (r) => movesText(r.plan.from, r.plan.to) || NA },
    { key: 'type', header: 'Type', sortValue: (r) => r.plan.type || '', cell: (r) => r.plan.type || NA },
    { key: 'viewStatus', header: 'Status', cell: (r) => <ViewStatus status={r.viewStatus} /> },
    { key: 'tech', header: 'Technician', sortValue: (r) => r.plan.technician || '', cell: (r) => r.plan.technician || NA },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => {
        const locked = isLocked(r.id)
        return (
          <span className="rs-actions-cell" onClick={(e) => e.stopPropagation()} role="presentation">
            <button type="button" className="cc-icon-btn" aria-label={`View ${r.no}`} onClick={() => setSelectedId(r.id)}><Eye size={14} /></button>
            <button type="button" className="cc-icon-btn" aria-label={`Edit ${r.no}`} onClick={() => openEdit(r)} disabled={locked}><Pencil size={14} /></button>
            <ActionMenu
              label="More"
              disabled={schedBusy}
              items={[
                { label: 'Approval', icon: ShieldCheck, onClick: () => setDetailSchedule(r) },
                { label: locked ? 'Locked, in approval' : 'Mark completed', icon: locked ? Lock : CheckCircle2, disabled: locked || r.viewStatus === 'Completed', onClick: () => completeSchedule(r) },
                { label: 'Vehicle rotation history', icon: Clock3, disabled: !vehiclesByAsset.get(r.asset), onClick: () => setDrawerVehicle(vehiclesByAsset.get(r.asset)) },
                { label: 'Remove', icon: Trash2, danger: true, onClick: () => setPendingRemoveId(r.id) },
              ]}
            />
          </span>
        )
      },
    },
  ], [isLocked, schedBusy, completeSchedule, vehiclesByAsset])

  const statusColumns = useMemo(() => [
    { key: 'asset', header: 'Asset', cell: (v) => <button type="button" className="rs-link" onClick={(e) => { e.stopPropagation(); setDrawerVehicle(v) }}>{v.asset}</button> },
    { key: 'site', header: 'Site' },
    { key: 'activeTyreCount', header: 'Active tyres', align: 'right', cell: (v) => fmt(v.activeTyreCount) },
    { key: 'lastRotationDate', header: 'Last rotation', cell: (v) => fmtDate(v.lastRotationDate) },
    { key: 'sinceLastKm', header: 'Since last (km)', align: 'right', sortValue: (v) => v.sinceLastKm ?? -1, cell: (v) => (v.sinceLastKm == null ? NA : <span style={v.sinceLastKm >= interval ? { color: 'var(--cc-red)', fontWeight: 600 } : undefined}>{fmt(v.sinceLastKm)}</span>) },
    { key: 'dueInKm', header: 'Due in (km)', align: 'right', sortValue: (v) => v.dueInKm ?? Number.MAX_SAFE_INTEGER, cell: (v) => (v.dueInKm == null ? NA : <span style={v.dueInKm <= 0 ? { color: 'var(--cc-red)', fontWeight: 600 } : v.dueInKm <= DUE_SOON_BUFFER ? { color: 'var(--cc-amber)' } : undefined}>{v.dueInKm <= 0 ? `${fmt(Math.abs(v.dueInKm))} overdue` : fmt(v.dueInKm)}</span>) },
    { key: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
    { key: 'wearImbalance', header: 'Wear imbalance', align: 'right', sortValue: (v) => v.wearImbalance ?? -1, cell: (v) => (v.wearImbalance == null ? NA : `${v.wearImbalance.toFixed(1)} mm`) },
    { key: 'action', header: '', sortable: false, cell: (v) => <button type="button" className="cc-btn-ghost" onClick={(e) => { e.stopPropagation(); openCreate(v) }}>Schedule</button> },
  ], [interval])

  const historyColumns = [
    { key: 'date', header: 'Date', cell: (e) => fmtDate(e.date) },
    { key: 'asset', header: 'Asset', cell: (e) => <button type="button" className="rs-link" onClick={() => setDrawerVehicle(vehiclesByAsset.get(e.asset))}>{e.asset}</button> },
    { key: 'site', header: 'Site' },
    { key: 'serial', header: 'Serial', cell: (e) => <span className="rs-mono">{e.serial}</span> },
    { key: 'from', header: 'From' },
    { key: 'to', header: 'To' },
    { key: 'km', header: 'Odometer', align: 'right', sortValue: (e) => e.km ?? -1, cell: (e) => fmtKm(e.km) },
  ]

  // ── Exports ───────────────────────────────────────────────────────────────
  const fileBase = reportFileName('TyrePulse Rotation Schedule', moneyOk ? activeCountry : null, reportDateLabel())
  const scheduleExportRows = (rows) => rows.map((r) => ({
    no: r.no, date: r.scheduledDate || '', asset: r.asset, type: r.vehicleType || 'N/A', site: r.site || '', brand: r.brand || 'N/A',
    from: r.plan.from.join(', ') || 'N/A', to: r.plan.to.join(', ') || 'N/A', rot: r.plan.type || 'N/A', status: r.viewStatus,
    priority: r.priority || '', tech: r.plan.technician || 'N/A',
    doneAt: r.completedAt ? fmtDate(r.completedAt) : 'N/A', doneKm: r.completedKm != null ? r.completedKm : 'N/A',
    files: attachmentsOf(r).length, notes: r.plan.freeNotes || '',
  }))
  const SCHED_COLS = ['no', 'date', 'asset', 'type', 'site', 'brand', 'from', 'to', 'rot', 'status', 'priority', 'tech', 'doneAt', 'doneKm', 'files', 'notes']
  const SCHED_HEAD = ['Schedule No', 'Date', 'Asset', 'Vehicle Type', 'Site', 'Tyre Brand', 'Current Positions', 'New Positions', 'Rotation Type', 'Status', 'Priority', 'Technician', 'Completed On', 'Completed At (km)', 'Attachments', 'Notes']

  async function exportExcel(rowsOverride) {
    const rows = rowsOverride || shown
    await exportSheetsToExcel([
      { name: 'Rotation Schedule', note: `${rows.length} of ${register.length} schedules, current filters`, columns: SCHED_COLS, headers: SCHED_HEAD, rows: scheduleExportRows(rows) },
      {
        name: 'Rotation Status',
        note: `${analytics.total} vehicles, interval ${fmt(interval)} km`,
        columns: ['asset', 'site', 'tyres', 'last', 'lastKm', 'since', 'due', 'status', 'rotations', 'imbalance'],
        headers: ['Asset', 'Site', 'Active Tyres', 'Last Rotation Date', 'Last Rotation (km)', 'Since Last (km)', 'Due In (km)', 'Status', 'Total Rotations', 'Wear Imbalance (mm)'],
        rows: analytics.vehicles.map((v) => ({
          asset: v.asset, site: v.site, tyres: v.activeTyreCount, last: fmtDate(v.lastRotationDate), lastKm: v.lastRotationKm ?? 'N/A',
          since: v.sinceLastKm ?? 'N/A', due: v.dueInKm ?? 'N/A', status: v.status, rotations: v.totalRotations,
          imbalance: v.wearImbalance != null ? v.wearImbalance.toFixed(1) : 'N/A',
        })),
      },
    ], fileBase, {
      title: 'Tyre Rotation Schedule',
      company,
      meta: { 'Rotation interval (km)': fmt(interval), 'Fleet compliance': analytics.compliancePct != null ? `${analytics.compliancePct}%` : 'N/A' },
      notes: [
        'Schedule numbers are derived from the record id; the schedule table has no number column.',
        'A rotation is detected when the same serial is recorded at a different axle group.',
      ],
    })
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const title = 'Tyre Rotation Schedule'
    const subtitle = `${shown.length} schedules${filtersOn ? ' after filters' : ''}, interval ${fmt(interval)} km`
    if (!shown.length && !analytics.total) {
      pdfHeader(doc, title, subtitle, company, brand)
      pdfEmptyState(doc, 'Nothing to report', 'No schedules or tyre records match the current view.')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`${fileBase}.pdf`)
      return
    }
    doc.setTextColor(55, 65, 81); doc.setFontSize(8)
    ;[
      ['Schedules', fmtInt(kpis.total)], ['Overdue', fmtInt(kpis.overdue)], ['Completed', fmtInt(kpis.completed)],
      ['Compliance', analytics.compliancePct != null ? `${analytics.compliancePct}%` : 'N/A'],
    ].forEach(([k, v], i) => {
      doc.setFont('helvetica', 'bold'); doc.text(v, 14 + i * 65, 30)
      doc.setFont('helvetica', 'normal'); doc.text(k, 14 + i * 65, 35)
    })
    autoTable(doc, {
      ...pdfTableTheme(brand.accent), startY: 42, margin: { left: 14, right: 14, top: 28 },
      head: [['Schedule No', 'Date', 'Asset', 'Site', 'Current', 'New', 'Type', 'Status', 'Technician']],
      body: scheduleExportRows(shown).map((r) => [r.no, r.date, r.asset, r.site, r.from, r.to, r.rot, r.status, r.tech]),
      didDrawPage: () => pdfHeader(doc, title, subtitle, company, brand),
    })
    if (analytics.vehicles.length) {
      doc.addPage()
      autoTable(doc, {
        ...pdfTableTheme(brand.accent), startY: 30, margin: { left: 14, right: 14, top: 28 },
        head: [['Asset', 'Site', 'Active Tyres', 'Last Rotation', 'Since Last (km)', 'Due In (km)', 'Status', 'Rotations']],
        body: analytics.vehicles.map((v) => [v.asset, v.site, v.activeTyreCount, fmtDate(v.lastRotationDate), fmt(v.sinceLastKm), fmt(v.dueInKm), v.status, v.totalRotations]),
        didDrawPage: () => pdfHeader(doc, 'Rotation compliance by vehicle', `${analytics.total} vehicles`, company, brand),
      })
    }
    const total = doc.internal.getNumberOfPages()
    for (let p = 1; p <= total; p++) { doc.setPage(p); pdfFooter(doc, p, total, company, brand) }
    doc.save(`${fileBase}.pdf`)
  }

  const reloadAll = () => { fetchData(); fetchSchedules(); fleet.retry() }
  const schedState = { loading: schedLoading, data: schedules, error: schedLoadError, retry: fetchSchedules }
  const recState = { loading, data: loading ? null : records, error, retry: fetchData }
  const rec = selVehicle ? nextRecommendation(selVehicle, recordsByAsset.get(selVehicle.asset) || [], interval) : null
  const selHistory = useMemo(() => {
    if (!selected) return []
    const detected = vehicleHistory(selVehicle).map((e) => ({ ...e, technician: null, status: 'Detected' }))
    const done = register.filter((r) => r.asset === selected.asset && r.viewStatus === 'Completed')
      .map((r) => ({ date: r.completedAt || r.scheduledDate, from: r.plan.from.join(', ') || null, to: r.plan.to.join(', ') || null, technician: r.plan.technician, status: 'Completed' }))
    return [...done, ...detected].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }, [selected, selVehicle, register])
  const selTread = selected ? treadByPosition(recordsByAsset.get(selected.asset) || []) : null
  const cal = useMemo(() => calendarMonth(shown, calMonth), [shown, calMonth])

  const intervalControl = (
    <div className="rs-interval">
      <label htmlFor="rs-interval"><Settings2 size={14} aria-hidden="true" /> Rotation interval</label>
      <input id="rs-interval" type="range" min={MIN_INTERVAL} max={MAX_INTERVAL} step={1000} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />
      <input type="number" aria-label="Rotation interval in km" min={MIN_INTERVAL} max={MAX_INTERVAL} step={1000} value={interval}
        onChange={(e) => setInterval(Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, Number(e.target.value) || MIN_INTERVAL)))} />
      <span>km. Every compliance figure recalculates for this interval.</span>
    </div>
  )

  const planDetails = (
    <Card title="Rotation plan details" action={selected ? <ViewStatus status={selected.viewStatus} /> : null}>
      <CardState state={schedState} empty={!selected ? 'Select a schedule to see its plan.' : null}>
        {selected && (
          <>
            <div className="rs-plan-head">
              <VehicleThumb row={{ asset_no: selected.asset, vehicle_type: selected.vehicleType, make: selected.make, model: selected.model }} size="lg" />
              <div><b>{selected.asset}</b><small>{[selFleet?.make, selFleet?.model].filter(Boolean).join(' ') || selected.vehicleType || 'Model not recorded'}</small></div>
            </div>
            <dl className="rs-dl rs-dl3">
              <div><dt>Schedule no.</dt><dd>{selected.no}</dd></div>
              <div><dt>Date</dt><dd>{fmtDate(selected.scheduledDate)}</dd></div>
              <div><dt>Type</dt><dd>{selected.plan.type || 'Not recorded'}</dd></div>
            </dl>
            <dl className="rs-dl rs-dl3">
              <div><dt>Technician</dt><dd>{selected.plan.technician || 'Not recorded'}</dd></div>
              <div><dt>Completed on</dt><dd>{selected.completedAt ? fmtDate(selected.completedAt) : 'N/A'}</dd></div>
              <div><dt>Completed at</dt><dd>{selected.completedKm != null ? fmtKm(selected.completedKm) : 'N/A'}</dd></div>
            </dl>
            {selected.plan.recorded ? (
              <div className="rs-diagrams">
                <PlanDiagram label="Current position" positions={selected.plan.from} tone="var(--cc-green)" />
                <ArrowRight size={20} aria-hidden="true" />
                <PlanDiagram label="New position" positions={selected.plan.to} tone="var(--cc-blue)" />
              </div>
            ) : <div className="cc-empty">No positions recorded for this schedule. Edit it to add the rotation plan.</div>}
            {selected.plan.freeNotes && <p className="rs-note">{selected.plan.freeNotes}</p>}
          </>
        )}
      </CardState>
    </Card>
  )

  return (
    <div className="cc rs-page">
      <PageHero
        title="Rotation Schedule"
        lead="Plan and manage tyre rotation based on usage, wear, position and mileage to maximize tyre life and performance."
        imgLight="/dashboard/hero-rotation-light.webp"
        imgDark="/dashboard/hero-rotation-dark.webp"
      />

      {schedError && (
        <div className="cc-card rs-banner" role="alert">
          <AlertOctagon size={16} aria-hidden="true" /><div>{schedError}</div>
          <button type="button" className="cc-icon-btn" onClick={() => setSchedError(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis">
        <Kpi icon={CalendarDays} tone="t-green" value={kpis.total} label="Total schedules" loading={schedLoading} />
        <Kpi icon={Clock3} tone="t-blue" value={kpis.dueThisMonth} label="Due this month" loading={schedLoading} onClick={() => { setTab('calendar'); setCalMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }} />
        <Kpi icon={CheckCircle2} tone="t-green" value={kpis.completed} label="Completed" loading={schedLoading} onClick={() => { setTab('schedule'); setF({ status: 'Completed' }) }} />
        <Kpi icon={AlertOctagon} tone="t-red" value={kpis.overdue} label="Overdue" danger={kpis.overdue > 0} loading={schedLoading} onClick={() => { setTab('schedule'); setF({ status: 'Overdue' }) }} />
        <Kpi icon={TrendingUp} tone="t-purple" display={kpis.lifeIncreasePct == null ? 'N/A' : `${kpis.lifeIncreasePct}%`} label="Avg. tyre life increase" loading={loading} title={kpis.lifeReason} />
        <Kpi icon={Coins} tone="t-amber" display={kpis.costSaving ? `${kpis.costSaving.currency || ''} ${fmtInt(Math.round(kpis.costSaving.value))}`.trim() : 'N/A'} label={`Cost saving${moneyOk ? ` (${activeCurrency})` : ''}, potential`} loading={loading} title={kpis.costReason} />
      </div>

      <div className="rs-layout">
        <div className="rs-main">
          <Card>
            <div className="rs-toolbar">
              <Tabs tabs={TABS.map((t) => (t.key === 'schedule' ? { ...t, count: register.length || null } : t))} value={tab} onChange={setTab} label="Rotation views" />
              <div className="rs-tools">
                <button type="button" className="cc-btn-ghost" onClick={() => exportExcel()} disabled={loading && schedLoading}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={exportPdf} disabled={loading && schedLoading}><FileText size={14} aria-hidden="true" /> PDF report</button>
                <button type="button" className="cc-icon-btn" onClick={reloadAll} aria-label="Refresh"><RefreshCw size={14} /></button>
              </div>
            </div>

            {(tab === 'schedule' || tab === 'calendar') && (
              <div className="rs-filters">
                <select className="cc-select" aria-label="Site" value={filters.site} onChange={(e) => setF({ site: e.target.value })}>
                  <option value="All">All sites</option>{optionsOf(register, (r) => r.site).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Vehicle type" value={filters.vehicleType} onChange={(e) => setF({ vehicleType: e.target.value })}>
                  <option value="All">All vehicle types</option>{optionsOf(register, (r) => r.vehicleType).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Position" value={filters.position} onChange={(e) => setF({ position: e.target.value })}>
                  <option value="All">All positions</option>{POSITION_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Tyre brand" value={filters.brand} onChange={(e) => setF({ brand: e.target.value })}>
                  <option value="All">All tyre brands</option>{optionsOf(register, (r) => r.brands).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
                  <option value="All">All status</option>{VIEW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className="rs-range">
                  <input type="date" aria-label="From date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
                  <span>to</span>
                  <input type="date" aria-label="To date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
                </span>
                <div className="cc-search"><Search size={14} aria-hidden="true" /><input value={filters.search} onChange={(e) => setF({ search: e.target.value })} placeholder="Search by vehicle, serial number" aria-label="Search by vehicle or serial number" /></div>
                {filtersOn && <button type="button" className="cc-btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}><X size={13} aria-hidden="true" /> Clear</button>}
              </div>
            )}

            {tab === 'schedule' && (
              <div className="rs-mt">
                <KitTable
                  className="rs-table"
                  columns={columns}
                  rows={shown}
                  getRowId={(r) => String(r.id)}
                  loading={schedLoading}
                  error={schedLoadError || null}
                  onRetry={fetchSchedules}
                  enableRowSelection
                  bulkActions={(sel, clear) => (
                    <>
                      <button type="button" className="cc-btn-ghost" onClick={() => exportExcel(sel)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected ({sel.length})</button>
                      <button type="button" className="cc-btn-ghost" disabled={schedBusy} onClick={async () => { for (const r of sel) { if (r.viewStatus !== 'Completed' && !isLocked(r.id)) await completeSchedule(r) } clear() }}><CheckCircle2 size={14} aria-hidden="true" /> Mark completed</button>
                      <button type="button" className="cc-btn-ghost" onClick={clear}>Clear selection</button>
                    </>
                  )}
                  onRowClick={(r) => setSelectedId(r.id)}
                  viewKey="rotation-schedule-register"
                  empty={filtersOn ? 'No schedules match these filters.' : 'No rotations scheduled yet. Create one on the right, or use Auto generate schedule.'}
                />
                <p className="rs-note">Schedule numbers are derived from each record (ROT-year-id); the schedule table has no number column. {register.length ? `${shown.length} of ${register.length} shown; the exports cover exactly these.` : ''}</p>
              </div>
            )}

            {tab === 'calendar' && (
              <div className="rs-mt">
                <div className="rs-cal-head">
                  <button type="button" className="cc-icon-btn" aria-label="Previous month" onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
                  <b>{cal.label}</b>
                  <button type="button" className="cc-icon-btn" aria-label="Next month" onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
                </div>
                <CardState state={schedState}>
                  <div className="rs-cal" role="grid" aria-label={`Rotation schedule, ${cal.label}`}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="rs-cal-dow" role="columnheader">{d}</div>)}
                    {cal.weeks.flat().map((d) => (
                      <div key={d.key} className={`rs-cal-day ${d.inMonth ? '' : 'out'}`} role="gridcell">
                        <span>{d.day}</span>
                        {d.items.slice(0, 3).map((r) => (
                          <button key={r.id} type="button" className={`cc-pill ${STATUS_TONE[r.viewStatus]}`} onClick={() => { setSelectedId(r.id); setTab('schedule') }} title={`${r.no}, ${r.viewStatus}`}>{r.asset}</button>
                        ))}
                        {d.items.length > 3 && <small>{d.items.length - 3} more</small>}
                      </div>
                    ))}
                  </div>
                </CardState>
              </div>
            )}

            {tab === 'history' && (
              <div className="rs-mt">
                <CardState state={recState}>
                  <KitTable columns={historyColumns} rows={fleetHistory(analytics.vehicles)} getRowId={(e, i) => `${e.serial}-${e.date}-${i}`} empty="No rotation detected yet. A rotation shows up when the same serial is recorded at a different axle group." />
                  <p className="rs-note">History is detected from tyre records. Completed schedules are listed in the Schedule view with the Completed status.</p>
                </CardState>
              </div>
            )}

            {tab === 'status' && (
              <div className="rs-mt">
                {intervalControl}
                <CardState state={recState} empty={analytics.total === 0 ? 'No tyre records with an asset and a serial exist for this country yet.' : null}>
                  <div className="rs-filters">
                    <div className="cc-search"><Search size={14} aria-hidden="true" /><input value={vSearch} onChange={(e) => setVSearch(e.target.value)} placeholder="Search asset or site" aria-label="Search asset or site" /></div>
                    <select className="cc-select" aria-label="Filter by site" value={vSite} onChange={(e) => setVSite(e.target.value)}>{vSites.map((s) => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}</select>
                    <select className="cc-select" aria-label="Filter by status" value={vStatus} onChange={(e) => setVStatus(e.target.value)}><option value="All">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                  </div>
                  <p className="rs-note" aria-live="polite">{fmtInt(filteredVehicles.length)} of {fmtInt(analytics.total)} vehicles. Compliance {analytics.compliancePct != null ? `${analytics.compliancePct}%` : 'N/A'}, {fmtInt(analytics.overdue)} overdue, {fmtInt(analytics.dueSoon)} due within {fmt(DUE_SOON_BUFFER)} km, average interval {analytics.avgInterval ? `${fmt(analytics.avgInterval)} km` : 'N/A'}.</p>
                  <KitTable columns={statusColumns} rows={filteredVehicles} getRowId={(v) => v.asset} onRowClick={(v) => setDrawerVehicle(v)} viewKey="rotation-status" empty="No vehicles match the current filters" />
                  {filteredVehicles.some((v) => v.wearImbalance != null && v.wearImbalance > WEAR_IMBALANCE_MM) && (
                    <div className="rs-chipline">
                      <span>Unbalanced wear (more than {WEAR_IMBALANCE_MM} mm steer to drive):</span>
                      {filteredVehicles.filter((v) => v.wearImbalance != null && v.wearImbalance > WEAR_IMBALANCE_MM).map((v) => (
                        <button key={v.asset} type="button" className="cc-btn-ghost" onClick={() => setDrawerVehicle(v)}>{v.asset} {v.wearImbalance.toFixed(1)} mm</button>
                      ))}
                    </div>
                  )}
                </CardState>
              </div>
            )}

            {tab === 'compliance' && (
              <div className="rs-mt">
                {intervalControl}
                <CardState state={recState} empty={analytics.total === 0 ? 'No tyre records with an asset and a serial exist for this country yet.' : null}>
                  <CompliancePanels
                    analytics={analytics}
                    currency={activeCurrency}
                    moneyOk={moneyOk}
                    company={company}
                    onPickStatus={(s) => { setVStatus(s); setTab('status') }}
                    onOpenVehicle={setDrawerVehicle}
                    onSchedule={(v) => openCreate(v)}
                  />
                </CardState>
              </div>
            )}
          </Card>

          <div className="rs-three">
            {planDetails}

            <Card title={selected ? `Rotation history (${selected.asset})` : 'Rotation history'} action={selVehicle ? <button type="button" className="cc-link cc-link-btn" onClick={() => setDrawerVehicle(selVehicle)}>View all</button> : null}>
              <CardState state={recState} empty={!selected ? 'Select a schedule to see the vehicle history.' : null}>
                {selected && (
                  <>
                    <KitTable
                      compact
                      columns={[
                        { key: 'date', header: 'Date', cell: (e) => fmtDate(e.date) },
                        { key: 'from', header: 'From', cell: (e) => e.from || NA },
                        { key: 'to', header: 'To', cell: (e) => e.to || NA },
                        { key: 'technician', header: 'Technician', cell: (e) => e.technician || NA },
                        { key: 'status', header: 'Status', cell: (e) => <span className={`cc-pill ${e.status === 'Completed' ? 'good' : 'info'}`}>{e.status}</span> },
                      ]}
                      rows={selHistory.slice(0, 6)}
                      getRowId={(e, i) => `${e.date}-${i}`}
                      empty="No rotation recorded for this vehicle yet."
                    />
                    <div className="rs-next">
                      <b><Sparkles size={14} aria-hidden="true" /> Next recommended rotation</b>
                      {rec && rec.estimatedKm != null ? (
                        <dl className="rs-dl">
                          <div><dt>Recommended date</dt><dd>{rec.overdue ? 'Now (overdue)' : rec.date ? fmtDate(rec.date) : 'N/A'}</dd></div>
                          <div><dt>Estimated km</dt><dd>{fmtKm(rec.estimatedKm)}</dd></div>
                        </dl>
                      ) : <p className="rs-note">Not measurable: this vehicle has no rotation with an odometer reading yet.</p>}
                      {rec && rec.estimatedKm != null && !rec.date && !rec.overdue && <p className="rs-note">A date needs two odometer readings at least 30 days apart for this vehicle.</p>}
                      <button type="button" className="cc-btn-primary" disabled={schedBusy || !autoEntries.length} onClick={() => createSchedules(autoEntries)} title={autoEntries.length ? '' : 'No overdue or due soon vehicle is waiting for a schedule'}>
                        Auto generate schedule{autoEntries.length ? ` (${autoEntries.length})` : ''}
                      </button>
                    </div>
                  </>
                )}
              </CardState>
            </Card>

            <div className="rs-stack">
              <Card title="Tyre wear analysis" sub={selected ? `Average tread by position, ${selected.asset}` : null}>
                <CardState state={recState}>
                  {selTread ? (
                    <div className="cc-bars">
                      {selTread.map((t) => (
                        <div key={t.position} className="rs-bar">
                          <span>{t.position}</span>
                          <span className="cc-bar-track"><i style={{ width: `${Math.min(100, (t.avg / 20) * 100)}%`, background: 'var(--cc-blue)' }} /></span>
                          <b>{t.avg.toFixed(1)} mm</b>
                        </div>
                      ))}
                      <p className="rs-note">Before and after figures need a tread reading at each rotation; these are the latest readings.</p>
                    </div>
                  ) : (
                    <div className="cc-empty">{treadTotal ? 'No tread depth recorded on this vehicle.' : 'Tread depth is not recorded on any tyre record in this scope, so wear before and after rotation cannot be shown.'}</div>
                  )}
                </CardState>
              </Card>
              <Card title="Photos and documents" sub={selected ? selected.no : null}>
                <RotationAttachments row={selected} />
              </Card>
            </div>
          </div>
        </div>

        <aside className="rs-rail">
          <RotationPlanForm
            key={formSeed.nonce}
            seed={formSeed}
            assets={assetOptions}
            sites={siteOptions}
            technicians={techs.data || []}
            techError={!!techs.error}
            busy={schedBusy}
            onCancel={formSeed.editing || formSeed.vehicle ? () => setFormSeed((s) => ({ nonce: s.nonce + 1 })) : null}
            onSave={saveForm}
          />
          {fleet.error && <p className="rs-note">Asset register unavailable. Assets from tyre records are still listed. <button type="button" className="cc-link cc-link-btn" onClick={fleet.retry}>Try again</button></p>}
        </aside>
      </div>

      {drawerVehicle && <RotationDrawer vehicle={drawerVehicle} onClose={() => setDrawerVehicle(null)} />}

      <Modal
        open={!!pendingRemoveId}
        onClose={schedBusy ? undefined : () => setPendingRemoveId(null)}
        title="Remove scheduled rotation"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setPendingRemoveId(null)} disabled={schedBusy} className="btn-secondary disabled:opacity-50">Cancel</button>
            <button type="button" onClick={confirmRemoveSchedule} disabled={schedBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50">
              {schedBusy ? 'Removing...' : 'Remove'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">Remove this scheduled rotation?</p>
      </Modal>

      {/* Scheduled rotation approval rail (tyre_rotation entity). While the
          workflow is active or locked, completing and editing are blocked. */}
      <SideDrawer
        open={!!detailSchedule}
        onClose={() => setDetailSchedule(null)}
        size="lg"
        busy={schedBusy}
        closeLabel="Close rotation approval"
        title={detailSchedule ? detailSchedule.asset : null}
        subtitle={detailSchedule ? [detailSchedule.site, fmtDate(detailSchedule.scheduledDate), detailSchedule.priority].filter(Boolean).join(', ') : null}
        bodyClassName="space-y-4"
      >
        {detailSchedule && (
          <>
            <EntityApprovalPanel
              entityType="tyre_rotation"
              entityId={detailSchedule.id}
              entityLabel={detailSchedule.asset || detailSchedule.id}
              context={{
                asset_no: detailSchedule.asset, due_date: detailSchedule.scheduledDate, priority: detailSchedule.priority,
                status: detailSchedule.status, cost: Number(detailSchedule.currentKm) || 0, site: detailSchedule.site,
              }}
              onStateChange={(st) => setWfLocked(!!(st?.isActive || st?.isLocked))}
              title="Rotation Approval"
            />
            {wfLocked && (
              <div role="status" className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                <Lock size={12} aria-hidden="true" /> Locked, in approval. Completing this rotation is disabled until the workflow finishes.
              </div>
            )}
            {planOf(detailSchedule).recorded && (
              <p className="text-xs text-[var(--text-muted)]">{movesText(planOf(detailSchedule).from, planOf(detailSchedule).to) || ''}</p>
            )}
            <button
              type="button"
              onClick={() => completeSchedule(detailSchedule)}
              disabled={schedBusy || wfLocked || detailSchedule.status === 'Completed'}
              className="btn-primary w-full min-h-[44px] gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              title={wfLocked ? 'Locked, in approval' : 'Mark rotation completed'}
            >
              {wfLocked ? <Lock size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {detailSchedule.status === 'Completed' ? 'Completed' : 'Mark Completed'}
            </button>
          </>
        )}
      </SideDrawer>
    </div>
  )
}
