import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import DateField from '../ui/DateField'
import MultiSelectFilter from '../ui/MultiSelectFilter'
import { filterWashes } from '../../lib/washAnalytics'
import { entryPerson } from '../../lib/washDetails'
import { isSelectionActive } from '../../lib/filterSelection'

const ADVANCED_KEYS = [
  'site', 'area', 'type', 'region', 'vehicleType', 'enteredBy', 'correctedBy',
  'washedBy', 'bay', 'photos', 'chemicals', 'corrections',
  'dateBasis', 'from', 'to',
]
const LABELS = {
  site: 'Site', area: 'Area', type: 'Wash type', region: 'Region',
  vehicleType: 'Vehicle type', enteredBy: 'Entered by', correctedBy: 'Corrected by',
  washedBy: 'Washed by', bay: 'Wash bay', photos: 'Photos', chemicals: 'Chemicals',
  corrections: 'Corrections', dateBasis: 'Date basis',
  from: 'From', to: 'To',
}
const SINGLE_LABELS = {
  photos: { yes: 'With photos', no: 'Without photos' },
  chemicals: { used: 'Chemical used', none: 'No chemical used', not_recorded: 'Not recorded' },
  corrections: { yes: 'Corrected records', no: 'No corrections' },
  dateBasis: { wash: 'Wash date', received: 'Received date' },
}

export const washSelectionValues = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value || value === 'all' || value === 'All') return []
  return String(value).split(',').map((part) => part.trim()).filter(Boolean)
}
export const washSelectionParam = (values) => (
  Array.isArray(values) && values.length ? values.join(',') : 'all'
)

function unique(rows, field) {
  return [...new Set(rows.map((row) => String(row?.[field] || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}
function active(value, key) {
  if (key === 'dateBasis') return value.dateBasis === 'received'
  return isSelectionActive(value[key]) && value[key] !== 'All'
}
function SelectFilter({ name, label, value, options, onChange }) {
  return (
    <label className="text-xs text-[var(--text-muted)] space-y-1 min-w-44">
      <span>{label}</span>
      <select className="input w-full" value={value || 'all'} onChange={(event) => onChange(name, event.target.value)}>
        <option value="all">All</option>
        {options.map(([id, text]) => <option value={id} key={id}>{text}</option>)}
      </select>
    </label>
  )
}

export default function WashAdvancedFilters({
  rows = [], value, onChange, onClear, userId, scope, statuses = [],
  resultCount = 0, quickRanges = [], canUseFleetFields = false,
}) {
  const advancedCount = ADVANCED_KEYS.filter((key) => active(value, key)).length
  const [showFilters, setShowFilters] = useState(() => advancedCount > 0)
  const [savedName, setSavedName] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const storageKey = `wash-filters-v3:${scope}`
  const set = (key, next) => onChange({ ...value, [key]: next })
  const setMulti = (key, next) => set(key, washSelectionParam(next))

  useEffect(() => { if (advancedCount > 0) setShowFilters(true) }, [advancedCount])

  const creators = useMemo(() => {
    const map = new Map()
    for (const row of rows) if (row.created_by) map.set(row.created_by, entryPerson(row))
    return [...map].map(([id, label]) => ({ value: id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])
  const creatorNames = useMemo(() => new Map(creators.map((person) => [person.value, person.label])), [creators])
  const correctors = useMemo(() => [...new Set(rows.flatMap((row) => row.corrected_by_ids || []))]
    .map((id) => ({ value: id, label: creatorNames.get(id) || `User ${String(id).slice(0, 8)}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [rows, creatorNames])

  const regions = useMemo(() => unique(rows, 'region'), [rows])
  const selectedRegions = washSelectionValues(value.region)
  const siteRows = selectedRegions.length
    ? rows.filter((row) => selectedRegions.includes(String(row.region || '').trim()))
    : rows
  const sites = unique(siteRows, 'site')
  const areas = unique(rows, 'area')
  const washTypes = unique(rows, 'wash_type')
  const vehicleTypes = unique(rows, 'vehicle_type')
  const washers = unique(rows, 'washed_by')
  const bays = unique(rows, 'bay')

  useEffect(() => {
    if (!selectedRegions.length) return
    const selectedSites = washSelectionValues(value.site)
    const nextSites = selectedSites.filter((site) => sites.includes(site))
    if (nextSites.length !== selectedSites.length) setMulti('site', nextSites)
    // Sites are dependent on region so a stale site cannot silently empty the register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.region, sites.join('|')])

  const statusBase = useMemo(() => filterWashes(rows, { ...value, status: 'all' }), [rows, value])
  const statusCounts = useMemo(() => {
    const counts = { all: statusBase.length }
    for (const status of statuses) counts[status] = filterWashes(statusBase, { status }).length
    return counts
  }, [statusBase, statuses])

  let saved = []
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
    if (!Array.isArray(saved)) saved = []
  } catch { saved = [] }
  void revision

  const personLabel = (key, raw) => {
    const people = key === 'enteredBy' ? creators : correctors
    return washSelectionValues(raw).map((id) => people.find((person) => person.value === id)?.label || `User ${String(id).slice(0, 8)}`).join(', ')
  }
  const activeItems = ADVANCED_KEYS.filter((key) => active(value, key)).map((key) => {
    const raw = value[key]
    const shown = ['enteredBy', 'correctedBy'].includes(key)
      ? personLabel(key, raw)
      : SINGLE_LABELS[key]?.[raw] || washSelectionValues(raw).join(', ') || raw
    return { key, label: LABELS[key], shown }
  })
  const anyActive = advancedCount > 0 || !!value.search || (value.status && value.status !== 'all')

  return (
    <div className="space-y-2" data-testid="wash-filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-0 sm:min-w-64">
          <span className="sr-only">Search washing records</span>
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <input aria-label="Search washing records" className="input w-full ps-9" placeholder="Search asset, registration, recorder, washer or site" value={value.search || ''} onChange={(event) => set('search', event.target.value)} />
        </label>
        <button type="button" onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters} className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-1.5 ${showFilters || advancedCount > 0 ? 'bg-[var(--input-bg)] text-[var(--text-primary)] border-[var(--input-border)]' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
          Filters{advancedCount ? ` (${advancedCount})` : ''}<ChevronDown size={13} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>
        {anyActive && <button type="button" onClick={onClear} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 inline-flex items-center gap-1"><X size={12} /> Clear</button>}
        <span className="text-xs text-[var(--text-muted)] ms-auto whitespace-nowrap">{resultCount}{resultCount !== rows.length ? ` of ${rows.length}` : ''} shown</span>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Wash status filters">
        {[['all', 'All records'], ...statuses.map((status) => [status, status])].map(([id, label]) => (
          <button key={id} type="button" onClick={() => set('status', id)} aria-pressed={(value.status || 'all') === id} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${(value.status || 'all') === id ? 'ring-2 ring-white/20 border-blue-500 text-[var(--text-primary)] bg-blue-950/40' : 'border-[var(--input-border)] text-[var(--text-muted)] bg-[var(--surface-2)] hover:text-[var(--text-primary)]'}`}>
            {label} ({statusCounts[id] || 0})
          </button>
        ))}
      </div>

      {activeItems.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Active washing filters">
        {activeItems.map((item) => <button key={item.key} type="button" onClick={() => set(item.key, item.key === 'dateBasis' ? 'wash' : ['from', 'to'].includes(item.key) ? '' : 'all')} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"><span>{item.label}: {item.shown}</span><X size={10} aria-hidden="true" /></button>)}
      </div>}

      {showFilters && <div className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3 space-y-3">
        {quickRanges.length > 0 && <div className="flex flex-wrap gap-1.5">{quickRanges.map((range) => <button key={range.id} type="button" className="btn-secondary text-xs" onClick={() => onChange({ ...value, from: range.from, to: range.to })}>{range.label}</button>)}</div>}
        <div className="flex flex-wrap gap-2 items-end">
          {canUseFleetFields && regions.length > 0 && <MultiSelectFilter className="w-44" label="Region" allLabel="All regions" options={regions} value={washSelectionValues(value.region)} onChange={(next) => setMulti('region', next)} />}
          {sites.length > 1 && <MultiSelectFilter className="w-48" label="Site" allLabel="All sites" options={sites} value={washSelectionValues(value.site)} onChange={(next) => setMulti('site', next)} />}
          {areas.length > 1 && <MultiSelectFilter className="w-44" label="Area" allLabel="All areas" options={areas} value={washSelectionValues(value.area)} onChange={(next) => setMulti('area', next)} />}
          {washTypes.length > 1 && <MultiSelectFilter className="w-44" label="Wash type" allLabel="All wash types" options={washTypes} value={washSelectionValues(value.type)} onChange={(next) => setMulti('type', next)} />}
          {canUseFleetFields && vehicleTypes.length > 1 && <MultiSelectFilter className="w-48" label="Vehicle type" allLabel="All vehicle types" options={vehicleTypes} value={washSelectionValues(value.vehicleType)} onChange={(next) => setMulti('vehicleType', next)} />}
          {creators.length > 0 && <MultiSelectFilter className="w-48" label="Entered by" allLabel="All recorders" pluralLabel="recorders" options={creators} value={washSelectionValues(value.enteredBy)} onChange={(next) => setMulti('enteredBy', next)} />}
          {washers.length > 1 && <MultiSelectFilter className="w-44" label="Washed by" allLabel="All wash operators" options={washers} value={washSelectionValues(value.washedBy)} onChange={(next) => setMulti('washedBy', next)} />}
          {bays.length > 1 && <MultiSelectFilter className="w-40" label="Wash bay" allLabel="All bays" options={bays} value={washSelectionValues(value.bay)} onChange={(next) => setMulti('bay', next)} />}
          {correctors.length > 0 && <MultiSelectFilter className="w-48" label="Corrected by" allLabel="All correction users" options={correctors} value={washSelectionValues(value.correctedBy)} onChange={(next) => setMulti('correctedBy', next)} />}
          <SelectFilter name="photos" label="Photos" value={value.photos} onChange={set} options={Object.entries(SINGLE_LABELS.photos)} />
          <SelectFilter name="chemicals" label="Chemicals" value={value.chemicals} onChange={set} options={Object.entries(SINGLE_LABELS.chemicals)} />
          <SelectFilter name="corrections" label="Corrections" value={value.corrections} onChange={set} options={Object.entries(SINGLE_LABELS.corrections)} />
          <SelectFilter name="dateBasis" label="Date basis" value={value.dateBasis || 'wash'} onChange={set} options={Object.entries(SINGLE_LABELS.dateBasis)} />
          <div className="text-xs text-[var(--text-muted)] space-y-1 w-40"><span>From</span><DateField className="text-sm" value={value.from || ''} onChange={(next) => set('from', next)} placeholder="From date" ariaLabel="Wash filter from date" /></div>
          <div className="text-xs text-[var(--text-muted)] space-y-1 w-40"><span>To</span><DateField className="text-sm" value={value.to || ''} onChange={(next) => set('to', next)} placeholder="To date" ariaLabel="Wash filter to date" min={value.from || undefined} /></div>
          {userId && <button type="button" className="btn-secondary text-xs" onClick={() => setMulti('enteredBy', [userId])}>My entries</button>}
        </div>
        <div className="flex flex-wrap gap-2 items-center border-t border-[var(--border-dim)] pt-3">
          <input aria-label="Saved view name" className="input min-w-48" maxLength={60} placeholder="Name this filter view" value={savedName} onChange={(event) => setSavedName(event.target.value)} />
          <button className="btn-secondary text-xs" type="button" disabled={!savedName.trim()} onClick={() => {
            try {
              const next = [...saved.filter((item) => item.name !== savedName.trim()), { name: savedName.trim(), filters: value }].slice(-20)
              localStorage.setItem(storageKey, JSON.stringify(next)); setRevision((current) => current + 1); setMessage('Filter view saved for this account and scope.')
            } catch { setMessage('Could not save this view on this browser.') }
          }}>Save view</button>
          {saved.length > 0 && <select aria-label="Load saved wash view" className="input" value="" onChange={(event) => { const selected = saved.find((item) => item.name === event.target.value); if (selected?.filters) onChange({ ...value, ...selected.filters }) }}><option value="">Load saved view</option>{saved.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>}
        </div>
        {message && <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>}
      </div>}
    </div>
  )
}
