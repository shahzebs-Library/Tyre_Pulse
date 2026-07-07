import { useState, useEffect, useCallback } from 'react'
import {
  GitBranch, Plus, Edit2, Trash2, X, Save, Loader2, Search,
  ToggleLeft, ToggleRight, XCircle, ChevronRight, ArrowUp, ArrowDown,
  Zap, Layers, Clock, Filter,
} from 'lucide-react'
import * as workflows from '../lib/api/workflows'

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_SUGGESTIONS = ['accident', 'work_order', 'purchase_order', 'import_batch']

const TRIGGER_EVENTS = [
  'inspection.completed',
  'tyre.installed',
  'accident.reported',
  'workorder.created',
  'purchase.order_created',
  'stock.movement',
  'threshold.triggered',
]

const APPROVER_ROLES = [
  { value: 'admin',    label: 'Admin' },
  { value: 'manager',  label: 'Manager' },
  { value: 'director', label: 'Director' },
]

const MAX_STEPS = 10

const ROLE_BADGE = {
  admin:    'bg-red-500/15 text-red-300',
  manager:  'bg-orange-500/15 text-orange-300',
  director: 'bg-blue-500/15 text-blue-300',
}

function roleLabel(r) { return APPROVER_ROLES.find(x => x.value === r)?.label || r }

const EMPTY_STEP = { name: '', approver_role: 'manager', sla_hours: '' }

// ─── Definition card ──────────────────────────────────────────────────────────

function DefinitionCard({ def, onEdit, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const steps = Array.isArray(def.steps) ? def.steps : []

  async function handleDelete() {
    if (!window.confirm(`Delete workflow "${def.name}"? In-flight approvals keep their snapshot, but no new chains will start.`)) return
    setDeleting(true)
    await onDelete(def.id)
    setDeleting(false)
  }

  async function handleToggle() {
    setToggling(true)
    await onToggle(def.id, !def.active)
    setToggling(false)
  }

  return (
    <div className="relative bg-gray-800 rounded-xl border border-gray-700 border-l-4 border-l-orange-500 overflow-hidden hover:border-gray-600 transition-all">
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{def.name}</p>
            {def.description && <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{def.description}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-[11px]">
                <Layers className="w-3 h-3" /> {def.entity_type}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 text-[11px] font-mono">
                <Zap className="w-3 h-3" /> {def.trigger_event || 'manual'}
              </span>
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={def.active ? 'Deactivate' : 'Activate'}
            className="shrink-0 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {toggling
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : def.active
                ? <ToggleRight className="w-6 h-6 text-orange-500" />
                : <ToggleLeft className="w-6 h-6" />
            }
          </button>
        </div>

        {/* Steps preview */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {steps.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${ROLE_BADGE[s.approver_role] || 'bg-gray-700 text-gray-300'}`}>
                {i + 1}. {s.name || roleLabel(s.approver_role)}
                {s.sla_hours ? <span className="inline-flex items-center gap-0.5 text-[10px] opacity-75"><Clock className="w-2.5 h-2.5" />{s.sla_hours}h</span> : null}
              </span>
              {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-600" />}
            </span>
          ))}
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-700/60 flex items-center justify-between gap-2">
        <span className="text-gray-500 text-xs">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(def)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all" title="Edit">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50" title="Delete">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {!def.active && <div className="absolute inset-0 bg-gray-900/40 rounded-xl pointer-events-none" />}
    </div>
  )
}

// ─── Modal (create / edit) ────────────────────────────────────────────────────

function DefinitionModal({ mode, initial, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    description: initial?.description || '',
    entity_type: initial?.entity_type || '',
    trigger_event: initial?.trigger_event || '',
    active: initial?.active ?? true,
    steps: Array.isArray(initial?.steps) && initial.steps.length
      ? initial.steps.map(s => ({ name: s.name || '', approver_role: s.approver_role || 'manager', sla_hours: s.sla_hours ?? '' }))
      : [{ ...EMPTY_STEP }],
  }))
  const [errors, setErrors] = useState({})

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  function setStep(i, key, value) {
    setForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? { ...s, [key]: value } : s) }))
    setErrors(e => { const n = { ...e }; delete n.steps; return n })
  }

  function addStep() {
    if (form.steps.length >= MAX_STEPS) return
    setForm(f => ({ ...f, steps: [...f.steps, { ...EMPTY_STEP }] }))
  }

  function removeStep(i) {
    setForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))
  }

  function moveStep(i, dir) {
    setForm(f => {
      const steps = [...f.steps]
      const j = i + dir
      if (j < 0 || j >= steps.length) return f
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...f, steps }
    })
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!form.entity_type.trim()) e.entity_type = 'Entity type is required'
    if (form.steps.length === 0) e.steps = 'At least one approval step is required'
    else if (form.steps.some(s => !s.name.trim())) e.steps = 'Every step needs a name'
    else if (form.steps.some(s => s.sla_hours !== '' && (isNaN(Number(s.sla_hours)) || Number(s.sla_hours) <= 0))) e.steps = 'SLA hours must be a positive number'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      entity_type: form.entity_type.trim(),
      trigger_event: form.trigger_event.trim() || null,
      active: form.active,
      steps: form.steps.map(s => ({
        name: s.name.trim(),
        approver_role: s.approver_role,
        ...(s.sla_hours !== '' ? { sla_hours: Number(s.sla_hours) } : {}),
      })),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base">
            {mode === 'edit' ? 'Edit Workflow' : 'New Approval Workflow'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Workflow Name <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Accident closure approval"
                className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.name ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Description <span className="text-gray-600 font-normal normal-case">(optional)</span>
              </label>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                rows={2}
                placeholder="What this workflow approves and why"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none"
              />
            </div>

            {/* Entity + trigger */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Entity Type <span className="text-orange-500">*</span>
                </label>
                <input
                  type="text"
                  list="wf-entity-types"
                  value={form.entity_type}
                  onChange={e => set('entity_type', e.target.value)}
                  placeholder="e.g. accident"
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.entity_type ? 'border-red-500' : 'border-gray-700'}`}
                />
                <datalist id="wf-entity-types">
                  {ENTITY_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                </datalist>
                {errors.entity_type && <p className="text-red-400 text-xs mt-1">{errors.entity_type}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Trigger Event <span className="text-gray-600 font-normal normal-case">(blank = manual start)</span>
                </label>
                <input
                  type="text"
                  list="wf-trigger-events"
                  value={form.trigger_event}
                  onChange={e => set('trigger_event', e.target.value)}
                  placeholder="manual"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                />
                <datalist id="wf-trigger-events">
                  {TRIGGER_EVENTS.map(ev => <option key={ev} value={ev} />)}
                </datalist>
              </div>
            </div>

            {/* Steps builder */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Approval Steps <span className="text-orange-500">*</span>
                  <span className="text-gray-600 font-normal normal-case"> ({form.steps.length}/{MAX_STEPS})</span>
                </label>
                <button
                  type="button"
                  onClick={addStep}
                  disabled={form.steps.length >= MAX_STEPS}
                  className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add step
                </button>
              </div>
              <div className="space-y-2">
                {form.steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-gray-800 border border-gray-700">
                    <span className="mt-2.5 w-5 h-5 shrink-0 rounded-full bg-orange-500/20 text-orange-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr,140px,90px] gap-2">
                      <input
                        type="text"
                        value={s.name}
                        onChange={e => setStep(i, 'name', e.target.value)}
                        placeholder="Step name (e.g. Site manager review)"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                      />
                      <select
                        value={s.approver_role}
                        onChange={e => setStep(i, 'approver_role', e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
                        aria-label="Approver role"
                      >
                        {APPROVER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={s.sla_hours}
                        onChange={e => setStep(i, 'sla_hours', e.target.value)}
                        placeholder="SLA h"
                        title="SLA hours (optional)"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-1 rounded text-gray-500 hover:text-white disabled:opacity-30 transition-colors" title="Move up" aria-label="Move step up">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => moveStep(i, 1)} disabled={i === form.steps.length - 1} className="p-1 rounded text-gray-500 hover:text-white disabled:opacity-30 transition-colors" title="Move down" aria-label="Move step down">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => removeStep(i)} disabled={form.steps.length === 1} className="p-1 rounded text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors" title="Remove" aria-label="Remove step">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {errors.steps && <p className="text-red-400 text-xs mt-1.5">{errors.steps}</p>}
            </div>

            {/* Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-gray-800 border border-gray-700">
              <div>
                <p className="text-white text-sm font-medium">Workflow active</p>
                <p className="text-gray-500 text-xs">Inactive workflows never auto-start; in-flight instances continue</p>
              </div>
              <button type="button" onClick={() => set('active', !form.active)} className="transition-colors" aria-label="Toggle active">
                {form.active
                  ? <ToggleRight className="w-8 h-8 text-orange-500" />
                  : <ToggleLeft className="w-8 h-8 text-gray-500" />
                }
              </button>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-800 flex gap-3 justify-end bg-gray-900/80">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-all">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {mode === 'edit' ? 'Save Changes' : 'Create Workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowSettings() {
  const [definitions, setDefinitions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [modal, setModal]             = useState(null)   // null | { mode, initial }
  const [saving, setSaving]           = useState(false)
  const [search, setSearch]           = useState('')
  const [filterActive, setFilterActive] = useState('all')

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await workflows.listWorkflowDefinitions()
      setDefinitions(rows || [])
    } catch (err) { setError(err.message || 'Failed to load workflows') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const q = search.trim().toLowerCase()
  const visible = definitions.filter(d => {
    const matchSearch = !q
      || (d.name || '').toLowerCase().includes(q)
      || (d.entity_type || '').toLowerCase().includes(q)
      || (d.trigger_event || '').toLowerCase().includes(q)
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? d.active : !d.active)
    return matchSearch && matchActive
  })

  async function handleSave(values) {
    setSaving(true)
    setError(null)
    try {
      if (modal.mode === 'edit') await workflows.updateWorkflowDefinition(modal.initial.id, values)
      else await workflows.createWorkflowDefinition(values)
      setModal(null)
      fetch()
    } catch (err) { setError(err.message || 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      await workflows.deleteWorkflowDefinition(id)
      setDefinitions(prev => prev.filter(d => d.id !== id))
    } catch (err) { setError(err.message || 'Delete failed') }
  }

  async function handleToggle(id, active) {
    setError(null)
    try {
      await workflows.updateWorkflowDefinition(id, { active })
      setDefinitions(prev => prev.map(d => d.id === id ? { ...d, active } : d))
    } catch (err) { setError(err.message || 'Update failed') }
  }

  return (
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <GitBranch className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Approval Workflows</h1>
          </div>
          <p className="text-gray-400 text-sm ml-11">Multi-step approval chains triggered by domain events or started manually</p>
        </div>
        <button
          onClick={() => setModal({ mode: 'create', initial: null })}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>

      {/* ── Filters ── */}
      {definitions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search workflows..."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={filterActive}
            onChange={e => setFilterActive(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={fetch}
            className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 rounded-xl bg-gray-800 border border-gray-700 animate-pulse" />)}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && definitions.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-6">
          <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <GitBranch className="w-9 h-9 text-gray-500" />
          </div>
          <div className="text-center max-w-md">
            <p className="text-gray-300 text-lg font-medium">No approval workflows yet</p>
            <p className="text-gray-500 text-sm mt-1">
              Define multi-step chains (e.g. accident closure → manager → director) that start automatically from
              domain events or manually from records.
            </p>
            <button
              onClick={() => setModal({ mode: 'create', initial: null })}
              className="mt-4 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            >
              Create your first workflow <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && definitions.length > 0 && (
        visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Filter className="w-8 h-8 text-gray-600" />
            <p className="text-gray-400 text-sm">No workflows match your filters.</p>
            <button onClick={() => { setSearch(''); setFilterActive('all') }} className="text-orange-400 text-xs hover:text-orange-300 transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible.map(d => (
              <DefinitionCard
                key={d.id}
                def={d}
                onEdit={def => setModal({ mode: 'edit', initial: def })}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )
      )}

      {/* ── Modal ── */}
      {modal && (
        <DefinitionModal
          mode={modal.mode}
          initial={modal.initial}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}
    </div>
  )
}
