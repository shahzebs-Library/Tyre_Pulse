import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Truck, Plus, Save, Trash2, Pencil, CheckCircle2, Power, AlertTriangle,
  Copy, LayoutTemplate, Layers, Activity, Bus, Car, Container, Forklift, Construction, PenTool, Gauge, Search,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAllPages } from '../../lib/fetchAll'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  normalizeDiagramConfig, positionsFromConfig, builtinToConfig, DEFAULT_DIAGRAM_CONFIG,
  AXLE_KINDS, AXLE_KIND_LABELS, BODY_STYLES, BODY_LABELS,
  AXLE_SPACINGS, AXLE_SPACING_LABELS, TYRE_SIZES, TYRE_SIZE_LABELS,
  HAZARD_SPEEDS, HAZARD_SPEED_LABELS, BUILTIN_TEMPLATE_TYPES,
  MAX_AXLES, MIN_AXLES, MAX_SPARES,
} from '../../lib/vehicleDiagram'
import {
  listVehicleDiagramConfigs, upsertVehicleDiagramConfig, deleteVehicleDiagramConfig,
  invalidateCustomLayouts, canonVehicleTypeKey,
} from '../../lib/api/vehicleDiagrams'
import { CustomDiagramPreview } from '../../components/VehicleDiagramCustomBody'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, SearchInput, Select, Toolbar, Segmented,
  LoadingState, EmptyState, ErrorState, Modal, Table, THead, Th, Tr, Td, ConfirmImpactDialog, ImpactBox,
} from '../components/ui'
import { countByType, vehicleCoverage, biggestGaps, positionsByType, wheelCheck } from './vehicleDesigner/coverage'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, TabPanel, fmtRelative } from './shared/pageKit'
import { namesFor } from '../../lib/api/consolePlatform'

const CUSTOM_TYPE = '__custom__'

// Deterministic sample pattern for the preview-only status simulation:
// a realistic mix of good / warning / critical wheels.
// Ceiling on the distinct-vehicle-type scan. Above the live fleet size
// (~1,617 assets) so today's read is complete.
const FLEET_TYPE_SCAN_CAP = 20000

const SIM_PATTERN = ['good', 'good', 'warning', 'good', 'critical', 'good', 'warning', 'good']

// Body styles as vector icons (the library's emoji render differently on every
// platform and cannot follow the theme).
const BODY_ICON = {
  truck: Truck, mixer: Construction, pump: Construction, bus: Bus,
  pickup: Car, trailer: Container, loader: Forklift, van: Car,
}
function BodyIcon({ body, size = 18, className = '' }) {
  const Icon = BODY_ICON[body] || Truck
  return <Icon size={size} className={className} aria-hidden="true" />
}
const TABS = ['designer', 'coverage']
const LIST_PAGE = 6
const DESIGN_SORTS = [
  { value: 'type', label: 'Vehicle type A-Z' },
  { value: 'tyres', label: 'Most tyres' },
  { value: 'status', label: 'Active first' },
]
const DESIGN_EXPORT = [
  { key: 'vehicle_type', header: 'Vehicle type' },
  { key: 'label', header: 'Label' },
  { key: 'tyres', header: 'Tyres', value: (r) => positionsFromConfig(r.config).tyres.length },
  { key: 'axles', header: 'Axles', value: (r) => normalizeDiagramConfig(r.config).axles.length },
  { key: 'body', header: 'Body style', value: (r) => BODY_LABELS[normalizeDiagramConfig(r.config).body] || '' },
  { key: 'active', header: 'Active', value: (r) => (r.active === false ? 'No' : 'Yes') },
]
const COVERAGE_EXPORT = [
  { key: 'vehicle_type', header: 'Vehicle type' },
  { key: 'vehicles', header: 'Vehicles' },
  { key: 'state', header: 'Diagram' },
  { key: 'tyres', header: 'Tyres' },
  { key: 'seen', header: 'Positions in tyre records' },
]
/** What makes a draft different from what was loaded: used for the unsaved guard. */
function snap(d) {
  return JSON.stringify({ t: canonVehicleTypeKey(d.vehicle_type), l: d.label || '', a: d.active !== false, c: d.config })
}

/** Audit is best effort: a logging failure must never undo or hide a real save. */
async function audit(logAction, ...args) {
  try { await logAction(...args) } catch { /* non-fatal */ }
}

// One chip style for every on/off choice in the builder, in the console's
// gray and orange families so it follows the light theme.
function chip(on, extra = '') {
  return `rounded-lg border transition-colors ${on
    ? 'border-orange-600/60 bg-orange-950/20 text-orange-300 font-semibold'
    : 'border-gray-800 text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'} ${extra}`
}
const FIELD = 'rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-sm px-2.5 py-2 placeholder-gray-500 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-60'
const MINI_SELECT = 'rounded bg-gray-900 border border-gray-800 text-gray-300 text-[11px] px-1.5 py-1 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-40'
const LABEL = 'text-xs font-semibold text-gray-300'

function freshDraft() {
  return {
    id: null,
    vehicle_type: '',
    typeMode: CUSTOM_TYPE,
    label: '',
    active: true,
    config: normalizeDiagramConfig(DEFAULT_DIAGRAM_CONFIG),
  }
}

/** Super-admin Vehicle Designer: build per-vehicle-type diagram layouts
 *  (axles with lift/spacing/tyre size, dual/single wheels, spares, body style,
 *  animated accents) with a live SVG preview, built-in templates, fleet
 *  coverage view and bulk assignment. Active layouts replace the app's
 *  built-in tyre diagrams for that vehicle type; built-ins stay the fallback.
 *  Table: V268. */
export default function ConsoleVehicleDesigner({ tabParam = 'tab' } = {}) {
  const { logAction } = useConsoleAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [fleetTypes, setFleetTypes] = useState([])
  const [fleetCounts, setFleetCounts] = useState({})
  const [seen, setSeen] = useState({ state: 'idle', map: {} })
  const [offTarget, setOffTarget] = useState(null)
  const [bulkReason, setBulkReason] = useState('')
  const [authors, setAuthors] = useState({})
  const [fleetState, setFleetState] = useState('loading') // loading | ok | error
  const [readAt, setReadAt] = useState(null)
  const [tab, setTab] = useUrlTab(TABS, 'designer', tabParam)
  const [listSort, setListSort] = useState('type')
  const [pendingSwitch, setPendingSwitch] = useState(null)
  const [query, setQuery] = useState('')

  const [draft, setDraft] = useState(freshDraft)
  const [baseline, setBaseline] = useState(() => snap(freshDraft()))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [simulate, setSimulate] = useState(false)
  const [togglingId, setTogglingId] = useState(null)

  // Bulk assign ("Apply to more types") modal state.
  const [bulkRow, setBulkRow] = useState(null)
  const [bulkSelected, setBulkSelected] = useState([])
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [bulkDone, setBulkDone] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setListError('')
    try {
      const data = await listVehicleDiagramConfigs()
      setRows(data)
      namesFor((data || []).map((r) => r.created_by)).then(setAuthors).catch(() => setAuthors({}))
      setReadAt(Date.now())
    } catch (e) {
      setListError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Distinct fleet vehicle types feed the type picker + coverage panel
  // (canonical UPPER, V245).
  const loadFleet = useCallback(async (isAlive = () => true) => {
    setFleetState('loading')
    {
      try {
        // PAGED with an explicit order. The old `.limit(3000)` returned 1000
        // rows (the server caps every response at 1000) and carried no ORDER
        // BY, so which 1000 came back was arbitrary: a vehicle type used only
        // by assets outside that slice was absent from the picker, and the
        // "types with no design" coverage panel below claimed completeness
        // while being wrong. `id` is the paging tiebreak.
        const { data, error } = await fetchAllPages(
          (from, to) => supabase
            .from('vehicle_fleet')
            .select('vehicle_type')
            .not('vehicle_type', 'is', null)
            .order('vehicle_type').order('id')
            .range(from, to),
          { max: FLEET_TYPE_SCAN_CAP },
        )
        if (!isAlive()) return
        if (error) { setFleetState('error'); return }
        const counts = countByType(data || [], canonVehicleTypeKey)
        setFleetCounts(counts)
        setFleetTypes(Object.keys(counts).sort())
        setFleetState('ok')
      } catch {
        // The picker degrades to free text, but coverage must say it could not look.
        if (isAlive()) setFleetState('error')
      }
    }
  }, [])
  useEffect(() => {
    let alive = true
    loadFleet(() => alive)
    return () => { alive = false }
  }, [loadFleet])

  const layout = useMemo(() => positionsFromConfig(draft.config), [draft.config])

  // Preview-only status simulation: a deterministic good/warning/critical mix
  // in the app's real status palette. Never persisted.
  const simStatuses = useMemo(() => {
    if (!simulate) return null
    const map = {}
    layout.tyres.forEach((t, i) => { map[t.id] = SIM_PATTERN[i % SIM_PATTERN.length] })
    return map
  }, [simulate, layout])

  function patchConfig(patch) {
    setSaved(false)
    setDraft((d) => ({ ...d, config: normalizeDiagramConfig({ ...d.config, ...patch }) }))
  }
  function patchAxle(i, patch) {
    setSaved(false)
    setDraft((d) => {
      const axles = d.config.axles.map((a, j) => (j === i ? { ...a, ...patch } : a))
      return { ...d, config: normalizeDiagramConfig({ ...d.config, axles }) }
    })
  }
  function addAxle() {
    if (draft.config.axles.length >= MAX_AXLES) return
    patchConfig({ axles: [...draft.config.axles, { kind: 'drive', dual: true }] })
  }
  function removeAxle(i) {
    if (draft.config.axles.length <= MIN_AXLES) return
    patchConfig({ axles: draft.config.axles.filter((_, j) => j !== i) })
  }

  function loadDraft(next) {
    setDraft(next)
    setBaseline(snap(next))
  }
  const draftDirty = snap(draft) !== baseline
  /** Switching drafts discards unsaved work, so ask first. */
  function guard(fn) {
    if (draftDirty) setPendingSwitch(() => fn)
    else fn()
  }

  function startNew(vehicleType = '') {
    const vt = canonVehicleTypeKey(vehicleType)
    loadDraft({
      ...freshDraft(),
      vehicle_type: vt,
      typeMode: vt && fleetTypes.includes(vt) ? vt : CUSTOM_TYPE,
    })
    setFormError('')
    setSaved(false)
  }
  function startEdit(row) {
    loadDraft({
      id: row.id,
      vehicle_type: row.vehicle_type,
      typeMode: fleetTypes.includes(row.vehicle_type) ? row.vehicle_type : CUSTOM_TYPE,
      label: row.label || '',
      active: row.active !== false,
      config: normalizeDiagramConfig(row.config),
    })
    setFormError('')
    setSaved(false)
  }
  /** Duplicate a saved design into a fresh draft: same config, new type. */
  function startDuplicate(row) {
    loadDraft({
      ...freshDraft(),
      label: row.label || '',
      config: normalizeDiagramConfig(row.config),
    })
    setFormError('')
    setSaved(false)
  }
  /** Seed the current draft's config from a built-in layout template. */
  function applyTemplate(name) {
    if (!name) return
    setSaved(false)
    setFormError('')
    setDraft((d) => ({ ...d, config: builtinToConfig(name) }))
  }

  async function handleSave() {
    const vt = canonVehicleTypeKey(draft.vehicle_type)
    if (!vt) {
      setFormError('Choose or type a vehicle type first.')
      return
    }
    setSaving(true)
    setFormError('')
    setSaved(false)
    try {
      const savedRow = await upsertVehicleDiagramConfig({
        vehicle_type: vt,
        label: draft.label,
        config: draft.config,
        active: draft.active,
      })
      invalidateCustomLayouts()
      await audit(logAction, 'update_config', null, 'vehicle_diagram', { vehicle_type: vt, active: savedRow.active })
      setDraft((d) => {
        const next = { ...d, id: savedRow.id, vehicle_type: savedRow.vehicle_type }
        setBaseline(snap(next))
        return next
      })
      setSaved(true)
      await load()
    } catch (e) {
      setFormError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row, reason) {
    setListError('')
    setTogglingId(row.id)
    try {
      await upsertVehicleDiagramConfig({
        vehicle_type: row.vehicle_type,
        label: row.label || '',
        config: row.config,
        active: row.active === false,
      })
      invalidateCustomLayouts()
      await audit(logAction, 'update_config', null, 'vehicle_diagram', { vehicle_type: row.vehicle_type, active: row.active === false, reason: reason || null })
      await load()
    } catch (e) {
      setListError(toUserMessage(e))
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(reason) {
    if (!deleteTarget) return
    setDeleting(true)
    setListError('')
    try {
      await deleteVehicleDiagramConfig(deleteTarget.id)
      invalidateCustomLayouts()
      await audit(logAction, 'update_config', null, 'vehicle_diagram', { vehicle_type: deleteTarget.vehicle_type, deleted: true, reason: reason || null })
      if (draft.id === deleteTarget.id) startNew()
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setListError(toUserMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  function openBulk(row) {
    setBulkReason('')
    setBulkRow(row)
    setBulkSelected([])
    setBulkError('')
    setBulkDone(0)
  }
  function toggleBulkType(vt) {
    setBulkSelected((sel) => (sel.includes(vt) ? sel.filter((t) => t !== vt) : [...sel, vt]))
  }
  async function handleBulkApply() {
    if (!bulkRow || bulkSelected.length === 0) return
    setBulkSaving(true)
    setBulkError('')
    setBulkDone(0)
    let done = 0
    try {
      for (const vt of bulkSelected) {
        await upsertVehicleDiagramConfig({
          vehicle_type: vt,
          label: bulkRow.label || '',
          config: bulkRow.config,
          active: bulkRow.active !== false,
        })
        done += 1
        setBulkDone(done)
      }
      invalidateCustomLayouts()
      await audit(logAction, 'update_config', null, 'vehicle_diagram', {
        vehicle_type: bulkRow.vehicle_type, bulk_applied_to: bulkSelected, reason: bulkReason.trim() || null,
      })
      await load()
      setBulkRow(null)
    } catch (e) {
      setBulkError(`${toUserMessage(e)}${done > 0 ? ` (${done} of ${bulkSelected.length} types were saved before the error)` : ''}`)
    } finally {
      setBulkSaving(false)
    }
  }

  const typeOptions = useMemo(() => {
    const set = new Set(fleetTypes)
    const vt = canonVehicleTypeKey(draft.vehicle_type)
    if (vt) set.add(vt)
    return [...set].sort()
  }, [fleetTypes, draft.vehicle_type])

  const savedTypeSet = useMemo(
    () => new Set(rows.map((r) => canonVehicleTypeKey(r.vehicle_type))),
    [rows],
  )
  // Fleet types with NO custom design yet (coverage gaps).
  const missingTypes = useMemo(
    () => fleetTypes.filter((t) => !savedTypeSet.has(t)),
    [fleetTypes, savedTypeSet],
  )
  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.vehicle_type || '').toUpperCase().includes(q) ||
      String(r.label || '').toUpperCase().includes(q))
  }, [rows, query])

  // Bulk target options: every known type except the source design's own.
  const bulkOptions = useMemo(() => {
    if (!bulkRow) return []
    const set = new Set([...fleetTypes, ...rows.map((r) => canonVehicleTypeKey(r.vehicle_type))])
    set.delete(canonVehicleTypeKey(bulkRow.vehicle_type))
    return [...set].filter(Boolean).sort()
  }, [bulkRow, fleetTypes, rows])

  const activeCount = rows.filter((r) => r.active !== false).length

  function toggleAccent(key) {
    patchConfig({ accents: { ...draft.config.accents, [key]: !draft.config.accents[key] } })
  }

  const ACCENTS = [
    { key: 'hazard', label: 'Hazard lights', dot: '#fbbf24' },
    { key: 'beacon', label: 'Roof beacon', dot: '#f97316' },
    { key: 'headlights', label: 'Headlights', dot: '#bae6fd' },
    { key: 'workLight', label: 'Rear work light', dot: '#fde047' },
  ]

  const sortedRows = useMemo(() => {
    const list = filteredRows.slice()
    if (listSort === 'tyres') return list.sort((a, b) => positionsFromConfig(b.config).tyres.length - positionsFromConfig(a.config).tyres.length)
    if (listSort === 'status') return list.sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || String(a.vehicle_type).localeCompare(String(b.vehicle_type)))
    return list.sort((a, b) => String(a.vehicle_type).localeCompare(String(b.vehicle_type)))
  }, [filteredRows, listSort])
  const listPaged = usePaged(sortedRows, LIST_PAGE, `${query}|${listSort}`)

  // Coverage: every fleet type plus any designed type the fleet no longer has.
  const [covQuery, setCovQuery] = useState('')
  const [covFilter, setCovFilter] = useState('all')
  const coverageRows = useMemo(() => {
    const byType = new Map(rows.map((r) => [canonVehicleTypeKey(r.vehicle_type), r]))
    const types = new Set([...fleetTypes, ...byType.keys()])
    return [...types].filter(Boolean).map((t) => {
      const r = byType.get(t)
      const inFleet = fleetTypes.includes(t)
      const state = !r ? 'Built-in diagram' : r.active === false ? 'Custom (switched off)' : inFleet ? 'Custom design' : 'Custom, not in fleet'
      const tyres = r ? positionsFromConfig(r.config).tyres.length : null
      const seenN = seen.state === 'ok' ? (seen.map[t] ?? null) : null
      const check = seen.state === 'ok' ? wheelCheck(tyres, seenN) : { state: 'unknown', text: 'N/A' }
      return { vehicle_type: t, state, tyres, row: r || null, inFleet, vehicles: fleetCounts[t] ?? 0, seen: seenN ?? 'N/A', check }
    })
  }, [rows, fleetTypes, fleetCounts, seen])
  const designsCanon = useMemo(() => rows.map((r) => ({ vehicle_type: canonVehicleTypeKey(r.vehicle_type), active: r.active !== false })), [rows])
  const vCover = useMemo(() => vehicleCoverage(fleetCounts, designsCanon), [fleetCounts, designsCanon])
  const gaps = useMemo(() => biggestGaps(fleetCounts, designsCanon, 5), [fleetCounts, designsCanon])

  // On demand: distinct tyre positions recorded per vehicle type, to check
  // each design has a slot for every wheel the fleet actually reports.
  async function checkWheels() {
    setSeen({ state: 'loading', map: {} })
    try {
      const { data, error } = await fetchAllPages(
        (from, to) => supabase.from('tyre_records').select('vehicle_type,tyre_position')
          .not('vehicle_type', 'is', null).not('tyre_position', 'is', null)
          .order('id').range(from, to),
        { max: 30000 },
      )
      if (error) throw error
      setSeen({ state: 'ok', map: positionsByType(data || [], canonVehicleTypeKey) })
    } catch {
      setSeen({ state: 'error', map: {} })
    }
  }
  const orphanDesigns = coverageRows.filter((c) => c.row && !c.inFleet && fleetState === 'ok')
  const { sort: covSort, onSort: onCovSort } = useTableSort({ key: 'vehicles', dir: 'desc' })
  // The positions are in the database, so read them as soon as coverage opens.
  useEffect(() => {
    if (tab === 'coverage' && fleetState === 'ok' && seen.state === 'idle') checkWheels()
  }, [tab, fleetState, seen.state])
  const coverageShown = useMemo(() => {
    const byFilter = coverageRows.filter((c) => (
      covFilter === 'missing' ? !c.row : covFilter === 'custom' ? !!c.row : covFilter === 'orphan' ? (c.row && !c.inFleet) : true))
    return sortRows(searchRows(byFilter, covQuery, ['vehicle_type', 'state']), covSort)
  }, [coverageRows, covFilter, covQuery, covSort])
  const covPaged = usePaged(coverageShown, 20, `${covFilter}|${covQuery}|${covSort?.key}|${covSort?.dir}`)

  const attention = []
  if (!loading && !listError) {
    if (fleetState === 'ok' && missingTypes.length) {
      attention.push({ key: 'missing', tone: 'info', text: `${missingTypes.length} fleet vehicle ${missingTypes.length === 1 ? 'type uses' : 'types use'} the built-in diagram because no custom design exists.`, actionLabel: 'See coverage', onAction: () => { setCovFilter('missing'); setTab('coverage') } })
    }
    if (rows.length - activeCount > 0) {
      attention.push({ key: 'off', tone: 'info', text: `${rows.length - activeCount} saved ${rows.length - activeCount === 1 ? 'design is' : 'designs are'} switched off, so the app ignores ${rows.length - activeCount === 1 ? 'it' : 'them'}.`, actionLabel: 'Active first', onAction: () => { setListSort('status'); setTab('designer') } })
    }
    if (orphanDesigns.length) {
      attention.push({ key: 'orphan', tone: 'warning', text: `${orphanDesigns.length} ${orphanDesigns.length === 1 ? 'design is' : 'designs are'} for a vehicle type no asset in the register uses (possibly a typo).`, actionLabel: 'Show them', onAction: () => { setCovFilter('orphan'); setTab('coverage') } })
    }
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={Truck}
        title="Vehicle Designer"
        purpose="Design custom vehicle diagrams per vehicle type: axles (with lift, spacing and tyre size), dual or single wheels, spares, body style and animated accents. Active designs replace the built-in tyre diagrams across the app for that type."
        refreshedAt={readAt}
        onRefresh={() => { load(); loadFleet() }}
        refreshing={loading}
        actions={<Btn variant="primary" icon={Plus} onClick={() => guard(() => { startNew(); setTab('designer') })}>New design</Btn>}
      />

      <ErrorState message={listError} onRetry={load} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile label="Saved designs" value={loading || listError ? 'N/A' : rows.length}
          onClick={() => setTab('designer')} active={tab === 'designer'} />
        <StatTile label="Active" value={loading || listError ? 'N/A' : activeCount} tone="good"
          sub={loading || listError ? undefined : `${rows.length - activeCount} switched off`} />
        <StatTile label="Fleet vehicle types" value={fleetState === 'ok' ? fleetTypes.length : 'N/A'}
          sub={fleetState === 'ok' ? 'From the asset register' : fleetState === 'error' ? 'Could not read the register' : 'Reading the register'} />
        <StatTile label="Types with no design" value={fleetState === 'ok' ? missingTypes.length : 'N/A'}
          tone={fleetState === 'ok' && missingTypes.length ? 'warning' : 'good'} sub="Use the built-in diagram"
          onClick={() => { setCovFilter('missing'); setTab('coverage') }} active={tab === 'coverage' && covFilter === 'missing'} />
        <StatTile icon={Gauge} label="Vehicles on a custom design"
          value={fleetState === 'ok' && !loading && !listError ? (vCover.pct == null ? 'N/A' : `${vCover.pct}%`) : 'N/A'}
          sub={fleetState === 'ok' && !loading && !listError ? `${vCover.covered.toLocaleString('en-US')} of ${vCover.total.toLocaleString('en-US')} vehicles` : 'Needs the asset register'}
          tone={vCover.pct != null && vCover.pct < 50 ? 'warning' : 'default'}
          onClick={() => setTab('coverage')} />
      </div>

      {!listError && <AttentionList items={attention} clear={loading ? 'Checking...' : 'Every fleet vehicle type has an active custom design.'} />}

      <nav aria-label="Vehicle designer views" className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Vehicle designer views" value={tab} onChange={setTab} options={[
          { key: 'designer', label: <><PenTool size={13} aria-hidden="true" />Designer</>, count: loading || listError ? null : rows.length },
          { key: 'coverage', label: <><Layers size={13} aria-hidden="true" />Fleet coverage</>, count: fleetState === 'ok' ? missingTypes.length : null },
        ]} />
        {draftDirty && <Badge tone="warning">Unsaved design</Badge>}
      </nav>

      {tab === 'coverage' && (
        <TabPanel label="Fleet coverage">
          <Panel>
            <PanelHeader
              icon={Layers}
              title="Fleet coverage"
              subtitle={fleetState !== 'ok'
                ? 'Every vehicle type in the asset register and whether it has a custom diagram.'
                : missingTypes.length === 0
                  ? 'Every fleet vehicle type has a custom design.'
                  : `${missingTypes.length} fleet vehicle ${missingTypes.length === 1 ? 'type has' : 'types have'} no custom design yet (the app uses built-in diagrams for them). Start one from its row.`}
              actions={(
                <Toolbar>
                  <SearchInput value={covQuery} onChange={setCovQuery} placeholder="Search vehicle types" className="w-full sm:w-52" ariaLabel="Search vehicle types" />
                  <Select ariaLabel="Coverage filter" value={covFilter} onChange={setCovFilter} className="w-44" options={[
                    { value: 'all', label: 'Every type' },
                    { value: 'missing', label: 'No custom design' },
                    { value: 'custom', label: 'Has a custom design' },
                    { value: 'orphan', label: 'Designed, not in fleet' },
                  ]} />
                  <Btn icon={Search} onClick={checkWheels} busy={seen.state === 'loading'} disabled={fleetState !== 'ok'}
                    title="Read the tyre positions recorded for each vehicle type and compare with the design">
                    {seen.state === 'ok' ? 'Re-check wheel counts' : 'Check wheel counts'}
                  </Btn>
                  <ExportButtons rows={coverageShown} columns={COVERAGE_EXPORT} title="Vehicle Diagram Coverage" disabled={fleetState !== 'ok'} />
                </Toolbar>
              )}
            />
            {fleetState === 'loading' ? (
              <LoadingState label="Reading the asset register" rows={3} />
            ) : fleetState === 'error' ? (
              <EmptyState icon={AlertTriangle} title="The asset register could not be read"
                reason="Coverage cannot be shown, because we could not see which vehicle types the fleet has. The designer still works with a typed vehicle type."
                action={<Btn onClick={() => loadFleet()}>Retry</Btn>} />
            ) : coverageRows.length === 0 ? (
              <EmptyState icon={Truck} title="No vehicle types" reason="No asset in the register has a vehicle type yet." />
            ) : missingTypes.length === 0 && covFilter === 'missing' ? (
              <div className="py-4"><Badge tone="good" icon={CheckCircle2}>Fully covered</Badge></div>
            ) : coverageShown.length === 0 ? (
              <EmptyState title="No type matches" reason="Change the search or the filter." action={<Btn onClick={() => { setCovQuery(''); setCovFilter('all') }}>Show every type</Btn>} />
            ) : (
              <>
                <Table>
                  <THead>
                    <Th sortKey="vehicle_type" sort={covSort} onSort={onCovSort}>Vehicle type</Th>
                    <Th align="right" sortKey="vehicles" sort={covSort} onSort={onCovSort}>Vehicles</Th>
                    <Th sortKey="state" sort={covSort} onSort={onCovSort}>Diagram</Th>
                    <Th align="right" sortKey="tyres" sort={covSort} onSort={onCovSort}>Tyres</Th>
                    <Th>Wheel check</Th>
                    <Th align="right">Action</Th>
                  </THead>
                  <tbody>
                    {covPaged.rows.map((c) => (
                      <Tr key={c.vehicle_type}>
                        <Td><span className="text-gray-200 font-medium">{c.vehicle_type}</span></Td>
                        <Td align="right" className="tabular-nums">{c.vehicles.toLocaleString('en-US')}</Td>
                        <Td><Badge tone={!c.row ? 'quiet' : c.row.active === false ? 'warning' : c.inFleet ? 'good' : 'warning'}>{c.state}</Badge></Td>
                        <Td align="right">{c.tyres ?? 'Built-in'}</Td>
                        <Td>
                          {seen.state === 'ok'
                            ? <Badge tone={c.check.state === 'short' ? 'warning' : c.check.state === 'ok' ? 'good' : 'quiet'}
                                title={typeof c.seen === 'number' ? `${c.seen} distinct positions in tyre records` : 'No tyre records for this type'}>{c.check.text}</Badge>
                            : <span className="text-gray-500 text-[11px]">{seen.state === 'error' ? 'Could not read' : 'Not checked'}</span>}
                        </Td>
                        <Td align="right">
                          {c.row
                            ? <Btn size="xs" icon={Pencil} onClick={() => guard(() => { startEdit(c.row); setTab('designer') })}>Edit</Btn>
                            : <Btn size="xs" icon={Plus} onClick={() => guard(() => { startNew(c.vehicle_type); setTab('designer') })}>Start design</Btn>}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager paged={covPaged} label="vehicle types" />
              </>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'designer' && (
      <TabPanel label="Designer">
      {fleetState === 'ok' && !loading && !listError && gaps.length > 0 && (
        <Panel className="mb-4">
          <PanelHeader icon={Layers} title="Biggest gaps first"
            subtitle="Fleet vehicle types with no custom design, most vehicles first. Their inspections use the built-in diagram." />
          <div className="flex flex-wrap gap-2">
            {gaps.map((g) => (
              <Btn key={g.vehicle_type} size="xs" icon={Plus}
                onClick={() => guard(() => startNew(g.vehicle_type))}>
                {g.vehicle_type} ({g.vehicles.toLocaleString('en-US')} vehicles)
              </Btn>
            ))}
          </div>
        </Panel>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {/* ── Saved designs ─────────────────────────────────────────────────── */}
        <Panel>
          <PanelHeader title="Saved designs" subtitle={loading ? 'Loading' : `${filteredRows.length} of ${rows.length} shown`}
            actions={rows.length > 0 ? <ExportButtons rows={sortedRows} columns={DESIGN_EXPORT} title="Vehicle Diagram Designs" /> : null} />
          <div className="space-y-3">
            {rows.length > 0 && (
              <Toolbar>
                <SearchInput value={query} onChange={setQuery} placeholder="Search saved designs" className="flex-1 min-w-[8rem]" />
                <Select ariaLabel="Sort designs" value={listSort} onChange={setListSort} options={DESIGN_SORTS} className="w-36" />
              </Toolbar>
            )}

            {loading ? (
              <LoadingState label="Loading designs" rows={3} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Truck}
                title={listError ? 'Designs could not be loaded' : 'No custom designs yet'}
                reason={listError
                  ? 'The saved designs could not be read, so none are listed. Retry above.'
                  : 'The app is using its built-in diagrams. Create a design and save it for a vehicle type.'}
              />
            ) : filteredRows.length === 0 ? (
              <EmptyState title="No saved design matches" reason={`Nothing matches "${query.trim()}".`}
                action={<Btn onClick={() => setQuery('')}>Clear search</Btn>} />
            ) : (
              <div className="space-y-2">
                {listPaged.rows.map((row) => {
                  const count = positionsFromConfig(row.config).tyres.length
                  const editing = draft.id === row.id
                  const isActive = row.active !== false
                  return (
                    <div key={row.id}
                      className={`rounded-xl border p-3 transition-colors ${editing ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'}`}>
                      <div className="flex items-start gap-2">
                        <BodyIcon body={normalizeDiagramConfig(row.config).body} className="text-orange-400 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-100 truncate">{row.vehicle_type}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {row.label ? `${row.label} | ` : ''}{count} tyres | {(fleetCounts[canonVehicleTypeKey(row.vehicle_type)] ?? 0).toLocaleString('en-US')} vehicles
                          </p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {row.updated_at ? `Updated ${fmtRelative(row.updated_at)}` : 'Update time not stored'}
                            {row.created_by ? ` | created by ${authors[row.created_by] || 'unknown person'}` : ''}
                          </p>
                        </div>
                        {editing && <Badge tone="accent" icon={Pencil}>Editing</Badge>}
                        <Badge tone={isActive ? 'good' : 'quiet'}>{isActive ? 'Active' : 'Off'}</Badge>
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5 mt-2">
                        <Btn size="xs" icon={Pencil} onClick={() => guard(() => startEdit(row))}>Edit</Btn>
                        <Btn size="xs" icon={Copy} onClick={() => guard(() => startDuplicate(row))}
                          title="Copy this design into a new draft for another vehicle type">Duplicate</Btn>
                        <Btn size="xs" icon={Layers} onClick={() => openBulk(row)}
                          title="Save a copy of this design for several vehicle types">Apply to more types</Btn>
                        <Btn size="xs" icon={Power} onClick={() => (isActive ? setOffTarget(row) : toggleActive(row))} busy={togglingId === row.id}>
                          {isActive ? 'Deactivate' : 'Activate'}
                        </Btn>
                        <span className="ml-auto">
                          <Btn size="xs" variant="danger" icon={Trash2} onClick={() => setDeleteTarget(row)}
                            title="Delete this design">Delete</Btn>
                        </span>
                      </div>
                    </div>
                  )
                })}
                <Pager paged={listPaged} label="designs" />
              </div>
            )}
          </div>
        </Panel>

        {/* ── Builder ───────────────────────────────────────────────────────── */}
        <Panel className="xl:col-span-2">
          <PanelHeader
            title={draft.id ? `Edit design${draft.vehicle_type ? `: ${canonVehicleTypeKey(draft.vehicle_type)}` : ''}` : 'New design'}
            subtitle="Changes show in the live preview straight away. Nothing is stored until you save."
            actions={(
              <div className="inline-flex items-center gap-1.5">
                <LayoutTemplate size={12} className="text-gray-500" />
                {/* Start from a built-in layout template (resets to blank after use) */}
                <Select
                  value=""
                  onChange={(v) => { if (v) guard(() => applyTemplate(v)) }}
                  placeholder="Start from..."
                  options={BUILTIN_TEMPLATE_TYPES.map((t) => ({ value: t, label: t }))}
                  className="w-40"
                />
              </div>
            )}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Controls */}
            <div className="space-y-4">
              {/* Vehicle type */}
              <div className="space-y-1.5">
                <label className={LABEL} htmlFor="vd-type-mode">Vehicle type</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    id="vd-type-mode"
                    value={draft.typeMode}
                    onChange={(e) => {
                      const v = e.target.value
                      setSaved(false)
                      setDraft((d) => ({
                        ...d,
                        typeMode: v,
                        vehicle_type: v === CUSTOM_TYPE ? d.vehicle_type : v,
                      }))
                    }}
                    className={FIELD}>
                    <option value={CUSTOM_TYPE}>Type manually...</option>
                    {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="text"
                    aria-label="Vehicle type name"
                    value={draft.vehicle_type}
                    disabled={draft.typeMode !== CUSTOM_TYPE}
                    onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, vehicle_type: e.target.value })) }}
                    placeholder="e.g. TR-MIXER"
                    className={FIELD} />
                </div>
                <p className="text-[11px] text-gray-500">
                  Stored uppercase. One design per vehicle type; saving again replaces it.
                </p>
              </div>

              {/* Label */}
              <div className="space-y-1.5">
                <label className={LABEL} htmlFor="vd-label">Display label (optional)</label>
                <input
                  id="vd-label"
                  type="text"
                  value={draft.label}
                  onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, label: e.target.value })) }}
                  placeholder="e.g. Transit Mixer 8x4"
                  className={`w-full ${FIELD}`} />
              </div>

              {/* Axles */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={LABEL}>Axles ({draft.config.axles.length} of {MAX_AXLES})</span>
                  <Btn size="xs" icon={Plus} onClick={addAxle} disabled={draft.config.axles.length >= MAX_AXLES}>Add axle</Btn>
                </div>
                <div className="space-y-1.5">
                  {draft.config.axles.map((axle, i) => (
                    <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/50 px-2.5 py-1.5 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-gray-500 w-12 flex-shrink-0">Axle {i + 1}</span>
                        <select value={axle.kind} onChange={(e) => patchAxle(i, { kind: e.target.value })}
                          aria-label={`Axle ${i + 1} kind`} className={MINI_SELECT}>
                          {AXLE_KINDS.map((k) => <option key={k} value={k}>{AXLE_KIND_LABELS[k]}</option>)}
                        </select>
                        <div className="flex rounded-lg overflow-hidden border border-gray-800" role="group" aria-label={`Axle ${i + 1} wheels`}>
                          <button type="button" onClick={() => patchAxle(i, { dual: false })} aria-pressed={!axle.dual}
                            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 text-xs px-2 py-1 ${!axle.dual ? 'bg-orange-500/20 text-orange-300' : 'text-gray-400 hover:bg-gray-800/60'}`}>
                            Single
                          </button>
                          <button type="button" onClick={() => patchAxle(i, { dual: true })} aria-pressed={axle.dual}
                            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 text-xs px-2 py-1 ${axle.dual ? 'bg-orange-500/20 text-orange-300' : 'text-gray-400 hover:bg-gray-800/60'}`}>
                            Dual
                          </button>
                        </div>
                        <span className="text-[10px] text-gray-500">{axle.dual ? '4 tyres' : '2 tyres'}</span>
                        <button type="button" onClick={() => removeAxle(i)} disabled={draft.config.axles.length <= MIN_AXLES}
                          title="Remove axle" aria-label={`Remove axle ${i + 1}`}
                          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ml-auto text-gray-500 hover:text-red-400 disabled:opacity-30 p-0.5">
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="flex items-center flex-wrap gap-2 sm:pl-12">
                        <button type="button" onClick={() => patchAxle(i, { lift: !axle.lift })} aria-pressed={!!axle.lift}
                          title="Lifted axle: wheels render slightly smaller with a LIFT marker"
                          className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 text-[10px] px-2 py-0.5 rounded-full border ${axle.lift
                            ? 'border-orange-600/60 bg-orange-950/20 text-orange-300 font-semibold'
                            : 'border-gray-800 text-gray-500 hover:bg-gray-800/60'}`}>
                          Lifted
                        </button>
                        <label className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                          Spacing
                          <select value={axle.spacing} onChange={(e) => patchAxle(i, { spacing: e.target.value })}
                            disabled={i === 0}
                            title={i === 0 ? 'Spacing applies to the gap from the previous axle' : 'Gap to the previous axle'}
                            className={MINI_SELECT}>
                            {AXLE_SPACINGS.map((s) => <option key={s} value={s}>{AXLE_SPACING_LABELS[s]}</option>)}
                          </select>
                        </label>
                        <label className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                          Tyre size
                          <select value={axle.tyreSize} onChange={(e) => patchAxle(i, { tyreSize: e.target.value })}
                            className={MINI_SELECT}>
                            {TYRE_SIZES.map((s) => <option key={s} value={s}>{TYRE_SIZE_LABELS[s]}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Spares */}
              <div className="space-y-1.5">
                <span className={LABEL}>Spare tyres</span>
                <div className="flex gap-1.5" role="group" aria-label="Spare tyres">
                  {Array.from({ length: MAX_SPARES + 1 }, (_, n) => (
                    <button type="button" key={n} onClick={() => patchConfig({ spare: n })} aria-pressed={draft.config.spare === n}
                      className={chip(draft.config.spare === n, 'text-xs px-3 py-1.5')}>
                      {n === 0 ? 'None' : n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body style */}
              <div className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 space-y-1.5">
                <span className={LABEL}>Body style</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {BODY_STYLES.map((b) => {
                    const on = draft.config.body === b
                    return (
                      <button type="button" key={b} onClick={() => patchConfig({ body: b })} aria-pressed={on}
                        title={BODY_LABELS[b]}
                        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-lg border px-1 py-2 text-center transition-colors ${on
                          ? 'border-orange-600/60 bg-orange-950/20'
                          : 'border-gray-800 hover:border-gray-700 bg-gray-900/50'}`}>
                        <BodyIcon body={b} className={`mx-auto ${on ? 'text-orange-300' : 'text-gray-400'}`} />
                        <span className={`text-[10px] block mt-1 truncate ${on ? 'text-orange-300 font-semibold' : 'text-gray-400'}`}>
                          {BODY_LABELS[b]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Accents */}
              <div className="space-y-1.5">
                <span className={LABEL}>Accents</span>
                <div className="flex flex-wrap gap-1.5">
                  {ACCENTS.map((a) => (
                    <button type="button" key={a.key} onClick={() => toggleAccent(a.key)} aria-pressed={!!draft.config.accents[a.key]}
                      className={chip(!!draft.config.accents[a.key], 'text-xs px-3 py-1.5 inline-flex items-center gap-1.5')}>
                      <span className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-2 h-2 rounded-full inline-block" style={{ background: a.dot }} /> {a.label}
                    </button>
                  ))}
                </div>
                {draft.config.accents.hazard && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-gray-500">Hazard blink speed</span>
                    <div className="flex rounded-lg overflow-hidden border border-gray-800" role="group" aria-label="Hazard blink speed">
                      {HAZARD_SPEEDS.map((s) => {
                        const on = draft.config.accents.hazardSpeed === s
                        return (
                          <button type="button" key={s} aria-pressed={on}
                            onClick={() => patchConfig({ accents: { ...draft.config.accents, hazardSpeed: s } })}
                            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 text-[11px] px-2.5 py-1 ${on
                              ? 'bg-orange-500/20 text-orange-300 font-semibold'
                              : 'text-gray-400 hover:bg-gray-800/60'}`}>
                            {HAZARD_SPEED_LABELS[s]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-gray-500">
                  Hazard indicators blink (at the chosen speed) and the beacon pulses in the live diagram. Headlights
                  and the rear work light add static glows. A mixer body also gets a rotating drum. Animations switch
                  off automatically for users who prefer reduced motion.
                </p>
              </div>

              {/* Active + Save */}
              <div className="flex items-center gap-3 pt-3 border-t border-gray-800">
                <label className="inline-flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={draft.active}
                    onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, active: e.target.checked })) }}
                    className="accent-orange-500" />
                  Active (used by the app)
                </label>
                <span className="ml-auto">
                  <Btn variant="primary" size="md" icon={Save} onClick={handleSave} busy={saving}>Save design</Btn>
                </span>
              </div>

              <ErrorState message={formError} />
              {saved && (
                <Note icon={CheckCircle2} tone="accent">Design saved. The app uses it on the next diagram load.</Note>
              )}
            </div>

            {/* Live preview (pinned while the controls scroll) */}
            <div className="space-y-2 lg:sticky lg:top-4 self-start">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Live preview</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSimulate((v) => !v)} aria-pressed={simulate}
                    title="Preview only: colours the wheels with a sample of live tyre statuses (good / warning / critical). Never saved."
                    className={chip(simulate, 'text-[11px] px-2.5 py-1 inline-flex items-center gap-1')}>
                    <Activity size={11} /> Simulate tyre status
                  </button>
                  <Badge tone="quiet">{layout.tyres.length} tyres</Badge>
                </div>
              </div>
              {/* The canvas is deliberately dark in both themes: the diagram art and
                  its light wheel labels are drawn for a dark ground, exactly as before. */}
              <div className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-xl border border-gray-800 p-4 flex items-center justify-center overflow-auto"
                style={{ minHeight: 320, maxHeight: 560, background: '#020617' }}>
                <CustomDiagramPreview layout={layout} width={250} statuses={simStatuses} />
              </div>
              {simulate && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#22c55e' }} /> Good</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#f59e0b' }} /> Warning</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} /> Critical</span>
                  <span className="text-gray-500">Sample data, preview only</span>
                </div>
              )}
              <p className="text-[11px] text-gray-500">
                Exactly these wheel slots (same ids and position codes) are used by inspections and the vehicle tyre diagram.
              </p>
            </div>
          </div>
        </Panel>
      </div>
      </TabPanel>
      )}

      {/* Unsaved draft guard */}
      <Modal
        open={!!pendingSwitch}
        title="Discard the unsaved design?"
        subtitle="The draft in the builder has changes that are not saved."
        onClose={() => setPendingSwitch(null)}
        width="max-w-sm"
        footer={(
          <>
            <Btn onClick={() => setPendingSwitch(null)}>Keep editing</Btn>
            <Btn variant="danger" onClick={() => { const fn = pendingSwitch; setPendingSwitch(null); if (fn) fn() }}>Discard changes</Btn>
          </>
        )}
      >
        <p className="text-xs text-gray-300">Save the current design first if you want to keep it. Discarding cannot be undone.</p>
      </Modal>

      {/* Delete confirm */}
      <ConfirmImpactDialog open={!!deleteTarget} danger requireReason typedWord={deleteTarget ? canonVehicleTypeKey(deleteTarget.vehicle_type) : undefined}
        busy={deleting} title="Delete this design?" confirmLabel="Delete design"
        onCancel={() => setDeleteTarget(null)} onConfirm={({ reason }) => handleDelete(reason)}
        impact={deleteTarget ? {
          tone: 'danger',
          what: `The custom diagram for ${deleteTarget.vehicle_type} is deleted.`,
          change: 'Inspections and tyre diagrams for this type fall back to the built-in layout.',
          who: `${(fleetCounts[canonVehicleTypeKey(deleteTarget.vehicle_type)] ?? 0).toLocaleString('en-US')} vehicles of this type, on the web app and in reports.`,
          undo: 'No. Export the designs first if you may need it again; a deleted design must be rebuilt.',
        } : null} />

      <ConfirmImpactDialog open={!!offTarget} requireReason busy={togglingId != null}
        title="Switch this design off?" confirmLabel="Switch off"
        onCancel={() => setOffTarget(null)} onConfirm={async ({ reason }) => { const r = offTarget; setOffTarget(null); await toggleActive(r, reason) }}
        impact={offTarget ? {
          tone: 'warning',
          what: `The design for ${offTarget.vehicle_type} stays saved but the app stops using it.`,
          change: 'Diagrams for this type use the built-in layout until it is switched back on.',
          who: `${(fleetCounts[canonVehicleTypeKey(offTarget.vehicle_type)] ?? 0).toLocaleString('en-US')} vehicles of this type.`,
          undo: 'Yes. Activate it again from the saved designs list.',
        } : null} />

      {/* Bulk assign */}
      <Modal
        open={!!bulkRow}
        title={bulkRow ? `Apply "${bulkRow.vehicle_type}" to more types` : ''}
        subtitle="Saves a copy of this design for each selected vehicle type. A type that already has a design gets it replaced."
        onClose={() => { if (!bulkSaving) setBulkRow(null) }}
        width="max-w-md"
        footer={(
          <>
            {bulkSaving && (
              <span className="text-[11px] text-gray-500 mr-auto self-center">Saving {bulkDone} of {bulkSelected.length}...</span>
            )}
            <Btn onClick={() => setBulkRow(null)} disabled={bulkSaving}>Cancel</Btn>
            <Btn variant="primary" icon={Save} onClick={handleBulkApply} busy={bulkSaving}
              disabled={bulkSelected.length === 0 || (bulkSelected.some((vt) => savedTypeSet.has(vt)) && bulkReason.trim().length < 3)}>
              {`Apply to ${bulkSelected.length || 'selected'} ${bulkSelected.length === 1 ? 'type' : 'types'}`}
            </Btn>
          </>
        )}
      >
        <div className="space-y-3">
          {bulkSelected.length > 0 && (
            <ImpactBox tone={bulkSelected.some((vt) => savedTypeSet.has(vt)) ? 'warning' : 'info'}
              what={`${bulkSelected.length} ${bulkSelected.length === 1 ? 'type gets' : 'types get'} this design.`}
              change={`${bulkSelected.filter((vt) => savedTypeSet.has(vt)).length} existing ${bulkSelected.filter((vt) => savedTypeSet.has(vt)).length === 1 ? 'design is' : 'designs are'} replaced.`}
              who={`${bulkSelected.reduce((n, vt) => n + (fleetCounts[vt] || 0), 0).toLocaleString('en-US')} vehicles in the asset register.`}
              undo="A replaced design is not kept. Export the designs first if you may need them." />
          )}
          {bulkSelected.some((vt) => savedTypeSet.has(vt)) && (
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (required when replacing a design)</span>
              <input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} maxLength={500} aria-label="Reason for replacing designs"
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                placeholder="Why are you replacing these designs?" />
            </label>
          )}
          {bulkOptions.length === 0 ? (
            <EmptyState title="No other vehicle types" reason="No other vehicle types were found in the fleet or among saved designs." />
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>{bulkSelected.length} of {bulkOptions.length} selected</span>
                <button type="button" disabled={bulkSaving}
                  onClick={() => setBulkSelected(bulkSelected.length === bulkOptions.length ? [] : [...bulkOptions])}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 text-orange-300 hover:underline disabled:opacity-50">
                  {bulkSelected.length === bulkOptions.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50 p-2 grid grid-cols-2 gap-1">
                {bulkOptions.map((vt) => (
                  <label key={vt} className="inline-flex items-center gap-1.5 text-xs text-gray-300 px-1.5 py-1 rounded hover:bg-gray-800/60 cursor-pointer">
                    <input type="checkbox" checked={bulkSelected.includes(vt)}
                      onChange={() => toggleBulkType(vt)} disabled={bulkSaving}
                      className="accent-orange-500" />
                    <span className="truncate">{vt}</span>
                    <span className="text-[10px] text-gray-500 tabular-nums">{fleetCounts[vt] ?? 0}</span>
                    {savedTypeSet.has(vt) && <Badge tone="warning" title="This type already has a design; applying replaces it">replaces</Badge>}
                  </label>
                ))}
              </div>
            </>
          )}
          <ErrorState message={bulkError} />
        </div>
      </Modal>
    </div>
  )
}
