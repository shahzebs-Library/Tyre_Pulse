import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Camera, Upload, Loader2, MapPin, Save, CircleDot, DollarSign, AlertTriangle, Gauge as GaugeIcon, Car } from 'lucide-react'
import { useSettings } from '../contexts/SettingsContext'
import * as v360 from '../lib/api/vehicle360'
import { recordCost } from '../lib/analyticsEngine'
import Gauge from '../components/ui/Gauge'
import StatTile from '../components/ui/StatTile'
import VehicleMap from '../components/ui/VehicleMap'
import LoadingState from '../components/LoadingState'
import EmptyState from '../components/EmptyState'

const isHigh = (r) => r.risk_level === 'High' || r.risk_level === 'Critical'

export default function Vehicle360() {
  const { assetNo } = useParams()
  const { activeCurrency } = useSettings()
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

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [v, t] = await Promise.all([v360.getVehicle(assetNo), v360.getVehicleTyres(assetNo)])
      if (!v) throw new Error(`Vehicle "${assetNo}" not found.`)
      setVehicle(v); setTyres(t || [])
      setGps({ lat: v.latitude ?? '', lng: v.longitude ?? '' })
      setPhotoUrl(v.image_path ? await v360.vehiclePhotoUrl(v.image_path) : null)
    } catch (e) { setError(e?.message || 'Could not load the vehicle.') }
    finally { setLoading(false) }
  }, [assetNo])
  useEffect(() => { load() }, [load])

  async function onPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return
    if (!/^image\//.test(file.type)) { setMsg({ type: 'err', text: 'Please choose an image file.' }); return }
    if (file.size > 8 * 1024 * 1024) { setMsg({ type: 'err', text: 'Image must be under 8 MB.' }); return }
    setUploading(true); setMsg(null)
    try {
      const { url } = await v360.uploadVehiclePhoto(assetNo, file)
      setPhotoUrl(url); setMsg({ type: 'ok', text: 'Photo updated.' })
    } catch (err) { setMsg({ type: 'err', text: err?.message || 'Upload failed.' }) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function saveGps(e) {
    e.preventDefault(); setSavingGps(true); setMsg(null)
    try {
      const { latitude, longitude } = await v360.saveVehicleGps(assetNo, gps.lat, gps.lng)
      setVehicle((v) => ({ ...v, latitude, longitude }))
      setMsg({ type: 'ok', text: 'Location saved.' })
    } catch (err) { setMsg({ type: 'err', text: err?.message || 'Could not save location.' }) }
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

  const targetKm = vehicle?.expected_km_per_tyre || 100000
  const money = (n) => `${activeCurrency} ${Math.round(n).toLocaleString()}`

  if (loading) return <LoadingState message="Loading vehicle…" />
  if (error) return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link to="/fleet-master" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 mb-4"><ArrowLeft size={15} /> Back to Fleet</Link>
      <EmptyState icon={AlertTriangle} title="Vehicle unavailable" message={error} />
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
            <p className="text-sm text-[var(--text-muted)]">{vehicle.asset_no}{vehicle.vehicle_type ? ` · ${vehicle.vehicle_type}` : ''}{vehicle.site ? ` · ${vehicle.site}` : ''}</p>
          </div>
        </div>
        {vehicle.status && <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--accent-wash,rgba(34,197,94,.12))] text-[var(--accent)]">{vehicle.status}</span>}
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>{msg.text}</div>
      )}

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
            <StatTile index={1} icon={DollarSign} tone="accent" label="Tyre spend" value={`${(m.spend / 1000).toFixed(1)}K`} unit={activeCurrency} />
            <StatTile index={2} icon={GaugeIcon} tone="neutral" label="Avg CPK" value={m.cpk ? m.cpk.toFixed(2) : '—'} unit={m.cpk ? `${activeCurrency}/km` : ''} />
            <StatTile index={3} icon={AlertTriangle} tone="crit" label="Critical" value={m.critical.toLocaleString()} unit={m.total ? `(${m.highRate.toFixed(0)}%)` : ''} />
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
              <div className="px-4 py-8"><EmptyState icon={CircleDot} title="No tyre records" message="No tyres are recorded against this vehicle yet." /></div>
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
                      const risk = t.risk_level || '—'
                      const tone = isHigh(t) ? 'text-red-400 bg-red-900/30' : risk === 'Medium' ? 'text-amber-400 bg-amber-900/30' : 'text-green-400 bg-green-900/30'
                      return (
                        <tr key={t.id} className="border-t border-[var(--table-cell-border)]">
                          <td className="px-3 py-2 text-[var(--text-muted)]">{t.issue_date?.slice(0, 10) || '—'}</td>
                          <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{t.serial_no || '—'}</td>
                          <td className="px-3 py-2">{t.brand || '—'}</td>
                          <td className="px-3 py-2">{t.position || '—'}</td>
                          <td className="px-3 py-2">{t.size || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{km > 0 ? km.toLocaleString() : '—'}</td>
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
        </div>
      </div>
    </div>
  )
}
