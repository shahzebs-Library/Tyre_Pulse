/**
 * RuleBuilder — full-page automation rule builder (routes
 * `/automation-rules/builder` for create and `/automation-rules/builder/:ruleId`
 * for edit).
 *
 * Migrated verbatim from the former RuleModal in AutomationRules.jsx per the
 * app-wide rule that LARGE modals (here a nested condition/action array builder)
 * become dedicated routed pages. Every feature, validation rule and API call is
 * preserved: multi-event selection, the ANDed conditions editor, the
 * notify_role / emit_event actions editor, cooldown, active toggle, and the
 * create/update calls against lib/api/businessRules.
 *
 * Edit mode loads the target rule from listBusinessRules() (the same source of
 * truth the list page uses — the service exposes no single-row fetch) with its
 * own loading / not-found / error states. Cancel and a successful Save both
 * navigate back to /automation-rules.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Zap, Plus, Trash2, Save, Loader2, ArrowLeft, Bell, Radio,
  ToggleLeft, ToggleRight, XCircle, AlertTriangle,
} from 'lucide-react'
import * as businessRules from '../lib/api/businessRules'

// ─── Constants (mirrors AutomationRules) ────────────────────────────────────

const EVENT_TYPES = [
  'inspection.completed',
  'tyre.installed',
  'accident.reported',
  'accident.closure_changed',
  'workorder.created',
  'workorder.status_changed',
  'corrective_action.created',
  'purchase.order_created',
  'stock.movement',
  'threshold.triggered',
  'knowledge.document_added',
]

const PAYLOAD_FIELDS = ['asset_no', 'site', 'tread_depth', 'pressure_reading', 'cost_per_tyre', 'severity', 'status', 'total_cost']

const OPERATORS = [
  { value: 'lt',       label: '<',        text: 'less than' },
  { value: 'lte',      label: '≤',        text: 'less than or equal' },
  { value: 'gt',       label: '>',        text: 'greater than' },
  { value: 'gte',      label: '≥',        text: 'greater than or equal' },
  { value: 'eq',       label: '=',        text: 'equals' },
  { value: 'neq',      label: '≠',        text: 'not equal' },
  { value: 'contains', label: 'contains', text: 'contains' },
]

const ROLES = [
  { value: 'admin',    label: 'Admin' },
  { value: 'manager',  label: 'Manager' },
  { value: 'director', label: 'Director' },
]

const EMPTY_CONDITION = { field: '', operator: 'lt', value: '' }
const EMPTY_NOTIFY = { type: 'notify_role', role: 'manager', title: '', message: '' }

// Build the editable form shape from a persisted rule (or nothing, for create).
function toForm(initial) {
  return {
    name: initial?.name || '',
    description: initial?.description || '',
    event_types: initial?.event_types || [],
    conditions: Array.isArray(initial?.conditions) && initial.conditions.length
      ? initial.conditions.map(c => ({ field: c.field || '', operator: c.operator || 'lt', value: String(c.value ?? '') }))
      : [],
    actions: Array.isArray(initial?.actions) && initial.actions.length
      ? initial.actions.map(a => a.type === 'notify_role'
        ? { type: 'notify_role', role: a.role || 'manager', title: a.title || '', message: a.message || '' }
        : { type: 'emit_event', event_type: (a.event_type || '').replace(/^rule\./, '') })
      : [{ ...EMPTY_NOTIFY }],
    cooldown_minutes: initial?.cooldown_minutes ?? 0,
    active: initial?.active ?? true,
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RuleBuilder() {
  const { ruleId } = useParams()
  const navigate = useNavigate()
  const mode = ruleId ? 'edit' : 'create'

  // Record load (edit only)
  const [loading, setLoading]   = useState(mode === 'edit')
  const [loadError, setLoadError] = useState(null)
  const [notFound, setNotFound] = useState(false)

  // Form + submit state
  const [form, setForm]       = useState(() => toForm(null))
  const [errors, setErrors]   = useState({})
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState(null)

  const goBack = useCallback(() => navigate('/automation-rules'), [navigate])

  // Load the rule when editing. The service has no single-row fetch, so we
  // reuse the org rules list (the same source the list page renders from).
  const loadRule = useCallback(async () => {
    if (mode !== 'edit') return
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const rows = await businessRules.listBusinessRules()
      const rule = (rows || []).find(r => String(r.id) === String(ruleId))
      if (!rule) { setNotFound(true); return }
      setForm(toForm(rule))
    } catch (err) {
      setLoadError(err.message || 'Failed to load rule')
    } finally {
      setLoading(false)
    }
  }, [mode, ruleId])

  useEffect(() => { loadRule() }, [loadRule])

  // ── Field mutators ──
  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  function toggleEvent(ev) {
    set('event_types', form.event_types.includes(ev) ? form.event_types.filter(x => x !== ev) : [...form.event_types, ev])
  }

  function setCondition(i, key, value) {
    set('conditions', form.conditions.map((c, idx) => idx === i ? { ...c, [key]: value } : c))
  }

  function setAction(i, patch) {
    set('actions', form.actions.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  // ── Validation ──
  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (form.event_types.length === 0) e.event_types = 'Select at least one event type'
    if (form.conditions.some(c => !c.field.trim() || c.value === '')) e.conditions = 'Every condition needs a field and a value'
    if (form.actions.length === 0) e.actions = 'Add at least one action'
    else if (form.actions.some(a => a.type === 'emit_event' && !a.event_type.trim())) e.actions = 'Emitted events need an event type'
    const cd = Number(form.cooldown_minutes)
    if (isNaN(cd) || cd < 0 || cd > 10080) e.cooldown_minutes = 'Cooldown must be 0 to 10080 minutes (7 days)'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Submit (create / update, verbatim payload shaping + API calls) ──
  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    const values = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      event_types: form.event_types,
      conditions: form.conditions.map(c => ({
        field: c.field.trim(),
        operator: c.operator,
        value: c.value !== '' && !isNaN(Number(c.value)) ? Number(c.value) : c.value.trim(),
      })),
      actions: form.actions.map(a => a.type === 'notify_role'
        ? {
          type: 'notify_role',
          role: a.role,
          ...(a.title.trim() ? { title: a.title.trim() } : {}),
          ...(a.message.trim() ? { message: a.message.trim() } : {}),
        }
        : { type: 'emit_event', event_type: a.event_type.trim().replace(/^rule\./, '') }),
      cooldown_minutes: Number(form.cooldown_minutes),
      active: form.active,
    }

    setSaving(true)
    setSaveError(null)
    try {
      if (mode === 'edit') await businessRules.updateBusinessRule(ruleId, values)
      else await businessRules.createBusinessRule(values)
      goBack()
    } catch (err) {
      setSaveError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading (edit) ──
  if (loading) {
    return (
      <div className="text-[var(--text-primary)]">
        <BuilderHeader mode={mode} onBack={goBack} />
        <div className="max-w-2xl mx-auto mt-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // ── Load error / not found (edit) ──
  if (loadError || notFound) {
    return (
      <div className="text-[var(--text-primary)]">
        <BuilderHeader mode={mode} onBack={goBack} />
        <div className="max-w-2xl mx-auto mt-8 flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--surface-2)] border border-[var(--input-border)] flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <div>
            <p className="text-gray-200 text-base font-medium">
              {notFound ? 'Rule not found' : 'Could not load this rule'}
            </p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              {notFound
                ? 'It may have been deleted. Return to the rules list to continue.'
                : (loadError || 'An unexpected error occurred.')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!notFound && (
              <button
                onClick={loadRule}
                className="px-4 py-2 text-sm font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
              >
                Retry
              </button>
            )}
            <button
              onClick={goBack}
              className="px-4 py-2 text-sm text-gray-300 hover:text-[var(--text-primary)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg border border-[var(--input-border)] transition-all"
            >
              Back to rules
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Builder form ──
  return (
    <div className="text-[var(--text-primary)]">
      <BuilderHeader mode={mode} onBack={goBack} />

      {saveError && (
        <div className="max-w-2xl mx-auto mt-4 flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{saveError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mt-6">
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-2xl overflow-hidden">
          <div className="px-6 py-6 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Rule Name <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Critical tread alert for Riyadh"
                className={`w-full bg-[var(--surface-2)] border rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.name ? 'border-red-500' : 'border-[var(--input-border)]'}`}
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                Description <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
              </label>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                rows={2}
                placeholder="What this rule automates and why"
                className="w-full bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none"
              />
            </div>

            {/* Event types */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                Trigger Events <span className="text-orange-500">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] max-h-48 overflow-y-auto">
                {EVENT_TYPES.map(ev => {
                  const on = form.event_types.includes(ev)
                  return (
                    <button
                      key={ev}
                      type="button"
                      onClick={() => toggleEvent(ev)}
                      className={`px-2 py-1 rounded-md text-[11px] font-mono border transition-all ${
                        on ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' : 'bg-[var(--surface-1)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-gray-300'
                      }`}
                    >
                      {ev}
                    </button>
                  )
                })}
              </div>
              {errors.event_types && <p className="text-red-400 text-xs mt-1">{errors.event_types}</p>}
            </div>

            {/* Conditions builder */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Conditions <span className="text-[var(--text-muted)] font-normal normal-case">(all must match, blank = always)</span>
                </label>
                <button
                  type="button"
                  onClick={() => set('conditions', [...form.conditions, { ...EMPTY_CONDITION }])}
                  className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add condition
                </button>
              </div>
              {form.conditions.length === 0 ? (
                <p className="text-[var(--text-muted)] text-xs px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)]">
                  No conditions, actions run on every matching event.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.conditions.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        list="rule-payload-fields"
                        value={c.field}
                        onChange={e => setCondition(i, 'field', e.target.value)}
                        placeholder="payload field"
                        className="flex-1 bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                      />
                      <select
                        value={c.operator}
                        onChange={e => setCondition(i, 'operator', e.target.value)}
                        className="w-28 bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg px-2 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
                        aria-label="Operator"
                      >
                        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label} {o.text}</option>)}
                      </select>
                      <input
                        type="text"
                        value={c.value}
                        onChange={e => setCondition(i, 'value', e.target.value)}
                        placeholder="value"
                        className="w-28 bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => set('conditions', form.conditions.filter((_, idx) => idx !== i))}
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 transition-colors shrink-0"
                        title="Remove condition"
                        aria-label="Remove condition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <datalist id="rule-payload-fields">
                {PAYLOAD_FIELDS.map(f => <option key={f} value={f} />)}
              </datalist>
              {errors.conditions && <p className="text-red-400 text-xs mt-1">{errors.conditions}</p>}
            </div>

            {/* Actions builder */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Actions <span className="text-orange-500">*</span>
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => set('actions', [...form.actions, { ...EMPTY_NOTIFY }])}
                    className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-xs font-semibold transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5" /> Notify role
                  </button>
                  <button
                    type="button"
                    onClick={() => set('actions', [...form.actions, { type: 'emit_event', event_type: '' }])}
                    className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-xs font-semibold transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5" /> Emit event
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {form.actions.map((a, i) => (
                  <div key={i} className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)]">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                        a.type === 'notify_role' ? 'bg-orange-500/15 text-orange-300' : 'bg-blue-500/15 text-blue-300'
                      }`}>
                        {a.type === 'notify_role' ? <Bell className="w-2.5 h-2.5" /> : <Radio className="w-2.5 h-2.5" />}
                        {a.type === 'notify_role' ? 'Notify role' : 'Emit event'}
                      </span>
                      <button
                        type="button"
                        onClick={() => set('actions', form.actions.filter((_, idx) => idx !== i))}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors"
                        title="Remove action"
                        aria-label="Remove action"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {a.type === 'notify_role' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-[140px,1fr] gap-2">
                        <select
                          value={a.role}
                          onChange={e => setAction(i, { role: e.target.value })}
                          className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
                          aria-label="Role to notify"
                        >
                          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <input
                          type="text"
                          value={a.title}
                          onChange={e => setAction(i, { title: e.target.value })}
                          placeholder="Notification title (optional)"
                          className="w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                        />
                        <input
                          type="text"
                          value={a.message}
                          onChange={e => setAction(i, { message: e.target.value })}
                          placeholder="Message (optional, defaults to rule name)"
                          className="w-full sm:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--text-muted)] text-sm font-mono shrink-0">rule.</span>
                          <input
                            type="text"
                            value={a.event_type}
                            onChange={e => setAction(i, { event_type: e.target.value })}
                            placeholder="custom.event_name"
                            className="flex-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                          />
                        </div>
                        <p className="text-[var(--text-muted)] text-[10px] mt-1">Emitted back into the event stream with the <code className="font-mono">rule.</code> prefix, usable as a webhook or workflow trigger.</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {errors.actions && <p className="text-red-400 text-xs mt-1">{errors.actions}</p>}
            </div>

            {/* Cooldown + active */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                  Cooldown <span className="text-[var(--text-muted)] font-normal normal-case">(minutes, 0 = none)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="10080"
                  step="1"
                  value={form.cooldown_minutes}
                  onChange={e => set('cooldown_minutes', e.target.value)}
                  className={`w-full bg-[var(--surface-2)] border rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.cooldown_minutes ? 'border-red-500' : 'border-[var(--input-border)]'}`}
                />
                {errors.cooldown_minutes && <p className="text-red-400 text-xs mt-1">{errors.cooldown_minutes}</p>}
              </div>
              <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-[var(--surface-2)] border border-[var(--input-border)] self-end">
                <div>
                  <p className="text-[var(--text-primary)] text-sm font-medium">Rule active</p>
                  <p className="text-[var(--text-muted)] text-xs">Disable to pause without deleting</p>
                </div>
                <button type="button" onClick={() => set('active', !form.active)} className="transition-colors" aria-label="Toggle active">
                  {form.active ? <ToggleRight className="w-8 h-8 text-orange-500" /> : <ToggleLeft className="w-8 h-8 text-[var(--text-muted)]" />}
                </button>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t border-[var(--border-dim)] flex gap-3 justify-end bg-[var(--surface-1)]">
            <button type="button" onClick={goBack} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg border border-[var(--input-border)] transition-all">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-[var(--text-primary)] bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {mode === 'edit' ? 'Save Changes' : 'Create Rule'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────

function BuilderHeader({ mode, onBack }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="shrink-0 p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-all"
        aria-label="Back to automation rules"
        title="Back to rules"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2.5">
        <div className="p-2 rounded-lg bg-orange-500/20">
          <Zap className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
            {mode === 'edit' ? 'Edit Rule' : 'New Automation Rule'}
          </h1>
          <p className="text-[var(--text-secondary)] text-sm">If-this-then-that rule evaluated on every domain event</p>
        </div>
      </div>
    </div>
  )
}
