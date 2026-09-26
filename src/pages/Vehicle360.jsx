import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Camera, Loader2, MapPin, Save, CircleDot, DollarSign, AlertTriangle, Gauge as GaugeIcon, Car, ClipboardCheck, Wrench, ShieldCheck, Timer, Search, FileSpreadsheet, FileText, ArrowUpDown, Info } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { useSettings } from '../contexts/SettingsContext'
import * as v360 from '../lib/api/vehicle360'
import { toUserMessage } from '../lib/safeError'
import { recordCost } from '../lib/analyticsEngine'
import Gauge from '../components/ui/Gauge'
import StatTile from '../components/ui/StatTile'
import VehicleMap from '../components/ui/VehicleMap'
import StatusBadge from '../components/ui/StatusBadge'
import LoadingState from '../components/LoadingState'
import EmptyState from '../components/EmptyState'
import CopilotCard from '../components/ai/CopilotCard'
import { TablePagination, usePagedRows } from '../components/ui/TablePagination'
import { loadAssetHistory } from '../lib/api/assetHistory'
import { listVehicleInsuranceLines } from '../lib/api/vehicleInsurance'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  buildVehicle360, activityRows, filterActivity, sortActivity, monthlyCost, ACTIVITY_TYPES,
} from '../lib/vehicle360Analytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const HISTORY_SOURCES = ['job_card', 'parts_line', 'accident', 'inspection', 'odometer', 'engine_hours']
const SOURCE_LABEL = {
  job_card: 'Work orders', parts_line: 'Expense grid', accident: 'Accidents', inspection: 'Inspections',
  odometer: 'Odometer readings', engine_hours: 'Engine hour readings', insurance: 'Insurance schedule',
}
const fmtN = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Math.round(Number(v)).toLocaleString())
const fmtMoney = (cur, v) => (v == null ? 'N/A' : `${cur} ${Math.round(v).toLocaleString()}`)
const ACTIVITY_LABEL = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.label]))

const isHigh = (r) => r.risk_level === 'High' || r.risk_level === 'Critical'

export default function Vehicle360() {
  const { assetNo } = useParams()
  const { activeCurrency, activeCountry } = useSettings()
  const fileRef = useRef(null)

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
  const [actType, setActType] = useState('all')
  const [actSearch, setActSearch] = useState('')
  const [actFrom, setActFrom] = useState('')
  const [actTo, setActTo] = useState('')
  const [actSort, setActSort] = useState({ key: 'date', dir: 'desc' })

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
      const [v, t] = await Promise.all([v360.getVehicle(assetNo), v360.getVehicleTyres(assetNo)])
      if (!v) throw new Error(`Vehicle "${assetNo}" not found.`)
      setVehicle(v); setTyres(t || [])
      setGps({ lat: v.latitude ?? '', lng: v.longitude ?? '' })
      setPhotoUrl(v.image_path ? await v360.vehiclePhotoUrl(v.image_path) : null)
      loadHistory(v)
    } catch (e) { setError(toUserMessage(e, 'Could not load the vehicle.')) }
    finally { setLoading(false) }
  }, [assetNo, loadHistory])
  useEffect(() => { load() }, [load])

  async function onPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return
    if (!/^image\//.test(file.type)) { setMsg({ type: 'err', text: 'Please choose an image file.' }); return }
    if (file.size > 8 * 1024 * 1024) { setMsg({ type: 'err', text: 'Image must be under 8 MB.' }); return }
    setUploading(true); setMsg(null)
    try {
      const { url } = await v360.uploadVehiclePhoto(assetNo, file)
      setPhotoUrl(url); setMsg({ type: 'ok', text: 'Photo updated.' })
    } catch (err) { setMsg({ type: 'err', text: toUserMessage(err, 'Upload failed.') }) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function saveGps(e) {
    e.preventDefault(); setSavingGps(true); setMsg(null)
    try {
      const { latitude, longitude } = await v360.saveVehicleGps(assetNo, gps.lat, gps.lng)
      setVehicle((v) => ({ ...v, latitude, longitude }))
      setMsg({ type: 'ok', text: 'Location saved.' })
    } catch (err) { setMsg({ type: 'err', text: toUserMessage(err, 'Could not save location.') }) }
    finally { setSavingGps(false) }
  }

  const m = useMemo(() => {
    const total = tyres.length
    const spend = tyres.reduce((s, t) => s + recordCost(t), 0)
    const critical = tyres.filter(isHigh).length
    const highRate = total ? (critical / total) * 100 : 0
    const health = total ? Math.max(0, Math.min(100, Math.round(100 - highRate * 0.4))) : 0
    // avg life (km) from fitment→removal on closed tyres
    const lives = tyres.map((t) => (t.km_at_removal || 0) - (t.km_at_fitment || 0)).filter((k) => k > 0 && k < 400000)
    const avgLifeKm = lives.length ? Math.round(lives.reduce((a, b) => a + b, 0) / lives.length) : 0
    const cpkVals = tyres.map((t) => {
      const km = (t.km_at_removal || 0) - (t.km_at_fitment || 0)
      return km > 0 ? recordCost(t) / km : null
    }).filter((x) => x != null && Number.isFinite(x))
    const cpk = cpkVals.length ? cpkVals.reduce((a, b) => a + b, 0) / cpkVals.length : 0
    return { total, spend, critical, highRate, health, avgLifeKm, cpk }
  }, [tyres])

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
    () => sortActivity(filterActivity(activity, { type: actType, search: actSearch, from: actFrom, to: actTo }), actSort.key, actSort.dir),
    [activity, actType, actSearch, actFrom, actTo, actSort],
  )
  const actPager = usePagedRows(activityView, { pageSize: 25 })
  const toggleActSort = (key) => setActSort((s0) => ({ key, dir: s0.key === key && s0.dir === 'desc' ? 'asc' : 'desc' }))
  const ACT_COLS = ['date', 'type', 'ref', 'detail', 'status', 'amount', 'currency']
  const ACT_HEAD = ['Date', 'Type', 'Reference', 'Detail', 'Status', 'Amount', 'Currency']
  const activityExportRows = () => activityView.map((r) => ({ ...r, type: ACTIVITY_LABEL[r.type] || r.type, date: r.date || 'N/A', amount: r.amount ?? 'N/A', currency: r.currency || 'N/A' }))
  function exportActivity(kind) {
    const rows = activityExportRows()
    if (!rows.length) return
    const name = `Vehicle 360 ${vehicle?.asset_no || ''}`
    if (kind === 'excel') exportToExcel(rows, ACT_COLS, ACT_HEAD, name)
    else exportToPdf(rows, ACT_COLS.map((k, i) => ({ key: k, header: ACT_HEAD[i] })), `${name} activity`, name, 'landscape')
  }
  const gridTyre = a360.cost.length === 1 ? a360.cost[0] : null

  const targetKm = vehicle?.expected_km_per_tyre || 100000
  const money = (n) => `${activeCurrency} ${Math.round(n).toLocaleString()}`

  if (loading) return <LoadingState message="Loading vehicle..." />
  if (error) return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link to="/fleet-master" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 mb-4"><ArrowLeft size={15} /> Back to Fleet</Link>
      <EmptyState icon={AlertTriangle} title="Vehicle unavailable" description={error} action={{ label: 'Retry', onClick: load }} />
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-4">
      {/* header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/fleet-master" className="p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={16} /></Link>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
              <Car size={20} className="text-[var(--accent)]" />
              {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.asset_no}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">{vehicle.asset_no}{vehicle.vehicle_type ? ` | ${vehicle.vehicle_type}` : ''}{vehicle.site ? ` | ${vehicle.site}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/inspections?asset=${encodeURIComponent(vehicle.asset_no)}`}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <ClipboardCheck size={15} /> Start Tyre Checklist
          </Link>
          {vehicle.status && <StatusBadge status={vehicle.status} size={30} />}
        </div>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>{msg.text}</div>
      )}

      <CopilotCard task="assess_vehicle_tyres" context={{ vehicle, tyres }} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: photo + details + gps */}
        <div className="space-y-4">
          {/* photo */}
          <div className="card !p-0 overflow-hidden">
            <div className="relative aspect-[16/10] bg-[var(--sunken,#f1f4f7)] grid place-items-center">
              {photoUrl
                ? <img src={photoUrl} alt={vehicle.asset_no} className="w-full h-full object-cover" />
                : <div className="text-center text-[var(--text-muted)]"><Car size={40} className="mx-auto mb-2 opacity-50" /><p className="text-xs">No photo yet</p></div>}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="absolute bottom-3 right-3 px-3 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold flex items-center gap-2 shadow disabled:opacity-60">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                {photoUrl ? 'Replace photo' : 'Add photo'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            </div>
          </div>

          {/* details */}
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Vehicle details</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {[
                ['Fleet no', vehicle.fleet_number], ['Make', vehicle.make], ['Model', vehicle.model],
                ['Type', vehicle.vehicle_type], ['Year', vehicle.year], ['Tyre size', vehicle.tyre_size],
                ['Site', vehicle.site], ['Region', vehicle.region], ['Department', vehicle.department],
                ['Operator', vehicle.operator_name],
                ['Monthly budget', vehicle.monthly_tyre_budget ? money(vehicle.monthly_tyre_budget) : null],
              ].filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{k}</dt>
                  <dd className="text-[var(--text-primary)] font-medium truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* GPS editor */}
          <form onSubmit={saveGps} className="card space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPin size={15} className="text-[var(--accent)]" /> Location</h3>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Latitude" value={gps.lat} onChange={(e) => setGps((g) => ({ ...g, lat: e.target.value }))} inputMode="decimal" />
              <input className="input" placeholder="Longitude" value={gps.lng} onChange={(e) => setGps((g) => ({ ...g, lng: e.target.value }))} inputMode="decimal" />
            </div>
            <button type="submit" disabled={savingGps} className="btn-secondary w-full justify-center text-sm disabled:opacity-60">
              {savingGps ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save location
            </button>
            {vehicle.gps_source && vehicle.gps_source !== 'manual' && (
              <p className="text-[11px] text-[var(--text-muted)]">Live source: {vehicle.gps_source}</p>
            )}
          </form>
        </div>

        {/* RIGHT: telematics */}
        <div className="lg:col-span-2 space-y-4">
          {/* stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile index={0} icon={CircleDot} tone="info" label="Tyres" value={m.total.toLocaleString()} />
            <StatTile index={1} icon={DollarSign} tone="accent" label="Tyre spend (expense grid)" value={historyLoading ? '...' : gridTyre ? `${(gridTyre.tyre / 1000).toFixed(1)}K` : a360.cost.length > 1 ? 'Mixed' : 'N/A'} unit={gridTyre ? gridTyre.currency : ''} />
            <StatTile index={2} icon={GaugeIcon} tone="neutral" label="Avg CPK" value={m.cpk ? m.cpk.toFixed(2) : 'N/A'} unit={m.cpk ? `${activeCurrency}/km` : ''} />
            <StatTile index={3} icon={AlertTriangle} tone="crit" label="Critical" value={m.critical.toLocaleString()} unit={m.total ? `(${m.highRate.toFixed(0)}%)` : ''} />
          </div>


          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile index={4} icon={GaugeIcon} tone="neutral" label="Current km" value={historyLoading ? '...' : fmtN(a360.meters.currentKm)} unit={a360.meters.kmDate ? `at ${a360.meters.kmDate}` : ''} />
            <StatTile index={5} icon={Timer} tone="neutral" label="Engine hours" value={historyLoading ? '...' : fmtN(a360.meters.engineHours)} unit={a360.meters.hoursDate ? `at ${a360.meters.hoursDate}` : ''} />
            <StatTile index={6} icon={Wrench} tone="info" label="Open work orders" value={historyLoading ? '...' : fmtN(a360.workOrders.open)} unit={`of ${fmtN(a360.workOrders.total)}`} />
            <StatTile index={7} icon={AlertTriangle} tone="crit" label="Open accidents" value={historyLoading ? '...' : fmtN(a360.accidents.open)} unit={`of ${fmtN(a360.accidents.total)}`} />
            <StatTile index={8} icon={ClipboardCheck} tone="neutral" label="Days since inspection" value={historyLoading ? '...' : fmtN(a360.inspections.daysSince)} unit={a360.inspections.lastDate || 'never recorded'} />
            <StatTile index={9} icon={ShieldCheck} tone="accent" label="Active cover lines" value={historyLoading ? '...' : fmtN(a360.insurance.active)} unit={a360.insurance.nextExpiry ? `ends ${a360.insurance.nextExpiry}` : ''} />
          </div>

          {(unreadable.length > 0 || truncatedSources.length > 0) && (
            <div role="status" className="card text-sm flex items-start gap-2">
              <Info size={15} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                {unreadable.length > 0 && <p>Could not be read: {unreadable.join(', ')}. Those figures show N/A, not zero.</p>}
                {truncatedSources.length > 0 && <p>Read ceiling reached for: {truncatedSources.join(', ')}. Totals cover the rows loaded.</p>}
                <button type="button" className="btn-secondary text-xs mt-2" onClick={() => vehicle && loadHistory(vehicle)}>Retry</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Operating cost (expense grid)</h3>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">From the classified expense grid, per currency. Currencies are never added together.</p>
              {historyLoading ? <p className="text-sm text-[var(--text-muted)]">Loading cost...</p>
                : !a360.cost.length ? <p className="text-sm text-[var(--text-muted)]">No expense lines are recorded against this vehicle.</p>
                : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-[var(--text-muted)]">{['Currency', 'Tyre', 'Spare', 'Oil', 'Total', 'Lines'].map((h) => <th key={h} className="text-left py-1.5 pr-2">{h}</th>)}</tr></thead>
                    <tbody>{a360.cost.map((c) => (
                      <tr key={c.currency} className="border-t border-[var(--table-cell-border)]">
                        <td className="py-1.5 pr-2 font-medium">{c.currency}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{fmtN(c.tyre)}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{fmtN(c.spare)}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{fmtN(c.oil)}</td>
                        <td className="py-1.5 pr-2 tabular-nums font-semibold">{fmtN(c.total)}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{fmtN(c.lines)}</td>
                      </tr>))}
                    </tbody>
                  </table>
                )}
              {costChart && (
                <div className="h-48 mt-3">
                  <Bar data={costChart} options={{ maintainAspectRatio: false, plugins: { legend: { labels: { color: 'var(--text-secondary)' } } }, scales: { x: { stacked: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } }, y: { stacked: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' }, title: { display: true, text: a360.chartCurrency, color: 'var(--text-muted)' } } } }} />
                </div>
              )}
              {a360.cost.length > 1 && <p className="text-[11px] text-[var(--text-muted)] mt-2">More than one currency on this vehicle, so the monthly chart is withheld.</p>}
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><ShieldCheck size={15} className="text-[var(--accent)]" /> Insurance</h3>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">Schedule lines naming this asset. Many schedules do not state an asset id, so no line here does not prove the vehicle is uninsured.</p>
              {historyLoading ? <p className="text-sm text-[var(--text-muted)]">Loading insurance...</p>
                : insurance.error ? <p className="text-sm text-[var(--text-muted)]">{insurance.error}</p>
                : !insurance.rows.length ? <p className="text-sm text-[var(--text-muted)]">No schedule line names this asset.</p>
                : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                      <div><p className="text-[var(--text-muted)]">Active</p><p className="text-lg font-semibold">{a360.insurance.active}</p></div>
                      <div><p className="text-[var(--text-muted)]">Expired</p><p className="text-lg font-semibold">{a360.insurance.expired}</p></div>
                      <div><p className="text-[var(--text-muted)]">Days to next expiry</p><p className="text-lg font-semibold">{fmtN(a360.insurance.daysToExpiry)}</p></div>
                    </div>
                    {a360.insurance.sumInsured.map((si) => <p key={si.currency} className="text-xs text-[var(--text-secondary)]">Sum insured (active): {fmtMoney(si.currency, si.amount)}</p>)}
                    <div className="overflow-x-auto max-h-48 overflow-y-auto mt-2">
                      <table className="w-full text-xs">
                        <thead><tr className="text-[var(--text-muted)]">{['Policy', 'Cover', 'From', 'To', 'Sum insured'].map((h) => <th key={h} className="text-left py-1 pr-2">{h}</th>)}</tr></thead>
                        <tbody>{insurance.rows.map((r) => (
                          <tr key={r.id} className="border-t border-[var(--table-cell-border)]">
                            <td className="py-1 pr-2">{r.policy_no || 'N/A'}</td><td className="py-1 pr-2">{r.cover_type || 'N/A'}</td>
                            <td className="py-1 pr-2">{r.cover_from?.slice(0, 10) || 'N/A'}</td><td className="py-1 pr-2">{r.cover_to?.slice(0, 10) || 'N/A'}</td>
                            <td className="py-1 pr-2 tabular-nums">{r.sum_insured == null ? 'N/A' : fmtMoney(r.currency || '', Number(r.sum_insured))}</td>
                          </tr>))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
            </div>
          </div>

          {/* gauges + map */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Health &amp; wear</h3>
              <div className="grid grid-cols-3 gap-1 pt-2 justify-items-center">
                <Gauge index={0} value={m.health} max={100} label="Health" size={116} />
                <Gauge index={1} value={m.highRate} max={100} unit="%" label="Critical rate" reverse format={(x) => x.toFixed(0)} size={116} />
                <Gauge index={2} value={Math.min(100, (m.avgLifeKm / targetKm) * 100)} max={100} unit="%" label="Life vs target" format={(x) => Math.round(x)} size={116} />
              </div>
            </div>
            <div className="card !p-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--card-border,rgba(0,0,0,0.06))]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPin size={15} className="text-[var(--accent)]" /> Location</h3>
                <span className="text-[11px] text-[var(--text-muted)]">{vehicle.location_updated_at ? new Date(vehicle.location_updated_at).toLocaleString() : 'no fix'}</span>
              </div>
              <VehicleMap lat={Number(vehicle.latitude)} lng={Number(vehicle.longitude)} label={vehicle.asset_no} height={244} />
            </div>
          </div>

          {/* tyres table */}
          <div className="card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border,rgba(0,0,0,0.06))]"><h3 className="text-sm font-semibold text-[var(--text-primary)]">Fitted &amp; historical tyres</h3></div>
            {m.total === 0 ? (
              <div className="px-4 py-8"><EmptyState illustration="module/tyres" icon={CircleDot} title="No tyre records" description="No tyres are recorded against this vehicle yet." /></div>
            ) : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--table-head-bg)] text-[var(--table-head-text)] sticky top-0">
                    <tr>
                      {['Date', 'Serial', 'Brand', 'Position', 'Size', 'KM run', 'Cost', 'Risk'].map((h) => (
                        <th key={h} className={`text-left px-3 py-2 font-semibold ${['KM run', 'Cost'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tyres.map((t) => {
                      const km = (t.km_at_removal || 0) - (t.km_at_fitment || 0)
                      const risk = t.risk_level || 'N/A'
                      const tone = isHigh(t) ? 'text-red-400 bg-red-900/30' : risk === 'Medium' ? 'text-amber-400 bg-amber-900/30' : 'text-green-400 bg-green-900/30'
                      return (
                        <tr key={t.id} className="border-t border-[var(--table-cell-border)]">
                          <td className="px-3 py-2 text-[var(--text-muted)]">{t.issue_date?.slice(0, 10) || 'N/A'}</td>
                          <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{t.serial_no || 'N/A'}</td>
                          <td className="px-3 py-2">{t.brand || 'N/A'}</td>
                          <td className="px-3 py-2">{t.position || 'N/A'}</td>
                          <td className="px-3 py-2">{t.size || 'N/A'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{km > 0 ? km.toLocaleString() : 'N/A'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--text-primary)]">{money(recordCost(t))}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${tone}`}>{risk}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* unified activity */}
          <div className="card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border,rgba(0,0,0,0.06))] flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mr-auto">Vehicle activity</h3>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input aria-label="Search activity" className="input pl-8 text-xs w-48" placeholder="Search reference, detail..." value={actSearch} onChange={(e) => setActSearch(e.target.value)} />
              </div>
              <select aria-label="Activity type" className="input text-xs w-auto" value={actType} onChange={(e) => setActType(e.target.value)}>
                <option value="all">All types</option>
                {ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <input aria-label="From date" type="date" className="input text-xs w-auto" value={actFrom} max={actTo || undefined} onChange={(e) => setActFrom(e.target.value)} />
              <input aria-label="To date" type="date" className="input text-xs w-auto" value={actTo} min={actFrom || undefined} onChange={(e) => setActTo(e.target.value)} />
              <button type="button" className="btn-secondary text-xs" disabled={!activityView.length} onClick={() => exportActivity('excel')}><FileSpreadsheet size={13} /> Excel</button>
              <button type="button" className="btn-secondary text-xs" disabled={!activityView.length} onClick={() => exportActivity('pdf')}><FileText size={13} /> PDF</button>
            </div>
            {historyLoading ? <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Loading activity...</p>
              : !activityView.length ? <p className="px-4 py-8 text-sm text-center text-[var(--text-muted)]">{activity.length ? 'No activity matches these filters.' : 'No activity is recorded for this vehicle.'}</p>
              : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[var(--table-head-bg)] text-[var(--table-head-text)]">
                        <tr>{ACT_COLS.map((k, i) => (
                          <th key={k} className="text-left px-3 py-2 font-semibold">
                            <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleActSort(k)}>{ACT_HEAD[i]} <ArrowUpDown size={11} className="opacity-50" /></button>
                          </th>))}
                        </tr>
                      </thead>
                      <tbody>{actPager.pageRows.map((r) => (
                        <tr key={r.key} className="border-t border-[var(--table-cell-border)]">
                          <td className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap">{r.date || 'N/A'}</td>
                          <td className="px-3 py-2">{ACTIVITY_LABEL[r.type] || r.type}</td>
                          <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{r.ref || 'N/A'}</td>
                          <td className="px-3 py-2 max-w-[320px] truncate">{r.detail || 'N/A'}</td>
                          <td className="px-3 py-2">{r.status || 'N/A'}</td>
                          <td className="px-3 py-2 tabular-nums">{r.amount == null ? 'N/A' : Math.round(r.amount).toLocaleString()}</td>
                          <td className="px-3 py-2">{r.currency || 'N/A'}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                  <TablePagination {...actPager} />
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
