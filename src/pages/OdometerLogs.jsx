/**
 * OdometerLogs (route /odometer-logs) - odometer and engine-hour readings,
 * rebuilt on the shared page kit to the owner's light reference design.
 *
 * Data: odometer_logs + engine_hours_logs + vehicle_fleet through
 * src/lib/api/vehicleMeters.js; list maths in odometerLogsAnalytics.js and the
 * view rules (status, jumps, missing, distance, sources) in odometerLogsView.js.
 *
 * There is NO approval column on either reading table. Readings are accepted
 * when saved; a reading below the previous one is accepted but flagged (V340)
 * and waits for an Admin review. The Approval queue tab is exactly that list,
 * and it says so on screen.
 *
 * Kept from the previous page: row entry of kilometres and hours with drafts
 * that survive filtering, lower-reading warning, per-row save status, the full
 * reading register with correction / Admin review and its audit history,
 * kilometre analytics, coverage and quality, every filter (region, site,
 * source, vehicle type, applicable meters, reading unit, date range, presets,
 * awaiting review, one vehicle), Excel and PDF export, and the permission gates.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Gauge, Search, SlidersHorizontal, ChevronDown, AlertTriangle, CalendarX2, ListChecks,
  RefreshCw, ShieldCheck, Activity, Plus, Eye, FileSpreadsheet, FileText, Truck, Info,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import SideDrawer from '../components/ui/SideDrawer'
import MeterHistory, { Correction } from '../components/meters/MeterHistory'
import {
  Card, Kpi, PageHero, Tabs, Donut, KitTable, VehicleThumb, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { loadVehicleMeters, saveVehicleMeters, getMeterReadingDetail } from '../lib/api/vehicleMeters'
import { buildVehicleMeters, meterKey, meterSource, meterToday, validateMeterDraft, receivedDate, newMeterDraft, readingDate } from '../lib/vehicleMeters'
import {
  distinct, filterVehicles, filterHistory, presetRange, vehicleExportRows,
} from '../lib/odometerLogsAnalytics'
import {
  DEFAULT_VIEW_SETTINGS, normalizeViewSettings, findJumps, readingStatus, STATUS_META, approvalQueue,
  missingReadings, viewKpis, assetMeterSeries, distanceSeries, sourceDistribution, sourceGroupLabel, readingExportRows,
  anomalyRows, readingKey,
} from '../lib/odometerLogsView'
import { resolveStorageUrls } from '../lib/storageRefs'
import { compareValues, sortRows } from '../lib/consoleTable'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import './OdometerLogs.css'

const MeterAnalytics = lazy(() => import('../components/meters/MeterAnalytics'))
const MeterCoverage = lazy(() => import('../components/meters/MeterCoverage'))
const EMPTY = { fleet: [], odometer: [], hours: [] }
const EMPTY_FILTERS = { search: '', region: '', site: '', source: '', from: '', to: '', flagged: false, assetId: '', vehicleType: '', meterType: '', readingKind: '' }
const SETTINGS_KEY = 'odometer-logs:view-settings'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const meterNumber = value => value == null ? 'No reading' : Number(value).toLocaleString()
const meterMode = row => row.supportsKm && row.supportsHours ? 'both' : row.supportsKm ? 'km' : row.supportsHours ? 'hours' : ''
const makeModel = r => [r.make, r.model].filter(Boolean).join(' ')
const receivedTime = (value, country) => {
  const text = receivedDate(value, country)
  return text === 'Not recorded' ? 'Received time not recorded' : `Received ${text}`
}

function loadViewSettings() {
  try { return normalizeViewSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) } catch { return { ...DEFAULT_VIEW_SETTINGS } }
}

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
  const [settings, setSettings] = useState(loadViewSettings)
  const [grain, setGrain] = useState('daily')
  const [selection, setSelection] = useState({})
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [assetView, setAssetView] = useState(null)
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => !['search', 'assetId', 'site', 'from', 'to'].includes(key) && Boolean(value)).length
  useEffect(() => {
    try { sessionStorage.setItem(`meter-filters:${country}`, JSON.stringify(filters)) } catch { /* Storage is optional. */ }
  }, [filters, country])
  const [drafts, setDrafts] = useState({})
  const [statuses, setStatuses] = useState({})
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const savingIds = useRef(new Set())
  const changeFilter = (key, value) => setFilters(old => ({ ...old, [key]: value, ...(key === 'region' ? { site: '', assetId: '' } : key === 'search' || key === 'site' ? { assetId: '' } : {}) }))
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
    return { ...r, region: v?.region, registration_no: v?.registration_no || v?.fleet_number, vehicleId: v?.id, vehicle_type: v?.vehicle_type, make: v?.make, model: v?.model, supportsKm: v?.supportsKm, supportsHours: v?.supportsHours }
  }).sort((a, b) => String(b.reading_date || '').localeCompare(a.reading_date || '') || String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id))), [data, fleetByKey])
  const filteredHistory = useMemo(() => filterHistory(history, filters), [history, filters])
  // Default order is by asset number; the table header then re-sorts the whole set.
  const filteredVehicles = useMemo(() => sortRows(filterVehicles(vehicles, filters), { key: 'asset_no', dir: 'asc' }), [vehicles, filters])
  const today = meterToday(country)
  // Jumps are judged on each vehicle's whole history so a date filter cannot
  // hide the reading before a jump; only jumps whose reading is in view count.
  const jumps = useMemo(() => {
    const inView = new Set(filteredHistory.map(readingKey))
    return findJumps(history, settings).filter(j => inView.has(j.key))
  }, [history, filteredHistory, settings])
  const jumpKeys = useMemo(() => new Set(jumps.map(j => j.key)), [jumps])
  const allJumps = useMemo(() => (assetView ? findJumps(history, settings) : []), [assetView, history, settings])
  const assetSeries = useMemo(() => (assetView
    ? assetMeterSeries(history, r => (r.vehicleId ? r.vehicleId === assetView.id : meterKey(r) === meterKey(assetView)), allJumps)
    : null), [assetView, history, allJumps])
  const missing = useMemo(() => missingReadings(filteredVehicles, today, settings), [filteredVehicles, today, settings])
  const queue = useMemo(() => approvalQueue(filteredHistory), [filteredHistory])
  const anomalies = useMemo(() => anomalyRows(filteredHistory, jumps), [filteredHistory, jumps])
  const kpis = useMemo(() => viewKpis({ rows: filteredHistory, vehicles: filteredVehicles, jumps, missing }), [filteredHistory, filteredVehicles, jumps, missing])
  const distance = useMemo(() => distanceSeries(filteredHistory, grain, today, settings), [filteredHistory, grain, today, settings])
  const sources = useMemo(() => sourceDistribution(filteredHistory), [filteredHistory])
  const regions = useMemo(() => distinct(vehicles.map(v => v.region)), [vehicles])
  const vehicleTypes = useMemo(() => distinct(vehicles.map(v => v.vehicle_type)), [vehicles])
  const sites = useMemo(() => distinct(vehicles.filter(v => !filters.region || v.region === filters.region).map(v => v.site)), [vehicles, filters.region])
  const vehicleOptions = useMemo(() => sortRows(vehicles.filter(v => (!filters.region || v.region === filters.region) && (!filters.site || v.site === filters.site)), { key: 'asset_no', dir: 'asc' }), [vehicles, filters.region, filters.site])
  const sourceOptions = useMemo(() => distinct(history.map(r => meterSource(r.source))), [history])
  const analyticsRows = useMemo(() => filteredHistory.filter(r => r.kind === 'km'), [filteredHistory])
  const selectedRows = useMemo(() => filteredHistory.filter(r => selection[readingKey(r)]), [filteredHistory, selection])
  const editingRow = useMemo(() => (editing ? history.find(r => readingKey(r) === editing) || null : null), [history, editing])

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
  function showHistory(vehicle) { setFilters(old => ({ ...old, assetId: vehicle.id, site: '', source: '', from: '', to: '', flagged: false, readingKind: '' })); setTab('readings') }
  function corrected(row, kind) {
    applySaved(kind === 'km' ? { odometer: row } : { hours: row })
    setNotice('Correction saved with its reason and audit history. Refresh to check the fleet\'s current meter.')
  }
  function preset(days) {
    const range = presetRange(meterToday(country), days)
    setFilters(old => ({ ...old, ...range }))
  }
  function addReadingFor(vehicle) {
    setFilters(old => ({ ...old, assetId: vehicle?.id || '' }))
    setTab('vehicles')
  }
  function changeSettings(next) {
    const clean = normalizeViewSettings(next)
    setSettings(clean)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean)) } catch { /* Storage is optional. */ }
  }

  function exportRows(format) {
    const historyRows = rows => rows.map(r => ({ asset: r.asset_no, country: r.country, region: r.region, site: r.site, reading: r.value, unit: r.kind, reading_date: r.reading_date, received_at: receivedDate(r.created_at, r.country), edited_at: receivedDate(r.updated_at, r.country), source: meterSource(r.source) }))
    const rows = tab === 'vehicles' ? vehicleExportRows(filteredVehicles)
      : tab === 'readings' ? readingExportRows(selectedRows.length ? selectedRows : filteredHistory, jumpKeys)
      : tab === 'approval' ? readingExportRows(queue, jumpKeys)
      : tab === 'missing' ? missing.map(m => ({ fleet_no: m.vehicle.asset_no, registration: m.vehicle.registration_no || m.vehicle.fleet_number || '', region: m.vehicle.region || '', site: m.vehicle.site || '', last_reading: m.lastDate || 'Never recorded', days_since: m.daysSince ?? 'Never recorded' }))
      : tab === 'anomalies' ? anomalies.map(a => ({ reading_date: a.reading.reading_date || '', fleet_no: a.reading.asset_no, reading: a.reading.value, unit: a.reading.kind, anomaly: a.label, detail: a.detail, status: STATUS_META[readingStatus(a.reading, jumpKeys)].label }))
      : historyRows(filteredHistory.filter(r => tab !== 'analytics' || r.kind === 'km'))
    if (!rows.length) return
    const cols = Object.keys(rows[0]), headers = cols.map(c => c.replaceAll('_', ' '))
    const file = reportFileName('Odometer Logs', reportDateLabel())
    if (format === 'excel') exportToExcel(rows, cols, headers, file, 'Odometer logs')
    else exportToPdf(rows, cols.map((key, i) => ({ key, header: headers[i] })), 'Odometer and engine hour readings', file, 'landscape')
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
        <div className="font-semibold tabular-nums">{meterNumber(current)} {current == null ? '' : label}</div>
        <div className="ol-sub">{matchesCurrent ? readingDate(last.reading_date) : 'Measurement date not recorded'}</div>
        {matchesCurrent && <div className="ol-sub" title={`Received ${receivedDate(last.created_at, row.country)}`}>{meterSource(last.source)}</div>}
        {enabled ? <input className="input w-full mt-2 min-h-[44px]" aria-label={`${row.asset_no} new ${label}`} type="number" min="0" step={kind === 'km' ? '1' : '0.1'} inputMode="decimal"
          placeholder={`New ${label}`} value={draft[kind]} disabled={saving || !canSave} onChange={e => changeDraft(row, kind, e.target.value)} />
          : <div className="ol-sub mt-3">Not applicable</div>}
        {enabled && draft[kind] !== '' && current != null && Number(draft[kind]) < current && <p className="ol-warn">Below the last reading. This will be saved for Admin review.</p>}
      </div>
    }
    return [
      {
        id: 'asset_no', header: 'Vehicle', accessorFn: v => v.asset_no || undefined, size: 220, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ row: { original: v } }) => {
          const mode = meterMode(v)
          return <div className="cc-vehicle min-w-[200px]">
            <VehicleThumb row={v} size="sm" />
            <div>
              <button type="button" className="ol-asset" onClick={() => setAssetView(v)} title="Open this vehicle's reading history">{v.asset_no}</button>
              <div className="ol-sub">{v.registration_no || v.fleet_number || 'No registration'} | {v.vehicle_type || 'Type not recorded'}</div>
              <div className="ol-sub">{mode === 'both' ? 'Kilometres + hours' : mode === 'km' ? 'Kilometres' : mode === 'hours' ? 'Engine hours' : 'Vehicle meter type not established'}</div>
            </div>
          </div>
        },
      },
      {
        id: 'region', header: 'Region / site', accessorFn: v => v.region || undefined, size: 150, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ row: { original: v } }) => <div><div>{v.region || 'Region not recorded'}</div><div className="ol-sub">{v.site || 'Site not recorded'}</div></div>,
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
            <button type="button" className="cc-btn-primary w-full justify-center min-h-[44px]" aria-label={`Save ${v.asset_no}`} disabled={!canSave || saving || !meterMode(v) || v.duplicate || (draft.km === '' && draft.hours === '')} onClick={() => save(v)}>{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" className="cc-btn-ghost w-full justify-center mt-2 min-h-[40px]" onClick={() => setAssetView(v)}>History and chart</button>
            {v.duplicate && <p className="ol-warn">Duplicate fleet identity; saving disabled.</p>}
            {status?.message && <p role={status.error ? 'alert' : 'status'} className={status.error ? 'ol-err' : 'ol-sub mt-2'}>{status.message}</p>}
          </div>
        },
      },
    ]
  // changeDraft / save / showHistory only read state through setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, statuses, canSave])

  const selectedVehicle = filters.assetId ? vehicles.find(v => v.id === filters.assetId) : null
  const tabs = [
    { key: 'vehicles', label: 'Latest per vehicle' },
    { key: 'readings', label: 'All readings' },
    { key: 'missing', label: 'Missing readings', count: loading || error ? null : missing.length, countTone: missing.length ? 'red' : '' },
    { key: 'anomalies', label: 'Anomalies', count: loading || error ? null : anomalies.length, countTone: anomalies.length ? 'red' : '' },
    { key: 'approval', label: 'Approval queue', count: loading || error ? null : queue.length },
    { key: 'history', label: 'History' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'coverage', label: 'Coverage' },
    { key: 'settings', label: 'Settings' },
  ]
  const ready = !loading && !error
  const correctAction = r => {
    const canEdit = r.flagged ? canReview : canCorrect
    return canEdit
      ? <button type="button" className="cc-btn" onClick={e => { e.stopPropagation(); setEditing(readingKey(r)) }}>{r.flagged ? 'Review / correct' : 'Correct / audit'}</button>
      : <span className="cc-na">{r.flagged ? 'Admin review only' : 'Correction unavailable'}</span>
  }

  return <div className="cc ol-page">
    <PageHero
      title="Odometer Logs"
      lead="Track odometer and engine hour readings, detect anomalies and ensure accurate data for maintenance and reporting"
      imgLight="/dashboard/hero-history-light.webp" imgDark="/dashboard/hero-history-dark.webp"
      stat={ready ? { value: fmtInt(kpis.reporting), lines: ['Vehicles reporting', `of ${fmtInt(kpis.vehicles)} in view`] } : null}
    />

    <Card className="ol-toolbar">
      <div className="cc-filters">
        <label className="cc-search"><Search size={16} aria-hidden="true" /><input aria-label="Search vehicles and readings" placeholder="Search asset, plate, region, site" value={filters.search} onChange={e => changeFilter('search', e.target.value)} /></label>
        <label className="cc-field"><span>Site</span><select className="cc-select" value={filters.site} onChange={e => changeFilter('site', e.target.value)}><option value="">All sites</option>{sites.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="cc-field"><span>Vehicle</span><select className="cc-select" value={filters.assetId} onChange={e => changeFilter('assetId', e.target.value)}><option value="">All vehicles</option>{vehicleOptions.map(v => <option key={v.id} value={v.id}>{v.asset_no}{v.registration_no ? ` | ${v.registration_no}` : ''}</option>)}</select></label>
        <label className="cc-field"><span>Reading date from</span><input className="cc-select" type="date" value={filters.from} max={filters.to || undefined} onChange={e => changeFilter('from', e.target.value)} /></label>
        <label className="cc-field"><span>To</span><input className="cc-select" type="date" value={filters.to} min={filters.from || undefined} onChange={e => changeFilter('to', e.target.value)} /></label>
        <button type="button" className="cc-btn-ghost" aria-expanded={showFilters} aria-controls="meter-filters" onClick={() => setShowFilters(open => !open)}><SlidersHorizontal size={15} aria-hidden="true" />More filters{activeFilterCount ? ` (${activeFilterCount})` : ''}<ChevronDown size={14} aria-hidden="true" className={showFilters ? 'rotate-180' : ''} /></button>
        {(activeFilterCount > 0 || filters.search || filters.assetId || filters.site || filters.from || filters.to) && <button type="button" className="cc-btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
        <div className="ol-actions">
          <button type="button" className="cc-icon-btn" aria-label="Refresh" title={loadedAt ? `Last loaded ${loadedAt.toLocaleTimeString()}` : 'Refresh'} disabled={loading} onClick={load}><RefreshCw size={15} aria-hidden="true" className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className="cc-btn-ghost" disabled={loading || !!error} onClick={() => exportRows('excel')}><FileSpreadsheet size={15} aria-hidden="true" />Excel</button>
          <button type="button" className="cc-btn-ghost" disabled={loading || !!error} onClick={() => exportRows('pdf')}><FileText size={15} aria-hidden="true" />PDF</button>
          {canReview && <button type="button" className="cc-btn-ghost" onClick={() => { setFilters({ ...EMPTY_FILTERS, flagged: true }); setTab('readings') }}>Admin review</button>}
          <button type="button" className="cc-btn-primary" disabled={!canSave} title={canSave ? 'Enter kilometres and hours for a vehicle' : 'Meter Logs access is required to add readings'} onClick={() => addReadingFor(selectedVehicle)}><Plus size={15} aria-hidden="true" />Add reading</button>
        </div>
      </div>
      {showFilters && <div id="meter-filters" className="ol-more">
        <div className="cc-filters">
          <label className="cc-field"><span>Region</span><select className="cc-select" value={filters.region} onChange={e => changeFilter('region', e.target.value)}><option value="">All regions</option>{regions.map(r => <option key={r}>{r}</option>)}</select></label>
          <label className="cc-field"><span>Source</span><select className="cc-select" value={filters.source} onChange={e => changeFilter('source', e.target.value)}><option value="">All sources</option>{sourceOptions.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="cc-field"><span>Vehicle type</span><select className="cc-select" value={filters.vehicleType} onChange={e => changeFilter('vehicleType', e.target.value)}><option value="">All vehicle types</option>{vehicleTypes.map(type => <option key={type}>{type}</option>)}<option value="__unknown">Type not recorded</option></select></label>
          <label className="cc-field"><span>Applicable meters</span><select className="cc-select" value={filters.meterType} onChange={e => changeFilter('meterType', e.target.value)}><option value="">All meter types</option><option value="hours">Hour-based (including both)</option><option value="km">Kilometre-based (including both)</option><option value="both">Kilometres + hours</option><option value="hours_only">Hours only</option><option value="km_only">Kilometres only</option><option value="unknown">Meters not established</option></select></label>
          <label className="cc-field"><span>Reading unit</span><select className="cc-select" value={filters.readingKind} onChange={e => changeFilter('readingKind', e.target.value)}><option value="">All readings</option><option value="km">Kilometre readings</option><option value="hours">Hour readings</option></select></label>
        </div>
        <div className="cc-filters mt-3">
          <button type="button" className="cc-btn-ghost" onClick={() => preset(1)}>Today</button>
          <button type="button" className="cc-btn-ghost" onClick={() => preset(7)}>Last 7 days</button>
          <button type="button" className="cc-btn-ghost" onClick={() => preset('month')}>This month</button>
          <label className="ol-check"><input type="checkbox" checked={filters.flagged} onChange={e => changeFilter('flagged', e.target.checked)} /> Awaiting Admin review</label>
        </div>
        <p className="ol-note">Region is the vehicle's current fleet region. Readings keep the site they were recorded at. Received times use each record's country timezone; measurement dates do not imply a recorded time.</p>
      </div>}
      {selectedVehicle && <p className="ol-note">Showing <strong>{selectedVehicle.asset_no}</strong> only. <button type="button" className="cc-link cc-link-btn" onClick={() => changeFilter('assetId', '')}>Show all vehicles</button></p>}
    </Card>

    {error
      ? <div role="alert" className="cc-card ol-error"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span><button type="button" className="cc-btn" onClick={load}><RefreshCw size={13} aria-hidden="true" /> Retry</button></div>
      : <div className="cc-kpis" aria-busy={loading}>
        <Kpi icon={ListChecks} tone="t-blue" value={kpis.total} loading={loading} label="Total readings" onClick={() => setTab('readings')} title="Kilometre and hour readings after filters" />
        <Kpi icon={Truck} tone="t-green" value={kpis.reporting} loading={loading} label={`Vehicles with a reading of ${fmtInt(kpis.vehicles)}`} onClick={() => setTab('vehicles')} />
        <Kpi icon={CalendarX2} tone="t-amber" value={kpis.missing} loading={loading} label="Missing readings" onClick={() => setTab('missing')} title={`Vehicles with no dated reading in ${settings.missingDays} days`} />
        <Kpi icon={Activity} tone="t-red" value={kpis.jumps} loading={loading} label="Suspicious jumps" onClick={() => setTab('anomalies')} danger={kpis.jumps > 0} />
        <Kpi icon={AlertTriangle} tone="t-orange" value={kpis.review} loading={loading} label="Awaiting review" onClick={() => setTab('approval')} title="Lower-than-previous readings waiting for an Admin" />
        <Kpi icon={ShieldCheck} tone="t-purple" display={fmtPct(kpis.accuracyPct)} loading={loading} label="Data accuracy" onClick={() => setTab('anomalies')} title="Share of readings not awaiting review and not a suspicious jump" />
      </div>}

    <Tabs tabs={tabs} value={tab} onChange={setTab} label="Odometer log views" variant="line" />
    <p className="ol-count" aria-live="polite">{filteredVehicles.length} vehicles | {filteredHistory.length} readings</p>

    {ready && !canSave && <p role="status" className="cc-card ol-note">Meter Logs access is required to add or correct readings for vehicles in your assigned scope.</p>}
    {hasDrafts && <p className="ol-note">Unsaved entries stay while searching or changing views. Save them before leaving this page or switching country.</p>}
    {notice && <p role="status" className="cc-card ol-note">{notice}</p>}
    {loading && !['vehicles'].includes(tab) && <p role="status" className="cc-card ol-note">Loading vehicle meters...</p>}

    {!error && tab === 'vehicles' && <Card title="Latest reading per vehicle" sub="Enter kilometres and engine hours in the same row. Each save adds a dated reading and keeps history.">
      <EnterpriseTable
        columns={columns}
        data={filteredVehicles}
        getRowId={v => String(v.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        enableKeyboard={false}
        enableColumnVisibility={false}
        stickyHeader={false}
        initialPageSize={25}
        className="cc-et"
        emptyMessage="No vehicles match these filters."
      />
    </Card>}

    {ready && tab === 'readings' && <Card title="All readings" sub={`Every kilometre and hour reading in view. Tick rows to export only those.${selectedRows.length ? ` ${selectedRows.length} selected.` : ''}`}
      action={selectedRows.length ? <button type="button" className="cc-link cc-link-btn" onClick={() => setSelection({})}>Clear selection</button> : null}>
      <ReadingsTable rows={filteredHistory} jumpKeys={jumpKeys} action={correctAction} onView={setViewing}
        selection={selection} onSelection={setSelection} resetKey={filters} empty="No readings match these filters." />
    </Card>}

    {ready && tab === 'approval' && <Card title="Approval queue" sub="Readings are accepted when saved. There is no separate approval step: a reading lower than the previous one is saved but flagged, and an Admin reviews it here.">
      <ReadingsTable rows={queue} jumpKeys={jumpKeys} action={correctAction} onView={setViewing} resetKey={filters}
        empty="No readings are waiting for an Admin review." />
    </Card>}

    {ready && tab === 'missing' && <Card title="Missing readings" sub={`Vehicles that use a meter and have no dated reading in the last ${settings.missingDays} days, or never had one. Change the window in Settings.`}>
      <KitTable rows={missing} getRowId={m => String(m.vehicle.id)} empty="Every vehicle in view has a recent reading." onRowClick={m => setAssetView(m.vehicle)}
        columns={[
          { key: 'vehicle', header: 'Fleet no', sortValue: m => m.vehicle.asset_no, cell: m => <div className="cc-vehicle"><VehicleThumb row={m.vehicle} size="sm" /><div><span className="cc-strong">{m.vehicle.asset_no}</span><span className="cc-sub">{m.vehicle.registration_no || m.vehicle.fleet_number || 'No registration'}</span></div></div> },
          { key: 'make', header: 'Make / model', sortValue: m => makeModel(m.vehicle), cell: m => makeModel(m.vehicle) || <span className="cc-na">Not recorded</span> },
          { key: 'site', header: 'Location', sortValue: m => m.vehicle.site, cell: m => <div>{m.vehicle.site || 'Site not recorded'}<span className="cc-sub">{m.vehicle.region || 'Region not recorded'}</span></div> },
          { key: 'meters', header: 'Meters', sortable: false, cell: m => meterMode(m.vehicle) === 'both' ? 'Kilometres + hours' : meterMode(m.vehicle) === 'km' ? 'Kilometres' : 'Engine hours' },
          { key: 'lastDate', header: 'Last reading', sortValue: m => m.lastDate || '', cell: m => m.lastDate ? readingDate(m.lastDate) : <span className="cc-pill bad">Never recorded</span> },
          { key: 'daysSince', header: 'Days since', numeric: true, sortValue: m => m.daysSince ?? Infinity, cell: m => m.daysSince == null ? <span className="cc-na">N/A</span> : fmtInt(m.daysSince) },
          { key: 'act', header: '', sortable: false, cell: m => <button type="button" className="cc-btn" disabled={!canSave} onClick={e => { e.stopPropagation(); addReadingFor(m.vehicle) }}>Add reading</button> },
        ]} />
    </Card>}

    {ready && tab === 'anomalies' && <Card title="Anomalies" sub={`Readings lower than the previous one (flagged by the server when saved) and suspicious jumps: kilometres up at least ${fmtInt(settings.jumpMinKm)} km and more than ${fmtInt(settings.maxKmPerDay)} km a day, or engine hours up more than ${settings.maxHoursPerDay} hours a day.`}>
      <KitTable rows={anomalies} getRowId={a => a.key} empty="No anomalies in the readings in view." onRowClick={a => setViewing(a.reading)}
        columns={[
          { key: 'date', header: 'Reading date', sortValue: a => a.reading.reading_date || '', cell: a => readingDate(a.reading.reading_date) },
          { key: 'asset', header: 'Fleet no', sortValue: a => a.reading.asset_no, cell: a => <div><span className="cc-strong">{a.reading.asset_no}</span><span className="cc-sub">{a.reading.site || 'Site not recorded'}</span></div> },
          { key: 'value', header: 'Reading', numeric: true, sortValue: a => Number(a.reading.value), cell: a => `${Number(a.reading.value).toLocaleString()} ${a.reading.kind}` },
          { key: 'type', header: 'Anomaly', sortValue: a => a.label, cell: a => <span className={`cc-pill ${a.type === 'jump' ? 'bad' : 'warn'}`}>{a.label}</span> },
          { key: 'detail', header: 'Detail', sortable: false, cell: a => <span className="ol-wrap">{a.detail}</span> },
          { key: 'status', header: 'Status', sortValue: a => readingStatus(a.reading, jumpKeys), cell: a => <StatusPill row={a.reading} jumpKeys={jumpKeys} /> },
          { key: 'act', header: '', sortable: false, cell: a => correctAction(a.reading) },
        ]} />
    </Card>}

    {ready && tab === 'history' && <Card title="Reading register" sub="Full register with received and last edited times. Correct a reading or finish an Admin review from here.">
      <MeterHistory canReview={canReview} canCorrect={canCorrect} rows={filteredHistory} onSaved={corrected} resetKey={filters} />
    </Card>}
    {ready && tab === 'coverage' && <Suspense fallback={<p role="status" className="ol-note">Loading coverage...</p>}><MeterCoverage vehicles={filteredVehicles} history={filteredHistory} today={today} /></Suspense>}
    {ready && tab === 'analytics' && <Suspense fallback={<p role="status" className="ol-note">Loading analytics...</p>}><MeterAnalytics rows={analyticsRows} /></Suspense>}
    {ready && tab === 'settings' && <SettingsCard settings={settings} onChange={changeSettings} canSave={canSave} canCorrect={canCorrect} canReview={canReview} />}

    {!error && <div className="ol-charts">
      <Card title="Distance travelled (km)" sub="Kilometre increases between consecutive dated readings, credited to the later reading's date. Decreases and suspicious jumps are left out."
        action={<Tabs tabs={[{ key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }]} value={grain} onChange={setGrain} label="Distance period" />}>
        {loading ? <div className="cc-skel" style={{ height: 200 }} />
          : distance.measured === 0 ? <div className="cc-empty">No kilometre increases between dated readings in this period.</div>
          : <>
            <div className="cc-headline"><b>{fmtInt(distance.total)} km</b><span>{grain === 'daily' ? 'last 30 days' : grain === 'weekly' ? 'last 12 weeks' : 'last 12 months'}</span></div>
            <DistanceChart points={distance.points} />
          </>}
      </Card>
      <Card title="Source distribution" sub="Where the readings in view came from">
        {loading ? <div className="cc-skel" style={{ height: 150 }} />
          : !filteredHistory.length ? <div className="cc-empty">No readings in view.</div>
          : <Donut segments={sources} centerLabel="Readings" />}
      </Card>
    </div>}

    {editingRow && <Correction row={editingRow} onCancel={() => setEditing(null)} onSaved={(result, kind) => { corrected(result, kind); setEditing(null) }} />}
    {viewing && <ReadingDetail row={viewing} jumpKeys={jumpKeys} onClose={() => setViewing(null)} />}
    {assetView && assetSeries && <AssetHistoryDrawer vehicle={assetView} series={assetSeries} canSave={canSave}
      onClose={() => setAssetView(null)}
      onAdd={() => { addReadingFor(assetView); setAssetView(null) }}
      onFilter={() => { showHistory(assetView); setAssetView(null) }}
      onView={r => setViewing(r)} />}
  </div>
}

function StatusPill({ row, jumpKeys }) {
  const meta = STATUS_META[readingStatus(row, jumpKeys)]
  return <span className={`cc-pill ${meta.tone}`} title={row.flag_reason || undefined}>{meta.label}</span>
}

function ReadingsTable({ rows, jumpKeys, action, onView, selection, onSelection, resetKey, empty }) {
  const selectable = Boolean(onSelection)
  return <KitTable rows={rows} getRowId={readingKey} empty={empty} resetPageKey={resetKey} onRowClick={onView}
    enableRowSelection={selectable} rowSelection={selectable ? selection : undefined} onRowSelectionChange={selectable ? onSelection : undefined}
    columns={[
      { key: 'reading_date', header: 'Date & time', sortValue: r => `${r.reading_date || ''}|${r.created_at || ''}`, cell: r => <div>{readingDate(r.reading_date)}<span className="cc-sub">{receivedTime(r.created_at, r.country)}</span></div> },
      { key: 'asset_no', header: 'Fleet no', sortValue: r => r.asset_no, cell: r => <div className="cc-vehicle"><VehicleThumb row={r} size="sm" /><div><span className="cc-strong">{r.asset_no}</span><span className="cc-sub">{r.registration_no || 'Registration not recorded'}</span></div></div> },
      { key: 'make', header: 'Make / model', sortValue: makeModel, cell: r => makeModel(r) || <span className="cc-na">Not recorded</span> },
      { key: 'km', header: 'Odometer (km)', numeric: true, sortValue: r => (r.kind === 'km' ? Number(r.value) : undefined), cell: r => r.kind === 'km' ? <span className="cc-strong">{`${Number(r.value).toLocaleString()} km`}</span> : <span className="cc-na">N/A</span> },
      { key: 'hours', header: 'Engine hours', numeric: true, sortValue: r => (r.kind === 'hours' ? Number(r.value) : undefined), cell: r => r.kind === 'hours' ? <span className="cc-strong">{`${Number(r.value).toLocaleString()} hours`}</span> : <span className="cc-na">N/A</span> },
      { key: 'site', header: 'Location', sortValue: r => r.site, cell: r => <div>{r.site || 'Site not recorded'}<span className="cc-sub">{r.region || 'Region not recorded'}</span></div> },
      { key: 'source', header: 'Source', sortValue: r => sourceGroupLabel(r.source), cell: r => <div>{sourceGroupLabel(r.source)}<span className="cc-sub">{meterSource(r.source)}</span></div> },
      { key: 'status', header: 'Status', sortValue: r => readingStatus(r, jumpKeys), cell: r => <div><StatusPill row={r} jumpKeys={jumpKeys} />{r.flagged && <span className="cc-sub ol-reason">{r.flag_reason || 'Saved below the last recorded reading'}</span>}</div> },
      { key: 'actions', header: '', sortable: false, cell: r => <div className="ol-row-actions"><button type="button" className="cc-icon-btn" aria-label={`View ${r.asset_no} reading`} onClick={e => { e.stopPropagation(); onView(r) }}><Eye size={15} aria-hidden="true" /></button>{action(r)}</div> },
    ]} />
}

/** Photos, signature and note of one reading, loaded only when it is opened. */
function ReadingDetail({ row, jumpKeys, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', detail: null, photos: [] })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let active = true
    setState({ loading: true, error: '', detail: null, photos: [] })
    getMeterReadingDetail(row)
      .then(async detail => {
        const refs = Array.isArray(detail?.photos) ? detail.photos.map(p => (typeof p === 'string' ? p : p?.url || p?.path)).filter(Boolean) : []
        const photos = await resolveStorageUrls(refs).catch(() => [])
        if (active) setState({ loading: false, error: '', detail, photos })
      })
      .catch(err => { if (active) setState({ loading: false, error: toUserMessage(err, 'Could not load this reading.'), detail: null, photos: [] }) })
    return () => { active = false }
  }, [row, nonce])
  const sig = typeof state.detail?.signature === 'string' && state.detail.signature.trim().startsWith('<svg') ? state.detail.signature : null
  const fields = [
    ['Reading', `${Number(row.value).toLocaleString()} ${row.kind}`],
    ['Reading date', readingDate(row.reading_date)],
    ['Received', receivedDate(row.created_at, row.country)],
    ['Location', row.site || 'Site not recorded'],
    ['Source', meterSource(row.source)],
    ['Status', STATUS_META[readingStatus(row, jumpKeys)].label],
  ]
  return <Modal open onClose={onClose} size="lg" title={`${row.asset_no} reading`} subtitle={[row.registration_no, makeModel(row)].filter(Boolean).join(' | ') || undefined}>
    <dl className="ol-dl">{fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    {state.loading ? <p role="status" className="ol-note">Loading photos and signature...</p>
      : state.error ? <p role="alert" className="ol-err">{state.error} <button type="button" className="cc-btn" onClick={() => setNonce(n => n + 1)}>Retry</button></p>
      : <>
        {(state.detail?.flag_reason || row.flag_reason) && <p className="ol-note"><Info size={13} aria-hidden="true" /> {state.detail?.flag_reason || row.flag_reason}</p>}
        <p className="ol-note">Note: {state.detail?.notes || row.notes || 'No note recorded'}</p>
        <h3 className="ol-h3">Photos</h3>
        {state.photos.length ? <div className="ol-photos">{state.photos.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={`${row.asset_no} meter photo`} loading="lazy" /></a>)}</div> : <p className="ol-note">No photo recorded for this reading.</p>}
        <h3 className="ol-h3">Signature</h3>
        {sig ? <img className="ol-sig" alt={`${row.asset_no} signature`} src={`data:image/svg+xml;utf8,${encodeURIComponent(sig)}`} /> : <p className="ol-note">No signature recorded for this reading.</p>}
      </>}
  </Modal>
}

function DistanceChart({ points }) {
  const W = 520; const H = 190; const pad = { l: 44, r: 10, t: 10, b: 24 }
  const max = Math.max(1, ...points.map(p => p.km))
  const step = 10 ** Math.floor(Math.log10(max)); const top = Math.ceil(max / step) * step
  const x = i => pad.l + (points.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (points.length - 1))
  const y = v => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.km)}`).join(' ')
  const area = `${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
  const every = Math.ceil(points.length / 8)
  return <div className="cc-chart ol-chart">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Distance travelled: ${points.filter(p => p.km).map(p => `${p.label} ${p.km} km`).join(', ') || 'no distance'}`}>
      <defs><linearGradient id="olDist" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#16a34a" stopOpacity="0.3" /><stop offset="1" stopColor="#16a34a" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map(f => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} stroke="var(--cc-track)" /><text className="cc-axis" x={pad.l - 6} y={y(top * f)} dy="0.35em" textAnchor="end">{fmtInt(top * f)}</text></g>)}
      <path d={area} fill="url(#olDist)" />
      <path d={d} fill="none" stroke="#16a34a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (i % every === 0 || i === points.length - 1) && <text key={p.key} className="cc-axis" x={x(i)} y={H - 6} textAnchor="middle">{p.label}</text>)}
    </svg>
  </div>
}

function SettingsCard({ settings, onChange, canSave, canCorrect, canReview }) {
  const [draft, setDraft] = useState(settings)
  const field = (key, label, hint) => <label className="cc-field"><span>{label}</span><input className="cc-select" type="number" value={draft[key]} onChange={e => setDraft(old => ({ ...old, [key]: e.target.value }))} /><small className="ol-sub">{hint}</small></label>
  return <Card title="Settings" sub="These checks run in your browser and are saved on this device only. They change what this page flags; they never change a stored reading.">
    <div className="cc-filters">
      {field('missingDays', 'Missing after (days)', '1 to 365')}
      {field('jumpMinKm', 'Jump: minimum km increase', '0 to 100,000')}
      {field('maxKmPerDay', 'Jump: km a day above', '100 to 20,000')}
      {field('maxHoursPerDay', 'Jump: engine hours a day above', '1 to 24')}
    </div>
    <div className="cc-filters mt-3">
      <button type="button" className="cc-btn-primary" onClick={() => { const clean = normalizeViewSettings(draft); setDraft(clean); onChange(clean) }}>Save settings</button>
      <button type="button" className="cc-btn-ghost" onClick={() => { setDraft({ ...DEFAULT_VIEW_SETTINGS }); onChange(DEFAULT_VIEW_SETTINGS) }}>Restore defaults</button>
    </div>
    <h3 className="ol-h3"><Gauge size={14} aria-hidden="true" /> How readings are handled</h3>
    <ul className="ol-rules">
      <li>A saved reading is accepted straight away. There is no separate approval step.</li>
      <li>A reading lower than the previous one is still saved, but flagged for an Admin review. The fleet's current kilometres stay at the higher value.</li>
      <li>Corrections keep the original value, the new value, who made the change and the reason.</li>
    </ul>
    <h3 className="ol-h3">Your access</h3>
    <ul className="ol-rules">
      <li>Add readings: {canSave ? 'Yes' : 'No'}</li>
      <li>Correct readings: {canCorrect ? 'Yes' : 'No'}</li>
      <li>Review flagged readings: {canReview ? 'Yes' : 'No'}</li>
    </ul>
  </Card>
}

/** Line chart of one meter over time; flagged and jump readings are drawn red with their reason. */
function SeriesChart({ points, unit }) {
  const W = 560; const H = 180; const pad = { l: 56, r: 12, t: 12, b: 26 }
  const ok = points.filter(p => p.date)
  if (ok.length < 2) return <div className="cc-empty">{ok.length ? 'Only one dated reading, so there is no line to draw yet.' : `No dated ${unit} readings.`}</div>
  const t = ok.map(p => Date.parse(`${String(p.date).slice(0, 10)}T00:00:00Z`))
  const t0 = Math.min(...t); const t1 = Math.max(...t)
  const vals = ok.map(p => p.value)
  const lo = Math.min(...vals); const hi = Math.max(...vals)
  const span = hi - lo || 1
  const x = ms => pad.l + (t1 === t0 ? 0 : ((ms - t0) / (t1 - t0)) * (W - pad.l - pad.r))
  const y = v => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
  const clean = ok.map((p, i) => ({ p, i })).filter(({ p }) => !p.flagged && !p.jump)
  const d = clean.map(({ p, i }, k) => `${k ? 'L' : 'M'}${x(t[i])},${y(p.value)}`).join(' ')
  const fmtD = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
  return <div className="cc-chart ol-series">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${unit} readings from ${fmtD(t0)} to ${fmtD(t1)}, ${ok.filter(p => p.flagged || p.jump).length} flagged`}>
      {[0, 0.5, 1].map(f => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(lo + span * f)} y2={y(lo + span * f)} stroke="var(--cc-track)" /><text className="cc-axis" x={pad.l - 6} y={y(lo + span * f)} dy="0.35em" textAnchor="end">{fmtInt(Math.round(lo + span * f))}</text></g>)}
      <path d={d} fill="none" stroke="#16a34a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {ok.map((p, i) => <circle key={p.key} cx={x(t[i])} cy={y(p.value)} r={p.flagged || p.jump ? 5 : 3} fill={p.flagged || p.jump ? 'var(--cc-red)' : '#16a34a'} vectorEffect="non-scaling-stroke">
        <title>{`${readingDate(p.date)}: ${p.value.toLocaleString('en-US')} ${unit}${p.reason ? `. ${p.reason}` : ''}`}</title>
      </circle>)}
      <text className="cc-axis" x={pad.l} y={H - 6}>{fmtD(t0)}</text>
      <text className="cc-axis" x={W - pad.r} y={H - 6} textAnchor="end">{fmtD(t1)}</text>
    </svg>
  </div>
}

function AssetHistoryDrawer({ vehicle, series, canSave, onClose, onAdd, onFilter, onView }) {
  const rows = [...series.km, ...series.hours].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const flagged = rows.filter(p => p.flagged || p.jump)
  return <SideDrawer open onClose={onClose} size="lg" title={`${vehicle.asset_no} readings`}
    subtitle={[vehicle.registration_no || vehicle.fleet_number, vehicle.vehicle_type, vehicle.site].filter(Boolean).join(' | ') || undefined}
    footer={<div className="cc ol-drawer-foot">
      <button type="button" className="cc-btn-ghost" onClick={onFilter}>Show in All readings</button>
      <button type="button" className="cc-btn-primary" disabled={!canSave} onClick={onAdd}><Plus size={14} aria-hidden="true" />Add reading</button>
    </div>}>
    <div className="cc ol-drawer">
      <div className="ol-drawer-head">
        <VehicleThumb row={vehicle} size="lg" />
        <dl className="ol-dl">
          <div><dt>Kilometres now</dt><dd>{vehicle.km == null ? 'Not recorded' : `${fmtInt(vehicle.km)} km`}</dd></div>
          <div><dt>Engine hours now</dt><dd>{vehicle.engineHours == null ? 'Not recorded' : `${fmtInt(vehicle.engineHours)} hours`}</dd></div>
          <div><dt>Distance in history</dt><dd>{series.kmTravelled == null ? 'N/A' : `${fmtInt(series.kmTravelled)} km`}</dd></div>
          <div><dt>Hours in history</dt><dd>{series.hoursRun == null ? 'N/A' : `${fmtInt(series.hoursRun)} hours`}</dd></div>
          <div><dt>Readings</dt><dd>{fmtInt(rows.length)}{series.firstDate ? `, ${readingDate(series.firstDate)} to ${readingDate(series.lastDate)}` : ''}</dd></div>
          <div><dt>Flagged</dt><dd className={flagged.length ? 'ol-bad' : ''}>{fmtInt(flagged.length)}</dd></div>
        </dl>
      </div>
      {flagged.length > 0 && <div className="ol-flags" role="note">
        <b><AlertTriangle size={14} aria-hidden="true" /> Flagged readings</b>
        <ul>{flagged.slice(0, 8).map(p => <li key={p.key}>{readingDate(p.date)}: {p.value.toLocaleString('en-US')} {p.row.kind}. {p.reason}{p.reviewed ? ' (reviewed by Admin)' : ''}</li>)}</ul>
        {flagged.length > 8 && <p className="ol-sub">{flagged.length - 8} more in the table below.</p>}
      </div>}
      {series.km.length > 0 && <Card title="Kilometres over time" sub="Green line joins accepted readings; red points are flagged.">
        <SeriesChart points={series.km} unit="km" />
      </Card>}
      {series.hours.length > 0 && <Card title="Engine hours over time" sub="Green line joins accepted readings; red points are flagged.">
        <SeriesChart points={series.hours} unit="hours" />
      </Card>}
      <Card title="All readings for this vehicle">
        <KitTable compact scroll rows={rows} getRowId={p => p.key} onRowClick={p => onView(p.row)} empty="No readings recorded for this vehicle."
          columns={[
            { key: 'date', header: 'Reading date', cell: p => readingDate(p.date) },
            { key: 'value', header: 'Reading', numeric: true, cell: p => `${p.value.toLocaleString('en-US')} ${p.row.kind}` },
            { key: 'source', header: 'Source', cell: p => meterSource(p.row.source) },
            { key: 'status', header: 'Status', cell: p => p.flagged || p.jump
              ? <div><span className={`cc-pill ${p.flagged && !p.reviewed ? 'warn' : p.jump ? 'bad' : 'info'}`}>{p.flagged ? (p.reviewed ? 'Reviewed' : 'Flagged') : 'Suspicious jump'}</span><span className="cc-sub ol-reason">{p.reason}</span></div>
              : <span className="cc-pill good">Accepted</span> },
          ]} />
      </Card>
    </div>
  </SideDrawer>
}
