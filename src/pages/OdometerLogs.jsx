import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Search } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { TablePagination, usePagedRows } from '../components/ui/TablePagination'
import MeterRow from '../components/meters/MeterRow'
import MeterHistory from '../components/meters/MeterHistory'
import { useSettings } from '../contexts/SettingsContext'
import { loadVehicleMeters, saveVehicleMeters } from '../lib/api/vehicleMeters'
import { buildVehicleMeters, meterKey, meterSource, meterToday, validateMeterDraft, receivedDate, newMeterDraft } from '../lib/vehicleMeters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import '../components/meters/meters.css'

const MeterAnalytics = lazy(() => import('../components/meters/MeterAnalytics'))
const EMPTY = { fleet: [], odometer: [], hours: [] }
const EMPTY_FILTERS = { search: '', region: '', site: '', source: '', from: '', to: '', flagged: false, assetId: '', vehicleType: '', meterType: '', readingKind: '' }
const matchesMeterType = (row, type) => !type || ({ km: row.supportsKm, hours: row.supportsHours, both: row.supportsKm && row.supportsHours, km_only: row.supportsKm && !row.supportsHours, hours_only: row.supportsHours && !row.supportsKm, unknown: !row.supportsKm && !row.supportsHours })[type]
const distinct = values => [...new Set(values.filter(Boolean))].sort()

export default function OdometerLogs() {
  const { activeCountry } = useSettings()
  return <MeterWorkspace key={activeCountry} country={activeCountry} />
}
function MeterWorkspace({ country }) {
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [tab, setTab] = useState('vehicles')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [drafts, setDrafts] = useState({})
  const [statuses, setStatuses] = useState({})
  const [notice, setNotice] = useState('')
  const [sort, setSort] = useState({ key: 'asset_no', asc: true })
  const generation = useRef(0)
  const savingIds = useRef(new Set())
  const changeFilter = (key, value) => setFilters(old => ({ ...old, [key]: value, ...(key === 'region' ? { site: '', assetId: '' } : key === 'search' ? { assetId: '' } : {}) }))
  const load = useCallback(async () => {
    if (savingIds.current.size) return
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const result = await loadVehicleMeters(country)
      if (generation.current === request) { setData(result); setLoadedAt(new Date()) }
    } catch (err) { if (generation.current === request) setError(toUserMessage(err, 'Could not load meter readings.')) }
    finally { if (generation.current === request) setLoading(false) }
  }, [country])
  useEffect(() => {
    const requests = generation
    load()
    return () => { requests.current++ }
  }, [load])
  const hasDrafts = Object.values(drafts).some(d => d.km !== '' || d.hours !== '')
  useEffect(() => {
    if (!hasDrafts) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDrafts])
  const vehicles = useMemo(() => buildVehicleMeters(data.fleet, data.odometer, data.hours), [data])
  const fleetByKey = useMemo(() => new Map(vehicles.filter(v => !v.duplicate).map(v => [meterKey(v), v])), [vehicles])
  const history = useMemo(() => [
    ...data.odometer.map(r => ({ ...r, kind: 'km', value: r.odometer_km })),
    ...data.hours.map(r => ({ ...r, kind: 'hours', value: r.engine_hours })),
  ].map(r => {
    const v = fleetByKey.get(meterKey(r))
    return { ...r, region: v?.region, registration_no: v?.registration_no || v?.fleet_number, vehicleId: v?.id, vehicle_type: v?.vehicle_type, supportsKm: v?.supportsKm, supportsHours: v?.supportsHours }
  }).sort((a, b) => String(b.reading_date || '').localeCompare(a.reading_date || '') || String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id))), [data, fleetByKey])
  const matchesReading = useCallback(r => (!filters.source || meterSource(r.source) === filters.source) && (!filters.from || (r.reading_date && r.reading_date >= filters.from)) && (!filters.to || (r.reading_date && r.reading_date <= filters.to)) && (!filters.flagged || r.flagged), [filters])
  const matchesAsset = useCallback(r => {
    const text = `${r.asset_no || ''} ${r.registration_no || ''} ${r.fleet_number || ''} ${r.vehicle_type || ''} ${r.region || ''} ${r.site || ''} ${r.source || ''} ${r.notes || ''}`.toLowerCase()
    return (!filters.vehicleType || (r.vehicle_type || '__unknown') === filters.vehicleType) && matchesMeterType(r, filters.meterType) && (!filters.region || r.region === filters.region) && (!filters.site || r.site === filters.site) && (!filters.assetId || (r.vehicleId || r.id) === filters.assetId) && filters.search.trim().toLowerCase().split(/\s+/).every(word => text.includes(word))
  }, [filters])
  const filteredHistory = useMemo(() => history.filter(r => matchesAsset(r) && matchesReading(r) && (!filters.readingKind || r.kind === filters.readingKind)), [history, matchesAsset, matchesReading, filters.readingKind])
  const filteredVehicles = useMemo(() => vehicles.filter(v => matchesAsset(v) &&
    (!(filters.source || filters.from || filters.to || filters.flagged || filters.readingKind) || (filters.readingKind === 'km' ? [v.kmLog] : filters.readingKind === 'hours' ? [v.hoursLog] : [v.kmLog, v.hoursLog]).filter(Boolean).some(matchesReading)))
    .sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      const diff = ['km', 'engineHours'].includes(sort.key) ? (x ?? -1) - (y ?? -1) : String(x || '').localeCompare(String(y || ''), undefined, { numeric: true })
      return sort.asc ? diff : -diff
    }), [vehicles, matchesAsset, filters, matchesReading, sort])
  const pager = usePagedRows(filteredVehicles, { pageSize: 25 })
  const { setPage } = pager
  useEffect(() => { setPage(0) }, [filters, setPage])
  const regions = useMemo(() => distinct(vehicles.map(v => v.region)), [vehicles])
  const vehicleTypes = useMemo(() => distinct(vehicles.map(v => v.vehicle_type)), [vehicles])
  const sites = useMemo(() => distinct(vehicles.filter(v => !filters.region || v.region === filters.region).map(v => v.site)), [vehicles, filters.region])
  const sources = useMemo(() => distinct(history.map(r => meterSource(r.source))), [history])
  const analyticsRows = useMemo(() => filteredHistory.filter(r => r.kind === 'km'), [filteredHistory])
  function changeDraft(vehicle, field, value) {
    if (savingIds.current.has(vehicle.id)) return
    setDrafts(old => {
      const draft = { ...(old[vehicle.id] || newMeterDraft(vehicle)), [field]: value }
      if (field !== 'confirmed') { draft.requestId = crypto.randomUUID(); draft.confirmed = false }
      if (field === 'mode') { if (!['km', 'both'].includes(value)) draft.km = ''; if (!['hours', 'both'].includes(value)) draft.hours = '' }
      return { ...old, [vehicle.id]: draft }
    })
    setStatuses(old => ({ ...old, [vehicle.id]: null }))
  }
  function applySaved(result) {
    setData(old => ({
      fleet: result.vehicle ? old.fleet.map(v => v.id === result.vehicle.id ? { ...v, ...result.vehicle } : v) : old.fleet,
      odometer: result.odometer?.id ? [...old.odometer.filter(r => r.id !== result.odometer.id), result.odometer] : old.odometer,
      hours: result.hours?.id ? [...old.hours.filter(r => r.id !== result.hours.id), result.hours] : old.hours,
    }))
  }
  async function save(vehicle) {
    if (savingIds.current.has(vehicle.id)) return
    const draft = drafts[vehicle.id]
    if (!draft) return
    const invalid = validateMeterDraft(draft, vehicle)
    if (invalid) { setStatuses(old => ({ ...old, [vehicle.id]: { error: true, message: invalid } })); return }
    savingIds.current.add(vehicle.id)
    generation.current++; setLoading(false)
    setStatuses(old => ({ ...old, [vehicle.id]: { saving: true } }))
    try {
      const result = await saveVehicleMeters(vehicle, draft)
      applySaved(result)
      setDrafts(old => { const next = { ...old }; delete next[vehicle.id]; return next })
      const submitted = [result.odometer?.id ? `${Number(result.odometer.odometer_km).toLocaleString()} km` : '', result.hours?.id ? `${Number(result.hours.engine_hours).toLocaleString()} hours` : ''].filter(Boolean).join(' + ')
      const flags = result.odometer?.flagged || result.hours?.flagged
      const unchanged = result.odometer?.id && Number(result.vehicle?.current_km) !== Number(result.odometer.odometer_km)
      setStatuses(old => ({ ...old, [vehicle.id]: { message: `Saved ${submitted}. ${flags ? 'Flagged for review. ' : ''}${unchanged ? 'Fleet kilometres remain at the higher value.' : ''}` } }))
    } catch (err) { setStatuses(old => ({ ...old, [vehicle.id]: { error: true, message: toUserMessage(err, 'Could not save. Your entries are retained; retry when connected.') } })) }
    finally { savingIds.current.delete(vehicle.id) }
  }
  function showHistory(vehicle) { setFilters(old => ({ ...old, assetId: vehicle.id, site: '', source: '', from: '', to: '', flagged: false, readingKind: '' })); setTab('history') }
  function corrected(row, kind) {
    applySaved(kind === 'km' ? { odometer: row } : { hours: row })
    setNotice('Correction saved with its reason and audit history. Refresh to check the fleet’s current meter.')
  }
  function preset(days) {
    const today = meterToday(country), start = new Date(`${today}T12:00:00Z`)
    if (days === 'month') start.setUTCDate(1); else start.setUTCDate(start.getUTCDate() - days + 1)
    setFilters(old => ({ ...old, from: start.toISOString().slice(0, 10), to: today }))
  }
  function exportRows(format) {
    const rows = tab === 'vehicles' ? filteredVehicles.map(v => {
      const kmLog = v.kmLog && Number(v.kmLog.odometer_km) === v.km ? v.kmLog : null
      const hoursLog = v.hoursLog && Number(v.hoursLog.engine_hours) === v.engineHours ? v.hoursLog : null
      return { asset: v.asset_no, registration: v.registration_no || v.fleet_number, country: v.country, region: v.region, site: v.site, km: v.km, hours: v.engineHours, km_date: kmLog?.reading_date, hours_date: hoursLog?.reading_date, km_source: meterSource(kmLog?.source), hours_source: meterSource(hoursLog?.source) }
    })
      : filteredHistory.filter(r => tab !== 'analytics' || r.kind === 'km').map(r => ({ asset: r.asset_no, country: r.country, region: r.region, site: r.site, reading: r.value, unit: r.kind, reading_date: r.reading_date, received_at: receivedDate(r.created_at, r.country), edited_at: receivedDate(r.updated_at, r.country), source: meterSource(r.source) }))
    if (!rows.length) return
    const cols = Object.keys(rows[0]), headers = cols.map(c => c.replaceAll('_', ' '))
    if (format === 'excel') exportToExcel(rows, cols, headers, 'vehicle_meters')
    else exportToPdf(rows, cols.map((key, i) => ({ key, header: headers[i] })), 'Vehicle meter readings', 'vehicle_meters', 'landscape')
  }
  return <div className="space-y-4">
    <PageHeader title="Vehicle Meter Logs" subtitle="Enter kilometres and engine hours in the same row. Each save adds dated readings and preserves history."
      icon={Gauge} onRefresh={load} refreshing={loading} updatedAt={loadedAt}
      actions={<div className="flex gap-2"><button className="btn-secondary" disabled={loading} onClick={() => exportRows('excel')}>Excel</button><button className="btn-secondary" disabled={loading} onClick={() => exportRows('pdf')}>PDF</button></div>} />
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="relative flex-1 min-w-[240px]"><span className="sr-only">Search vehicles and readings</span><Search size={17} className="absolute start-3 top-3 text-[var(--text-muted)]" /><input className="input w-full ps-10" placeholder="Search asset, plate, region, site…" value={filters.search} onChange={e => changeFilter('search', e.target.value)} /></label>
        {[['region', 'Region', regions], ['site', 'Site', sites], ['source', 'Source', sources]].map(([key, label, items]) => <label key={key}><span className="sr-only">{label}</span><select className="input" value={filters[key]} onChange={e => changeFilter(key, e.target.value)}><option value="">All {label.toLowerCase()}s</option>{items.map(item => <option key={item}>{item}</option>)}</select></label>)}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label>Vehicle type<select className="input block" value={filters.vehicleType} onChange={e => changeFilter('vehicleType', e.target.value)}><option value="">All vehicle types</option>{vehicleTypes.map(type => <option key={type}>{type}</option>)}<option value="__unknown">Type not recorded</option></select></label>
        <label>Applicable meters<select className="input block" value={filters.meterType} onChange={e => changeFilter('meterType', e.target.value)}><option value="">All meter types</option><option value="hours">Hour-based (including both)</option><option value="km">Kilometre-based (including both)</option><option value="both">Kilometres + hours</option><option value="hours_only">Hours only</option><option value="km_only">Kilometres only</option><option value="unknown">Meters not established</option></select></label>
        <label>Reading unit<select className="input block" value={filters.readingKind} onChange={e => changeFilter('readingKind', e.target.value)}><option value="">All readings</option><option value="km">Kilometre readings</option><option value="hours">Hour readings</option></select></label>
      </div>
      <div className="flex flex-wrap gap-2 items-end text-sm">
        <label>Reading date from<input className="input block" type="date" value={filters.from} max={filters.to || undefined} onChange={e => changeFilter('from', e.target.value)} /></label>
        <label>To<input className="input block" type="date" value={filters.to} min={filters.from || undefined} onChange={e => changeFilter('to', e.target.value)} /></label>
        <button className="btn-secondary" onClick={() => preset(1)}>Today</button><button className="btn-secondary" onClick={() => preset(7)}>Last 7 days</button><button className="btn-secondary" onClick={() => preset('month')}>This month</button>
        <label className="flex gap-2 items-center px-2 py-2"><input type="checkbox" checked={filters.flagged} onChange={e => changeFilter('flagged', e.target.checked)} /> Flagged only</label>
        <button className="btn-secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">Region is the vehicle’s current fleet region. History retains the recorded site. Received times use each record’s country timezone; measurement dates do not imply a recorded time.</p>
      {filters.assetId && <p className="text-sm">History for <strong>{vehicles.find(v => v.id === filters.assetId)?.asset_no}</strong> <button className="underline ms-2" onClick={() => changeFilter('assetId', '')}>Show all vehicles</button></p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-lg bg-[var(--input-bg)] p-1" role="group" aria-label="Meter views">{[['vehicles', 'Latest per vehicle'], ['history', 'All readings'], ['analytics', 'Analytics']].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-secondary'}>{label}</button>)}</div><span className="text-sm text-[var(--text-muted)]">{filteredVehicles.length} vehicles · {filteredHistory.length} readings</span></div>
    {hasDrafts && <p className="text-xs text-[var(--text-muted)]">Unsaved entries stay while searching or changing views. Save them before leaving this page or switching country.</p>}
    {notice && <p role="status" className="card text-sm">{notice}</p>}
    {error && <div role="alert" className="card text-red-600 dark:text-red-300">{error} <button className="btn-secondary ms-2" onClick={load}>Retry</button></div>}
    {loading && <p role="status" className="card">Loading vehicle meters…</p>}
    {!loading && !error && tab === 'vehicles' && <div className="card !p-0 overflow-hidden"><div className="overflow-x-auto"><table className="meter-entry-table w-full text-sm">
      <thead><tr className="border-b border-[var(--input-border)] text-[var(--text-muted)]">{[['asset_no', 'Vehicle'], ['region', 'Region / site'], ['km', 'Kilometres'], ['engineHours', 'Engine hours']].map(([key, label]) => <th scope="col" className="px-4 py-3 text-start" key={key} aria-sort={sort.key === key ? sort.asc ? 'ascending' : 'descending' : 'none'}><button onClick={() => setSort(old => ({ key, asc: old.key === key ? !old.asc : true }))}>{label} {sort.key === key ? sort.asc ? '↑' : '↓' : '↕'}</button></th>)}<th scope="col" className="px-4 py-3 text-start">New reading date / note</th><th scope="col" className="px-4 py-3 text-start">Save reading</th></tr></thead>
      <tbody>{pager.pageRows.map(vehicle => <MeterRow key={vehicle.id} vehicle={vehicle} draft={drafts[vehicle.id]} status={statuses[vehicle.id]} onChange={changeDraft} onSave={save} onHistory={showHistory} />)}{!filteredVehicles.length && <tr><td colSpan={6} className="p-10 text-center text-[var(--text-muted)]">No vehicles match these filters.</td></tr>}</tbody>
    </table></div><TablePagination {...pager} /></div>}
    {!loading && !error && tab === 'history' && <MeterHistory rows={filteredHistory} onSaved={corrected} resetKey={filters} />}
    {!loading && !error && tab === 'analytics' && <Suspense fallback={<p role="status">Loading analytics…</p>}><MeterAnalytics rows={analyticsRows} /></Suspense>}
  </div>
}
