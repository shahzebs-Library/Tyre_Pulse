/**
 * VehicleCheckInOut (route /vehicle-checkinout) - vehicle handovers. A driver
 * checks a vehicle OUT (odometer, fuel level, condition) and later back IN.
 * Full CRUD on the org and country scoped `vehicle_checkinout` table.
 *
 * Built on the shared page kit to the owner's light mockup: hero with Check in /
 * Check out, tabs (Live status, Check in, Check out, History, Settings), a live
 * board with four tiles, and quick check-in / check-out cards.
 *
 * The live board is derived in `src/lib/vehicleCheckInOutView.js` (a vehicle's
 * state is its latest recorded event). Handover analytics (pairing, time out,
 * km driven, daily trend, exports) stay in `src/lib/vehicleCheckInOutAnalytics.js`.
 * Make and model come from the fleet register; nothing is invented. Degrades
 * gracefully when the table is absent, prompting for
 * MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  ArrowRightLeft, LogIn, LogOut, Search, X, Pencil, Trash2, FileSpreadsheet, FileText,
  AlertTriangle, Loader2, Car, Gauge, CheckCircle2, Clock, Fuel, RefreshCw, Hourglass, Eye,
  MoreVertical, CalendarClock, ArrowRight,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import ActionMenu from '../components/ui/ActionMenu'
import {
  useCard, Card, Tabs, Kpi, PageHero, KitTable, VehicleThumb, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { listCheckInOut, createEntry, updateEntry, deleteEntry } from '../lib/api/vehicleCheckInOut'
import { listAssets } from '../lib/api/assets'
import { probeRelation } from '../lib/api/_client'
import {
  filterHandovers, handoverKpis, pairHandovers, currentlyOut, dailyTrend, handoverExportRows,
  DIRECTIONS, STATUSES, DIRECTION_LABEL, STATUS_LABEL, OVERDUE_HOURS, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/vehicleCheckInOutAnalytics'
import {
  liveStatus, liveKpis, filterLive, withFleet, makeModel, fuelPct, validateQuickEntry, quickPayload,
  LIVE_STATES, LIVE_STATE_META, assetKey,
} from '../lib/vehicleCheckInOutView'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import './vehicleCheckInOut.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'
const READ_LIMIT = 500

const STATUS_CLS = {
  open: 'bg-amber-900/30 text-amber-400 border border-amber-700/50',
  closed: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const FUEL_LEVELS = ['Empty', '1/4', '1/2', '3/4', 'Full']
const EMPTY_FORM = {
  asset_no: '', driver_name: '', direction: 'out', odometer_km: '',
  fuel_level: '', condition_notes: '', site: '', status: 'open',
}
const EMPTY_QUICK = { asset_no: '', odometer_km: '', fuel_pct: '', driver_name: '' }
const TAB_KEYS = ['live', 'in', 'out', 'history', 'settings']

const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString('en-US'))
const fmtPctN = (v) => (v == null ? 'N/A' : `${v}%`)
const fmtHours = (h) => {
  if (h == null) return 'N/A'
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24); const r = Math.round(h % 24)
  return r ? `${d}d ${r}h` : `${d}d`
}
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function toLocalInput(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
  scales: {
    x: { stacked: false, ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 }, precision: 0 }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

function StatePill({ state }) {
  const meta = LIVE_STATE_META[state]
  if (!meta) return <span className="cc-na">N/A</span>
  return <span className={`cc-pill ${meta.tone}`}>{meta.label}</span>
}

function DirectionPill({ direction }) {
  if (!DIRECTION_LABEL[direction]) return <span className="cc-na">N/A</span>
  return <span className={`cc-pill ${direction === 'in' ? 'good' : 'info'}`}>{direction === 'in' ? <LogIn size={11} aria-hidden="true" /> : <LogOut size={11} aria-hidden="true" />} {DIRECTION_LABEL[direction]}</span>
}

function Banner({ tone, title, children, onAction, actionLabel, actionIcon: ActionIcon }) {
  return (
    <div className={`cc-card vcio-banner ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <AlertTriangle size={17} aria-hidden="true" />
      <div>{title && <b>{title}</b>}{children && <p>{children}</p>}</div>
      {onAction && <button type="button" className="cc-btn-ghost" onClick={onAction}>{ActionIcon && <ActionIcon size={14} aria-hidden="true" />} {actionLabel}</button>}
    </div>
  )
}

/** Quick check-in or check-out card. Writes through the existing createEntry. */
function QuickCard({ direction, form, setForm, vehicles, onSubmit, busy, message, disabled, fleetState }) {
  const isIn = direction === 'in'
  const id = `vcio-q-${direction}`
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, confirm: false }))
  return (
    <Card
      title={isIn ? 'Quick check in' : 'Quick check out'}
      sub={isIn ? 'Record a vehicle returning with its odometer and fuel level.' : 'Hand a vehicle out with its odometer and fuel level.'}
    >
      <form className="vcio-quick-form" onSubmit={(e) => { e.preventDefault(); onSubmit() }} noValidate>
        <label className="full" htmlFor={`${id}-asset`}>Select vehicle
          <select id={`${id}-asset`} value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} disabled={disabled}>
            <option value="">{vehicles.length ? 'Choose a vehicle' : (isIn ? 'No vehicle is checked out' : 'No vehicles loaded')}</option>
            {vehicles.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </label>
        <label htmlFor={`${id}-odo`}>Current odometer (km)
          <input id={`${id}-odo`} type="number" min={0} inputMode="numeric" placeholder="e.g. 45000" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} disabled={disabled} />
        </label>
        <label htmlFor={`${id}-fuel`}>Fuel level (%)
          <input id={`${id}-fuel`} type="number" min={0} max={100} inputMode="numeric" placeholder="e.g. 75" value={form.fuel_pct} onChange={(e) => set('fuel_pct', e.target.value)} disabled={disabled} />
        </label>
        {!isIn && (
          <label className="full" htmlFor={`${id}-driver`}>Driver (optional)
            <input id={`${id}-driver`} maxLength={200} placeholder="Driver name" value={form.driver_name} onChange={(e) => set('driver_name', e.target.value)} disabled={disabled} />
          </label>
        )}
        {fleetState?.error && <p className="vcio-note full">The fleet register could not be read, so only vehicles already in the log are listed.</p>}
        {message && <p className={`vcio-msg ${message.tone} full`} role={message.tone === 'bad' ? 'alert' : 'status'}>{message.text}</p>}
        <div className="vcio-quick-foot full">
          <button type="submit" className="cc-btn-primary" disabled={disabled || busy || !form.asset_no}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : (isIn ? <LogIn size={15} aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />)}
            {busy ? 'Saving...' : (form.confirm ? 'Save anyway' : `Proceed to check ${isIn ? 'in' : 'out'}`)}
            {!busy && <ArrowRight size={14} aria-hidden="true" />}
          </button>
        </div>
      </form>
    </Card>
  )
}

export default function VehicleCheckInOut() {
  const { activeCountry } = useSettings()
  const countryScope = activeCountry && activeCountry !== 'All' ? activeCountry : null
  const [tab, setTab] = useState('live')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())

  // Live board filters
  const [liveSite, setLiveSite] = useState('')
  const [liveState, setLiveState] = useState('')
  const [liveDate, setLiveDate] = useState('')
  const [liveSearch, setLiveSearch] = useState('')

  // History filters
  const [directionFilter, setDirectionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [viewing, setViewing] = useState(null)

  const [quickIn, setQuickIn] = useState(EMPTY_QUICK)
  const [quickOut, setQuickOut] = useState(EMPTY_QUICK)
  const [quickBusy, setQuickBusy] = useState('')
  const [quickMsg, setQuickMsg] = useState({ in: null, out: null })

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listCheckInOut({ country: activeCountry, limit: READ_LIMIT })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // listCheckInOut degrades a missing table to [], so the catch below never
      // sees it. Probe only when empty, and believe only a definite answer.
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('vehicle_checkinout')
        setMissing(checked && !exists)
      }
      setNowTick(Date.now())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load check-in and check-out entries.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Fleet register: make, model and the vehicle list for the quick forms. It
  // loads and fails on its own; the board still works without it.
  const fleetCard = useCard(() => listAssets({ country: activeCountry }), [activeCountry])
  const fleet = useMemo(() => (Array.isArray(fleetCard.data) ? fleetCard.data : []), [fleetCard.data])
  const fleetByKey = useMemo(() => {
    const m = new Map()
    for (const f of fleet) { const k = assetKey(f.asset_no); if (k && !m.has(k)) m.set(k, f) }
    return m
  }, [fleet])

  const loaded = Array.isArray(rows)
  const all = useMemo(() => rows || [], [rows])
  const truncated = loaded && all.length >= READ_LIMIT

  // ── Live board ───────────────────────────────────────────────────────────
  const live = useMemo(() => (loaded ? withFleet(liveStatus(all, { now: nowTick }), fleet) : null), [loaded, all, fleet, nowTick])
  const liveTiles = useMemo(() => liveKpis(live, { now: nowTick }), [live, nowTick])
  const liveFiltered = useMemo(() => filterLive(live || [], { site: liveSite, state: liveState, date: liveDate, search: liveSearch }), [live, liveSite, liveState, liveDate, liveSearch])
  const liveSites = useMemo(() => [...new Set((live || []).map((v) => v.site).filter(Boolean))].sort(), [live])
  const hasLiveFilters = !!(liveSite || liveState || liveDate || liveSearch)

  // ── History (existing analytics) ─────────────────────────────────────────
  const filtered = useMemo(() => filterHandovers(all, {
    direction: directionFilter, status: statusFilter, asset: assetFilter, site: siteFilter,
    from: fromDate, to: toDate, search,
  }), [all, directionFilter, statusFilter, assetFilter, siteFilter, fromDate, toDate, search])
  const k = useMemo(() => handoverKpis(filtered, { now: nowTick }), [filtered, nowTick])
  const pairs = useMemo(() => pairHandovers(filtered), [filtered])
  const outNow = useMemo(() => currentlyOut(all, { now: nowTick }), [all, nowTick])
  const trend = useMemo(() => dailyTrend(filtered, { now: nowTick }), [filtered, nowTick])
  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])
  const siteOptions = useMemo(() => [...new Set(all.map((r) => r.site).filter(Boolean))].sort(), [all])

  // Vehicles out on the board (latest event is an open check-out).
  const liveOut = useMemo(() => (live || []).filter((v) => v.state !== 'in'), [live])
  const liveIn = useMemo(() => (live || []).filter((v) => v.state === 'in'), [live])

  // ── Quick-form vehicle lists ─────────────────────────────────────────────
  const vehicleLabel = useCallback((assetNo) => {
    const f = fleetByKey.get(assetKey(assetNo))
    const mm = f ? [f.make, f.model].filter(Boolean).join(' ') : ''
    return mm ? `${assetNo} (${mm})` : String(assetNo)
  }, [fleetByKey])
  const inVehicles = useMemo(() => liveOut.map((v) => ({ value: v.asset_no, label: `${vehicleLabel(v.asset_no)}${v.state === 'overdue' ? ' - overdue' : ''}` })), [liveOut, vehicleLabel])
  const outVehicles = useMemo(() => {
    const outKeys = new Set(liveOut.map((v) => v.key))
    const seen = new Set()
    const list = []
    for (const f of fleet) {
      const key = assetKey(f.asset_no)
      if (!key || seen.has(key) || outKeys.has(key)) continue
      seen.add(key); list.push({ value: f.asset_no, label: vehicleLabel(f.asset_no) })
    }
    for (const v of liveIn) {
      if (seen.has(v.key)) continue
      seen.add(v.key); list.push({ value: v.asset_no, label: vehicleLabel(v.asset_no) })
    }
    return list.sort((a, b) => String(a.value).localeCompare(String(b.value)))
  }, [fleet, liveIn, liveOut, vehicleLabel])

  // ── Full-form modal ──────────────────────────────────────────────────────
  const openCreate = useCallback((direction = 'out', prefill = {}) => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, direction, ...prefill, checked_at: toLocalInput() })
    setFormError(''); setModalOpen(true)
  }, [])
  const openEdit = useCallback((row) => {
    setEditing(row)
    setForm({
      asset_no: row.asset_no || '', driver_name: row.driver_name || '', direction: row.direction || 'out',
      odometer_km: row.odometer_km ?? '', fuel_level: row.fuel_level || '', condition_notes: row.condition_notes || '',
      site: row.site || '', status: row.status || 'open', checked_at: toLocalInput(row.checked_at),
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const setField = (key, v) => setForm((f) => ({ ...f, [key]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.odometer_km !== '' && (!Number.isFinite(Number(form.odometer_km)) || Number(form.odometer_km) < 0)) {
      setFormError('Odometer must be zero or more.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: countryScope,
        checked_at: form.checked_at ? new Date(form.checked_at).toISOString() : undefined,
      }
      if (editing) {
        const updated = await updateEntry(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createEntry(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
      setNowTick(Date.now())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save this entry.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, countryScope])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteEntry(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete this entry.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Quick forms ──────────────────────────────────────────────────────────
  const submitQuick = useCallback(async (direction) => {
    const q = direction === 'in' ? quickIn : quickOut
    const setQ = direction === 'in' ? setQuickIn : setQuickOut
    const f = fleetByKey.get(assetKey(q.asset_no))
    const v = (live || []).find((x) => x.key === assetKey(q.asset_no))
    const { errors, warnings } = validateQuickEntry({ ...q, direction }, { rows: all, live: live || [], fleetKm: f?.current_km })
    if (errors.length) { setQuickMsg((m) => ({ ...m, [direction]: { tone: 'bad', text: errors.join(' ') } })); return }
    if (warnings.length && !q.confirm) {
      setQ((s) => ({ ...s, confirm: true }))
      setQuickMsg((m) => ({ ...m, [direction]: { tone: 'warn', text: `${warnings.join(' ')} Press Save anyway to record it.` } }))
      return
    }
    setQuickBusy(direction)
    setQuickMsg((m) => ({ ...m, [direction]: null }))
    try {
      const payload = quickPayload({
        ...q,
        direction,
        driver_name: q.driver_name || (direction === 'in' ? v?.driver_name : '') || '',
        site: v?.site || f?.site || '',
      }, { country: countryScope, now: Date.now() })
      const created = await createEntry(payload)
      let closed = null
      // A return closes the open check-out it answers, so "open" means still out.
      if (direction === 'in' && v && v.state !== 'in' && v.latest?.id != null) {
        try { closed = await updateEntry(v.latest.id, { status: 'closed' }) } catch { closed = null }
      }
      setRows((prev) => {
        const base = (prev || []).map((r) => (closed && r.id === closed.id ? closed : r))
        return [created, ...base]
      })
      setQ(EMPTY_QUICK)
      setNowTick(Date.now())
      setQuickMsg((m) => ({ ...m, [direction]: { tone: 'good', text: `${payload.asset_no} checked ${direction === 'in' ? 'in' : 'out'}.` } }))
    } catch (err) {
      setQuickMsg((m) => ({ ...m, [direction]: { tone: 'bad', text: toUserMessage(err, 'Could not save this handover.') } }))
    } finally {
      setQuickBusy('')
    }
  }, [quickIn, quickOut, fleetByKey, live, all, countryScope])

  const startQuick = useCallback((direction, assetNo) => {
    if (direction === 'in') { setQuickIn({ ...EMPTY_QUICK, asset_no: assetNo }); setTab('in') } else { setQuickOut({ ...EMPTY_QUICK, asset_no: assetNo }); setTab('out') }
    setQuickMsg({ in: null, out: null })
  }, [])

  // ── Exports ──────────────────────────────────────────────────────────────
  const runExport = useCallback(async (format, source = filtered) => {
    try {
      const u = await loadExportUtils()
      const rowsOut = handoverExportRows(source, fmtDateTime)
      const name = u.reportFileName('TyrePulse Vehicle Check In Out', countryScope, u.reportDateLabel())
      if (format === 'pdf') await u.exportToPdf(rowsOut, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Vehicle Check In/Out', name, 'landscape')
      else await u.exportToExcel(rowsOut, EXPORT_COLS, EXPORT_HEADERS, name)
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }, [filtered, countryScope])

  const exportLive = useCallback(async (list) => {
    try {
      const u = await loadExportUtils()
      const cols = ['asset_no', 'make_model', 'driver', 'site', 'check_out', 'expected_in', 'status']
      const headers = ['Fleet no', 'Make / model', 'Driver', 'Site', 'Check out', 'Expected in', 'Status']
      const data = list.map((v) => ({
        asset_no: v.asset_no || 'N/A', make_model: makeModel(v) || 'N/A', driver: v.driver_name || 'N/A', site: v.site || 'N/A',
        check_out: fmtDateTime(v.checkOutAt), expected_in: fmtDateTime(v.expectedIn), status: LIVE_STATE_META[v.state]?.label || 'N/A',
      }))
      await u.exportToExcel(data, cols, headers, u.reportFileName('TyrePulse Vehicle Live Status', countryScope, u.reportDateLabel()))
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }, [countryScope])

  const clearFilters = () => {
    setDirectionFilter('all'); setStatusFilter('all'); setAssetFilter(''); setSiteFilter('')
    setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = directionFilter !== 'all' || statusFilter !== 'all' || !!(assetFilter || siteFilter || fromDate || toDate || search)

  // ── Live board table ─────────────────────────────────────────────────────
  const liveColumns = useMemo(() => [
    { key: 'asset', header: 'Fleet no', sortValue: (v) => v.asset_no || '',
      cell: (v) => (
        <span className="vcio-vehicle">
          <VehicleThumb row={{ asset_no: v.asset_no, vehicle_type: v.vehicle_type, make: v.make, model: v.model }} size="sm" />
          <b className="vcio-mono">{v.asset_no || 'N/A'}</b>
        </span>
      ) },
    { key: 'makeModel', header: 'Make / model', sortValue: (v) => makeModel(v) || '', cell: (v) => makeModel(v) || <span className="cc-na">N/A</span> },
    { key: 'driver', header: 'Driver', sortValue: (v) => v.driver_name || '', cell: (v) => v.driver_name || <span className="cc-na">N/A</span> },
    { key: 'checkOut', header: 'Check out', sortValue: (v) => v.checkOutAt || '', cell: (v) => fmtDateTime(v.checkOutAt) },
    { key: 'expected', header: 'Expected in', sortValue: (v) => v.expectedIn || '',
      cell: (v) => (v.expectedIn ? <span title={`Check-out time plus ${OVERDUE_HOURS} hours`}>{fmtDateTime(v.expectedIn)}</span> : (v.returnedAt ? <span title="Returned">In {fmtDateTime(v.returnedAt)}</span> : <span className="cc-na">N/A</span>)) },
    { key: 'status', header: 'Status', sortValue: (v) => LIVE_STATES.indexOf(v.state), cell: (v) => <StatePill state={v.state} /> },
    { key: 'actions', header: '', sortable: false, align: 'right',
      cell: (v) => (
        <span className="vcio-row-actions">
          <button type="button" className="cc-icon-btn" onClick={() => setViewing(v)} aria-label={`View handovers for ${v.asset_no}`}><Eye size={15} /></button>
          <ActionMenu label="More" icon={MoreVertical} items={[
            v.state === 'in'
              ? { label: 'Check out', icon: LogOut, onClick: () => startQuick('out', v.asset_no), disabled: missing }
              : { label: 'Check in', icon: LogIn, onClick: () => startQuick('in', v.asset_no), disabled: missing },
            { label: 'Edit latest entry', icon: Pencil, onClick: () => openEdit(v.latest) },
            { label: 'Delete latest entry', icon: Trash2, danger: true, onClick: () => setConfirmDelete(v.latest) },
          ]} />
        </span>
      ) },
  ], [missing, openEdit, startQuick])

  const outColumns = useMemo(() => [
    { key: 'asset', header: 'Asset', sortValue: (r) => r.asset_no || '', cell: (r) => <span className="vcio-mono">{r.asset_no || 'N/A'}</span> },
    { key: 'driver', header: 'Driver', sortValue: (r) => r.driver_name || '', cell: (r) => r.driver_name || <span className="cc-na">N/A</span> },
    { key: 'since', header: 'Out since', sortValue: (r) => r.checkOutAt || '', cell: (r) => fmtDateTime(r.checkOutAt) },
    { key: 'hours', header: 'Time out', sortValue: (r) => r.hoursOut ?? -1, align: 'right',
      cell: (r) => (<span className={r.state === 'overdue' ? 'text-red-500 font-semibold' : ''}>{fmtHours(r.hoursOut)}</span>) },
    { key: 'status', header: 'Status', sortValue: (r) => r.state, cell: (r) => <StatePill state={r.state} /> },
    { key: 'return', header: '', sortable: false, align: 'right',
      cell: (r) => (
        <span className="vcio-row-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => startQuick('in', r.asset_no)} disabled={missing}><LogIn size={13} aria-hidden="true" /> Quick return</button>
          <button type="button" className="cc-btn-ghost" onClick={() => openCreate('in', { asset_no: r.asset_no || '', driver_name: r.driver_name || '', site: r.site || '' })} disabled={missing} aria-label={`Record return of ${r.asset_no || 'vehicle'}`}>Record return</button>
        </span>
      ) },
  ], [missing, openCreate, startQuick])

  const availColumns = useMemo(() => [
    { key: 'asset', header: 'Asset', sortValue: (r) => r.asset_no || '', cell: (r) => <span className="vcio-mono">{r.asset_no || 'N/A'}</span> },
    { key: 'makeModel', header: 'Make / model', sortValue: (r) => makeModel(r) || '', cell: (r) => makeModel(r) || <span className="cc-na">N/A</span> },
    { key: 'returned', header: 'Last returned', sortValue: (r) => r.returnedAt || '', cell: (r) => fmtDateTime(r.returnedAt) },
    { key: 'odo', header: 'Last odometer', sortValue: (r) => r.odometer_km ?? -1, align: 'right', cell: (r) => (r.odometer_km == null ? <span className="cc-na">N/A</span> : `${fmtNum(r.odometer_km)} km`) },
    { key: 'fuel', header: 'Last fuel', sortValue: (r) => r.fuel_pct ?? -1, align: 'right', cell: (r) => (r.fuel_pct == null ? <span className="cc-na">N/A</span> : `${r.fuel_pct}%`) },
    { key: 'go', header: '', sortable: false, align: 'right',
      cell: (r) => <button type="button" className="cc-btn-ghost" onClick={() => startQuick('out', r.asset_no)} disabled={missing}><LogOut size={13} aria-hidden="true" /> Check out</button> },
  ], [missing, startQuick])

  const historyColumns = useMemo(() => [
    { key: 'when', header: 'Date/Time', sortValue: (r) => r.checked_at || '', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.checked_at)}</span> },
    { key: 'direction', header: 'Direction', sortValue: (r) => DIRECTION_LABEL[r.direction] || '', cell: (r) => <DirectionPill direction={r.direction} /> },
    { key: 'asset', header: 'Asset', sortValue: (r) => r.asset_no || '', cell: (r) => <span className="vcio-mono">{r.asset_no || 'N/A'}</span> },
    { key: 'driver', header: 'Driver', sortValue: (r) => r.driver_name || '', cell: (r) => r.driver_name || <span className="cc-na">N/A</span> },
    { key: 'odo', header: 'Odometer', align: 'right', sortValue: (r) => (r.odometer_km == null || r.odometer_km === '' ? -1 : Number(r.odometer_km)),
      cell: (r) => (r.odometer_km == null || r.odometer_km === '' ? <span className="cc-na">N/A</span> : `${Number(r.odometer_km).toLocaleString('en-US')} km`) },
    { key: 'fuel', header: 'Fuel', sortValue: (r) => r.fuel_level || '', cell: (r) => r.fuel_level || <span className="cc-na">N/A</span> },
    { key: 'site', header: 'Site', sortValue: (r) => r.site || '', cell: (r) => r.site || <span className="cc-na">N/A</span> },
    { key: 'status', header: 'Status', sortValue: (r) => STATUS_LABEL[r.status] || '',
      cell: (r) => (STATUS_LABEL[r.status] ? <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span> : <span className="cc-na">N/A</span>) },
    { key: 'notes', header: 'Condition notes', sortValue: (r) => r.condition_notes || '', cell: (r) => <span className="text-xs">{r.condition_notes || ''}</span> },
    { key: 'actions', header: '', sortable: false, align: 'right',
      cell: (r) => (
        <span className="vcio-row-actions">
          <button type="button" onClick={() => openEdit(r)} className="cc-icon-btn" aria-label={`Edit handover for ${r.asset_no || 'asset'}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => setConfirmDelete(r)} className="cc-icon-btn" aria-label={`Delete handover for ${r.asset_no || 'asset'}`}><Trash2 size={14} /></button>
        </span>
      ) },
  ], [openEdit])

  const pairColumns = useMemo(() => [
    { key: 'asset', header: 'Asset', sortValue: (p) => p.asset_no || '', cell: (p) => p.asset_no || <span className="cc-na">N/A</span> },
    { key: 'driver', header: 'Driver', sortValue: (p) => p.driver_name || '', cell: (p) => p.driver_name || <span className="cc-na">N/A</span> },
    { key: 'out', header: 'Out', sortValue: (p) => p.outAt || '', cell: (p) => fmtDateTime(p.outAt) },
    { key: 'in', header: 'Returned', sortValue: (p) => p.inAt || '', cell: (p) => fmtDateTime(p.inAt) },
    { key: 'hours', header: 'Time out', align: 'right', sortValue: (p) => p.hoursOut ?? -1, cell: (p) => fmtHours(p.hoursOut) },
    { key: 'km', header: 'Km driven', align: 'right', sortValue: (p) => p.kmDriven ?? -1,
      cell: (p) => (p.odometerBackwards
        ? <span className="text-amber-500 inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> Odometer went back</span>
        : p.kmDriven == null ? <span className="cc-na">N/A</span> : `${fmtNum(p.kmDriven)} km`) },
    { key: 'fuel', header: 'Fuel out / in', sortValue: (p) => `${p.fuelOut || ''}${p.fuelIn || ''}`, cell: (p) => `${p.fuelOut || 'N/A'} / ${p.fuelIn || 'N/A'}` },
  ], [])

  const viewEvents = useMemo(() => (viewing ? all.filter((r) => assetKey(r.asset_no) === viewing.key) : []), [viewing, all])

  const trendData = {
    labels: trend.map((d) => d.day.slice(5)),
    datasets: [
      { label: 'Checked out', data: trend.map((d) => d.out), backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 3 },
      { label: 'Checked in', data: trend.map((d) => d.in), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 3 },
    ],
  }

  const loadingBoard = !loaded && !error
  const liveKpiTiles = [
    { label: 'Currently out', value: liveTiles.currentlyOut, icon: LogOut, tone: 't-blue', onClick: () => { setLiveState(''); setTab('in') }, title: 'Vehicles whose latest entry is an open check-out' },
    { label: 'Currently in', value: liveTiles.currentlyIn, icon: LogIn, tone: 't-green', onClick: () => setLiveState('in'), title: 'Vehicles whose latest entry is a return or a closed check-out' },
    { label: 'Overdue', value: liveTiles.overdue, icon: AlertTriangle, tone: 't-red', danger: (liveTiles.overdue || 0) > 0, onClick: () => setLiveState('overdue'), title: `Out for more than ${OVERDUE_HOURS} hours` },
    { label: 'Due today', value: liveTiles.dueToday, icon: CalendarClock, tone: 't-amber', onClick: () => setLiveState('out'), title: `Out, and ${OVERDUE_HOURS} hours from check-out falls today` },
  ]

  const historyTiles = [
    { label: 'Handovers', display: loaded ? fmtNum(k.total) : 'N/A', icon: ArrowRightLeft, tone: 't-green' },
    { label: 'Returned', display: loaded ? fmtNum(k.returned) : 'N/A', icon: LogIn, tone: 't-blue' },
    { label: 'Avg time out', display: loaded ? fmtHours(k.avgHoursOut) : 'N/A', icon: Clock, tone: 't-purple' },
    { label: 'Km driven', display: loaded ? (k.totalKmDriven == null ? 'N/A' : `${fmtNum(k.totalKmDriven)} km`) : 'N/A', icon: Gauge, tone: 't-orange', title: k.odometerBackwards ? `${k.odometerBackwards} trip(s) where the odometer went back` : 'Across paired trips' },
    { label: 'Assets tracked', display: loaded ? fmtNum(k.assets) : 'N/A', icon: Car, tone: 't-green' },
    { label: 'Paired trips', display: loaded ? fmtNum(k.completedHandovers) : 'N/A', icon: CheckCircle2, tone: 't-blue' },
    { label: 'Odometer recorded', display: loaded ? fmtPctN(k.odometerCoveragePct) : 'N/A', icon: Hourglass, tone: 't-amber', title: 'Share of handovers with an odometer reading' },
    { label: 'Fuel recorded', display: loaded ? fmtPctN(k.fuelCoveragePct) : 'N/A', icon: Fuel, tone: 't-orange', title: 'Share of handovers with a fuel level' },
  ]

  const tabs = [
    { key: 'live', label: 'Live status' },
    { key: 'in', label: 'Check in', count: loaded ? liveOut.length : undefined },
    { key: 'out', label: 'Check out' },
    { key: 'history', label: 'History', count: loaded ? all.length : undefined },
    { key: 'settings', label: 'Settings' },
  ]

  const quickCardProps = (direction) => ({
    direction,
    form: direction === 'in' ? quickIn : quickOut,
    setForm: direction === 'in' ? setQuickIn : setQuickOut,
    vehicles: direction === 'in' ? inVehicles : outVehicles,
    onSubmit: () => submitQuick(direction),
    busy: quickBusy === direction,
    message: quickMsg[direction],
    disabled: missing || !loaded,
    fleetState: fleetCard,
  })

  const scopeNote = loaded && truncated
    ? <p className="vcio-note">Only the most recent {READ_LIMIT} handovers are loaded, so vehicles last moved before that are not on the board.</p>
    : null

  return (
    <div className="cc vcio-page">
      <div className="vcio-hero">
        <PageHero
          title="Vehicle Check In / Out"
          lead="Manage vehicle and equipment check-in/check-out with complete condition, odometer and fuel details"
          imgLight="/dashboard/hero-sites-light.webp"
          imgDark="/dashboard/hero-sites-dark.webp"
        />
        <div className="vcio-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => openCreate('in')} disabled={missing || !loaded}><LogIn size={15} aria-hidden="true" /> Check In</button>
          <button type="button" className="cc-btn-primary" onClick={() => openCreate('out')} disabled={missing || !loaded}><LogOut size={15} aria-hidden="true" /> Check Out</button>
        </div>
      </div>

      {missing && (
        <Banner tone="warn" title="Vehicle check-in and check-out is not enabled on this database yet.">
          Apply MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql, then reload.
        </Banner>
      )}
      {error && <Banner tone="bad" title="Could not load handovers." onAction={load} actionLabel="Retry" actionIcon={RefreshCw}>{error}</Banner>}
      {actionError && (
        <div className="cc-card vcio-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={(key) => TAB_KEYS.includes(key) && setTab(key)} label="Check in and out sections" variant="line" />

      {tab === 'live' && (
        <>
          <Card>
            <div className="cc-filters vcio-filters">
              <label className="cc-field" htmlFor="vcio-live-site"><span>Sites</span>
                <select id="vcio-live-site" className="cc-select" value={liveSite} onChange={(e) => setLiveSite(e.target.value)}>
                  <option value="">All sites</option>
                  {liveSites.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="cc-field" htmlFor="vcio-live-state"><span>Status</span>
                <select id="vcio-live-state" className="cc-select" value={liveState} onChange={(e) => setLiveState(e.target.value)}>
                  <option value="">All statuses</option>
                  {LIVE_STATES.map((s) => <option key={s} value={s}>{LIVE_STATE_META[s].label}</option>)}
                </select>
              </label>
              <label className="cc-field" htmlFor="vcio-live-date"><span>Date</span>
                <input id="vcio-live-date" type="date" className="vcio-date" value={liveDate} onChange={(e) => setLiveDate(e.target.value)} />
              </label>
              <div className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search vehicles" placeholder="Search fleet no, make, driver or site" value={liveSearch} onChange={(e) => setLiveSearch(e.target.value)} />
              </div>
              {hasLiveFilters && <button type="button" className="cc-btn-ghost" onClick={() => { setLiveSite(''); setLiveState(''); setLiveDate(''); setLiveSearch('') }}><X size={13} aria-hidden="true" /> Clear</button>}
              <button type="button" className="cc-btn-ghost" onClick={() => { load(); fleetCard.retry() }} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
            </div>
          </Card>

          <div className="cc-kpis vcio-kpis">
            {liveKpiTiles.map((t) => <Kpi key={t.label} {...t} loading={loadingBoard} />)}
          </div>

          <Card
            title="Live status"
            sub={`One row per vehicle, from its latest entry. Expected in is the check-out time plus ${OVERDUE_HOURS} hours; no return date is recorded.`}
            action={<button type="button" className="cc-btn-ghost" onClick={() => exportLive(liveFiltered)} disabled={!liveFiltered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>}
          >
            {fleetCard.error && <p className="vcio-note">The fleet register could not be read, so make and model read N/A. <button type="button" className="cc-btn" onClick={fleetCard.retry}>Try again</button></p>}
            <KitTable
              columns={liveColumns}
              rows={liveFiltered}
              getRowId={(v) => v.key}
              loading={loadingBoard}
              error={error && !loaded ? error : null}
              onRetry={load}
              empty={(live || []).length === 0 && !missing ? 'No handovers logged yet. Use Check out or Check in to record one.' : 'No vehicles match these filters.'}
              enableRowSelection
              bulkActions={(selected, clear) => (
                <>
                  <button type="button" className="cc-btn-ghost" onClick={() => exportLive(selected)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected ({selected.length})</button>
                  <button type="button" className="cc-btn-ghost" onClick={clear}>Clear selection</button>
                </>
              )}
              resetPageKey={`${liveSite}|${liveState}|${liveDate}|${liveSearch}`}
            />
            {scopeNote}
          </Card>

          <div className="vcio-two">
            <QuickCard {...quickCardProps('in')} />
            <QuickCard {...quickCardProps('out')} />
          </div>
        </>
      )}

      {tab === 'in' && (
        <div className="vcio-two">
          <Card title="Vehicles still out" sub={`Latest entry is an open check-out, longest out first. Over ${OVERDUE_HOURS} hours is overdue.`}>
            <KitTable
              columns={outColumns}
              rows={[...liveOut].sort((a, b) => (b.hoursOut ?? -1) - (a.hoursOut ?? -1))}
              getRowId={(v) => v.key}
              loading={loadingBoard}
              empty="Every vehicle has been returned."
            />
            {outNow.length !== liveOut.length && loaded && (
              <p className="vcio-note">{fmtNum(outNow.length)} check-out entries are still marked open in the log; some already have a later return and are not listed as out.</p>
            )}
          </Card>
          <div style={{ display: 'grid', gap: 14 }}>
            <QuickCard {...quickCardProps('in')} />
            <Card title="Full check-in form" sub="Record the driver, site, condition notes and a specific date and time.">
              <div><button type="button" className="cc-btn-ghost" onClick={() => openCreate('in')} disabled={missing || !loaded}><LogIn size={14} aria-hidden="true" /> Open check-in form</button></div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'out' && (
        <div className="vcio-two">
          <Card title="Vehicles in" sub="Vehicles whose latest entry is a return. Vehicles never logged are in the quick form list from the fleet register.">
            <KitTable
              columns={availColumns}
              rows={liveIn}
              getRowId={(v) => v.key}
              loading={loadingBoard}
              empty="No vehicle has a recorded return yet."
            />
          </Card>
          <div style={{ display: 'grid', gap: 14 }}>
            <QuickCard {...quickCardProps('out')} />
            <Card title="Full check-out form" sub="Record the site, condition notes and a specific date and time.">
              <div><button type="button" className="cc-btn-ghost" onClick={() => openCreate('out')} disabled={missing || !loaded}><LogOut size={14} aria-hidden="true" /> Open check-out form</button></div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <>
          <Card>
            <div className="cc-filters vcio-filters">
              <div className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input id="cio-search" aria-label="Search handovers" placeholder="Asset, driver, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="cc-select" aria-label="Direction" value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
                <option value="all">All directions</option>
                {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
              </select>
              <select className="cc-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <select className="cc-select" aria-label="Asset" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
                <option value="">All assets</option>
                {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="cc-select" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" className="vcio-date" aria-label="From date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
              <input type="date" className="vcio-date" aria-label="To date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
              {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
              <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={!filtered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
            </div>
            {loaded && (
              <p className="vcio-note" style={{ marginTop: 8 }} aria-live="polite">
                These figures cover the {fmtNum(filtered.length)} of {fmtNum(all.length)} handover{all.length === 1 ? '' : 's'} matching the current filters
                {truncated ? `. Only the most recent ${READ_LIMIT} handovers are loaded, so older ones are not included.` : '.'}
              </p>
            )}
          </Card>

          <div className="cc-kpis vcio-kpis-8">
            {historyTiles.map((t) => <Kpi key={t.label} {...t} loading={loadingBoard} />)}
          </div>

          <Card title="Handovers per day, last 14 days">
            <div className="vcio-chart" role="img" aria-label="Check-outs and check-ins per day over the last 14 days">
              {!loaded ? <div className="cc-skel" style={{ height: '100%' }} />
                : trend.some((d) => d.out || d.in) ? <Bar data={trendData} options={BAR_OPTS} />
                  : <div className="cc-empty">No handovers in the last 14 days.</div>}
            </div>
          </Card>

          <Card title="Handover register" sub="Every check-out and check-in entry. Edit or delete an entry from its row.">
            <KitTable
              columns={historyColumns}
              rows={filtered}
              getRowId={(r) => String(r.id)}
              loading={loadingBoard}
              error={error && !loaded ? error : null}
              onRetry={load}
              empty={all.length === 0 && !missing ? 'No handovers logged yet. Use Check out or Check in to record one.' : 'No entries match these filters.'}
              resetPageKey={`${directionFilter}|${statusFilter}|${assetFilter}|${siteFilter}|${fromDate}|${toDate}|${search}`}
            />
          </Card>

          <Card title="Completed handovers" sub="Each check-out matched to the next check-in of the same asset. Km driven reads N/A when either odometer is missing.">
            <KitTable
              columns={pairColumns}
              rows={pairs}
              getRowId={(p, i) => `${p.asset_no}-${p.outAt}-${i}`}
              loading={loadingBoard}
              empty="No check-out has a matching return in this scope yet."
            />
          </Card>
        </>
      )}

      {tab === 'settings' && (
        <Card title="Settings" sub="How this page reads the handover log. These rules are fixed in the app; there is no per-organisation setting stored for them yet.">
          <div className="vcio-settings">
            <dl>
              <dt>Overdue rule</dt><dd>A vehicle out for more than {OVERDUE_HOURS} hours is overdue. Expected in is the check-out time plus {OVERDUE_HOURS} hours.</dd>
              <dt>Vehicle state</dt><dd>Taken from each vehicle&apos;s latest entry: an open check-out is Out, anything else is In.</dd>
              <dt>Fuel level</dt><dd>The full form records {FUEL_LEVELS.join(', ')}. The quick forms record a percentage (for example 75%).</dd>
              <dt>Odometer check</dt><dd>A quick-form reading below the last recorded reading for that vehicle (log or fleet register) is flagged and needs a second press. It is not refused, because a meter can be replaced.</dd>
              <dt>Returns</dt><dd>A quick check-in also closes the open check-out it answers.</dd>
              <dt>Data loaded</dt><dd>The most recent {READ_LIMIT} entries for {countryScope || 'all countries'}{loaded ? ` (${fmtInt(all.length)} loaded)` : ''}.</dd>
              <dt>Database table</dt><dd>{missing ? 'Not provisioned. Apply MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql.' : loaded ? 'Available' : error ? 'Could not be read' : 'Checking'}</dd>
              <dt>Fleet register</dt><dd>{fleetCard.loading ? 'Loading' : fleetCard.error ? 'Could not be read' : `${fmtInt(fleet.length)} vehicles`}</dd>
            </dl>
          </div>
        </Card>
      )}

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Handovers for ${viewing.asset_no}` : 'Handovers'}
        size="lg"
      >
        {viewing && (
          <div style={{ display: 'grid', gap: 10 }} className="cc">
            <p className="vcio-note">
              {makeModel(viewing) || 'Make and model not recorded'} | Status <StatePill state={viewing.state} /> | Last odometer {viewing.odometer_km == null ? 'N/A' : `${fmtNum(viewing.odometer_km)} km`} | Last fuel {viewing.fuel_pct == null ? 'N/A' : `${viewing.fuel_pct}%`}
            </p>
            <KitTable columns={historyColumns} rows={viewEvents} getRowId={(r) => String(r.id)} empty="No entries for this vehicle." compact />
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) setModalOpen(false) }}
        title={editing ? 'Edit handover' : (form.direction === 'in' ? 'Vehicle check-in' : 'Vehicle check-out')}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="handover-form" className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {saving ? 'Saving...' : (editing ? 'Save changes' : 'Record handover')}
            </button>
          </div>
        }
      >
        <form id="handover-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hf-asset" className="label">Asset number <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="hf-asset" className={FIELD} placeholder="e.g. TRK-045" value={form.asset_no} maxLength={120} required onChange={(e) => setField('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-driver" className="label">Driver</label>
              <input id="hf-driver" className={FIELD} placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => setField('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-direction" className="label">Direction</label>
              <select id="hf-direction" className={FIELD} value={form.direction} onChange={(e) => setField('direction', e.target.value)}>
                {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hf-status" className="label">Status</label>
              <select id="hf-status" className={FIELD} value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hf-odo" className="label">Odometer (km)</label>
              <input id="hf-odo" type="number" min={0} inputMode="numeric" className={FIELD} placeholder="45000" value={form.odometer_km} onChange={(e) => setField('odometer_km', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-fuel" className="label">Fuel level</label>
              <select id="hf-fuel" className={FIELD} value={form.fuel_level} onChange={(e) => setField('fuel_level', e.target.value)}>
                <option value="">Not recorded</option>
                {FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
                {form.fuel_level && !FUEL_LEVELS.includes(form.fuel_level) && fuelPct(form.fuel_level) != null && <option value={form.fuel_level}>{form.fuel_level}</option>}
              </select>
            </div>
            <div>
              <label htmlFor="hf-site" className="label">Site</label>
              <input id="hf-site" className={FIELD} placeholder="Depot or branch" value={form.site} maxLength={200} onChange={(e) => setField('site', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-when" className="label">Date and time</label>
              <input id="hf-when" type="datetime-local" className={FIELD} value={form.checked_at || ''} onChange={(e) => setField('checked_at', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="hf-notes" className="label">Condition notes</label>
            <textarea id="hf-notes" className="input w-full min-h-[90px] resize-y" placeholder="Damage, defects, cleanliness or other remarks" value={form.condition_notes} maxLength={4000} onChange={(e) => setField('condition_notes', e.target.value)} />
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this handover?"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {DIRECTION_LABEL[confirmDelete.direction] || 'Entry'} for <span className="font-mono">{confirmDelete.asset_no || 'N/A'}</span> on {fmtDateTime(confirmDelete.checked_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
