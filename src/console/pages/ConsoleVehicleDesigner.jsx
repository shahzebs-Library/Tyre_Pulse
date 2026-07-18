import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Truck, Plus, Save, Trash2, Pencil, CheckCircle, Power, RefreshCw, AlertTriangle,
  Copy, Search, LayoutTemplate, Layers, Activity, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  normalizeDiagramConfig, positionsFromConfig, builtinToConfig, DEFAULT_DIAGRAM_CONFIG,
  AXLE_KINDS, AXLE_KIND_LABELS, BODY_STYLES, BODY_LABELS, BODY_EMOJI,
  AXLE_SPACINGS, AXLE_SPACING_LABELS, TYRE_SIZES, TYRE_SIZE_LABELS,
  HAZARD_SPEEDS, HAZARD_SPEED_LABELS, BUILTIN_TEMPLATE_TYPES,
  MAX_AXLES, MIN_AXLES, MAX_SPARES,
} from '../../lib/vehicleDiagram'
import {
  listVehicleDiagramConfigs, upsertVehicleDiagramConfig, deleteVehicleDiagramConfig,
  invalidateCustomLayouts, canonVehicleTypeKey,
} from '../../lib/api/vehicleDiagrams'
import { CustomDiagramPreview } from '../../components/VehicleDiagramCustomBody'

const CUSTOM_TYPE = '__custom__'

// Deterministic sample pattern for the preview-only status simulation:
// a realistic mix of good / warning / critical wheels.
const SIM_PATTERN = ['good', 'good', 'warning', 'good', 'critical', 'good', 'warning', 'good']

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
export default function ConsoleVehicleDesigner() {
  const { logAction } = useConsoleAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [fleetTypes, setFleetTypes] = useState([])
  const [query, setQuery] = useState('')

  const [draft, setDraft] = useState(freshDraft)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [simulate, setSimulate] = useState(false)

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
    } catch (e) {
      setListError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Distinct fleet vehicle types feed the type picker + coverage panel
  // (canonical UPPER, V245).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('vehicle_fleet')
          .select('vehicle_type')
          .not('vehicle_type', 'is', null)
          .limit(3000)
        if (error || !alive) return
        const set = new Set()
        for (const r of data || []) {
          const vt = canonVehicleTypeKey(r.vehicle_type)
          if (vt) set.add(vt)
        }
        setFleetTypes([...set].sort())
      } catch { /* picker degrades to free text */ }
    })()
    return () => { alive = false }
  }, [])

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

  function startNew(vehicleType = '') {
    const vt = canonVehicleTypeKey(vehicleType)
    setDraft({
      ...freshDraft(),
      vehicle_type: vt,
      typeMode: vt && fleetTypes.includes(vt) ? vt : CUSTOM_TYPE,
    })
    setFormError('')
    setSaved(false)
  }
  function startEdit(row) {
    setDraft({
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
    setDraft({
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
      await logAction('update_config', null, 'vehicle_diagram', { vehicle_type: vt, active: savedRow.active })
      setDraft((d) => ({ ...d, id: savedRow.id, vehicle_type: savedRow.vehicle_type }))
      setSaved(true)
      await load()
    } catch (e) {
      setFormError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row) {
    setListError('')
    try {
      await upsertVehicleDiagramConfig({
        vehicle_type: row.vehicle_type,
        label: row.label || '',
        config: row.config,
        active: row.active === false,
      })
      invalidateCustomLayouts()
      await logAction('update_config', null, 'vehicle_diagram', { vehicle_type: row.vehicle_type, active: row.active === false })
      await load()
    } catch (e) {
      setListError(toUserMessage(e))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setListError('')
    try {
      await deleteVehicleDiagramConfig(deleteTarget.id)
      invalidateCustomLayouts()
      await logAction('update_config', null, 'vehicle_diagram', { vehicle_type: deleteTarget.vehicle_type, deleted: true })
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
      await logAction('update_config', null, 'vehicle_diagram', {
        vehicle_type: bulkRow.vehicle_type, bulk_applied_to: bulkSelected,
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Truck size={20} /> Vehicle Designer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Design custom vehicle diagrams per vehicle type: axles (with lift, spacing and tyre size), dual or single
            wheels, spares, body style and animated accents. Active designs replace the built-in tyre diagrams across
            the app for that type.
          </p>
        </div>
        <button onClick={() => startNew()}
          className="text-sm px-4 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 inline-flex items-center gap-1.5">
          <Plus size={14} /> New design
        </button>
      </div>

      {listError && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-sm px-4 py-2">{listError}</div>
      )}

      {/* ── Fleet coverage ─────────────────────────────────────────────────── */}
      {fleetTypes.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Layers size={13} /> Fleet coverage
          </p>
          {missingTypes.length === 0 ? (
            <p className="text-xs text-emerald-300 inline-flex items-center gap-1.5">
              <CheckCircle size={13} /> Every fleet vehicle type has a custom design.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-500">
                {missingTypes.length} fleet vehicle {missingTypes.length === 1 ? 'type has' : 'types have'} no custom
                design yet (the app uses built-in diagrams for them). Click a type to start a design for it.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missingTypes.map((t) => (
                  <button key={t} onClick={() => startNew(t)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:border-orange-500/60 hover:text-orange-300 hover:bg-orange-500/10 transition-colors">
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {/* ── Saved designs ─────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Saved designs</p>
            <button onClick={load} title="Refresh"
              className="text-slate-500 hover:text-slate-200 p-1 rounded"><RefreshCw size={13} /></button>
          </div>

          {rows.length > 0 && (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search saved designs..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 text-white text-xs pl-8 pr-2.5 py-2 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none" />
            </div>
          )}

          {loading ? (
            <div className="text-slate-400 text-sm py-8 text-center rounded-xl border border-slate-800 bg-slate-900/40">
              Loading designs...
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-center space-y-1">
              <p className="text-sm text-slate-300 font-medium">No custom designs yet</p>
              <p className="text-xs text-slate-500">
                The app is using its built-in diagrams. Create a design on the right and save it for a vehicle type.
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-center">
              <p className="text-xs text-slate-500">No saved design matches "{query.trim()}".</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRows.map((row) => {
                const count = positionsFromConfig(row.config).tyres.length
                const editing = draft.id === row.id
                return (
                  <div key={row.id}
                    className={`rounded-xl border p-3 transition-colors ${editing ? 'border-orange-500/60 bg-orange-950/20' : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg leading-none mt-0.5">{BODY_EMOJI[normalizeDiagramConfig(row.config).body]}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">{row.vehicle_type}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {row.label ? `${row.label} | ` : ''}{count} tyres
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${row.active !== false
                        ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50'
                        : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {row.active !== false ? 'ACTIVE' : 'OFF'}
                      </span>
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5 mt-2">
                      <button onClick={() => startEdit(row)}
                        className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1">
                        <Pencil size={11} /> Edit
                      </button>
                      <button onClick={() => startDuplicate(row)} title="Copy this design into a new draft for another vehicle type"
                        className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1">
                        <Copy size={11} /> Duplicate
                      </button>
                      <button onClick={() => openBulk(row)} title="Save a copy of this design for several vehicle types"
                        className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1">
                        <Layers size={11} /> Apply to more types
                      </button>
                      <button onClick={() => toggleActive(row)}
                        className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1">
                        <Power size={11} /> {row.active !== false ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => setDeleteTarget(row)}
                        className="text-xs px-2 py-1 rounded-lg border border-red-900/60 text-red-400 hover:bg-red-950/40 inline-flex items-center gap-1 ml-auto">
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Builder ───────────────────────────────────────────────────────── */}
        <div className="xl:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Controls */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {draft.id ? 'Edit design' : 'New design'}
                </p>
                {/* Start from a built-in layout template */}
                <div className="inline-flex items-center gap-1.5">
                  <LayoutTemplate size={12} className="text-slate-500" />
                  <select
                    value=""
                    onChange={(e) => { applyTemplate(e.target.value); e.target.value = '' }}
                    title="Replace the current axle/body setup with a built-in layout"
                    className="rounded-lg bg-slate-950 border border-slate-700 text-slate-300 text-xs px-2 py-1.5 focus:border-orange-500 focus:outline-none">
                    <option value="">Start from...</option>
                    {BUILTIN_TEMPLATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Vehicle type */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Vehicle type</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
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
                    className="rounded-lg bg-slate-950 border border-slate-700 text-white text-sm px-2.5 py-2 focus:border-orange-500 focus:outline-none">
                    <option value={CUSTOM_TYPE}>Type manually...</option>
                    {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="text"
                    value={draft.vehicle_type}
                    disabled={draft.typeMode !== CUSTOM_TYPE}
                    onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, vehicle_type: e.target.value })) }}
                    placeholder="e.g. TR-MIXER"
                    className="rounded-lg bg-slate-950 border border-slate-700 text-white text-sm px-2.5 py-2 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none disabled:opacity-60" />
                </div>
                <p className="text-[11px] text-slate-500">
                  Stored uppercase. One design per vehicle type; saving again replaces it.
                </p>
              </div>

              {/* Label */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Display label (optional)</label>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, label: e.target.value })) }}
                  placeholder="e.g. Transit Mixer 8x4"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 text-white text-sm px-2.5 py-2 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none" />
              </div>

              {/* Axles */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Axles ({draft.config.axles.length} of {MAX_AXLES})</label>
                  <button onClick={addAxle} disabled={draft.config.axles.length >= MAX_AXLES}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-40">
                    <Plus size={11} /> Add axle
                  </button>
                </div>
                <div className="space-y-1.5">
                  {draft.config.axles.map((axle, i) => (
                    <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 w-12 flex-shrink-0">Axle {i + 1}</span>
                        <select value={axle.kind} onChange={(e) => patchAxle(i, { kind: e.target.value })}
                          className="rounded bg-slate-900 border border-slate-700 text-white text-xs px-1.5 py-1 focus:border-orange-500 focus:outline-none">
                          {AXLE_KINDS.map((k) => <option key={k} value={k}>{AXLE_KIND_LABELS[k]}</option>)}
                        </select>
                        <div className="flex rounded-lg overflow-hidden border border-slate-700">
                          <button onClick={() => patchAxle(i, { dual: false })}
                            className={`text-xs px-2 py-1 ${!axle.dual ? 'bg-orange-500/20 text-orange-300' : 'text-slate-400 hover:bg-slate-800'}`}>
                            Single
                          </button>
                          <button onClick={() => patchAxle(i, { dual: true })}
                            className={`text-xs px-2 py-1 ${axle.dual ? 'bg-orange-500/20 text-orange-300' : 'text-slate-400 hover:bg-slate-800'}`}>
                            Dual
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-600">{axle.dual ? '4 tyres' : '2 tyres'}</span>
                        <button onClick={() => removeAxle(i)} disabled={draft.config.axles.length <= MIN_AXLES}
                          title="Remove axle"
                          className="ml-auto text-slate-600 hover:text-red-400 disabled:opacity-30 p-0.5">
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center flex-wrap gap-2 pl-12">
                        <button onClick={() => patchAxle(i, { lift: !axle.lift })}
                          title="Lifted axle: wheels render slightly smaller with a LIFT marker"
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${axle.lift
                            ? 'border-orange-500/60 bg-orange-500/15 text-orange-300 font-semibold'
                            : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}>
                          Lifted
                        </button>
                        <label className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                          Spacing
                          <select value={axle.spacing} onChange={(e) => patchAxle(i, { spacing: e.target.value })}
                            disabled={i === 0}
                            title={i === 0 ? 'Spacing applies to the gap from the previous axle' : 'Gap to the previous axle'}
                            className="rounded bg-slate-900 border border-slate-700 text-slate-300 text-[10px] px-1 py-0.5 focus:border-orange-500 focus:outline-none disabled:opacity-40">
                            {AXLE_SPACINGS.map((s) => <option key={s} value={s}>{AXLE_SPACING_LABELS[s]}</option>)}
                          </select>
                        </label>
                        <label className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                          Tyre size
                          <select value={axle.tyreSize} onChange={(e) => patchAxle(i, { tyreSize: e.target.value })}
                            className="rounded bg-slate-900 border border-slate-700 text-slate-300 text-[10px] px-1 py-0.5 focus:border-orange-500 focus:outline-none">
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
                <label className="text-xs font-semibold text-slate-300">Spare tyres</label>
                <div className="flex gap-1.5">
                  {Array.from({ length: MAX_SPARES + 1 }, (_, n) => (
                    <button key={n} onClick={() => patchConfig({ spare: n })}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${draft.config.spare === n
                        ? 'border-orange-500/60 bg-orange-500/15 text-orange-300 font-semibold'
                        : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                      {n === 0 ? 'None' : n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body style */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Body style</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {BODY_STYLES.map((b) => (
                    <button key={b} onClick={() => patchConfig({ body: b })}
                      title={BODY_LABELS[b]}
                      className={`rounded-lg border px-1 py-2 text-center transition-colors ${draft.config.body === b
                        ? 'border-orange-500/60 bg-orange-500/15'
                        : 'border-slate-700 hover:border-slate-500 bg-slate-950/60'}`}>
                      <span className="text-lg block leading-none">{BODY_EMOJI[b]}</span>
                      <span className={`text-[10px] block mt-1 truncate ${draft.config.body === b ? 'text-orange-300 font-semibold' : 'text-slate-400'}`}>
                        {BODY_LABELS[b]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Accents */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Accents</label>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => patchConfig({ accents: { ...draft.config.accents, hazard: !draft.config.accents.hazard } })}
                    className={`text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${draft.config.accents.hazard
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 font-semibold'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Hazard lights
                  </button>
                  <button onClick={() => patchConfig({ accents: { ...draft.config.accents, beacon: !draft.config.accents.beacon } })}
                    className={`text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${draft.config.accents.beacon
                      ? 'border-orange-500/60 bg-orange-500/15 text-orange-300 font-semibold'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                    <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Roof beacon
                  </button>
                  <button onClick={() => patchConfig({ accents: { ...draft.config.accents, headlights: !draft.config.accents.headlights } })}
                    className={`text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${draft.config.accents.headlights
                      ? 'border-sky-500/60 bg-sky-500/15 text-sky-300 font-semibold'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                    <span className="w-2 h-2 rounded-full bg-sky-200 inline-block" /> Headlights
                  </button>
                  <button onClick={() => patchConfig({ accents: { ...draft.config.accents, workLight: !draft.config.accents.workLight } })}
                    className={`text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${draft.config.accents.workLight
                      ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-300 font-semibold'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                    <span className="w-2 h-2 rounded-full bg-yellow-300 inline-block" /> Rear work light
                  </button>
                </div>
                {draft.config.accents.hazard && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-500">Hazard blink speed</span>
                    <div className="flex rounded-lg overflow-hidden border border-slate-700">
                      {HAZARD_SPEEDS.map((s) => (
                        <button key={s}
                          onClick={() => patchConfig({ accents: { ...draft.config.accents, hazardSpeed: s } })}
                          className={`text-[11px] px-2.5 py-1 ${draft.config.accents.hazardSpeed === s
                            ? 'bg-amber-500/20 text-amber-300 font-semibold'
                            : 'text-slate-400 hover:bg-slate-800'}`}>
                          {HAZARD_SPEED_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-slate-500">
                  Hazard indicators blink (at the chosen speed) and the beacon pulses in the live diagram. Headlights
                  and the rear work light add static glows. A mixer body also gets a rotating drum. Animations switch
                  off automatically for users who prefer reduced motion.
                </p>
              </div>

              {/* Active + Save */}
              <div className="flex items-center gap-3 pt-1 border-t border-slate-800">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer mt-3">
                  <input type="checkbox" checked={draft.active}
                    onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, active: e.target.checked })) }}
                    className="accent-orange-500" />
                  Active (used by the app)
                </label>
                <button onClick={handleSave} disabled={saving}
                  className="ml-auto mt-3 text-sm px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Save size={14} /> {saving ? 'Saving...' : 'Save design'}
                </button>
              </div>

              {formError && (
                <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-sm px-3 py-2">{formError}</div>
              )}
              {saved && (
                <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 text-emerald-300 text-sm px-3 py-2 inline-flex items-center gap-2">
                  <CheckCircle size={15} /> Design saved. The app uses it on the next diagram load.
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSimulate((v) => !v)}
                    title="Preview only: colours the wheels with a sample of live tyre statuses (good / warning / critical). Never saved."
                    className={`text-[11px] px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 ${simulate
                      ? 'border-orange-500/60 bg-orange-500/15 text-orange-300 font-semibold'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                    <Activity size={11} /> Simulate tyre status
                  </button>
                  <span className="text-[11px] text-slate-500">{layout.tyres.length} tyres</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex items-center justify-center overflow-auto"
                style={{ minHeight: 320, maxHeight: 560 }}>
                <CustomDiagramPreview layout={layout} width={250} statuses={simStatuses} />
              </div>
              {simulate && (
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#22c55e' }} /> Good</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#f59e0b' }} /> Warning</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} /> Critical</span>
                  <span className="text-slate-600">Sample data, preview only</span>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Exactly these wheel slots (same ids and position codes) are used by inspections and the vehicle tyre diagram.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 max-w-sm w-full space-y-3">
            <p className="text-sm font-bold text-white flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-400" /> Delete this design?
            </p>
            <p className="text-xs text-slate-400">
              The custom diagram for <span className="text-white font-semibold">{deleteTarget.vehicle_type}</span> will
              be removed and the app falls back to its built-in layout for that type.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Trash2 size={12} /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk assign */}
      {bulkRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 max-w-md w-full space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-white flex items-center gap-2">
                <Layers size={16} className="text-orange-400" /> Apply "{bulkRow.vehicle_type}" to more types
              </p>
              <button onClick={() => setBulkRow(null)} disabled={bulkSaving}
                className="text-slate-500 hover:text-slate-200 p-0.5 rounded"><X size={15} /></button>
            </div>
            <p className="text-xs text-slate-400">
              Saves a copy of this design for each selected vehicle type. A type that already has a design gets it
              replaced.
            </p>
            {bulkOptions.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center rounded-lg border border-slate-800 bg-slate-950/60">
                No other vehicle types found in the fleet.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2 grid grid-cols-2 gap-1">
                {bulkOptions.map((vt) => (
                  <label key={vt} className="inline-flex items-center gap-1.5 text-xs text-slate-300 px-1.5 py-1 rounded hover:bg-slate-800 cursor-pointer">
                    <input type="checkbox" checked={bulkSelected.includes(vt)}
                      onChange={() => toggleBulkType(vt)} disabled={bulkSaving}
                      className="accent-orange-500" />
                    <span className="truncate">{vt}</span>
                  </label>
                ))}
              </div>
            )}
            {bulkError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-xs px-3 py-2">{bulkError}</div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              {bulkSaving && (
                <span className="text-[11px] text-slate-500 mr-auto">Saving {bulkDone} of {bulkSelected.length}...</span>
              )}
              <button onClick={() => setBulkRow(null)} disabled={bulkSaving}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={handleBulkApply} disabled={bulkSaving || bulkSelected.length === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Save size={12} /> {bulkSaving ? 'Applying...' : `Apply to ${bulkSelected.length || 'selected'} ${bulkSelected.length === 1 ? 'type' : 'types'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
