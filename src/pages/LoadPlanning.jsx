/**
 * LoadPlanning (route /load-planning) - pairs each asset with the cargo it is
 * scheduled to carry and measures the planned load against the asset's rated
 * payload and volume, so overloads are caught before dispatch.
 *
 * Rebuilt on the Command Center kit to the owner's mockup: five headline
 * tiles, available vehicles from the real fleet register (vehicle_fleet), the
 * route overview, constraint cards with quick actions, the weekly tonnage,
 * load band and 14 day capacity charts, and the planned-load register with
 * tabs, filters, selection, bulk dispatch, create / edit / delete and Excel /
 * PDF export.
 *
 * Plans come from `load_plans` (V167). Numbers are shaped in
 * `src/lib/loadPlanningView.js` (new layout) on top of `loadPlanningAnalytics`
 * and `loadPlans`. Anything the tables do not hold (drivers, axle weights,
 * route geometry, customers, distances) is shown as not recorded.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Truck, Gauge, AlertTriangle, ClipboardList, CheckCircle2, Search, MapPin, ChevronRight,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, RefreshCw, Loader2, ShieldCheck, Send, Scale, UserCheck, Milestone, X,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, KitTable, Tabs, VehicleThumb, ViewAll, fmtInt, useCard } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { listLoadPlans, createLoadPlan, updateLoadPlan, deleteLoadPlan } from '../lib/api/loadPlans'
import { listAssets } from '../lib/api/assets'
import {
  LOAD_STATUSES, LOAD_BANDS, LOAD_BAND_LABEL, statusLabel, loadTableRows, filterLoadPlans,
  loadCountryOptions, loadExportRows, LOAD_EXPORT_COLS, LOAD_EXPORT_HEADERS,
} from '../lib/loadPlanningAnalytics'
import {
  fleetAvailability, depotOptions, filterVehicles, headlineTiles, constraintCards, bandDistribution,
  weekTonnage, capacityOutlook, PLAN_TABS, planTabMatch, planTabCounts, placeOptions, plannerStatus,
  fleetIndex, routeLegs,
} from '../lib/loadPlanningView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './LoadPlanning.css'

// Header art cropped from the owner's Load Planning mockup (its green terrain
// texture, clear of the title text), with a lighter grade for the light theme.
const HERO_DARK = '/dashboard/hero-load-dark.webp'
const HERO_LIGHT = '/dashboard/hero-load-light.webp'

const EMPTY_FORM = {
  reference: '', asset_no: '', origin: '', destination: '', plan_date: '',
  cargo_type: '', cargo_weight_kg: '', max_payload_kg: '', volume_m3: '',
  max_volume_m3: '', pallet_count: '', status: 'draft', notes: '',
}
const EMPTY_FILTERS = { search: '', origin: '', destination: '', status: '', band: '', country: '' }

const NA = <span className="cc-na">N/A</span>
const Pill = ({ tone = 'muted', children }) => <span className={`cc-pill ${tone}`}>{children}</span>
const fmtT = (kg) => (kg == null ? null : `${(Number(kg) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} T`)
const pctText = (v) => (v == null ? 'N/A' : `${Math.round(v)}%`)

/** Weekly planned load vs rated capacity, as paired bars. */
function TonnageBars({ days }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.planned || 0, d.capacity || 0)))
  const W = 300; const H = 130; const bw = W / days.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="lp-svg" role="img" aria-label={days.map((d) => `${d.label} planned ${d.planned == null ? 'none' : Math.round(d.planned)} kg`).join(', ')}>
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="lp-gridline" />)}
      {days.map((d, i) => {
        const x = i * bw + bw * 0.22; const w = bw * 0.56
        const ch = d.capacity == null ? 0 : (d.capacity / max) * H
        const ph = d.planned == null ? 0 : (d.planned / max) * H
        return (
          <g key={d.day}>
            {ch > 0 && <rect x={x} y={H - ch} width={w} height={ch} rx="2" className="lp-bar-cap" />}
            {ph > 0 && <rect x={x + w * 0.2} y={H - ph} width={w * 0.6} height={ph} rx="2" className={d.capacity != null && d.planned > d.capacity ? 'lp-bar-over' : 'lp-bar-plan'} />}
            <text x={x + w / 2} y={H + 13} textAnchor="middle" className="cc-axis">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Chart frame that keeps the axes visible and lays an honest note over an empty chart. */
function ChartFrame({ empty, children }) {
  return (
    <div className="lp-chart-wrap">
      {children}
      {empty && <div className="lp-chart-empty"><span>{empty}</span></div>}
    </div>
  )
}

/** Plans per capacity band as columns (within / near / over / no rated capacity). */
function BandColumns({ bands, active, onPick }) {
  const max = Math.max(1, ...bands.map((b) => b.count))
  const W = 300; const H = 120; const bw = W / bands.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="lp-svg" role="img" aria-label={bands.map((b) => `${b.label} ${b.count}`).join(', ')}>
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="lp-gridline" />)}
      {bands.map((b, i) => {
        const x = i * bw + bw * 0.25; const w = bw * 0.5
        const h = (b.count / max) * H
        return (
          <g key={b.key} className={`lp-band-col${active === b.key ? ' is-active' : ''}`} onClick={() => onPick(b.key)} role="presentation">
            {h > 0 && <rect x={x} y={H - h} width={w} height={h} rx="2" style={{ fill: b.color }} />}
            <text x={x + w / 2} y={H - h - 4} textAnchor="middle" className="cc-axis">{b.count}</text>
            <text x={x + w / 2} y={H + 13} textAnchor="middle" className="cc-axis">{b.short}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Mean weight utilisation per day for the next 14 days. */
function OutlookLine({ days }) {
  const W = 300; const H = 120; const step = W / Math.max(1, days.length - 1)
  const maxU = Math.max(100, ...days.map((d) => d.util || 0))
  const y = (u) => H - (u / maxU) * H
  const pts = days.map((d, i) => (d.util == null ? null : [i * step, y(d.util)])).filter(Boolean)
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="lp-svg" role="img" aria-label={days.map((d) => `${d.label} ${d.plans} plans, ${d.util == null ? 'no rated payload' : `${d.util}% utilised`}`).join(', ')}>
      {[25, 50, 75, 100].map((u) => <line key={u} x1="0" x2={W} y1={y(u)} y2={y(u)} className={u === 100 ? 'lp-gridline lp-grid-limit' : 'lp-gridline'} />)}
      {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} className="lp-line" />}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" className="lp-dot" />)}
      {days.map((d, i) => (i % 2 === 0 ? <text key={d.day} x={i * step} y={H + 13} textAnchor="middle" className="cc-axis">{d.label}</text> : null))}
    </svg>
  )
}

export default function LoadPlanning() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => new Date())

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [tab, setTab] = useState('all')
  const [selection, setSelection] = useState({})
  const [vehTab, setVehTab] = useState('available')
  const [depot, setDepot] = useState('')
  const [vehSearch, setVehSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [dispatching, setDispatching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listLoadPlans({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setNow(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load load plans.'))
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  const fleet = useCard(() => listAssets({ country: activeCountry }), [activeCountry])

  const known = rows !== null && !error
  const plansState = {
    loading, data: known ? true : null, retry: load,
    error: error || (notProvisioned ? 'Load planning is not enabled on this database yet.' : null),
  }

  const allPlans = useMemo(() => rows || [], [rows])
  // Date window applies to every plan figure on the page.
  const windowed = useMemo(() => filterLoadPlans(allPlans, { from: fromDate, to: toDate }), [allPlans, fromDate, toDate])
  const tiles = useMemo(() => headlineTiles(windowed), [windowed])
  const constraints = useMemo(() => constraintCards(windowed), [windowed])
  const bands = useMemo(() => bandDistribution(windowed), [windowed])
  const week = useMemo(() => weekTonnage(allPlans, now), [allPlans, now])
  const outlook = useMemo(() => capacityOutlook(allPlans, now, 14), [allPlans, now])
  const legs = useMemo(() => routeLegs(windowed), [windowed])
  const places = useMemo(() => placeOptions(allPlans), [allPlans])
  const countryOptions = useMemo(() => loadCountryOptions(allPlans), [allPlans])

  const filtered = useMemo(() => {
    const base = filterLoadPlans(windowed, { status: filters.status, band: filters.band, country: filters.country, search: filters.search })
    return base.filter((p) => (!filters.origin || p.origin === filters.origin) && (!filters.destination || p.destination === filters.destination))
  }, [windowed, filters])
  const tabCounts = useMemo(() => planTabCounts(filtered), [filtered])
  const tabRows = useMemo(() => loadTableRows(filtered.filter((p) => planTabMatch(p, tab))), [filtered, tab])
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const hasFilters = Object.values(filters).some(Boolean) || !!fromDate || !!toDate

  const fleetRows = useMemo(() => fleet.data || [], [fleet.data])
  const availability = useMemo(() => fleetAvailability(fleetRows, allPlans), [fleetRows, allPlans])
  const depots = useMemo(() => depotOptions(fleetRows), [fleetRows])
  const vehicles = useMemo(() => filterVehicles(availability[vehTab] || [], { depot, search: vehSearch }), [availability, vehTab, depot, vehSearch])
  const lookupAsset = useMemo(() => fleetIndex(fleetRows), [fleetRows])

  const selectedPlans = useMemo(() => allPlans.filter((p) => selection[String(p.id)]), [allPlans, selection])

  // -- Export ---------------------------------------------------------------
  const runExport = async (kind) => {
    setActionError('')
    try {
      const out = loadExportRows(filtered)
      const name = reportFileName('Load Plans')
      if (kind === 'excel') await exportToExcel(out, LOAD_EXPORT_COLS, LOAD_EXPORT_HEADERS, name)
      else await exportToPdf(out, LOAD_EXPORT_COLS.map((k, i) => ({ key: k, header: LOAD_EXPORT_HEADERS[i] })), 'Load Plans', name, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // -- Create / edit / delete -----------------------------------------------
  const openCreate = (prefill = {}) => { setEditing(null); setForm({ ...EMPTY_FORM, ...prefill }); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      reference: r.reference || '', asset_no: r.asset_no || '',
      origin: r.origin || '', destination: r.destination || '',
      plan_date: r.plan_date || '', cargo_type: r.cargo_type || '',
      cargo_weight_kg: r.cargo_weight_kg ?? '', max_payload_kg: r.max_payload_kg ?? '',
      volume_m3: r.volume_m3 ?? '', max_volume_m3: r.max_volume_m3 ?? '',
      pallet_count: r.pallet_count ?? '', status: r.status || 'draft', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.reference.trim()) { setFormError('A plan reference is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateLoadPlan(editing.id, payload)
      else await createLoadPlan(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the load plan.'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteLoadPlan(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the load plan.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const dispatchable = selectedPlans.filter((p) => ['draft', 'planned', 'loaded'].includes(String(p.status || '').toLowerCase()))
  const dispatchSelected = async () => {
    if (!dispatchable.length) return
    setDispatching(true); setActionError('')
    const failed = []
    for (const p of dispatchable) {
      try { await updateLoadPlan(p.id, { status: 'dispatched' }) } catch (err) { failed.push(`${p.reference || 'Plan'}: ${toUserMessage(err, 'not saved')}`) }
    }
    if (failed.length) setActionError(`${dispatchable.length - failed.length} of ${dispatchable.length} plans dispatched. ${failed.join('; ')}`)
    setSelection({})
    setDispatching(false)
    await load()
  }

  const nextReference = () => `LP-${now.getFullYear()}-${String(allPlans.length + 1).padStart(4, '0')}`

  // -- Columns --------------------------------------------------------------
  const columns = [
    { key: 'reference', header: 'Load ID', cell: (r) => <button type="button" className="cc-link cc-link-btn lp-ref" onClick={() => openEdit(r)}>{r.reference || 'N/A'}</button> },
    { key: 'cargo', header: 'Cargo', sortValue: (r) => r.cargo_type || '', cell: (r) => r.cargo_type || <span className="cc-na">Not recorded</span> },
    { key: 'origin', header: 'Origin', cell: (r) => (r.origin ? <span className="cc-site"><MapPin size={12} aria-hidden="true" />{r.origin}</span> : NA) },
    { key: 'destination', header: 'Destination', cell: (r) => (r.destination ? <span className="cc-site"><MapPin size={12} aria-hidden="true" />{r.destination}</span> : NA) },
    {
      key: 'weight', header: 'Weight / volume', numeric: true, sortValue: (r) => r._weight ?? -1,
      cell: (r) => <span>{fmtT(r._weight) || NA}{r.volume_m3 != null && r.volume_m3 !== '' && <span className="cc-sub">{Number(r.volume_m3)} m3</span>}</span>,
    },
    {
      key: 'util', header: 'Utilisation', numeric: true, sortValue: (r) => Math.max(r._weightPct ?? -1, r._volumePct ?? -1),
      cell: (r) => {
        const p = Math.max(r._weightPct ?? -Infinity, r._volumePct ?? -Infinity)
        if (!Number.isFinite(p)) return <span className="cc-na">No rated capacity</span>
        return <span className={p > 100 ? 'lp-bad' : p >= 90 ? 'lp-warn' : ''}>{pctText(p)}</span>
      },
    },
    {
      key: 'vehicle', header: 'Vehicle', sortValue: (r) => r.asset_no || '',
      cell: (r) => {
        if (!r.asset_no) return <span className="cc-na">Unassigned</span>
        const v = lookupAsset(r.asset_no)
        return <span className="cc-strong">{r.asset_no}<span className="cc-sub">{v?.vehicle_type || 'Not in fleet register'}</span></span>
      },
    },
    { key: 'date', header: 'Planned date', sortValue: (r) => r._date || '', cell: (r) => r._date || NA },
    { key: 'route', header: 'Distance', sortable: false, cell: () => <span className="cc-na">Not recorded</span> },
    { key: 'status', header: 'Planner status', sortValue: (r) => plannerStatus(r).label, cell: (r) => { const s = plannerStatus(r); return <Pill tone={s.tone}>{s.label}</Pill> } },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <span className="lp-row-actions">
          <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`Edit load plan ${r.reference || ''}`.trim()}><Pencil size={13} /></button>
          <button type="button" className="cc-icon-btn lp-danger" onClick={() => setConfirmDelete(r)} aria-label={`Delete load plan ${r.reference || ''}`.trim()}><Trash2 size={13} /></button>
        </span>
      ),
    },
  ]

  const kpis = [
    { icon: Truck, tone: 't-green', value: known ? tiles.planned : null, label: 'Planned loads', title: 'Plans not yet delivered', onClick: () => setTab('pending') },
    { icon: Gauge, tone: 't-blue', display: known ? pctText(tiles.capacityUtil) : 'N/A', label: tiles.capacityUtil == null && known ? 'Capacity utilisation (no rated payload)' : 'Capacity utilisation', title: known ? `Mean weight utilisation over ${tiles.measured} plans with a rated payload` : undefined },
    { icon: AlertTriangle, tone: 't-amber', value: known ? tiles.overweight : null, label: 'Overweight risk', danger: known && tiles.overweight > 0, onClick: () => setTab('risk') },
    { icon: ClipboardList, tone: 't-red', value: known ? tiles.pending : null, label: 'Pending assignments', title: 'Open plans with no asset assigned' },
    { icon: CheckCircle2, tone: 't-green', display: known ? pctText(tiles.dispatchReady) : 'N/A', label: 'Dispatch ready', title: known ? `${tiles.readyCount} of ${tiles.readyBase} planned or loaded plans are assigned and within capacity` : undefined },
  ]
  const constraintIcon = { weight: Scale, vehicle: Truck, driver: UserCheck, route: ShieldCheck }
  const vehicleState = { loading: fleet.loading, error: fleet.error, retry: fleet.retry, data: fleet.data }
  const weekHasData = week.some((d) => d.planned != null || d.capacity != null)
  const outlookHasData = outlook.some((d) => d.util != null)
  const bandTotal = bands.reduce((s, b) => s + b.count, 0)

  return (
    <div className="cc lp-page">
      <header className="lp-head">
        <div className="lp-head-img cc-hero-dark" style={{ backgroundImage: `url(${HERO_DARK})` }} aria-hidden="true" />
        <div className="lp-head-img cc-hero-light" style={{ backgroundImage: `url(${HERO_LIGHT})` }} aria-hidden="true" />
        <div className="lp-head-copy">
          <p className="lp-crumb">Monitoring and Logistics <ChevronRight size={12} aria-hidden="true" /> <span>Load Planning</span></p>
          <h1>Load Planning</h1>
          <p>Assign loads to available assets while checking rated payload, volume and dispatch readiness.</p>
        </div>
        <div className="lp-head-actions">
          <label className="lp-date"><span>From</span><input type="date" className="cc-select" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="lp-date"><span>To</span><input type="date" className="cc-select" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></label>
          <button type="button" className="cc-icon-btn" onClick={() => { load(); fleet.retry() }} aria-label="Refresh" title="Refresh"><RefreshCw size={14} /></button>
          <button type="button" className="cc-icon-btn" onClick={() => runExport('excel')} disabled={!known || !filtered.length} aria-label="Export to Excel" title="Export to Excel"><FileSpreadsheet size={14} /></button>
          <button type="button" className="cc-icon-btn" onClick={() => runExport('pdf')} disabled={!known || !filtered.length} aria-label="Export to PDF" title="Export to PDF"><FileText size={14} /></button>
          <button type="button" className="cc-btn-primary" onClick={() => openCreate({ reference: nextReference() })} disabled={notProvisioned}><Plus size={14} aria-hidden="true" /> Plan load</button>
        </div>
      </header>

      {notProvisioned && (
        <div className="cc-card lp-banner" role="status"><AlertTriangle size={18} aria-hidden="true" /><div><b>Load planning is not enabled on this database yet.</b><p>Apply MIGRATIONS_V167_LOAD_PLANS.sql, then reload.</p></div></div>
      )}
      {error && (
        <div className="cc-card lp-banner bad" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><b>Could not load load plans.</b><p>{error}</p></div><button type="button" className="cc-btn-ghost" onClick={load}>Retry</button></div>
      )}
      {actionError && (
        <div className="cc-card lp-banner bad" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><p>{actionError}</p></div><button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button></div>
      )}

      <div className="cc-kpis lp-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading && rows === null} />)}
      </div>
      {known && allPlans.length === 0 && (
        <p className="lp-note">No load plans recorded yet. Every plan figure reads N/A or zero plans until the first plan is created with Plan load.</p>
      )}

      <div className="lp-grid">
        <Card
          className="lp-vehicles"
          title="Available vehicles"
          sub="From the fleet register, active assets only."
          action={(
            <select className="cc-select lp-mini-select" aria-label="Depot" value={depot} onChange={(e) => setDepot(e.target.value)}>
              <option value="">All depots</option>
              {depots.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        >
          <Tabs
            label="Vehicle availability"
            value={vehTab}
            onChange={setVehTab}
            tabs={[
              { key: 'available', label: 'Available', count: fleet.data ? availability.counts.available : null, countTone: 'green' },
              { key: 'inUse', label: 'In use', count: fleet.data ? availability.counts.inUse : null },
              { key: 'maintenance', label: 'Under maintenance', count: fleet.data ? availability.counts.maintenance : null, countTone: 'red' },
            ]}
          />
          <label className="cc-search lp-veh-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Search vehicles, type or site" value={vehSearch} onChange={(e) => setVehSearch(e.target.value)} aria-label="Search vehicles" /></label>
          <CardState state={vehicleState} lines={6} empty={fleet.data && vehicles.length === 0 ? (vehSearch || depot ? 'No vehicles match this search.' : vehTab === 'inUse' ? 'No vehicle is on a loaded or dispatched plan.' : vehTab === 'maintenance' ? 'No active vehicle is marked broken down or planned for scrap.' : 'No available vehicles.') : null}>
            <div className="cc-list lp-veh-list">
              {vehicles.slice(0, 60).map((v) => (
                <div key={v.id} className="cc-row lp-veh-row">
                  <VehicleThumb row={v} size="sm" />
                  <div className="cc-row-main">
                    <div className="cc-row-title">{v.asset_no}</div>
                    <div className="cc-row-meta">{[v.vehicle_type, v.capacity].filter(Boolean).join(' | ') || 'Type not recorded'}</div>
                  </div>
                  <span className="cc-site lp-veh-site"><MapPin size={12} aria-hidden="true" />{v.site || 'N/A'}</span>
                  {v._state === 'available' && <button type="button" className="cc-btn" onClick={() => openCreate({ reference: nextReference(), asset_no: v.asset_no, origin: v.site || '' })} disabled={notProvisioned}>Plan</button>}
                  {v._state === 'inUse' && <span className="lp-veh-util"><Pill tone="info">In use</Pill><span className="cc-row-time">{v._plan?.reference || ''}{v._util != null ? `, ${pctText(v._util)}` : ''}</span></span>}
                  {v._state === 'maintenance' && <Pill tone="bad">{v.ops_status === 'planned_scrap' ? 'Planned scrap' : 'Breakdown'}</Pill>}
                </div>
              ))}
            </div>
            {vehicles.length > 60 && <p className="lp-foot">Showing 60 of {fmtInt(vehicles.length)} vehicles. Search or pick a depot to narrow the list.</p>}
          </CardState>
        </Card>

        <Card className="lp-routes" title="Route and load overview" sub="Origin to destination legs on the plans in this window.">
          <CardState state={plansState} lines={5}>
            <div className="lp-map">
              <div className="lp-map-legend" aria-label="Route legend">
                <span><i className="lp-lg-route" />Planned route</span>
                <span><i className="lp-lg-risk" />Over payload leg</span>
              </div>
              <div className="lp-map-note"><MapPin size={22} aria-hidden="true" /><span>Map view is not connected yet. {legs.length ? `${legs.length} route leg${legs.length === 1 ? '' : 's'} listed below.` : 'No route legs on load plans yet. A leg appears once a plan records an origin and destination.'}</span></div>
            </div>
            {legs.length > 0 && (
              <ol className="lp-legs">
                {legs.map((l) => (
                  <li key={`${l.origin}|${l.destination}`}>
                    <span className={`lp-leg-dot${l.over > 0 ? ' is-risk' : ''}`} aria-hidden="true" />
                    <span className="lp-leg-text"><b>{l.origin}</b> <Milestone size={12} aria-hidden="true" /> <b>{l.destination}</b></span>
                    <span className="lp-leg-count">{fmtInt(l.plans)} plan{l.plans === 1 ? '' : 's'}</span>
                    {l.over > 0 && <Pill tone="bad">{l.over} over</Pill>}
                  </li>
                ))}
              </ol>
            )}
          </CardState>
        </Card>

        <Card className="lp-constraints" title="Load constraints and compliance" action={<ViewAll label="View all" onClick={() => { setTab('risk'); document.getElementById('lp-register')?.scrollIntoView({ behavior: 'smooth' }) }} />}>
          <CardState state={plansState} lines={4}>
            <div className="lp-cons-grid">
              {constraints.map((c) => {
                const Icon = constraintIcon[c.key]
                return (
                  <div key={c.key} className="lp-cons">
                    <span className={`cc-kpi-icon ${c.value == null ? 't-blue' : c.value >= 90 ? 't-green' : 't-amber'}`}><Icon size={18} aria-hidden="true" /></span>
                    <div className="lp-cons-body">
                      <span className="lp-cons-title">{c.title}</span>
                      <b>{c.value == null ? (c.notRecorded ? 'Not recorded' : 'N/A') : `${c.value}%`}</b>
                      <small>{c.reason || c.sub}</small>
                    </div>
                    {c.side && c.value != null && <span className="lp-cons-side">{c.side}</span>}
                  </div>
                )
              })}
            </div>
            <h3 className="lp-sub-title">Quick actions</h3>
            <div className="lp-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => openCreate({ reference: nextReference() })} disabled={notProvisioned}><Plus size={14} aria-hidden="true" /> Plan load</button>
              <button type="button" className="cc-btn-ghost" onClick={() => selectedPlans.length === 1 && openEdit(selectedPlans[0])} disabled={selectedPlans.length !== 1} title={selectedPlans.length !== 1 ? 'Tick exactly one plan in the register' : undefined}><Truck size={14} aria-hidden="true" /> Reassign vehicle</button>
              <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!known || !filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export plan</button>
              <button type="button" className="cc-btn-ghost" onClick={() => setTab('risk')} disabled={!known}><ShieldCheck size={14} aria-hidden="true" /> Validate compliance</button>
              <button type="button" className="cc-btn-primary" onClick={dispatchSelected} disabled={!dispatchable.length || dispatching} title={!dispatchable.length ? 'Tick plans that are draft, planned or loaded' : undefined}>
                {dispatching ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Dispatch selected{dispatchable.length ? ` (${dispatchable.length})` : ''}
              </button>
            </div>
          </CardState>
        </Card>

        <div className="lp-charts">
          <Card className="lp-week" title="Fleet utilisation (by tonnage)" sub="Planned load vs rated payload, last 7 days.">
            <CardState state={plansState} lines={4}>
              <div className="lp-legend"><span><i className="lp-sw lp-sw-plan" />Planned load</span><span><i className="lp-sw lp-sw-cap" />Rated payload</span><span><i className="lp-sw lp-sw-over" />Over payload</span></div>
              <ChartFrame empty={known && !weekHasData ? 'No plan in the last 7 days records a cargo weight or rated payload.' : null}>
                <TonnageBars days={week} />
              </ChartFrame>
            </CardState>
          </Card>

          <Card className="lp-bands" title="Load distribution" sub="Plans by peak of weight and volume against rated capacity.">
            <CardState state={plansState} lines={4}>
              <div className="lp-legend"><span><i className="lp-sw lp-sw-plan" />Within limit</span><span><i className="lp-sw lp-sw-near" />Near limit</span><span><i className="lp-sw lp-sw-over" />Over limit</span></div>
              <ChartFrame empty={known && bandTotal === 0 ? 'No load plans in this window.' : null}>
                <BandColumns bands={bands} active={filters.band} onPick={(k) => setF('band', filters.band === k ? '' : k)} />
              </ChartFrame>
              <p className="lp-foot">Axle by axle weights are not recorded on load plans, so loads are judged against the whole vehicle payload. Click a column to filter the register.</p>
            </CardState>
          </Card>

          <Card className="lp-outlook" title="Planned capacity (next 14 days)" sub="Mean weight utilisation of open plans per day.">
            <CardState state={plansState} lines={4}>
              <div className="lp-legend"><span><i className="lp-sw lp-sw-line" />Planned utilisation</span><span><i className="lp-sw lp-sw-limit" />100% of payload</span></div>
              <ChartFrame empty={known && !outlookHasData ? 'No open plan in the next 14 days records a rated payload.' : null}>
                <OutlookLine days={outlook} />
              </ChartFrame>
              <p className="lp-foot">Daily fleet availability is not recorded, so only planned utilisation is drawn.</p>
            </CardState>
          </Card>
        </div>

        <section className="cc-card lp-register" id="lp-register" aria-label="Planned loads">
          <div className="lp-reg-head">
            <h2 className="cc-card-title">Planned loads ({known ? fmtInt(filtered.length) : 'N/A'})</h2>
            <Tabs
              label="Planned load views"
              value={tab}
              onChange={setTab}
              tabs={PLAN_TABS.map((t) => ({ key: t.key, label: t.label, count: known ? tabCounts[t.key] : null, countTone: t.key === 'risk' && tabCounts.risk ? 'red' : undefined }))}
            />
          </div>
          <div className="cc-filters lp-filters">
            <label className="cc-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Search reference, asset, route, cargo, notes" value={filters.search} onChange={(e) => setF('search', e.target.value)} aria-label="Search load plans" /></label>
            <select className="cc-select" aria-label="Origin" value={filters.origin} onChange={(e) => setF('origin', e.target.value)}><option value="">All origins</option>{places.origins.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            <select className="cc-select" aria-label="Destination" value={filters.destination} onChange={(e) => setF('destination', e.target.value)}><option value="">All destinations</option>{places.destinations.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setF('status', e.target.value)}><option value="">All statuses</option>{LOAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
            <select className="cc-select" aria-label="Capacity band" value={filters.band} onChange={(e) => setF('band', e.target.value)}><option value="">All capacity bands</option>{LOAD_BANDS.map((b) => <option key={b} value={b}>{LOAD_BAND_LABEL[b]}</option>)}</select>
            {countryOptions.length > 0 && <select className="cc-select" aria-label="Country" value={filters.country} onChange={(e) => setF('country', e.target.value)}><option value="">All countries</option>{countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
            {hasFilters && <button type="button" className="cc-btn-ghost" onClick={() => { setFilters(EMPTY_FILTERS); setFromDate(''); setToDate('') }}><X size={14} aria-hidden="true" /> Clear</button>}
          </div>
          <CardState state={plansState} lines={6}>
            <KitTable
              columns={columns}
              rows={tabRows}
              getRowId={(r) => String(r.id)}
              enableRowSelection
              rowSelection={selection}
              onRowSelectionChange={setSelection}
              empty={allPlans.length === 0 ? 'No load plans recorded yet. Use Plan load to create the first plan.' : 'No plans match these filters.'}
            />
          </CardState>
        </section>
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit load plan' : 'New load plan'}
        size="lg"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="load-plan-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving</> : editing ? 'Save changes' : 'Create plan'}
            </button>
          </>
        )}
      >
        <form id="load-plan-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label htmlFor="lp-ref" className="label">Reference (required)</label><input id="lp-ref" required className="input w-full" placeholder="e.g. LP-2026-0042" value={form.reference} maxLength={200} onChange={(e) => set('reference', e.target.value)} /></div>
            <div>
              <label htmlFor="lp-asset" className="label">Asset number (optional)</label>
              <input id="lp-asset" className="input w-full" list="lp-asset-options" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
              <datalist id="lp-asset-options">{availability.available.slice(0, 500).map((v) => <option key={v.id} value={v.asset_no}>{[v.vehicle_type, v.site].filter(Boolean).join(', ')}</option>)}</datalist>
            </div>
            <div><label htmlFor="lp-origin" className="label">Origin (optional)</label><input id="lp-origin" className="input w-full" placeholder="e.g. Riyadh depot" value={form.origin} maxLength={200} onChange={(e) => set('origin', e.target.value)} /></div>
            <div><label htmlFor="lp-dest" className="label">Destination (optional)</label><input id="lp-dest" className="input w-full" placeholder="e.g. Dammam port" value={form.destination} maxLength={200} onChange={(e) => set('destination', e.target.value)} /></div>
            <div><label htmlFor="lp-date" className="label">Plan date</label><input id="lp-date" className="input w-full" type="date" value={form.plan_date} onChange={(e) => set('plan_date', e.target.value)} /><p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p></div>
            <div><label htmlFor="lp-cargo" className="label">Cargo type (optional)</label><input id="lp-cargo" className="input w-full" placeholder="e.g. Palletised FMCG" value={form.cargo_type} maxLength={200} onChange={(e) => set('cargo_type', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><label htmlFor="lp-weight" className="label">Cargo weight (kg)</label><input id="lp-weight" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="18000" value={form.cargo_weight_kg} onChange={(e) => set('cargo_weight_kg', e.target.value)} /></div>
            <div><label htmlFor="lp-payload" className="label">Max payload (kg)</label><input id="lp-payload" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="24000" value={form.max_payload_kg} onChange={(e) => set('max_payload_kg', e.target.value)} /></div>
            <div><label htmlFor="lp-volume" className="label">Volume (m3)</label><input id="lp-volume" className="input w-full" type="number" inputMode="decimal" step="0.1" min="0" placeholder="60" value={form.volume_m3} onChange={(e) => set('volume_m3', e.target.value)} /></div>
            <div><label htmlFor="lp-maxvol" className="label">Max volume (m3)</label><input id="lp-maxvol" className="input w-full" type="number" inputMode="decimal" step="0.1" min="0" placeholder="76" value={form.max_volume_m3} onChange={(e) => set('max_volume_m3', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label htmlFor="lp-pallets" className="label">Pallet count (optional)</label><input id="lp-pallets" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="26" value={form.pallet_count} onChange={(e) => set('pallet_count', e.target.value)} /></div>
            <div>
              <label htmlFor="lp-status" className="label">Status</label>
              <select id="lp-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {LOAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>
          </div>
          <div><label htmlFor="lp-notes" className="label">Notes (optional)</label><textarea id="lp-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. hazmat segregation, temperature-controlled" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></div>
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this load plan?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.reference || 'Plan'}{confirmDelete?.asset_no ? ` | ${confirmDelete.asset_no}` : ''}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
