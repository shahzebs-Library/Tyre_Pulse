import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Search, SlidersHorizontal, ChevronDown, Truck, Clock, AlertTriangle, CalendarX2, ListChecks, RefreshCw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import MeterHistory from '../components/meters/MeterHistory'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { loadVehicleMeters, saveVehicleMeters } from '../lib/api/vehicleMeters'
import { buildVehicleMeters, meterKey, meterSource, meterToday, validateMeterDraft, receivedDate, newMeterDraft, readingDate } from '../lib/vehicleMeters'
import {
  distinct, filterVehicles, filterHistory, meterKpis, presetRange, vehicleExportRows, STALE_DAYS,
} from '../lib/odometerLogsAnalytics'
import { compareValues, sortRows } from '../lib/consoleTable'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'

const MeterAnalytics = lazy(() => import('../components/meters/MeterAnalytics'))
const MeterCoverage = lazy(() => import('../components/meters/MeterCoverage'))
const EMPTY = { fleet: [], odometer: [], hours: [] }
const EMPTY_FILTERS = { search: '', region: '', site: '', source: '', from: '', to: '', flagged: false, assetId: '', vehicleType: '', meterType: '', readingKind: '' }
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const meterNumber = value => value == null ? 'No reading' : Number(value).toLocaleString()
const meterMode = row => row.supportsKm && row.supportsHours ? 'both' : row.supportsKm ? 'km' : row.supportsHours ? 'hours' : ''

export default function OdometerLogs() {
  const { activeCountry } = useSettings()
  const { profile, capabilities, modulePerms, grantOverrides } = useAuth()
  const scope = JSON.stringify([activeCountry, profile, capabilities, modulePerms, grantOverrides])
  return <MeterWorkspace key={scope} country={activeCountry} />
}
function MeterWorkspace({ country }) {
  const [data, setData] = useState(EMPTY)
  const canSave = data.permissions?.canSave === true
  const canCorrect = data.permissions?.canCorrect === true
  const canReview = data.permissions?.canReview === true
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [tab, setTab] = useState('vehicles')
  const [filters, setFilters] = useState(() => {
    try { return { ...EMPTY_FILTERS, ...JSON.parse(sessionStorage.getItem(`meter-filters:${country}`) || '{}') } } catch { return EMPTY_FILTERS }
  })
  const [showFilters, setShowFilters] = useState(false)
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== 'search' && key !== 'assetId' && Boolean(value)).length
  useEffect(() => {
    try { sessionStorage.setItem(`meter-filters:${country}`, JSON.stringify(filters)) } catch { /* Storage is optional. */ }
  }, [filters, country])
  const [drafts, setDrafts] = useState({})
  const [statuses, setStatuses] = useState({})
  const [notice, setNotice] = useState('')
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
  const filteredHistory = useMemo(() => filterHistory(history, filters), [history, filters])
  // Default order is by asset number; the table header then re-sorts the whole set.
  const filteredVehicles = useMemo(() => sortRows(filterVehicles(vehicles, filters), { key: 'asset_no', dir: 'asc' }), [vehicles, filters])
  const today = meterToday(country)
  const kpis = useMemo(() => meterKpis(filteredVehicles, filteredHistory, today), [filteredVehicles, filteredHistory, today])
  const regions = useMemo(() => distinct(vehicles.map(v => v.region)), [vehicles])
  const vehicleTypes = useMemo(() => distinct(vehicles.map(v => v.vehicle_type)), [vehicles])
  const sites = useMemo(() => distinct(vehicles.filter(v => !filters.region || v.region === filters.region).map(v => v.site)), [vehicles, filters.region])
  const sources = useMemo(() => distinct(history.map(r => meterSource(r.source))), [history])
  const analyticsRows = useMemo(() => filteredHistory.filter(r => r.kind === 'km'), [filteredHistory])
  function changeDraft(vehicle, field, value) {
    if (!canSave || savingIds.current.has(vehicle.id)) return
    setDrafts(old => {
      const draft = { ...(old[vehicle.id] || newMeterDraft(vehicle)), [field]: value }
      draft.requestId = crypto.randomUUID()
      return { ...old, [vehicle.id]: draft }
    })
    setStatuses(old => ({ ...old, [vehicle.id]: null }))
  }
  function applySaved(result) {
    setData(old => ({
      ...old,
      fleet: result.vehicle ? old.fleet.map(v => v.id === result.vehicle.id ? { ...v, ...result.vehicle } : v) : old.fleet,
      odometer: result.odometer?.id ? [...old.odometer.filter(r => r.id !== result.odometer.id), result.odometer] : old.odometer,
      hours: result.hours?.id ? [...old.hours.filter(r => r.id !== result.hours.id), result.hours] : old.hours,
    }))
  }
  async function save(vehicle) {
    if (!canSave || savingIds.current.has(vehicle.id)) return
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
      setStatuses(old => ({ ...old, [vehicle.id]: { message: `Saved ${submitted}. ${flags ? 'Flagged for Admin review. ' : ''}${unchanged ? 'Fleet kilometres remain at the higher value.' : ''}` } }))
    } catch (err) { setStatuses(old => ({ ...old, [vehicle.id]: { error: true, message: toUserMessage(err, 'Could not save. Your entries are retained; retry when connected.') } })) }
    finally { savingIds.current.delete(vehicle.id) }
  }
  function showHistory(vehicle) { setFilters(old => ({ ...old, assetId: vehicle.id, site: '', source: '', from: '', to: '', flagged: false, readingKind: '' })); setTab('history') }
  function corrected(row, kind) {
    applySaved(kind === 'km' ? { odometer: row } : { hours: row })
    setNotice('Correction saved with its reason and audit history. Refresh to check the fleet\'s current meter.')
  }
  function preset(days) {
    const range = presetRange(meterToday(country), days)
    setFilters(old => ({ ...old, ...range }))
  }
  function exportRows(format) {
    const rows = tab === 'vehicles' ? vehicleExportRows(filteredVehicles)
      : filteredHistory.filter(r => tab !== 'analytics' || r.kind === 'km').map(r => ({ asset: r.asset_no, country: r.country, region: r.region, site: r.site, reading: r.value, unit: r.kind, reading_date: r.reading_date, received_at: receivedDate(r.created_at, r.country), edited_at: receivedDate(r.updated_at, r.country), source: meterSource(r.source) }))
    if (!rows.length) return
    const cols = Object.keys(rows[0]), headers = cols.map(c => c.replaceAll('_', ' '))
    const file = reportFileName('Vehicle Meter Logs', reportDateLabel())
    if (format === 'excel') exportToExcel(rows, cols, headers, file, 'Vehicle meters')
    else exportToPdf(rows, cols.map((key, i) => ({ key, header: headers[i] })), 'Vehicle meter readings', file, 'landscape')
  }
  const columns = useMemo(() => {
    const meterCell = (row, kind) => {
      const label = kind === 'km' ? 'km' : 'hours'
      const current = kind === 'km' ? row.km : row.engineHours
      const last = kind === 'km' ? row.kmLog : row.hoursLog
      const mode = meterMode(row)
      const enabled = mode === kind || mode === 'both'
      const draft = drafts[row.id] || { km: '', hours: '', date: meterToday(row.country), notes: '' }
      const saving = statuses[row.id]?.saving
      const matchesCurrent = last && Number(last[kind === 'km' ? 'odometer_km' : 'engine_hours']) === current
      return <div className="min-w-[170px]">
        <div className="font-semibold tabular-nums text-[var(--text-primary)]">{meterNumber(current)} {current == null ? '' : label}</div>
        <div className="text-xs text-[var(--text-muted)] mt-1">{matchesCurrent ? readingDate(last.reading_date) : 'Measurement date not recorded'}</div>
        {matchesCurrent && <div className="text-xs text-[var(--text-muted)]" title={`Received ${receivedDate(last.created_at, row.country)}`}>{meterSource(last.source)}</div>}
        {enabled ? <input className="input w-full mt-2 min-h-[44px]" aria-label={`${row.asset_no} new ${label}`} type="number" min="0" step={kind === 'km' ? '1' : '0.1'} inputMode="decimal"
          placeholder={`New ${label}`} value={draft[kind]} disabled={saving || !canSave} onChange={e => changeDraft(row, kind, e.target.value)} />
          : <div className="text-xs text-[var(--text-muted)] mt-3">Not applicable</div>}
        {enabled && draft[kind] !== '' && current != null && Number(draft[kind]) < current && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Below the last reading. This will be saved for Admin review.</p>}
      </div>
    }
    return [
      {
        id: 'asset_no', header: 'Vehicle', accessorFn: v => v.asset_no || undefined, size: 200, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ row: { original: v } }) => {
          const mode = meterMode(v)
          return <div className="min-w-[180px]">
            <button type="button" className="font-semibold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 min-h-[32px]" onClick={() => showHistory(v)}>{v.asset_no}</button>
            <div className="text-xs text-[var(--text-muted)] mt-1">{v.registration_no || v.fleet_number || 'No registration'} | {v.vehicle_type || 'Type not recorded'}</div>
            <div className="text-xs text-[var(--text-muted)] mt-2">{mode === 'both' ? 'Kilometres + hours' : mode === 'km' ? 'Kilometres' : mode === 'hours' ? 'Engine hours' : 'Vehicle meter type not established'}</div>
          </div>
        },
      },
      {
        id: 'region', header: 'Region / site', accessorFn: v => v.region || undefined, size: 150, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ row: { original: v } }) => <div className="text-sm"><div>{v.region || 'Region not recorded'}</div><div className="text-xs text-[var(--text-muted)] mt-1">{v.site || 'Site not recorded'}</div></div>,
      },
      { id: 'km', header: 'Kilometres', accessorFn: v => v.km ?? undefined, size: 190, sortingFn: valueSort, sortUndefined: 'last', cell: ({ row }) => meterCell(row.original, 'km') },
      { id: 'engineHours', header: 'Engine hours', accessorFn: v => v.engineHours ?? undefined, size: 190, sortingFn: valueSort, sortUndefined: 'last', cell: ({ row }) => meterCell(row.original, 'hours') },
      {
        id: 'entry', header: 'New reading date / note', enableSorting: false, size: 190,
        cell: ({ row: { original: v } }) => {
          const draft = drafts[v.id] || { km: '', hours: '', date: meterToday(v.country), notes: '' }
          const saving = statuses[v.id]?.saving
          return <div className="min-w-[170px]">
            <input className="input w-full min-h-[44px]" aria-label={`${v.asset_no} reading date`} type="date" max={meterToday(v.country)} value={draft.date} disabled={saving || !canSave} onChange={e => changeDraft(v, 'date', e.target.value)} />
            <input className="input w-full mt-2 min-h-[44px]" aria-label={`${v.asset_no} notes`} placeholder="Optional note" maxLength={4000} value={draft.notes} disabled={saving || !canSave} onChange={e => changeDraft(v, 'notes', e.target.value)} />
          </div>
        },
      },
      {
        id: 'save', header: 'Save reading', enableSorting: false, size: 160,
        cell: ({ row: { original: v } }) => {
          const draft = drafts[v.id] || { km: '', hours: '' }
          const status = statuses[v.id]
          const saving = status?.saving
          return <div className="min-w-[140px]">
            <button type="button" className="btn-primary w-full min-h-[44px] disabled:opacity-50" aria-label={`Save ${v.asset_no}`} disabled={!canSave || saving || !meterMode(v) || v.duplicate || (draft.km === '' && draft.hours === '')} onClick={() => save(v)}>{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" className="btn-secondary w-full mt-2 text-xs min-h-[44px]" onClick={() => showHistory(v)}>History</button>
            {v.duplicate && <p className="text-xs text-amber-600 mt-2">Duplicate fleet identity; saving disabled.</p>}
            {status?.message && <p role={status.error ? 'alert' : 'status'} className={`text-xs mt-2 ${status.error ? 'text-red-600 dark:text-red-300' : 'text-[var(--text-secondary)]'}`}>{status.message}</p>}
          </div>
        },
      },
    ]
  // changeDraft / save / showHistory only read state through setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, statuses, canSave])
  const kpiTiles = [
    { label: 'Vehicles in view', value: kpis.vehicles.toLocaleString(), icon: Truck, sub: kpis.duplicates ? `${kpis.duplicates} with duplicate identity` : 'Fleet register in scope' },
    { label: 'Kilometre coverage', value: kpis.kmCoveragePct == null ? 'N/A' : `${kpis.kmCoveragePct}%`, icon: Gauge, sub: `${kpis.withKm.toLocaleString()} km-based vehicles with a reading` },
    { label: 'Hour coverage', value: kpis.hoursCoveragePct == null ? 'N/A' : `${kpis.hoursCoveragePct}%`, icon: Clock, sub: `${kpis.withHours.toLocaleString()} hour-based vehicles with a reading` },
    { label: `Stale over ${STALE_DAYS} days`, value: kpis.stale.toLocaleString(), icon: CalendarX2, sub: `${kpis.undated.toLocaleString()} with no dated reading`, tone: kpis.stale ? 'text-amber-600 dark:text-amber-300' : undefined },
    { label: 'Readings in view', value: kpis.readings.toLocaleString(), icon: ListChecks, sub: 'Kilometre and hour readings after filters' },
    { label: 'Flagged for review', value: kpis.flagged.toLocaleString(), icon: AlertTriangle, sub: 'Lower-than-previous readings', tone: kpis.flagged ? 'text-red-600 dark:text-red-300' : undefined },
  ]
  return <div className="space-y-4">
    <PageHeader title="Vehicle Meter Logs" subtitle="Enter kilometres and engine hours in the same row. Each save adds dated readings and preserves history."
      icon={Gauge} onRefresh={load} refreshing={loading} updatedAt={loadedAt}
      actions={<div className="flex gap-2"><button type="button" className="btn-secondary min-h-[44px]" disabled={loading || !!error} onClick={() => exportRows('excel')}>Excel</button><button type="button" className="btn-secondary min-h-[44px]" disabled={loading || !!error} onClick={() => exportRows('pdf')}>PDF</button></div>} />
    {!error && <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-busy={loading}>
      {kpiTiles.map(({ label, value, icon: Icon, sub, tone }) => <div key={label} className="card">
        <div className="flex items-center justify-between gap-2"><p className="text-xs text-[var(--text-muted)]">{label}</p><Icon size={16} className="text-[var(--text-muted)]" aria-hidden="true" /></div>
        {loading ? <div className="h-7 w-14 mt-1 rounded bg-[var(--input-bg)] animate-pulse" /> : <p className={`text-2xl font-bold tabular-nums mt-1 ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>}
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>
      </div>)}
    </div>}
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="relative flex-1 min-w-[240px]"><span className="sr-only">Search vehicles and readings</span><Search size={17} className="absolute start-3 top-3 text-[var(--text-muted)]" /><input className="input w-full ps-10 min-h-[44px]" placeholder="Search asset, plate, region, site" value={filters.search} onChange={e => changeFilter('search', e.target.value)} /></label>
        <button type="button" className="btn-secondary flex items-center gap-2 min-h-[44px]" aria-expanded={showFilters} aria-controls="meter-filters" onClick={() => setShowFilters(open => !open)}><SlidersHorizontal size={16} />Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}<ChevronDown size={14} aria-hidden="true" className={showFilters ? 'rotate-180' : ''} /></button>
        {(activeFilterCount > 0 || filters.search || filters.assetId) && <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
      </div>
      {showFilters && <div id="meter-filters" className="space-y-3 border-t border-[var(--input-border)] pt-3">
      <div className="flex flex-wrap gap-3">
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
        <button type="button" className="btn-secondary min-h-[44px]" onClick={() => preset(1)}>Today</button><button type="button" className="btn-secondary min-h-[44px]" onClick={() => preset(7)}>Last 7 days</button><button type="button" className="btn-secondary min-h-[44px]" onClick={() => preset('month')}>This month</button>
        <label className="flex gap-2 items-center px-2 py-2"><input type="checkbox" checked={filters.flagged} onChange={e => changeFilter('flagged', e.target.checked)} /> Awaiting Admin review</label>
      </div>
      <p className="text-xs text-[var(--text-muted)]">Region is the vehicle's current fleet region. History retains the recorded site. Received times use each record's country timezone; measurement dates do not imply a recorded time.</p>
      </div>}
      {filters.assetId && <p className="text-sm">History for <strong>{vehicles.find(v => v.id === filters.assetId)?.asset_no}</strong> <button type="button" className="underline ms-2 min-h-[44px]" onClick={() => changeFilter('assetId', '')}>Show all vehicles</button></p>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-lg bg-[var(--input-bg)] p-1" role="group" aria-label="Meter views">{[['vehicles', 'Latest per vehicle'], ['history', 'All readings'], ['analytics', 'Analytics'], ['coverage', 'Coverage and quality']].map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className={`${tab === key ? 'btn-primary' : 'btn-secondary'} min-h-[44px]`}>{label}</button>)}</div><span className="text-sm text-[var(--text-muted)]" aria-live="polite">{filteredVehicles.length} vehicles | {filteredHistory.length} readings</span></div>
    {!loading && !error && !canSave && <p role="status" className="card text-sm">Meter Logs access is required to add or correct readings for vehicles in your assigned scope.</p>}
    {hasDrafts && <p className="text-xs text-[var(--text-muted)]">Unsaved entries stay while searching or changing views. Save them before leaving this page or switching country.</p>}
    {canReview && <button type="button" className="btn-secondary min-h-[44px]" onClick={() => { setFilters({ ...EMPTY_FILTERS, flagged: true }); setTab('history') }}>Admin review</button>}
    {notice && <p role="status" className="card text-sm">{notice}</p>}
    {error && <div role="alert" className="card flex flex-wrap items-center gap-3 text-red-600 dark:text-red-300"><AlertTriangle size={18} aria-hidden="true" /><span className="flex-1">{error}</span><button type="button" className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button></div>}
    {loading && tab !== 'vehicles' && <p role="status" className="card">Loading vehicle meters...</p>}
    {!error && tab === 'vehicles' && <EnterpriseTable
      columns={columns}
      data={filteredVehicles}
      getRowId={v => String(v.id)}
      loading={loading}
      enableGlobalFilter={false}
      enableColumnFilters={false}
      enableExport={false}
      enableKeyboard={false}
      initialPageSize={25}
      emptyMessage="No vehicles match these filters."
    />}
    {!loading && !error && tab === 'history' && <MeterHistory canReview={canReview} canCorrect={canCorrect} rows={filteredHistory} onSaved={corrected} resetKey={filters} />}
    {!loading && !error && tab === 'coverage' && <Suspense fallback={<p role="status">Loading coverage...</p>}><MeterCoverage vehicles={filteredVehicles} history={filteredHistory} today={meterToday(country)} /></Suspense>}
    {!loading && !error && tab === 'analytics' && <Suspense fallback={<p role="status">Loading analytics...</p>}><MeterAnalytics rows={analyticsRows} /></Suspense>}
  </div>
}
