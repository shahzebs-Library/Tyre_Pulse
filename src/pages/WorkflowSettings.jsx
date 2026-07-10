import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  GitBranch, Plus, Edit2, Trash2, X, Save, Loader2, Search,
  ToggleLeft, ToggleRight, XCircle, ChevronRight, ChevronDown,
  Zap, Layers, Clock, Filter, Copy, GripVertical, Sparkles,
  PenLine, Camera, MapPin, MessageSquare, CornerUpLeft, CircleDashed,
  Play, Flag, User, Users, AlertCircle, SlidersHorizontal,
} from 'lucide-react'
import * as workflows from '../lib/api/workflows'
import { STARTER_TEMPLATES } from '../lib/workflow/starterTemplates'

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  'inspection', 'work_order', 'tyre_change', 'accident', 'purchase_order',
  'warranty_claim', 'gate_pass', 'job_card', 'maintenance_request',
  'goods_received_note', 'tyre_issuance', 'tyre_return', 'tyre_transfer',
  'vehicle_handover', 'vehicle_return', 'asset_disposal', 'document_approval',
]

const TRIGGER_EVENTS = [
  'inspection.completed',
  'tyre.replacement_requested',
  'tyre.installed',
  'accident.reported',
  'workorder.created',
  'purchase.request_created',
  'purchase.order_created',
  'stock.movement',
  'threshold.triggered',
]

// Expanded approver role set (spec §4 / G1). Stored value === label to stay
// human-readable in the jsonb steps array and legible in downstream PDFs.
const APPROVER_ROLES = [
  'Admin', 'Manager', 'Director', 'Tyre Man', 'Inspector', 'Store Keeper',
  'Fleet Supervisor', 'Workshop Manager', 'Procurement', 'Finance', 'GM',
  'Operations Manager',
]

const CONDITION_OPS = [
  { value: '=',  label: '= equals' },
  { value: '!=', label: '≠ not equal' },
  { value: '>',  label: '> greater than' },
  { value: '>=', label: '≥ at least' },
  { value: '<',  label: '< less than' },
  { value: '<=', label: '≤ at most' },
]

const CONDITION_FIELDS = [
  'replacement_cost', 'total_cost', 'downtime_hours', 'severity',
  'pressure_reading', 'tread_depth', 'cost_per_tyre', 'status',
]

const MAX_STEPS = 20

// Per-step requirement toggles → icon + label metadata (drives the editor
// toggle row and the live-preview icon strip).
const REQUIREMENTS = [
  { key: 'require_signature',         icon: PenLine,       label: 'Signature',         short: 'Sig' },
  { key: 'require_photo',             icon: Camera,        label: 'Photo',             short: 'Photo' },
  { key: 'require_gps',               icon: MapPin,        label: 'GPS',               short: 'GPS' },
  { key: 'require_comment_on_return', icon: MessageSquare, label: 'Comment on return', short: 'Comment' },
  { key: 'allow_return',              icon: CornerUpLeft,  label: 'Allow return',      short: 'Return' },
  { key: 'optional',                  icon: CircleDashed,  label: 'Optional step',     short: 'Optional' },
]

// Stable palette for role badges, hashed off the role name.
const ROLE_HUES = ['#f97316', '#3b82f6', '#a855f7', '#22c55e', '#eab308', '#ec4899', '#14b8a6', '#ef4444']
function roleHue(role) {
  let h = 0
  for (let i = 0; i < (role || '').length; i++) h = (h * 31 + role.charCodeAt(i)) >>> 0
  return ROLE_HUES[h % ROLE_HUES.length]
}

let stepKeySeq = 1
function newStepKey() { return `step-${stepKeySeq++}` }

/** A schema-complete blank step for the editor. */
function makeEmptyStep() {
  return {
    _key: newStepKey(),
    name: '',
    assignee_type: 'role',
    approver_role: 'Manager',
    approver_user_id: '',
    sla_hours: '24',
    require_signature: false,
    require_photo: false,
    require_gps: false,
    require_comment_on_return: true,
    allow_return: true,
    optional: false,
    condition: null,
  }
}

/** Normalise a persisted/template step into editor shape (strings for inputs). */
function toEditorStep(s = {}) {
  return {
    _key: newStepKey(),
    name: s.name || '',
    assignee_type: s.assignee_type === 'user' ? 'user' : 'role',
    approver_role: s.approver_role || 'Manager',
    approver_user_id: s.approver_user_id ?? '',
    sla_hours: s.sla_hours != null && s.sla_hours !== '' ? String(s.sla_hours) : '',
    require_signature: !!s.require_signature,
    require_photo: !!s.require_photo,
    require_gps: !!s.require_gps,
    require_comment_on_return: s.require_comment_on_return !== false,
    allow_return: s.allow_return !== false,
    optional: !!s.optional,
    condition: s.condition && s.condition.field
      ? { field: s.condition.field, op: s.condition.op || '>', value: String(s.condition.value ?? '') }
      : null,
  }
}

/** Serialise an editor step into the jsonb payload persisted in `steps`. */
function toPayloadStep(s) {
  const out = {
    name: s.name.trim(),
    assignee_type: s.assignee_type,
    approver_role: s.approver_role,
    approver_user_id: s.assignee_type === 'user' ? (s.approver_user_id.trim() || null) : null,
    require_signature: !!s.require_signature,
    require_photo: !!s.require_photo,
    require_gps: !!s.require_gps,
    require_comment_on_return: !!s.require_comment_on_return,
    allow_return: !!s.allow_return,
    optional: !!s.optional,
    condition: null,
  }
  if (s.sla_hours !== '' && !isNaN(Number(s.sla_hours))) out.sla_hours = Number(s.sla_hours)
  if (s.condition && s.condition.field && s.condition.value !== '') {
    const num = Number(s.condition.value)
    out.condition = {
      field: s.condition.field,
      op: s.condition.op,
      value: s.condition.value !== '' && !isNaN(num) ? num : s.condition.value,
    }
  }
  return out
}

function assigneeLabel(s) {
  if (s.assignee_type === 'user') return s.approver_user_id?.trim() ? `User ${s.approver_user_id}` : 'Specific user'
  return s.approver_role
}

// ─── Definition card ──────────────────────────────────────────────────────────

function DefinitionCard({ def, onEdit, onClone, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [cloning, setCloning] = useState(false)
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

  async function handleClone() {
    setCloning(true)
    await onClone(def)
    setCloning(false)
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
          {steps.map((s, i) => {
            const hue = roleHue(s.approver_role)
            return (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
                  style={{ backgroundColor: `${hue}26`, color: hue }}
                  title={s.name}
                >
                  {i + 1}. {s.name || assigneeLabel(s)}
                  {s.optional ? <CircleDashed className="w-2.5 h-2.5 opacity-70" /> : null}
                  {s.condition?.field ? <SlidersHorizontal className="w-2.5 h-2.5 opacity-70" /> : null}
                  {s.sla_hours ? <span className="inline-flex items-center gap-0.5 text-[10px] opacity-75"><Clock className="w-2.5 h-2.5" />{s.sla_hours}h</span> : null}
                </span>
                {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-600" />}
              </span>
            )
          })}
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-700/60 flex items-center justify-between gap-2">
        <span className="text-gray-500 text-xs">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <button onClick={handleClone} disabled={cloning} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all disabled:opacity-50" title="Clone">
            {cloning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
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

// ─── Step editor (one row in the vertical chain) ──────────────────────────────

function StepEditor({
  step, index, total, error,
  dragging, dropTarget,
  onChange, onRemove,
  onDragStart, onDragOver, onDrop, onDragEnd,
}) {
  const [open, setOpen] = useState(false)
  const hue = roleHue(step.assignee_type === 'role' ? step.approver_role : 'user')

  function set(key, value) { onChange({ ...step, [key]: value }) }
  function toggle(key) { onChange({ ...step, [key]: !step[key] }) }

  function setCondition(patch) {
    onChange({ ...step, condition: { ...(step.condition || { field: CONDITION_FIELDS[0], op: '>', value: '' }), ...patch } })
  }

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={e => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`rounded-xl border transition-all ${
        error ? 'border-red-500/60' : 'border-gray-700'
      } ${dragging ? 'opacity-40' : ''} ${
        dropTarget ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-gray-900' : ''
      } bg-gray-800`}
    >
      <div className="flex items-center gap-2 p-3">
        <span className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 shrink-0" title="Drag to reorder">
          <GripVertical className="w-4 h-4" />
        </span>
        <span
          className="w-6 h-6 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center"
          style={{ backgroundColor: `${hue}33`, color: hue }}
        >
          {index + 1}
        </span>
        <input
          type="text"
          value={step.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Step name (e.g. Inspector review)"
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="shrink-0 inline-flex items-center gap-1 text-gray-400 hover:text-white text-xs px-2 py-1.5 rounded-lg hover:bg-gray-700 transition-all"
          title="Edit details"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={total === 1}
          className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors"
          title={total === 1 ? 'A workflow needs at least one step' : 'Remove step'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Requirement chips row (always-visible summary) */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 pl-14">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
          style={{ backgroundColor: `${hue}26`, color: hue }}
        >
          {step.assignee_type === 'user' ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />}
          {assigneeLabel(step)}
        </span>
        {step.sla_hours ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-gray-700 text-gray-300">
            <Clock className="w-3 h-3" /> {step.sla_hours}h SLA
          </span>
        ) : null}
        {REQUIREMENTS.filter(r => step[r.key]).map(r => {
          const Icon = r.icon
          return (
            <span key={r.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-gray-700 text-gray-300" title={r.label}>
              <Icon className="w-3 h-3" /> {r.short}
            </span>
          )
        })}
        {step.condition?.field ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-purple-500/15 text-purple-300 font-mono">
            <SlidersHorizontal className="w-3 h-3" />
            {step.condition.field} {step.condition.op} {step.condition.value || '?'}
          </span>
        ) : null}
      </div>

      {/* Expanded detail editor */}
      {open && (
        <div className="border-t border-gray-700/60 p-3 pl-14 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Assignee type</label>
              <select
                value={step.assignee_type}
                onChange={e => set('assignee_type', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
              >
                <option value="role">Role</option>
                <option value="user">Specific user</option>
              </select>
            </div>
            {step.assignee_type === 'role' ? (
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Approver role</label>
                <select
                  value={step.approver_role}
                  onChange={e => set('approver_role', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
                >
                  {APPROVER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Approver user id</label>
                <input
                  type="text"
                  value={step.approver_user_id}
                  onChange={e => set('approver_user_id', e.target.value)}
                  placeholder="user uuid / id"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">SLA hours</label>
              <input
                type="number"
                min="1"
                step="1"
                value={step.sla_hours}
                onChange={e => set('sla_hours', e.target.value)}
                placeholder="e.g. 24"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Requirement toggles */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Requirements</label>
            <div className="flex flex-wrap gap-1.5">
              {REQUIREMENTS.map(r => {
                const Icon = r.icon
                const on = !!step[r.key]
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => toggle(r.key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      on
                        ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
                        : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Condition editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Condition <span className="text-gray-600 normal-case font-normal">(step runs only if true)</span>
              </label>
              {step.condition ? (
                <button type="button" onClick={() => set('condition', null)} className="text-gray-500 hover:text-red-400 text-[11px] transition-colors">
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => set('condition', { field: CONDITION_FIELDS[0], op: '>', value: '' })}
                  className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-[11px] font-semibold transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add condition
                </button>
              )}
            </div>
            {step.condition && (
              <div className="grid grid-cols-[1fr,90px,1fr] gap-2">
                <input
                  type="text"
                  list="wf-condition-fields"
                  value={step.condition.field}
                  onChange={e => setCondition({ field: e.target.value })}
                  placeholder="field"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <select
                  value={step.condition.op}
                  onChange={e => setCondition({ op: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-1 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
                >
                  {CONDITION_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="text"
                  value={step.condition.value}
                  onChange={e => setCondition({ value: e.target.value })}
                  placeholder="value (e.g. 5000)"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-xs px-3 pb-2 pl-14">{error}</p>}
    </div>
  )
}

// ─── Live preview chain ───────────────────────────────────────────────────────

function PreviewChain({ steps }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-green-400">
        <span className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center"><Play className="w-3 h-3" /></span>
        <span className="font-medium">Start</span>
      </div>
      {steps.map((s, i) => {
        const hue = roleHue(s.assignee_type === 'role' ? s.approver_role : 'user')
        return (
          <div key={s._key} className="pl-3">
            <div className="w-px h-3 bg-gray-700 ml-3" />
            <div className="flex items-start gap-2">
              <span className="w-6 h-6 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ backgroundColor: `${hue}33`, color: hue }}>{i + 1}</span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-white text-sm truncate">
                  {s.name || <span className="text-gray-600 italic">Unnamed step</span>}
                  {s.optional && <span className="ml-1.5 text-[10px] text-gray-500">(optional)</span>}
                </p>
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  <span className="text-[11px]" style={{ color: hue }}>{assigneeLabel(s)}</span>
                  {s.sla_hours ? <span className="text-[10px] text-gray-500 inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{s.sla_hours}h</span> : null}
                  {REQUIREMENTS.filter(r => s[r.key]).map(r => {
                    const Icon = r.icon
                    return <Icon key={r.key} className="w-3 h-3 text-gray-500" title={r.label} />
                  })}
                  {s.condition?.field ? (
                    <span className="text-[10px] text-purple-300 font-mono">if {s.condition.field} {s.condition.op} {s.condition.value || '?'}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div className="pl-3">
        <div className="w-px h-3 bg-gray-700 ml-3" />
        <div className="flex items-center gap-2 text-xs text-blue-400">
          <span className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center"><Flag className="w-3 h-3" /></span>
          <span className="font-medium">Complete</span>
        </div>
      </div>
    </div>
  )
}

// ─── Builder modal ────────────────────────────────────────────────────────────

function BuilderModal({ mode, initial, onSave, onClose, saving, error }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    description: initial?.description || '',
    entity_type: initial?.entity_type || '',
    trigger_event: initial?.trigger_event || '',
    active: initial?.active ?? true,
    steps: Array.isArray(initial?.steps) && initial.steps.length
      ? initial.steps.map(toEditorStep)
      : [makeEmptyStep()],
  }))
  const [errors, setErrors] = useState({})
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  function setStep(i, next) {
    setForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? next : s) }))
    setErrors(e => { const n = { ...e }; delete n.steps; delete n[`step-${i}`]; return n })
  }

  function addStep() {
    if (form.steps.length >= MAX_STEPS) return
    setForm(f => ({ ...f, steps: [...f.steps, makeEmptyStep()] }))
  }

  function removeStep(i) {
    setForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))
  }

  function loadTemplate(tpl) {
    setForm({
      name: tpl.name,
      description: `Starter template: ${tpl.name}`,
      entity_type: tpl.entity_type,
      trigger_event: tpl.trigger_event,
      active: true,
      steps: tpl.steps.map(toEditorStep),
    })
    setErrors({})
    setShowTemplates(false)
  }

  // ── Native HTML5 drag reorder ──
  function handleDragStart(e, i) {
    setDragIndex(i)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(i)) } catch { /* older browsers */ }
  }
  function handleDragOver(e, i) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (i !== overIndex) setOverIndex(i)
  }
  function handleDrop(e, i) {
    e.preventDefault()
    const from = dragIndex
    if (from == null || from === i) { setDragIndex(null); setOverIndex(null); return }
    setForm(f => {
      const steps = [...f.steps]
      const [moved] = steps.splice(from, 1)
      steps.splice(i, 0, moved)
      return { ...f, steps }
    })
    setDragIndex(null)
    setOverIndex(null)
  }
  function handleDragEnd() { setDragIndex(null); setOverIndex(null) }

  // ── Validation (mirrors server validate_workflow_steps) ──
  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!form.entity_type.trim()) e.entity_type = 'Entity type is required'
    if (form.steps.length === 0) {
      e.steps = 'At least one approval step is required'
    } else {
      form.steps.forEach((s, i) => {
        if (!s.name.trim()) e[`step-${i}`] = 'Step name is required'
        else if (s.assignee_type === 'role' && !s.approver_role.trim()) e[`step-${i}`] = 'A role is required'
        else if (s.assignee_type === 'user' && !s.approver_user_id.trim()) e[`step-${i}`] = 'A user id is required'
        else if (s.sla_hours !== '' && (isNaN(Number(s.sla_hours)) || Number(s.sla_hours) <= 0)) e[`step-${i}`] = 'SLA hours must be a positive number'
        else if (s.condition && (!s.condition.field.trim() || s.condition.value === '')) e[`step-${i}`] = 'Condition needs a field and value'
      })
      if (Object.keys(e).some(k => k.startsWith('step-')) && !e.steps) e.steps = 'Fix the highlighted steps'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev) {
    ev.preventDefault()
    if (!validate()) return
    onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      entity_type: form.entity_type.trim(),
      trigger_event: form.trigger_event.trim() || null,
      active: form.active,
      steps: form.steps.map(toPayloadStep),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-orange-400" />
            {mode === 'edit' ? 'Edit Workflow' : 'Visual Workflow Builder'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTemplates(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/30 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" /> Use template
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Template picker */}
        {showTemplates && (
          <div className="px-6 py-3 border-b border-gray-800 bg-gray-800/40">
            <p className="text-xs text-gray-400 mb-2">Load a ready-made reference flow, then customise it:</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STARTER_TEMPLATES.map(tpl => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => loadTemplate(tpl)}
                  className="text-left p-2.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-orange-500/50 transition-all"
                >
                  <p className="text-white text-xs font-semibold truncate">{tpl.name}</p>
                  <p className="text-gray-500 text-[11px] mt-0.5">{tpl.steps.length} steps · {tpl.entity_type}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr,1fr]">
            {/* Left: config + steps */}
            <div className="px-6 py-5 space-y-5 lg:border-r border-gray-800">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Workflow Name <span className="text-orange-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Daily Vehicle Inspection"
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.name ? 'border-red-500' : 'border-gray-700'}`}
                />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
              </div>

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
                    placeholder="e.g. inspection"
                    className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.entity_type ? 'border-red-500' : 'border-gray-700'}`}
                  />
                  {errors.entity_type && <p className="text-red-400 text-xs mt-1">{errors.entity_type}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Trigger Event <span className="text-gray-600 font-normal normal-case">(blank = manual)</span>
                  </label>
                  <input
                    type="text"
                    list="wf-trigger-events"
                    value={form.trigger_event}
                    onChange={e => set('trigger_event', e.target.value)}
                    placeholder="manual"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                  />
                </div>
              </div>

              {/* Steps chain */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Approval Steps <span className="text-orange-500">*</span>
                    <span className="text-gray-600 font-normal normal-case"> ({form.steps.length}/{MAX_STEPS}) · drag to reorder</span>
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
                    <StepEditor
                      key={s._key}
                      step={s}
                      index={i}
                      total={form.steps.length}
                      error={errors[`step-${i}`]}
                      dragging={dragIndex === i}
                      dropTarget={overIndex === i && dragIndex !== null && dragIndex !== i}
                      onChange={next => setStep(i, next)}
                      onRemove={() => removeStep(i)}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
                {errors.steps && <p className="text-red-400 text-xs mt-1.5">{errors.steps}</p>}
              </div>

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

            {/* Right: live preview */}
            <div className="px-6 py-5 bg-gray-900/60">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Live Preview</p>
              <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-4">
                <PreviewChain steps={form.steps} />
              </div>
              <p className="text-[11px] text-gray-600 mt-3 leading-relaxed">
                Optional steps and conditions are evaluated server-side at runtime against the
                document context. The chain above shows the maximal path.
              </p>
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-2 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          <div className="px-6 py-4 border-t border-gray-800 flex gap-3 justify-end bg-gray-900/80 sticky bottom-0">
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

        <datalist id="wf-entity-types">
          {ENTITY_TYPES.map(s => <option key={s} value={s} />)}
        </datalist>
        <datalist id="wf-trigger-events">
          {TRIGGER_EVENTS.map(ev => <option key={ev} value={ev} />)}
        </datalist>
        <datalist id="wf-condition-fields">
          {CONDITION_FIELDS.map(f => <option key={f} value={f} />)}
        </datalist>
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
  const [modalError, setModalError]   = useState(null)
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
  const visible = useMemo(() => definitions.filter(d => {
    const matchSearch = !q
      || (d.name || '').toLowerCase().includes(q)
      || (d.entity_type || '').toLowerCase().includes(q)
      || (d.trigger_event || '').toLowerCase().includes(q)
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? d.active : !d.active)
    return matchSearch && matchActive
  }), [definitions, q, filterActive])

  async function handleSave(values) {
    setSaving(true)
    setModalError(null)
    try {
      if (modal.mode === 'edit') await workflows.updateWorkflowDefinition(modal.initial.id, values)
      else await workflows.createWorkflowDefinition(values)
      setModal(null)
      fetch()
    } catch (err) {
      setModalError(err.message || 'Save failed. The live database may not yet accept the richer step schema (V116).')
    } finally { setSaving(false) }
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

  function handleClone(def) {
    // Open the builder pre-loaded with a copy (no id) so save creates a new row.
    setModalError(null)
    setModal({
      mode: 'create',
      initial: {
        name: `${def.name} (copy)`,
        description: def.description,
        entity_type: def.entity_type,
        trigger_event: def.trigger_event,
        active: false,
        steps: Array.isArray(def.steps) ? def.steps : [],
      },
    })
  }

  function openTemplate(tpl) {
    setModalError(null)
    setModal({
      mode: 'create',
      initial: {
        name: tpl.name,
        description: `Starter template: ${tpl.name}`,
        entity_type: tpl.entity_type,
        trigger_event: tpl.trigger_event,
        active: true,
        steps: tpl.steps,
      },
    })
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
          <p className="text-gray-400 text-sm ml-11">Visually build multi-step approval chains — Start → step → step → Complete — per entity type</p>
        </div>
        <button
          onClick={() => { setModalError(null); setModal({ mode: 'create', initial: null }) }}
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
        <div className="flex flex-col items-center justify-center py-16 gap-6">
          <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <GitBranch className="w-9 h-9 text-gray-500" />
          </div>
          <div className="text-center max-w-lg">
            <p className="text-gray-300 text-lg font-medium">No approval workflows yet</p>
            <p className="text-gray-500 text-sm mt-1">
              Build a multi-step chain visually, or start from a ready-made reference flow below.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
            {STARTER_TEMPLATES.map(tpl => (
              <button
                key={tpl.name}
                onClick={() => openTemplate(tpl)}
                className="text-left p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-orange-500/50 transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-orange-400" />
                  <p className="text-white text-sm font-semibold">{tpl.name}</p>
                </div>
                <p className="text-gray-500 text-xs">{tpl.steps.length} steps · {tpl.entity_type} · {tpl.trigger_event}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-orange-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Use template <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
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
                onEdit={def => { setModalError(null); setModal({ mode: 'edit', initial: def }) }}
                onClone={handleClone}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )
      )}

      {/* ── Builder modal ── */}
      {modal && (
        <BuilderModal
          mode={modal.mode}
          initial={modal.initial}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
          error={modalError}
        />
      )}
    </div>
  )
}
