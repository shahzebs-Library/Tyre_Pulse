import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, MapPin, Loader2, Save, CircleDot, DollarSign, AlertTriangle, Gauge as GaugeIcon, ClipboardCheck,
  ShieldCheck, Search, FileSpreadsheet, FileText, Info, Pencil, ChevronDown, MoreVertical, RefreshCw,
  ExternalLink, Wrench, Timer,
} from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { useSettings } from '../contexts/SettingsContext'
import * as v360 from '../lib/api/vehicle360'
import { getVehicleDocumentDates } from '../lib/api/vehicle360Extra'
import { saveVehicleMeters } from '../lib/api/vehicleMeters'
import { toUserMessage } from '../lib/safeError'
import { currencyForCountry } from '../lib/governedCost'
import Gauge from '../components/ui/Gauge'
import VehicleMap from '../components/ui/VehicleMap'
import LoadingState from '../components/LoadingState'
import EmptyState from '../components/EmptyState'
import CopilotCard from '../components/ai/CopilotCard'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { Card, Tabs, KitTable, fmtInt } from '../components/commandCenter/kit'
import V360Menu, { V360MenuItem } from '../components/vehicle360/V360Menu'
import {
  Breadcrumb, HeaderCard, InfoCard, LayoutCard, LatestInspectionCard, ActivityCard,
  OpenWorkOrdersCard, CostSummaryCard, Tile, val,
} from '../components/vehicle360/Vehicle360Parts'
import { loadAssetHistory } from '../lib/api/assetHistory'
import { listVehicleInsuranceLines } from '../lib/api/vehicleInsurance'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import { layoutPositionsFor, canonicalToSlotId } from '../lib/tyreBay'
import {
  buildVehicle360, activityRows, filterActivity, sortActivity, monthlyCost, ACTIVITY_TYPES,
  tyreMetrics, tyreKmRun, tyreCost, isHighRiskTyre,
} from '../lib/vehicle360Analytics'
import {
  normalizeTab, fittedTyres, averageField, layoutStatus, costSplit, tyreSpendYtd, costPerTyre, retreadCount,
  openWorkOrders, latestInspection, recentActivity, complianceLines, riskBand,
} from '../lib/vehicle360View'
import './vehicle360.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const HISTORY_SOURCES = ['job_card', 'parts_line', 'accident', 'inspection', 'odometer', 'engine_hours']
const SOURCE_LABEL = {
  job_card: 'Work orders', parts_line: 'Expense grid', accident: 'Accidents', inspection: 'Inspections',
  odometer: 'Odometer readings', engine_hours: 'Engine hour readings', insurance: 'Insurance schedule',
}
const fmtN = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Math.round(Number(v)).toLocaleString())
const fmtMoney = (cur, v) => (v == null ? 'N/A' : `${cur} ${Math.round(v).toLocaleString()}`)
const ACTIVITY_LABEL = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.label]))
const typeLabel = (k) => ACTIVITY_LABEL[k] || k

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'layout', label: 'Tyre Layout' },
  { key: 'tyres', label: 'Tyre Records' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'costs', label: 'Costs & CPK' },
  { key: 'history', label: 'History' },
  { key: 'documents', label: 'Documents' },
  { key: 'compliance', label: 'Compliance' },
]
const MORE = [
  { key: 'location', label: 'Location & GPS', icon: MapPin },
  { key: 'health', label: 'Health & wear', icon: GaugeIcon },
  { key: 'ai', label: 'AI assessment', icon: ShieldCheck },
]

function GaugeNa({ label, note }) {
  return (
    <div className="v360-gauge-na">
      <b>N/A</b><span>{label}</span><small>{note}</small>
    </div>
  )
}

const RISK_PILL = { critical: 'bad', warning: 'warn', normal: 'good', unrated: 'muted' }
const RISK_TEXT = { critical: 'Critical', warning: 'Warning', normal: 'Normal', unrated: 'Not rated' }

export default function Vehicle360() {
  const { assetNo } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { activeCurrency, activeCountry } = useSettings()
  const fileRef = useRef(null)
  const tab = normalizeTab(sp.get('tab'))
  const setTab = useCallback((k) => setSp((p) => {
    const n = new URLSearchParams(p)
    if (k === 'overview') n.delete('tab'); else n.set('tab', k)
    return n
  }, { replace: true }), [setSp])

  const [vehicle, setVehicle] = useState(null)
  const [tyres, setTyres] = useState([])
  const [photoUrl, setPhotoUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [gps, setGps] = useState({ lat: '', lng: '' })
  const [savingGps, setSavingGps] = useState(false)
  const [msg, setMsg] = useState(null)
  const [history, setHistory] = useState(null)
  const [insurance, setInsurance] = useState({ rows: [], error: null })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [docs, setDocs] = useState({ loading: true, data: null, error: null })
  const [actType, setActType] = useState('all')
  const [actSearch, setActSearch] = useState('')
  const [actFrom, setActFrom] = useState('')
  const [actTo, setActTo] = useState('')
  const [costPeriod, setCostPeriod] = useState('year')
  const [costCur, setCostCur] = useState(null)
  const [meterEdit, setMeterEdit] = useState(false)
  const [meterDraft, setMeterDraft] = useState({ km: '', hours: '' })
  const [savingMeters, setSavingMeters] = useState(false)

  const loadHistory = useCallback(async (v) => {
    setHistoryLoading(true)
    const country = v?.country || activeCountry
    const [h, ins] = await Promise.allSettled([
      loadAssetHistory(v.asset_no, { country, sources: HISTORY_SOURCES }),
      listVehicleInsuranceLines(v.asset_no, { country }),
    ])
    setHistory(h.status === 'fulfilled' ? h.value : { sources: {}, failed: true })
    setInsurance(ins.status === 'fulfilled'
      ? { rows: ins.value, error: null }
      : { rows: [], error: toUserMessage(ins.reason, 'Could not read the insurance schedule.') })
    setHistoryLoading(false)
  }, [activeCountry])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // The same asset code in two countries is a different machine: read the
      // vehicle in the active country, then its tyres in THAT vehicle's country.
      const v = await v360.getVehicle(assetNo, { country: activeCountry })
      if (!v) throw new Error(`Vehicle "${assetNo}" not found.`)
      const t = await v360.getVehicleTyres(assetNo, { country: v.country })
      setVehicle(v); setTyres(t || [])
      setGps({ lat: v.latitude ?? '', lng: v.longitude ?? '' })
      setPhotoUrl(await v360.vehiclePhotoUrl(v360.resolveVehiclePhotoPath(v)))
      loadHistory(v)
    } catch (e) { setError(toUserMessage(e, 'Could not load the vehicle.')) }
    finally { setLoading(false) }
  }, [assetNo, activeCountry, loadHistory])
  useEffect(() => { load() }, [load])

  const fleetId = history?.fleet?.id ?? vehicle?.id ?? null
  useEffect(() => {
    if (fleetId == null) return undefined
    let alive = true
    setDocs({ loading: true, data: null, error: null })
    getVehicleDocumentDates(fleetId).then(
      (d) => { if (alive) setDocs({ loading: false, data: d, error: null }) },
      (e) => { if (alive) setDocs({ loading: false, data: null, error: toUserMessage(e, 'Could not read the document dates.') }) },
    )
    return () => { alive = false }
  }, [fleetId])

  async function onPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return
    if (!/^image\//.test(file.type)) { setMsg({ type: 'err', text: 'Please choose an image file.' }); return }
    if (file.size > 8 * 1024 * 1024) { setMsg({ type: 'err', text: 'Image must be under 8 MB.' }); return }
    setUploading(true); setMsg(null)
    try {
      const { url } = await v360.uploadVehiclePhoto(assetNo, file, { country: vehicle?.country })
      setPhotoUrl(url); setMsg({ type: 'ok', text: 'Photo updated.' })
    } catch (err) { setMsg({ type: 'err', text: toUserMessage(err, 'Upload failed.') }) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function saveGps(e) {
    e.preventDefault(); setSavingGps(true); setMsg(null)
    try {
      const { latitude, longitude } = await v360.saveVehicleGps(assetNo, gps.lat, gps.lng, 'manual', { country: vehicle?.country })
      setVehicle((v) => ({ ...v, latitude, longitude }))
      setMsg({ type: 'ok', text: 'Location saved.' })
    } catch (err) { setMsg({ type: 'err', text: toUserMessage(err, 'Could not save location.') }) }
    finally { setSavingGps(false) }
  }

  const m = useMemo(
    () => tyreMetrics(tyres, { targetKm: vehicle?.expected_km_per_tyre }),
    [tyres, vehicle?.expected_km_per_tyre],
  )
  // Tyre prices are held in the vehicle's own country currency. Under the All
  // countries view the settings currency is not this vehicle's, so it is not used.
  const tyreCurrency = currencyForCountry(vehicle?.country) || (activeCountry !== 'All' ? activeCurrency : null)

  const src = history?.sources || {}
  const rowsOf = (k) => (src[k]?.ok ? src[k].rows : [])
  const unreadable = useMemo(() => {
    const out = HISTORY_SOURCES.filter((k) => history && !history.failed && src[k] && src[k].ok === false).map((k) => SOURCE_LABEL[k])
    if (history?.failed) out.push('Vehicle history')
    if (insurance.error) out.push(SOURCE_LABEL.insurance)
    return out
  }, [history, insurance.error]) // eslint-disable-line react-hooks/exhaustive-deps
  const truncatedSources = (history?.truncated || []).map((k) => SOURCE_LABEL[k] || k)

  const a360 = useMemo(() => buildVehicle360({
    fleet: history?.fleet || vehicle,
    jobCards: rowsOf('job_card'), tyres, accidents: rowsOf('accident'), inspections: rowsOf('inspection'),
    partsLines: rowsOf('parts_line'), odometer: rowsOf('odometer'), hours: rowsOf('engine_hours'),
    insurance: insurance.rows, now: Date.now(),
  }), [history, vehicle, tyres, insurance.rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const costChart = useMemo(() => {
    if (!a360.chartCurrency) return null
    const series = monthlyCost(rowsOf('parts_line'), a360.chartCurrency, { now: Date.now(), months: 12 })
    if (!series.tyre.some((v) => v) && !series.other.some((v) => v)) return null
    return {
      labels: series.labels,
      datasets: [
        { label: 'Tyre', data: series.tyre, backgroundColor: withAlpha(colorAt(0), 0.85), stack: 's' },
        { label: 'Spare and oil', data: series.other, backgroundColor: withAlpha(colorAt(2), 0.85), stack: 's' },
      ],
    }
  }, [a360.chartCurrency, history]) // eslint-disable-line react-hooks/exhaustive-deps

  const activity = useMemo(() => activityRows({
    jobCards: rowsOf('job_card'), tyres, accidents: rowsOf('accident'),
    inspections: rowsOf('inspection'), partsLines: rowsOf('parts_line'),
  }), [history, tyres]) // eslint-disable-line react-hooks/exhaustive-deps
  const activityView = useMemo(
    () => sortActivity(filterActivity(activity, { type: actType, search: actSearch, from: actFrom, to: actTo }), 'date', 'desc'),
    [activity, actType, actSearch, actFrom, actTo],
  )
  const ACT_COLS = ['date', 'type', 'ref', 'detail', 'status', 'amount', 'currency']
  const ACT_HEAD = ['Date', 'Type', 'Reference', 'Detail', 'Status', 'Amount', 'Currency']
  const activityExportRows = () => activityView.map((r) => ({ ...r, type: typeLabel(r.type), date: r.date || 'N/A', amount: r.amount ?? 'N/A', currency: r.currency || 'N/A' }))
  function exportActivity(kind) {
    const rows = activityExportRows()
    if (!rows.length) return
    const name = reportFileName('Vehicle 360', vehicle?.asset_no, actFrom && `from ${actFrom}`, actTo && `to ${actTo}`)
    if (kind === 'excel') exportToExcel(rows, ACT_COLS, ACT_HEAD, name)
    else exportToPdf(rows, ACT_COLS.map((k, i) => ({ key: k, header: ACT_HEAD[i] })), `${name} activity`, name, 'landscape')
  }

  const now = Date.now()
  const fitted = useMemo(() => fittedTyres(tyres), [tyres])
  const fittedCritical = fitted.filter(isHighRiskTyre).length
  const tread = averageField(fitted, 'tread_depth')
  const pressure = averageField(fitted, 'pressure_reading')
  const status = useMemo(() => layoutStatus(vehicle?.vehicle_type, tyres, vehicle?.asset_no), [vehicle, tyres])
  const spendYtd = useMemo(() => tyreSpendYtd(rowsOf('parts_line'), Date.now()), [history]) // eslint-disable-line react-hooks/exhaustive-deps
  const split = useMemo(() => costSplit(rowsOf('parts_line'), { period: costPeriod, now: Date.now() }), [history, costPeriod]) // eslint-disable-line react-hooks/exhaustive-deps
  const openWos = useMemo(() => openWorkOrders(rowsOf('job_card')), [history]) // eslint-disable-line react-hooks/exhaustive-deps
  const lastInsp = useMemo(() => latestInspection(rowsOf('inspection')), [history]) // eslint-disable-line react-hooks/exhaustive-deps
  const feed = useMemo(() => recentActivity(activity, 6), [activity])
  const compliance = useMemo(() => complianceLines(docs.data, Date.now()), [docs.data])

  const money = (n) => (n == null ? 'N/A' : tyreCurrency ? `${tyreCurrency} ${Math.round(n).toLocaleString()}` : Math.round(n).toLocaleString())
  const enc = encodeURIComponent(vehicle?.asset_no || assetNo)

  function startMeterEdit() {
    setMeterDraft({ km: a360.meters.currentKm ?? '', hours: a360.meters.engineHours ?? '' })
    setMeterEdit(true); setMsg(null)
  }
  async function saveMeters() {
    const km = String(meterDraft.km ?? '').trim()
    const hours = String(meterDraft.hours ?? '').trim()
    if (!km && !hours) { setMsg({ type: 'err', text: 'Enter an odometer or engine hours reading.' }); return }
    for (const v of [km, hours]) {
      if (v && (!Number.isFinite(Number(v)) || Number(v) < 0)) { setMsg({ type: 'err', text: 'Readings must be numbers of zero or more.' }); return }
    }
    setSavingMeters(true); setMsg(null)
    try {
      await saveVehicleMeters(
        { id: fleetId, km: a360.meters.currentKm, engineHours: a360.meters.engineHours },
        { date: new Date().toISOString().slice(0, 10), km, hours, notes: '', requestId: globalThis.crypto?.randomUUID?.() || `v360-${Date.now()}` },
      )
      setMsg({ type: 'ok', text: 'Meter readings saved.' })
      setMeterEdit(false)
      loadHistory(vehicle)
    } catch (err) { setMsg({ type: 'err', text: toUserMessage(err, 'Could not save the readings.') }) }
    finally { setSavingMeters(false) }
  }

  // ── table columns ──────────────────────────────────────────────────────────
  const costColumns = useMemo(() => [
    { id: 'currency', header: 'Currency', accessorKey: 'currency', cell: ({ getValue }) => <b>{getValue()}</b> },
    ...['tyre', 'spare', 'oil', 'total', 'lines'].map((k) => ({
      id: k, header: k === 'lines' ? 'Lines' : k[0].toUpperCase() + k.slice(1), accessorKey: k, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{fmtN(getValue())}</span>,
    })),
  ], [])

  const insuranceColumns = useMemo(() => [
    { id: 'policy_no', header: 'Policy', accessorFn: (r) => r.policy_no || 'N/A' },
    { id: 'cover_type', header: 'Cover', accessorFn: (r) => r.cover_type || 'N/A' },
    { id: 'cover_from', header: 'From', accessorFn: (r) => r.cover_from?.slice(0, 10) || 'N/A' },
    { id: 'cover_to', header: 'To', accessorFn: (r) => r.cover_to?.slice(0, 10) || 'N/A' },
    { id: 'sum_insured', header: 'Sum insured', accessorFn: (r) => (r.sum_insured == null ? -1 : Number(r.sum_insured)), meta: { align: 'right', exportValue: (r) => r.sum_insured ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.sum_insured == null ? 'N/A' : fmtMoney(row.original.currency || '', Number(row.original.sum_insured))}</span> },
  ], [])

  const tyreColumns = useMemo(() => [
    { id: 'issue_date', header: 'Date', accessorFn: (t) => t.issue_date?.slice(0, 10) || '', cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() || 'N/A'}</span> },
    { id: 'serial_no', header: 'Serial', accessorFn: (t) => t.serial_no || 'N/A', cell: ({ row, getValue }) => (
      row.original.serial_no
        ? <Link className="cc-link" to={`/tyre-passport/${encodeURIComponent(row.original.serial_no)}`}>{getValue()}</Link>
        : <span className="cc-na">N/A</span>) },
    { id: 'brand', header: 'Brand', accessorFn: (t) => t.brand || 'N/A', meta: { filterVariant: 'select' } },
    { id: 'position', header: 'Position', accessorFn: (t) => t.position || 'N/A', meta: { filterVariant: 'select' } },
    { id: 'size', header: 'Size', accessorFn: (t) => t.size || 'N/A', meta: { filterVariant: 'select' } },
    { id: 'km', header: 'KM run', accessorFn: (t) => tyreKmRun(t) ?? -1, meta: { align: 'right', exportValue: (t) => tyreKmRun(t) ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{fmtN(tyreKmRun(row.original))}</span> },
    { id: 'cost', header: tyreCurrency ? `Cost (${tyreCurrency})` : 'Cost', accessorFn: (t) => tyreCost(t) ?? -1, meta: { align: 'right', exportValue: (t) => tyreCost(t) ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{fmtN(tyreCost(row.original))}</span> },
    { id: 'risk', header: 'Risk', accessorFn: (t) => t.risk_level || 'N/A', meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const band = riskBand(row.original.risk_level)
        return <span className={`cc-pill ${RISK_PILL[band]}`}>{row.original.risk_level || RISK_TEXT[band]}</span>
      } },
  ], [tyreCurrency])

  const activityColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: (r) => r.date || '', cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() || 'N/A'}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => typeLabel(r.type) },
    { id: 'ref', header: 'Reference', accessorFn: (r) => r.ref || 'N/A', cell: ({ getValue }) => <b>{getValue()}</b> },
    { id: 'detail', header: 'Detail', accessorFn: (r) => r.detail || 'N/A', size: 320, cell: ({ getValue }) => <span className="block max-w-[320px] truncate" title={getValue()}>{getValue()}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status || 'N/A' },
    { id: 'amount', header: 'Amount', accessorFn: (r) => (r.amount == null ? -1 : r.amount), meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.amount == null ? 'N/A' : Math.round(row.original.amount).toLocaleString()}</span> },
    { id: 'currency', header: 'Currency', accessorFn: (r) => r.currency || 'N/A' },
  ], [])

  // Slot-by-slot table for the Tyre Layout tab: every wheel of the layout and
  // the tyre on it now. Built only when the layout is known.
  const slotRows = useMemo(() => {
    if (!vehicle || status.tyreless) return []
    const current = new Map()
    for (const t of fitted) {
      const slot = canonicalToSlotId(vehicle.vehicle_type, t.position)
      if (slot) current.set(slot, t)
    }
    return layoutPositionsFor(vehicle.vehicle_type).map(({ slot, code }) => {
      const t = current.get(slot)
      return { key: slot, code, tyre: t || null }
    })
  }, [vehicle, fitted, status.tyreless])

  if (loading) return <LoadingState message="Loading vehicle..." />
  if (error) return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link to="/fleet-master" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 mb-4"><ArrowLeft size={15} /> Back to Fleet</Link>
      <EmptyState icon={AlertTriangle} title="Vehicle unavailable" description={error} action={{ label: 'Retry', onClick: load }} />
    </div>
  )

  const inspectTo = `/inspections?asset=${enc}`
  const spendTile = (() => {
    if (historyLoading) return { value: '...', sub: null }
    if (!spendYtd.length) return { value: 'N/A', sub: 'No expense lines this year' }
    if (spendYtd.length === 1) return { value: `${spendYtd[0].currency} ${fmtInt(Math.round(spendYtd[0].amount))}`, sub: 'Expense grid, this year' }
    return { value: 'Mixed', sub: spendYtd.map((s) => `${s.currency} ${fmtInt(Math.round(s.amount))}`).join(' | ') }
  })()

  const actions = (
    <>
      <Link className="cc-btn-ghost" to={`/fleet-master?search=${enc}`}><Pencil size={14} aria-hidden="true" /> Edit</Link>
      <div className="v360-split">
        <Link className="cc-btn-primary" to={inspectTo}><ClipboardCheck size={15} aria-hidden="true" /> New Inspection</Link>
        <V360Menu label="More inspection options" triggerClass="cc-btn-primary" trigger={<ChevronDown size={15} aria-hidden="true" />}>
          {(close) => (
            <>
              <V360MenuItem icon={ClipboardCheck} onClick={() => { close(); navigate(inspectTo) }}>Tyre checklist</V360MenuItem>
              <V360MenuItem icon={ClipboardCheck} onClick={() => { close(); navigate('/checklists') }}>Open checklists</V360MenuItem>
              <V360MenuItem icon={ClipboardCheck} onClick={() => { close(); navigate('/inspection-planner') }}>Inspection planner</V360MenuItem>
            </>
          )}
        </V360Menu>
      </div>
      <V360Menu label="More actions" triggerClass="cc-icon-btn" trigger={<MoreVertical size={16} aria-hidden="true" />}>
        {(close) => (
          <>
            <V360MenuItem icon={RefreshCw} onClick={() => { close(); load() }}>Refresh data</V360MenuItem>
            <V360MenuItem icon={FileSpreadsheet} disabled={!activityView.length} onClick={() => { close(); exportActivity('excel') }}>Export activity (Excel)</V360MenuItem>
            <V360MenuItem icon={FileText} disabled={!activityView.length} onClick={() => { close(); exportActivity('pdf') }}>Export activity (PDF)</V360MenuItem>
            <V360MenuItem icon={ExternalLink} onClick={() => { close(); navigate(`/fleet-master?search=${enc}`) }}>Open in Fleet Master</V360MenuItem>
          </>
        )}
      </V360Menu>
    </>
  )

  const infoCard = (
    <InfoCard
      vehicle={vehicle} fleet={history?.fleet} meters={a360.meters} loadingMeters={historyLoading}
      money={money} edit={meterEdit} onEdit={startMeterEdit} onCancel={() => setMeterEdit(false)}
      onSave={saveMeters} saving={savingMeters} draft={meterDraft} setDraft={setMeterDraft}
      editLink={<Link className="cc-icon-btn" to={`/fleet-master?search=${enc}`} aria-label="Edit vehicle details" title="Edit vehicle details"><Pencil size={14} aria-hidden="true" /></Link>}
    />
  )
  const costCard = (
    <CostSummaryCard
      loading={historyLoading} split={split} currency={costCur} onCurrency={setCostCur}
      period={costPeriod} onPeriod={setCostPeriod}
      tiles={[
        { label: 'Tyre cost per km', value: m.cpk == null ? 'N/A' : `${m.cpk.toFixed(2)}${tyreCurrency ? ` ${tyreCurrency}` : ''}` },
        { label: 'Avg cost per tyre', value: (() => { const c = costPerTyre(tyres); return c ? money(c.value) : 'N/A' })() },
        { label: 'Total jobs', value: historyLoading ? '...' : fmtN(a360.workOrders.total) },
        { label: 'Retreads', value: fmtN(retreadCount(tyres)) },
      ]}
    />
  )
  const insuranceCard = (
    <Card title="Insurance" sub="Schedule lines naming this asset. Many schedules do not state an asset id, so no line here does not prove the vehicle is uninsured.">
      {historyLoading ? <div className="cc-empty">Loading insurance...</div>
        : insurance.error ? <div className="cc-empty" role="alert">{insurance.error}</div>
        : !insurance.rows.length ? <div className="cc-empty">No schedule line names this asset.</div>
        : (
          <>
            <div className="v360-mini">
              <div><b>{a360.insurance.active}</b><span>Active lines</span></div>
              <div><b>{a360.insurance.expired}</b><span>Expired</span></div>
              <div><b>{fmtN(a360.insurance.daysToExpiry)}</b><span>Days to next expiry</span></div>
              {a360.insurance.sumInsured.map((si) => <div key={si.currency}><b>{fmtMoney(si.currency, si.amount)}</b><span>Sum insured (active)</span></div>)}
            </div>
            <div className="v360-gap">
              <EnterpriseTable columns={insuranceColumns} data={insurance.rows} getRowId={(r) => String(r.id)}
                enableGlobalFilter={false} enableColumnFilters={false} enableColumnVisibility={false}
                exportFileName={reportFileName('Vehicle 360', vehicle.asset_no, 'insurance')} className="cc-et"
                virtual maxHeight={260} emptyMessage="No schedule line names this asset." />
            </div>
          </>
        )}
    </Card>
  )

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      <div className="cc v360">
        <Breadcrumb asset={vehicle.asset_no} />
        <HeaderCard
          vehicle={vehicle} fleet={history?.fleet} photoUrl={photoUrl} uploading={uploading}
          fileRef={fileRef} onPhoto={onPhoto} actions={actions}
        />

        {msg && (
          <div role="status" className={`v360-banner ${msg.type === 'ok' ? 'ok' : 'bad'}`}>{msg.text}</div>
        )}
        {(unreadable.length > 0 || truncatedSources.length > 0) && (
          <div role="status" className="v360-banner">
            <Info size={15} aria-hidden="true" />
            <div>
              {unreadable.length > 0 && <p>Could not be read: {unreadable.join(', ')}. Those figures show N/A, not zero.</p>}
              {truncatedSources.length > 0 && <p>Read ceiling reached for: {truncatedSources.join(', ')}. Totals cover the rows loaded.</p>}
              <button type="button" className="cc-btn" onClick={() => vehicle && loadHistory(vehicle)}>Retry</button>
            </div>
          </div>
        )}

        <div className="v360-tabs">
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Vehicle sections" variant="line" />
          <V360Menu
            label="More sections" triggerClass="v360-more" selected={MORE.some((x) => x.key === tab)} align="right"
            trigger={<>More <ChevronDown size={14} aria-hidden="true" /></>}
          >
            {(close) => MORE.map((x) => (
              <V360MenuItem key={x.key} icon={x.icon} onClick={() => { close(); setTab(x.key) }}>{x.label}</V360MenuItem>
            ))}
          </V360Menu>
        </div>

        {tab === 'overview' && (
          <>
            <div className="v360-kpis">
              <Tile icon={CircleDot} tone="t-green" label="Total Tyres" value={fmtInt(fitted.length)}
                sub={tyres.length > fitted.length ? `${tyres.length} records incl. removed` : 'Fitted now'}
                chip={fittedCritical > 0 ? <span className="cc-count red v360-chip" title="Fitted tyres at High or Critical risk">{fittedCritical} critical</span> : null} />
              <Tile icon={GaugeIcon} tone="t-blue" label="Avg Tread Depth"
                value={tread ? `${tread.value.toFixed(1)} mm` : 'N/A'}
                sub={tread ? `From ${tread.sample} tyre${tread.sample === 1 ? '' : 's'}` : 'No tread depth recorded'} />
              <Tile icon={Timer} tone="t-purple" label="Avg Pressure"
                value={pressure ? `${Math.round(pressure.value)} psi` : 'N/A'}
                sub={pressure ? `From ${pressure.sample} tyre${pressure.sample === 1 ? '' : 's'}` : 'No pressure recorded'} />
              <Tile icon={DollarSign} tone="t-amber" label="Tyre Spend (YTD)" value={spendTile.value} sub={spendTile.sub} loading={historyLoading} />
              <Tile icon={GaugeIcon} tone="t-green" label="Avg CPK"
                value={m.cpk == null ? 'N/A' : `${m.cpk.toFixed(2)}${tyreCurrency ? ` ${tyreCurrency}/km` : ''}`}
                sub={m.cpk == null ? 'Needs a priced tyre with a measured run' : `From ${m.cpkSample} tyre${m.cpkSample === 1 ? '' : 's'}`} />
              <Tile icon={ClipboardCheck} tone="t-blue" label="Last Inspection" loading={historyLoading}
                value={lastInsp ? (a360.inspections.daysSince === 0 ? 'Today' : `${fmtN(a360.inspections.daysSince)} d ago`) : 'Never'}
                sub={lastInsp ? lastInsp.day : 'None recorded. Next-inspection dates are not read here.'} />
            </div>

            <div className="v360-row3">
              {infoCard}
              <LayoutCard vehicle={vehicle} tyres={tyres} status={status} onExpand={() => setTab('layout')} />
              <LatestInspectionCard loading={historyLoading} inspection={lastInsp} startTo={inspectTo} allTo="/inspections" now={now} />
            </div>
            <div className="v360-row3">
              <ActivityCard loading={historyLoading} rows={feed} onViewAll={() => setTab('history')} now={now} typeLabel={typeLabel} />
              <OpenWorkOrdersCard loading={historyLoading} rows={openWos} newTo="/work-orders" allTo="/work-orders" />
              {costCard}
            </div>
          </>
        )}

        {tab === 'layout' && (
          <div className="v360-two">
            <LayoutCard vehicle={vehicle} tyres={tyres} status={status} wide />
            <Card title="Wheel positions" sub="Every wheel of this layout and the tyre fitted now.">
              {!slotRows.length ? <div className="cc-empty">{status.tyreless ? 'This equipment carries no tyres.' : 'No wheel layout is known for this vehicle type.'}</div> : (
                <KitTable
                  columns={[
                    { key: 'code', header: 'Position', cell: (r) => <b>{r.code}</b>, sortValue: (r) => r.code },
                    { key: 'serial', header: 'Serial', cell: (r) => (r.tyre?.serial_no ? <Link className="cc-link" to={`/tyre-passport/${encodeURIComponent(r.tyre.serial_no)}`}>{r.tyre.serial_no}</Link> : <span className="cc-na">Not fitted</span>), sortValue: (r) => r.tyre?.serial_no || '' },
                    { key: 'brand', header: 'Brand', cell: (r) => val(r.tyre?.brand), sortValue: (r) => r.tyre?.brand || '' },
                    { key: 'risk', header: 'Risk', cell: (r) => (r.tyre ? <span className={`cc-pill ${RISK_PILL[riskBand(r.tyre.risk_level)]}`}>{RISK_TEXT[riskBand(r.tyre.risk_level)]}</span> : <span className="cc-na">N/A</span>), sortValue: (r) => r.tyre?.risk_level || '' },
                  ]}
                  rows={slotRows} getRowId={(r) => r.key} compact empty="No wheel positions."
                />
              )}
            </Card>
          </div>
        )}

        {tab === 'tyres' && (
          <Card title="Fitted & historical tyres" sub={m.priced < m.total ? `${m.total - m.priced} of ${m.total} tyres carry no price, so their cost shows N/A rather than zero.` : undefined}>
            {m.total === 0 ? (
              <EmptyState illustration="module/tyres" icon={CircleDot} title="No tyre records" description="No tyres are recorded against this vehicle yet." />
            ) : (
              <EnterpriseTable
                columns={tyreColumns} data={tyres} getRowId={(t) => String(t.id)}
                searchPlaceholder="Search serial, brand, position" className="cc-et"
                exportFileName={reportFileName('Vehicle 360', vehicle.asset_no, 'tyres')}
                initialPageSize={25} emptyMessage="No tyres match these filters."
              />
            )}
          </Card>
        )}

        {tab === 'inspections' && (
          <Card title="Inspections" action={<Link className="cc-btn" to={inspectTo}>New Inspection</Link>}>
            {historyLoading ? <div className="cc-empty">Loading inspections...</div>
              : src.inspection && src.inspection.ok === false ? <div className="cc-empty" role="alert">Inspections could not be read. <button type="button" className="cc-btn" onClick={() => loadHistory(vehicle)}>Retry</button></div>
              : (
                <KitTable
                  columns={[
                    { key: 'day', header: 'Date', sortValue: (r) => r.inspection_date || r.completed_date || '', cell: (r) => val((r.inspection_date || r.completed_date || '').slice(0, 10)) },
                    { key: 'title', header: 'Type', sortValue: (r) => r.inspection_type || r.title || '', cell: (r) => val(r.inspection_type || r.title) },
                    { key: 'inspector', header: 'Inspector' },
                    { key: 'status', header: 'Status', cell: (r) => (r.status ? <span className="cc-pill info">{r.status}</span> : <span className="cc-na">N/A</span>) },
                    { key: 'severity', header: 'Severity' },
                    { key: 'findings', header: 'Findings', cell: (r) => <span className="v360-wrap">{val(r.findings)}</span>, sortable: false },
                  ]}
                  rows={rowsOf('inspection')} getRowId={(r) => String(r.id)} empty="No inspection is recorded for this vehicle."
                />
              )}
          </Card>
        )}

        {tab === 'maintenance' && (
          <Card title="Maintenance" sub={`${openWos.length} open of ${fmtN(a360.workOrders.total)} job cards`} action={<Link className="cc-btn" to="/work-orders"><Wrench size={12} aria-hidden="true" /> Work orders</Link>}>
            {historyLoading ? <div className="cc-empty">Loading work orders...</div>
              : src.job_card && src.job_card.ok === false ? <div className="cc-empty" role="alert">Work orders could not be read. <button type="button" className="cc-btn" onClick={() => loadHistory(vehicle)}>Retry</button></div>
              : (
                <KitTable
                  columns={[
                    { key: 'work_order_no', header: 'Job card', cell: (r) => <b>{r.work_order_no || 'N/A'}</b> },
                    { key: 'opened_at', header: 'Opened', sortValue: (r) => r.opened_at || '', cell: (r) => val((r.opened_at || '').slice(0, 10)) },
                    { key: 'work_type', header: 'Type' },
                    { key: 'description', header: 'Description', cell: (r) => <span className="v360-wrap">{val(r.description)}</span>, sortable: false },
                    { key: 'status', header: 'Status', cell: (r) => (r.status ? <span className="cc-pill info">{r.status}</span> : <span className="cc-na">N/A</span>) },
                    { key: 'priority', header: 'Priority' },
                    { key: 'technician_name', header: 'Technician' },
                  ]}
                  rows={rowsOf('job_card')} getRowId={(r) => String(r.id)} empty="No work orders are recorded for this vehicle."
                />
              )}
          </Card>
        )}

        {tab === 'costs' && (
          <>
            <div className="v360-two">
              {costCard}
              <Card title="Operating cost (expense grid)" sub="From the classified expense grid, per currency. Currencies are never added together.">
                {historyLoading ? <div className="cc-empty">Loading cost...</div>
                  : !a360.cost.length ? <div className="cc-empty">No expense lines are recorded against this vehicle.</div>
                  : (
                    <EnterpriseTable columns={costColumns} data={a360.cost} getRowId={(r) => r.currency}
                      enableGlobalFilter={false} enableColumnFilters={false} enableColumnVisibility={false} enableExport={false}
                      initialPageSize={25} pageSizeOptions={[25]} className="cc-et" emptyMessage="No expense lines are recorded against this vehicle." />
                  )}
                {costChart && (
                  <div className="v360-chart">
                    <Bar data={costChart} options={{ maintainAspectRatio: false, plugins: { legend: { labels: { color: 'var(--text-secondary)' } } }, scales: { x: { stacked: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } }, y: { stacked: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' }, title: { display: true, text: a360.chartCurrency, color: 'var(--text-muted)' } } } }} />
                  </div>
                )}
                {a360.cost.length > 1 && <p className="v360-note">More than one currency on this vehicle, so the monthly chart is withheld.</p>}
              </Card>
            </div>
          </>
        )}

        {tab === 'history' && (
          <Card
            title="Vehicle activity"
            action={(
              <div className="v360-filters">
                <button type="button" className="cc-btn-ghost" disabled={!activityView.length} onClick={() => exportActivity('excel')}><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" disabled={!activityView.length} onClick={() => exportActivity('pdf')}><FileText size={13} aria-hidden="true" /> PDF</button>
              </div>
            )}
          >
            <div className="v360-filters">
              <label className="cc-search grow">
                <Search size={14} aria-hidden="true" />
                <input aria-label="Search activity" placeholder="Search reference, detail..." value={actSearch} onChange={(e) => setActSearch(e.target.value)} />
              </label>
              <select aria-label="Activity type" className="cc-select" value={actType} onChange={(e) => setActType(e.target.value)}>
                <option value="all">All types</option>
                {ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <input aria-label="From date" type="date" className="cc-select" value={actFrom} max={actTo || undefined} onChange={(e) => setActFrom(e.target.value)} />
              <input aria-label="To date" type="date" className="cc-select" value={actTo} min={actFrom || undefined} onChange={(e) => setActTo(e.target.value)} />
            </div>
            {historyLoading ? <div className="cc-empty">Loading activity...</div>
              : !activityView.length ? <div className="cc-empty">{activity.length ? 'No activity matches these filters.' : 'No activity is recorded for this vehicle.'}</div>
              : (
                <EnterpriseTable columns={activityColumns} data={activityView} getRowId={(r) => String(r.key)}
                  enableGlobalFilter={false} enableColumnFilters={false} enableExport={false} className="cc-et"
                  initialPageSize={25} emptyMessage="No activity matches these filters." />
              )}
          </Card>
        )}

        {tab === 'documents' && insuranceCard}

        {tab === 'compliance' && (
          <div className="v360-two">
            <Card title="Document dates" sub="From the fleet register. A missing date is not recorded, it does not mean valid.">
              {docs.loading ? <div className="cc-empty">Loading document dates...</div>
                : docs.error ? <div className="cc-empty" role="alert">{docs.error}</div>
                : (
                  <div className="v360-comp">
                    {compliance.map((c) => (
                      <div key={c.label}>
                        <span className="lbl">{c.label}</span>
                        <b>{c.day || 'Not recorded'}</b>
                        <span className={`cc-pill ${c.status === 'valid' ? 'good' : c.status === 'due-soon' ? 'warn' : c.status === 'expired' ? 'bad' : 'muted'}`}>
                          {c.status === 'valid' ? `Valid, ${c.days} days left` : c.status === 'due-soon' ? `Due in ${c.days} days` : c.status === 'expired' ? `Expired ${Math.abs(c.days)} days ago` : 'No date on file'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
            </Card>
            <Card title="Cover and inspection" sub="From the insurance schedule and the inspection register.">
              <dl className="v360-kv">
                <div><dt>Active insurance lines</dt><dd>{historyLoading ? '...' : fmtN(a360.insurance.active)}</dd></div>
                <div><dt>Next cover expiry</dt><dd>{historyLoading ? '...' : val(a360.insurance.nextExpiry)}</dd></div>
                <div><dt>Days since last inspection</dt><dd>{historyLoading ? '...' : val(a360.inspections.daysSince)}</dd></div>
                <div><dt>Open accidents</dt><dd>{historyLoading ? '...' : fmtN(a360.accidents.open)}</dd></div>
              </dl>
            </Card>
          </div>
        )}

        {tab === 'location' && (
          <div className="v360-two">
            <Card title="Location" sub={vehicle.location_updated_at ? `Last fix ${new Date(vehicle.location_updated_at).toLocaleString()}` : 'No GPS fix recorded'}>
              <VehicleMap lat={Number(vehicle.latitude)} lng={Number(vehicle.longitude)} label={vehicle.asset_no} height={244} />
            </Card>
            <Card title="Set location" sub={vehicle.gps_source && vehicle.gps_source !== 'manual' ? `Live source: ${vehicle.gps_source}` : undefined}>
              <form onSubmit={saveGps}>
                <div className="v360-gps">
                  <label htmlFor="v360-lat">Latitude
                    <input id="v360-lat" className="cc-select" placeholder="24.7136" value={gps.lat} onChange={(e) => setGps((g) => ({ ...g, lat: e.target.value }))} inputMode="decimal" />
                  </label>
                  <label htmlFor="v360-lng">Longitude
                    <input id="v360-lng" className="cc-select" placeholder="46.6753" value={gps.lng} onChange={(e) => setGps((g) => ({ ...g, lng: e.target.value }))} inputMode="decimal" />
                  </label>
                </div>
                <div className="v360-card-foot">
                  <button type="submit" disabled={savingGps} className="cc-btn-primary">
                    {savingGps ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} Save location
                  </button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {tab === 'health' && (
          <Card title="Health & wear" sub="Derived from this vehicle's tyre records only.">
            <div className="v360-gauges">
              {m.health == null ? <GaugeNa label="Health" note="No tyres recorded" /> : <Gauge index={0} value={m.health} max={100} label="Health" size={116} />}
              {m.highRate == null ? <GaugeNa label="Critical rate" note="No tyres recorded" /> : <Gauge index={1} value={m.highRate} max={100} unit="%" label="Critical rate" reverse format={(x) => x.toFixed(0)} size={116} />}
              {m.lifeVsTargetPct == null
                ? <GaugeNa label="Life vs target" note={m.avgLifeKm == null ? 'No tyre with a measured run' : 'No expected km per tyre on this vehicle'} />
                : <Gauge index={2} value={m.lifeVsTargetPct} max={100} unit="%" label="Life vs target" format={(x) => Math.round(x)} size={116} />}
            </div>
          </Card>
        )}

        {tab === 'ai' && (
          <CopilotCard task="assess_vehicle_tyres" context={{ vehicle, tyres }} />
        )}
      </div>
    </div>
  )
}
