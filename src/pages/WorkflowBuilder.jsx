import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  GitBranch, Plus, Trash2, Save, Loader2,
  ToggleLeft, ToggleRight, ChevronDown,
  Zap, Clock, GripVertical, Sparkles,
  PenLine, Camera, MapPin, MessageSquare, CornerUpLeft, CircleDashed,
  Play, Flag, User, Users, AlertCircle, SlidersHorizontal, ArrowLeft, XCircle,
} from 'lucide-react'
import * as workflows from '../lib/api/workflows'
import { STARTER_TEMPLATES } from '../lib/workflow/starterTemplates'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'

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
        error ? 'border-red-500/60' : 'border-[var(--input-border)]'
      } ${dragging ? 'opacity-40' : ''} ${
        dropTarget ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-[var(--surface-1)]' : ''
      } bg-[var(--surface-2)]`}
    >
      <div className="flex items-center gap-2 p-3">
        <span className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-gray-300 shrink-0" title="Drag to reorder">
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
          className="flex-1 min-w-0 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="shrink-0 inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs px-2 py-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-all"
          title="Edit details"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={total === 1}
          className="shrink-0 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 disabled:opacity-30 transition-colors"
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[var(--surface-3)] text-gray-300">
            <Clock className="w-3 h-3" /> {step.sla_hours}h SLA
          </span>
        ) : null}
        {REQUIREMENTS.filter(r => step[r.key]).map(r => {
          const Icon = r.icon
          return (
            <span key={r.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[var(--surface-3)] text-gray-300" title={r.label}>
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
        <div className="border-t border-[var(--border-dim)] p-3 pl-14 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">Assignee type</label>
              <select
                value={step.assignee_type}
                onChange={e => set('assignee_type', e.target.value)}
                className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
              >
                <option value="role">Role</option>
                <option value="user">Specific user</option>
              </select>
            </div>
            {step.assignee_type === 'role' ? (
              <div>
                <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">Approver role</label>
                <select
                  value={step.approver_role}
                  onChange={e => set('approver_role', e.target.value)}
                  className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
                >
                  {APPROVER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">Approver user id</label>
                <input
                  type="text"
                  value={step.approver_user_id}
                  onChange={e => set('approver_user_id', e.target.value)}
                  placeholder="user uuid / id"
                  className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">SLA hours</label>
              <input
                type="number"
                min="1"
                step="1"
                value={step.sla_hours}
                onChange={e => set('sla_hours', e.target.value)}
                placeholder="e.g. 24"
                className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Requirement toggles */}
          <div>
            <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Requirements</label>
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
                        : 'bg-[var(--surface-1)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-gray-300'
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
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Condition <span className="text-[var(--text-muted)] normal-case font-normal">(step runs only if true)</span>
              </label>
              {step.condition ? (
                <button type="button" onClick={() => set('condition', null)} className="text-[var(--text-muted)] hover:text-red-400 text-[11px] transition-colors">
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
                  className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <select
                  value={step.condition.op}
                  onChange={e => setCondition({ op: e.target.value })}
                  className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-1 py-1.5 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
                >
                  {CONDITION_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="text"
                  value={step.condition.value}
                  onChange={e => setCondition({ value: e.target.value })}
                  placeholder="value (e.g. 5000)"
                  className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
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
            <div className="w-px h-3 bg-[var(--surface-3)] ml-3" />
            <div className="flex items-start gap-2">
              <span className="w-6 h-6 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ backgroundColor: `${hue}33`, color: hue }}>{i + 1}</span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[var(--text-primary)] text-sm truncate">
                  {s.name || <span className="text-[var(--text-muted)] italic">Unnamed step</span>}
                  {s.optional && <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(optional)</span>}
                </p>
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  <span className="text-[11px]" style={{ color: hue }}>{assigneeLabel(s)}</span>
                  {s.sla_hours ? <span className="text-[10px] text-[var(--text-muted)] inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{s.sla_hours}h</span> : null}
                  {REQUIREMENTS.filter(r => s[r.key]).map(r => {
                    const Icon = r.icon
                    return <Icon key={r.key} className="w-3 h-3 text-[var(--text-muted)]" title={r.label} />
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
        <div className="w-px h-3 bg-[var(--surface-3)] ml-3" />
        <div className="flex items-center gap-2 text-xs text-blue-400">
          <span className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center"><Flag className="w-3 h-3" /></span>
          <span className="font-medium">Complete</span>
        </div>
      </div>
    </div>
  )
}

// ─── Builder page ─────────────────────────────────────────────────────────────

const BUILDER_ROUTE = '/workflow-settings'

/**
 * Full-page visual workflow builder (routed).
 *
 * Route: `/workflow-settings/builder/:defId?`
 *   - absent `defId` → create mode (optionally hydrated from ?clone / template
 *     via router state passed by WorkflowSettings)
 *   - present `defId` → edit mode; the definition is loaded org-scoped from the
 *     workflow_definitions table (RLS-guarded, same source as the list page).
 *
 * Every builder feature is preserved verbatim from the former modal: header
 * config, the drag-reorderable multi-step editor with validation, template
 * loading, and the live-preview chain. Supabase writes go through the same
 * workflows service (create/update) used by the list page.
 */
export default function WorkflowBuilder() {
  const { defId } = useParams()
  const navigate = useNavigate()
  const { t, isRTL } = useLanguage()
  const settings = useSettings()

  const isEdit = !!defId

  // ── Async load state (edit mode fetches the definition) ──
  const [loading, setLoading]   = useState(isEdit)
  const [loadError, setLoadError] = useState(null)
  const [initial, setInitial]   = useState(null)

  // ── Form state (initialised once the definition — if any — is known) ──
  const [form, setForm] = useState(null)
  const [errors, setErrors]     = useState({})
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState(null)

  const hydrateForm = useCallback((source) => ({
    name: source?.name || '',
    description: source?.description || '',
    entity_type: source?.entity_type || '',
    trigger_event: source?.trigger_event || '',
    active: source?.active ?? true,
    steps: Array.isArray(source?.steps) && source.steps.length
      ? source.steps.map(toEditorStep)
      : [makeEmptyStep()],
  }), [])

  // Load / hydrate: edit mode fetches the org's definitions and finds this id;
  // create mode may receive a clone/template seed via router navigation state.
  const load = useCallback(async () => {
    if (!isEdit) {
      const seed = window.history.state?.usr?.seed || null
      setInitial(seed)
      setForm(hydrateForm(seed))
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await workflows.listWorkflowDefinitions()
      const def = (rows || []).find(d => String(d.id) === String(defId))
      if (!def) { setLoadError('This workflow no longer exists or you do not have access to it.'); return }
      setInitial(def)
      setForm(hydrateForm(def))
    } catch (err) {
      setLoadError(toUserMessage(err, 'Failed to load workflow'))
    } finally {
      setLoading(false)
    }
  }, [isEdit, defId, hydrateForm])

  useEffect(() => { load() }, [load])

  function goBack() { navigate(BUILDER_ROUTE) }

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  function setStep(i, next) {
    setForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? next : s) }))
    setErrors(e => { const n = { ...e }; delete n.steps; delete n[`step-${i}`]; return n })
  }

  function addStep() {
    setForm(f => (f.steps.length >= MAX_STEPS ? f : { ...f, steps: [...f.steps, makeEmptyStep()] }))
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

  async function handleSubmit(ev) {
    ev.preventDefault()
    if (!validate()) return
    const values = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      entity_type: form.entity_type.trim(),
      trigger_event: form.trigger_event.trim() || null,
      active: form.active,
      steps: form.steps.map(toPayloadStep),
    }
    setSaving(true)
    setSaveError(null)
    try {
      if (isEdit) await workflows.updateWorkflowDefinition(defId, values)
      else await workflows.createWorkflowDefinition(values)
      goBack()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Save failed. The live database may not yet accept the richer step schema (V116).'))
    } finally {
      setSaving(false)
    }
  }

  // ── Loading (edit mode) ──
  if (loading) {
    return (
      <div className="text-[var(--text-primary)] space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <BuilderHeader t={t} isEdit={isEdit} onBack={goBack} disabled />
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr,1fr] gap-6">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] animate-pulse" />
        </div>
      </div>
    )
  }

  // ── Load error (edit mode) ──
  if (loadError) {
    return (
      <div className="text-[var(--text-primary)] space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <BuilderHeader t={t} isEdit={isEdit} onBack={goBack} />
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30 max-w-lg">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{loadError}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="px-3 py-1.5 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all">
              Retry
            </button>
            <button onClick={goBack} className="px-3 py-1.5 text-xs font-semibold text-gray-300 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg border border-[var(--input-border)] transition-all">
              Back to workflows
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!form) return null

  return (
    <form onSubmit={handleSubmit} className="text-[var(--text-primary)] space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <BuilderHeader
        t={t}
        isEdit={isEdit}
        onBack={goBack}
        onToggleTemplates={() => setShowTemplates(v => !v)}
      />

      {/* Template picker */}
      {showTemplates && (
        <div className="p-4 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)]">
          <p className="text-xs text-[var(--text-secondary)] mb-2">{t('workflow.builder.templateHint')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STARTER_TEMPLATES.map(tpl => (
              <button
                key={tpl.name}
                type="button"
                onClick={() => loadTemplate(tpl)}
                className="text-left p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--input-border)] hover:border-orange-500/50 transition-all"
              >
                <p className="text-[var(--text-primary)] text-xs font-semibold truncate">{tpl.name}</p>
                <p className="text-[var(--text-muted)] text-[11px] mt-0.5">{tpl.steps.length} steps · {tpl.entity_type}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr,1fr] gap-6">
        {/* Left: config + steps */}
        <div className="space-y-5 rounded-2xl border border-[var(--border-dim)] bg-[var(--surface-1)] p-5 sm:p-6">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              Workflow Name <span className="text-orange-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Daily Vehicle Inspection"
              className={`w-full bg-[var(--surface-2)] border rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.name ? 'border-red-500' : 'border-[var(--input-border)]'}`}
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
              Description <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              placeholder="What this workflow approves and why"
              className="w-full bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Entity Type <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                list="wf-entity-types"
                value={form.entity_type}
                onChange={e => set('entity_type', e.target.value)}
                placeholder="e.g. inspection"
                className={`w-full bg-[var(--surface-2)] border rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.entity_type ? 'border-red-500' : 'border-[var(--input-border)]'}`}
              />
              {errors.entity_type && <p className="text-red-400 text-xs mt-1">{errors.entity_type}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Trigger Event <span className="text-[var(--text-muted)] font-normal normal-case">(blank = manual)</span>
              </label>
              <input
                type="text"
                list="wf-trigger-events"
                value={form.trigger_event}
                onChange={e => set('trigger_event', e.target.value)}
                placeholder="manual"
                className="w-full bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              />
            </div>
          </div>

          {/* Steps chain */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                Approval Steps <span className="text-orange-500">*</span>
                <span className="text-[var(--text-muted)] font-normal normal-case"> ({form.steps.length}/{MAX_STEPS}) · drag to reorder</span>
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

          <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)]">
            <div>
              <p className="text-[var(--text-primary)] text-sm font-medium">Workflow active</p>
              <p className="text-[var(--text-muted)] text-xs">Inactive workflows never auto-start; in-flight instances continue</p>
            </div>
            <button type="button" onClick={() => set('active', !form.active)} className="transition-colors" aria-label="Toggle active">
              {form.active
                ? <ToggleRight className="w-8 h-8 text-orange-500" />
                : <ToggleLeft className="w-8 h-8 text-[var(--text-muted)]" />
              }
            </button>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="lg:sticky lg:top-4 self-start rounded-2xl border border-[var(--border-dim)] bg-[var(--surface-1)] p-5 sm:p-6">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Live Preview</p>
          <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] p-4">
            <PreviewChain steps={form.steps} />
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-3 leading-relaxed">
            Optional steps and conditions are evaluated server-side at runtime against the
            document context. The chain above shows the maximal path.
          </p>
        </div>
      </div>

      {saveError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-400 text-xs">{saveError}</p>
        </div>
      )}

      {/* Sticky action bar */}
      <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-5 py-4 border-t border-[var(--border-dim)] flex gap-3 justify-end bg-[var(--surface-1)] backdrop-blur-sm sm:rounded-b-2xl">
        <button type="button" onClick={goBack} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg border border-[var(--input-border)] transition-all">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-[var(--text-primary)] bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEdit ? 'Save Changes' : 'Create Workflow'}
        </button>
      </div>

      <datalist id="wf-entity-types">
        {ENTITY_TYPES.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="wf-trigger-events">
        {TRIGGER_EVENTS.map(ev => <option key={ev} value={ev} />)}
      </datalist>
      <datalist id="wf-condition-fields">
        {CONDITION_FIELDS.map(f => <option key={f} value={f} />)}
      </datalist>
    </form>
  )
}

// ─── Page header (shared across loading / error / editing states) ─────────────

function BuilderHeader({ t, isEdit, onBack, onToggleTemplates, disabled }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium mb-2 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t('workflow.builder.back')}
        </button>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <GitBranch className="w-5 h-5 text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {isEdit ? t('workflow.builder.editTitle') : t('workflow.builder.createTitle')}
          </h1>
        </div>
        <p className="text-[var(--text-secondary)] text-sm ml-11">{t('workflow.builder.subtitle')}</p>
      </div>
      {onToggleTemplates && (
        <button
          type="button"
          onClick={onToggleTemplates}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-2 rounded-lg border border-orange-500/30 transition-all self-start disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" /> {t('workflow.builder.useTemplate')}
        </button>
      )}
    </div>
  )
}
