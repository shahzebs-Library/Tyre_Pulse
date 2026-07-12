import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ClipboardList, Plus, Trash2, Save, Loader2, Upload, ArrowLeft,
  ChevronUp, ChevronDown, GripVertical, AlertCircle, CheckCircle2, XCircle,
  Type, AlignLeft, Hash, List, ListChecks, ToggleRight, Calendar, Star,
  Camera, PenLine, Heading, Eye, Copy, X, Info, Filter, Scale, Target,
  Truck, MapPin, User, Sparkles, Link2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  FIELD_TYPES, newField, typeHasOptions, isLayoutField, isValueField,
  validateTemplate, fieldTypeDef, isReferenceField, referenceSource,
  FIELD_LIBRARY, fieldFromLibrary,
} from '../lib/checklist/fieldTypes'
import {
  getTemplate, createTemplate, updateTemplate, publishTemplate,
} from '../lib/api/checklists'

// ─── Static config ────────────────────────────────────────────────────────────

const CHECKLISTS_ROUTE = '/checklists'

const CATEGORIES = [
  'Vehicle Inspection', 'Tyre Inspection', 'Safety', 'Maintenance',
  'Workshop', 'Compliance', 'Handover', 'Gate Pass', 'Quality', 'General',
]

const ICON_PRESETS = ['📋', '🚚', '🛞', '🔧', '🛡️', '⚠️', '✅', '📝', '🚦', '🏁', '🧰', '📷']

// Field-type → icon, for the field row + preview accent.
const TYPE_ICON = {
  section: Heading,
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  select: List,
  multiselect: ListChecks,
  boolean: ToggleRight,
  date: Calendar,
  rating: Star,
  asset: Truck,
  site: MapPin,
  user: User,
  photo: Camera,
  signature: PenLine,
}

// Reference source → { icon, noun, placeholder } for editor + preview copy.
const REFERENCE_META = {
  asset: { Icon: Truck, noun: 'Assets', placeholder: 'Select an asset…' },
  site:  { Icon: MapPin, noun: 'Sites', placeholder: 'Select a site…' },
  user:  { Icon: User,  noun: 'Users', placeholder: 'Select a user…' },
}

function referenceMeta(type) {
  const src = referenceSource(type)
  return (src && REFERENCE_META[src]) || REFERENCE_META.asset
}

const GROUP_LABELS = {
  layout: 'Layout',
  input: 'Input',
  choice: 'Choice',
  reference: 'Reference (live data)',
  media: 'Media',
}
const GROUP_ORDER = ['layout', 'input', 'choice', 'reference', 'media']

// Conditional-visibility operators (mirror lib/checklist/fieldTypes COND_OPS).
// `needsValue` = the value input is shown for this operator.
const CONDITION_OPS = [
  { op: '=',          label: 'equals',          needsValue: true },
  { op: '!=',         label: 'does not equal',  needsValue: true },
  { op: '>',          label: 'greater than',    needsValue: true },
  { op: '>=',         label: 'at least',        needsValue: true },
  { op: '<',          label: 'less than',       needsValue: true },
  { op: '<=',         label: 'at most',         needsValue: true },
  { op: 'includes',   label: 'includes',        needsValue: true },
  { op: 'empty',      label: 'is empty',        needsValue: false },
  { op: 'not_empty',  label: 'is answered',     needsValue: false },
]
const CONDITION_OP_SET = new Set(CONDITION_OPS.map((o) => o.op))

// A short human sentence for a rule, used in the summary row + preview badge.
function describeCondition(rule, fields) {
  if (!rule || !rule.field || !rule.op) return ''
  const ref = (Array.isArray(fields) ? fields : []).find((f) => f && f.id === rule.field)
  const name = String(ref?.label || '').trim() || 'a field'
  const meta = CONDITION_OPS.find((o) => o.op === rule.op)
  const verb = meta?.label || rule.op
  const val = meta?.needsValue ? ` "${String(rule.value ?? '').trim() || '…'}"` : ''
  return `${name} ${verb}${val}`
}

// Shared control classes (theme-aware via CSS vars).
const INPUT_CLS =
  'w-full bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg px-3 py-2 text-sm ' +
  'text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none ' +
  'focus:ring-2 focus:ring-[var(--brand-bright)] focus:border-transparent transition-all'

const LABEL_CLS =
  'block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5'

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 w-full text-left disabled:opacity-50"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked
            ? 'bg-[var(--brand-bright)] border-[var(--brand-bright)]'
            : 'bg-[var(--surface-2)] border-[var(--border-dim)]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-[var(--text-primary)]">{label}</span>
        {hint && <span className="block text-xs text-[var(--text-muted)]">{hint}</span>}
      </span>
    </button>
  )
}

// ─── Options editor (select / multiselect) ───────────────────────────────────

function OptionsEditor({ options, onChange }) {
  const list = Array.isArray(options) ? options : []

  const setAt = (i, val) => onChange(list.map((o, idx) => (idx === i ? val : o)))
  const removeAt = (i) => onChange(list.filter((_, idx) => idx !== i))
  const add = () => onChange([...list, `Option ${list.length + 1}`])

  return (
    <div>
      <label className={LABEL_CLS}>Options</label>
      <div className="space-y-2">
        {list.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] italic">No options yet — add at least one.</p>
        )}
        {list.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-4 text-right shrink-0">{i + 1}</span>
            <input
              type="text"
              value={opt}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className={INPUT_CLS}
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="shrink-0 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 transition-colors"
              title="Remove option"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-bright)] hover:opacity-80 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" /> Add option
      </button>
    </div>
  )
}

// ─── Conditional-visibility editor ("Show only when…") ────────────────────────

function ConditionEditor({ field, allFields, onChange }) {
  // Any OTHER value-carrying field can be a source (guard against self-reference).
  const sources = (Array.isArray(allFields) ? allFields : []).filter(
    (f) => f && f.id !== field.id && isValueField(f.type),
  )
  const rule = field.visibleWhen && typeof field.visibleWhen === 'object' ? field.visibleWhen : null
  const enabled = !!rule

  const refField = rule ? sources.find((f) => f.id === rule.field) : null
  const opMeta = rule ? CONDITION_OPS.find((o) => o.op === rule.op) : null
  const needsValue = opMeta ? opMeta.needsValue : true

  const setRule = (patch) => onChange({ ...field, visibleWhen: { ...rule, ...patch } })

  const enable = () => {
    const first = sources[0]
    onChange({ ...field, visibleWhen: { field: first ? first.id : '', op: '=', value: '' } })
  }
  const clear = () => onChange({ ...field, visibleWhen: null })

  // Value choices when the referenced field constrains its answers.
  let valueChoices = null
  if (refField) {
    if (refField.type === 'select' || refField.type === 'multiselect') {
      valueChoices = (Array.isArray(refField.options) ? refField.options : [])
        .map((o) => String(o).trim()).filter(Boolean)
        .map((o) => ({ value: o, label: o }))
    } else if (refField.type === 'boolean') {
      valueChoices = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
    }
  }

  return (
    <div className="p-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5" /> Conditional visibility
        </span>
        {enabled ? (
          <button
            type="button"
            onClick={clear}
            className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={sources.length === 0}
            className="text-[11px] font-semibold text-[var(--brand-bright)] hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            Add rule
          </button>
        )}
      </div>

      {!enabled ? (
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
          {sources.length === 0
            ? 'Add another answerable field first to reference it here.'
            : 'Always shown. Add a rule to show this field only when another answer matches.'}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-[var(--text-muted)]">Show this field only when…</p>
          <div className="grid grid-cols-1 sm:grid-cols-[1.3fr,1fr] gap-2">
            <select
              value={rule.field || ''}
              onChange={(e) => setRule({ field: e.target.value })}
              className={INPUT_CLS}
              aria-label="Reference field"
            >
              <option value="">— Select a field —</option>
              {sources.map((f) => (
                <option key={f.id} value={f.id}>
                  {String(f.label || '').trim() || 'Untitled field'}
                </option>
              ))}
            </select>
            <select
              value={rule.op || '='}
              onChange={(e) => setRule({ op: e.target.value })}
              className={INPUT_CLS}
              aria-label="Condition operator"
            >
              {CONDITION_OPS.map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>
          </div>
          {needsValue && (
            valueChoices && valueChoices.length ? (
              <select
                value={rule.value ?? ''}
                onChange={(e) => setRule({ value: e.target.value })}
                className={INPUT_CLS}
                aria-label="Condition value"
              >
                <option value="">— Select a value —</option>
                {valueChoices.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={rule.value ?? ''}
                onChange={(e) => setRule({ value: e.target.value })}
                placeholder="Value to match"
                className={INPUT_CLS}
                aria-label="Condition value"
              />
            )
          )}
          {!refField && (
            <p className="text-[11px] text-amber-400/90 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" /> Pick a field to reference.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Passing-answers selector (choice / boolean scoring) ──────────────────────

function PassValuesEditor({ field, onChange }) {
  const selected = Array.isArray(field.passValues) ? field.passValues : []

  if (field.type === 'boolean') {
    const opts = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]
    const toggle = (v) => {
      const has = selected.includes(v)
      const next = has ? selected.filter((x) => x !== v) : [...selected, v]
      onChange({ ...field, passValues: next })
    }
    return (
      <div>
        <label className={LABEL_CLS}>Passing answer</label>
        <div className="flex gap-2">
          {opts.map((o) => {
            const active = selected.includes(o.value)
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => toggle(o.value)}
                className={`px-4 py-1.5 rounded-lg text-sm border transition-all ${
                  active
                    ? 'border-[var(--brand-bright)] bg-brand-subtle text-[var(--brand-bright)] font-semibold'
                    : 'border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--brand-bright)]'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1">Selected answers earn the field's weight.</p>
      </div>
    )
  }

  // select / multiselect
  const options = (Array.isArray(field.options) ? field.options : [])
    .map((o) => String(o).trim()).filter(Boolean)
  const toggle = (opt) => {
    const has = selected.includes(opt)
    const next = has ? selected.filter((x) => x !== opt) : [...selected, opt]
    onChange({ ...field, passValues: next })
  }

  return (
    <div>
      <label className={LABEL_CLS}>Passing answers</label>
      {options.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)] italic">Add options above to mark which pass.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const active = selected.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                  active
                    ? 'border-[var(--brand-bright)] bg-brand-subtle text-[var(--brand-bright)] font-semibold'
                    : 'border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--brand-bright)]'
                }`}
              >
                {active && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}{opt}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-muted)] mt-1">
        {options.length ? 'Selected answers earn the full weight.' : ''}
      </p>
    </div>
  )
}

// ─── Per-field scoring editor (weight + passing answers) ──────────────────────

function ScoringEditor({ field, onChange }) {
  const hasPassValues = field.type === 'select' || field.type === 'multiselect' || field.type === 'boolean'
  const weightVal = field.weight
  const set = (key, value) => onChange({ ...field, [key]: value })

  return (
    <div className="p-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)] space-y-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
        <Scale className="w-3.5 h-3.5" /> Scoring
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>
            Weight (points) <span className="text-[var(--text-muted)] font-normal normal-case">(0 = not scored)</span>
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={weightVal ?? ''}
            onChange={(e) => set('weight', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
            placeholder="—"
            className={INPUT_CLS}
          />
        </div>
        {hasPassValues && (
          <div className="sm:pt-0">
            <PassValuesEditor field={field} onChange={onChange} />
          </div>
        )}
      </div>
      {!hasPassValues && (
        <p className="text-[11px] text-[var(--text-muted)]">
          Any non-empty answer earns the weight for this field type.
        </p>
      )}
    </div>
  )
}

// ─── Field editor row ─────────────────────────────────────────────────────────

function FieldRow({ field, index, total, expanded, error, allFields, scored, onToggleExpand, onChange, onMove, onRemove, onDuplicate }) {
  const def = fieldTypeDef(field.type)
  const Icon = TYPE_ICON[field.type] || Type
  const layout = isLayoutField(field.type)
  const hasOptions = typeHasOptions(field.type)
  const isMedia = field.type === 'photo' || field.type === 'signature'
  const isReference = isReferenceField(field.type)
  const refMeta = isReference ? referenceMeta(field.type) : null

  const set = (key, value) => onChange({ ...field, [key]: value })

  return (
    <div
      id={`field-${field.id}`}
      className={`rounded-xl border bg-[var(--surface-2)] transition-all scroll-mt-4 ${
        error ? 'border-red-500/60' : 'border-[var(--border-dim)]'
      }`}
    >
      {/* Summary row */}
      <div className="flex items-center gap-2 p-3">
        <div className="flex flex-col shrink-0">
          <button
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-25 transition-colors"
            title="Move up"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={index === total - 1}
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-25 transition-colors"
            title="Move down"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <span
          className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${
            layout
              ? 'bg-[var(--surface-1)] text-[var(--text-muted)]'
              : 'bg-brand-subtle text-[var(--brand-bright)]'
          }`}
          title={def?.label || field.type}
        >
          <Icon className="w-4 h-4" />
        </span>

        <button
          type="button"
          onClick={() => onToggleExpand(field.id)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm text-[var(--text-primary)] truncate">
            {String(field.label || '').trim() || (
              <span className="text-[var(--text-muted)] italic">
                {layout ? 'Untitled section' : 'Untitled field'}
              </span>
            )}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 flex-wrap">
            <span>{def?.label || field.type}</span>
            {field.required && !layout && <span className="text-amber-400">• required</span>}
            {field.allow_photo && !isMedia && !layout && <span>• photo</span>}
            {hasOptions && <span>• {(field.options || []).length} options</span>}
            {isReference && (
              <span className="inline-flex items-center gap-1 text-[var(--brand-bright)]">
                • <Link2 className="w-2.5 h-2.5" /> live data
              </span>
            )}
            {field.visibleWhen && field.visibleWhen.field && (
              <span className="inline-flex items-center gap-1 text-[var(--brand-bright)]">
                • <Filter className="w-2.5 h-2.5" /> conditional
              </span>
            )}
            {scored && Number(field.weight) > 0 && !layout && (
              <span className="inline-flex items-center gap-1 text-[var(--brand-bright)]">
                • <Scale className="w-2.5 h-2.5" /> {Number(field.weight)} pt{Number(field.weight) === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onDuplicate(index)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Duplicate field"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 transition-colors"
            title="Delete field"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onToggleExpand(field.id)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={expanded ? 'Collapse' : 'Edit'}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-[var(--border-dim)] p-3 space-y-4">
          <div>
            <label className={LABEL_CLS}>
              {layout ? 'Section title' : 'Label'} <span className="text-[var(--brand-bright)]">*</span>
            </label>
            <input
              type="text"
              value={field.label || ''}
              onChange={(e) => set('label', e.target.value)}
              placeholder={layout ? 'e.g. Exterior condition' : 'e.g. Tread depth (mm)'}
              className={INPUT_CLS}
            />
          </div>

          {!layout && (
            <div>
              <label className={LABEL_CLS}>
                Help text <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={field.help || ''}
                onChange={(e) => set('help', e.target.value)}
                placeholder="Guidance shown under the field at runtime"
                className={INPUT_CLS}
              />
            </div>
          )}

          {field.type === 'number' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Min <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span></label>
                <input
                  type="number"
                  value={field.min ?? ''}
                  onChange={(e) => set('min', e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="—"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Max <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span></label>
                <input
                  type="number"
                  value={field.max ?? ''}
                  onChange={(e) => set('max', e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="—"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          )}

          {isReference && refMeta && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)]">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-subtle text-[var(--brand-bright)] flex items-center justify-center">
                <refMeta.Icon className="w-3.5 h-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text-primary)]">Live reference field</p>
                <p className="text-[11px] text-[var(--text-muted)] leading-snug mt-0.5">
                  Filled from your real {refMeta.noun} at check time — no options to configure here.
                </p>
              </div>
            </div>
          )}

          {typeHasOptions(field.type) && (
            <OptionsEditor options={field.options} onChange={(opts) => set('options', opts)} />
          )}

          {!layout && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)]">
                <Toggle
                  checked={!!field.required}
                  onChange={(v) => set('required', v)}
                  label="Required"
                  hint="Must be answered"
                />
              </div>
              {!isMedia && (
                <div className="p-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)]">
                  <Toggle
                    checked={!!field.allow_photo}
                    onChange={(v) => set('allow_photo', v)}
                    label="Allow photo"
                    hint="Attach a photo to this answer"
                  />
                </div>
              )}
            </div>
          )}

          {/* Conditional visibility — every non-first field can reference another. */}
          <ConditionEditor field={field} allFields={allFields} onChange={onChange} />

          {/* Per-field scoring — only when the template is a scored checklist. */}
          {scored && isValueField(field.type) && (
            <ScoringEditor field={field} onChange={onChange} />
          )}

          {error && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Add-field menu ───────────────────────────────────────────────────────────

function AddFieldMenu({ onAdd }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const grouped = useMemo(() => {
    const map = {}
    for (const ft of FIELD_TYPES) (map[ft.group] ||= []).push(ft)
    return map
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-primary text-sm"
      >
        <Plus className="w-4 h-4" /> Add field
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 max-h-[420px] overflow-y-auto rounded-xl border border-[var(--border-dim)] bg-[var(--surface-1)] shadow-float p-2">
          {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
            <div key={group} className="mb-1.5 last:mb-0">
              <p className="px-2 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {GROUP_LABELS[group] || group}
              </p>
              {grouped[group].map((ft) => {
                const Icon = TYPE_ICON[ft.type] || Type
                return (
                  <button
                    key={ft.type}
                    type="button"
                    onClick={() => { onAdd(ft.type); setOpen(false) }}
                    className="w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-subtle text-[var(--brand-bright)] flex items-center justify-center mt-0.5">
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-[var(--text-primary)]">{ft.label}</span>
                      <span className="block text-[11px] text-[var(--text-muted)] leading-snug">{ft.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Field library / suggestions panel ────────────────────────────────────────

function LibraryChip({ type }) {
  const def = fieldTypeDef(type)
  const Icon = TYPE_ICON[type] || Type
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-muted)] shrink-0">
      <Icon className="w-2.5 h-2.5" /> {def?.label || type}
    </span>
  )
}

function FieldLibraryPanel({ onAdd }) {
  const [open, setOpen] = useState(false)
  const groups = Array.isArray(FIELD_LIBRARY) ? FIELD_LIBRARY : []

  return (
    <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--surface-1)] transition-colors"
      >
        <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-subtle text-[var(--brand-bright)] flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[var(--text-primary)]">Add from library</span>
          <span className="block text-[11px] text-[var(--text-muted)] leading-snug">
            Curated tyre, vehicle &amp; safety fields — one click to add.
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[var(--border-dim)] p-3 space-y-3 max-h-[420px] overflow-y-auto">
          {groups.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic">No library suggestions available.</p>
          ) : (
            groups.map((group) => {
              const presets = Array.isArray(group?.fields) ? group.fields : []
              if (!presets.length) return null
              return (
                <div key={group.category}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                    {group.category}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {presets.map((preset, i) => {
                      const Icon = TYPE_ICON[preset?.type] || Type
                      return (
                        <button
                          key={`${group.category}-${i}`}
                          type="button"
                          onClick={() => onAdd(preset)}
                          className="group flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-1)] text-left hover:border-[var(--brand-bright)] hover:bg-brand-subtle transition-all"
                          title={`Add "${preset?.label || preset?.type}"`}
                        >
                          <span className="w-6 h-6 shrink-0 rounded-md bg-brand-subtle text-[var(--brand-bright)] flex items-center justify-center">
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-[var(--text-primary)] truncate">
                              {preset?.label || 'Untitled'}
                            </span>
                          </span>
                          <span className="hidden sm:block"><LibraryChip type={preset?.type} /></span>
                          <Plus className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--brand-bright)]" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ─── Runtime preview of one field ─────────────────────────────────────────────

function ConditionalBadge({ field, allFields }) {
  if (!field?.visibleWhen || !field.visibleWhen.field) return null
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-brand-subtle text-[var(--brand-bright)] max-w-full"
      title={`Shown when ${describeCondition(field.visibleWhen, allFields)}`}
    >
      <Filter className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">shown when {describeCondition(field.visibleWhen, allFields)}</span>
    </span>
  )
}

function PreviewField({ field, allFields, scored }) {
  const label = String(field.label || '').trim()
  const weight = Number(field.weight)
  const showPoints = scored && !isLayoutField(field.type) && Number.isFinite(weight) && weight > 0

  if (field.type === 'section') {
    return (
      <div className="pt-4 first:pt-0">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">
            {label || 'Section'}
          </h4>
          <div className="flex-1 h-px bg-[var(--border-dim)]" />
          <ConditionalBadge field={field} allFields={allFields} />
        </div>
      </div>
    )
  }

  const options = Array.isArray(field.options) ? field.options : []

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <label className="block text-sm font-medium text-[var(--text-primary)]">
          {label || <span className="text-[var(--text-muted)] italic">Untitled field</span>}
          {field.required && <span className="text-red-400 ml-1">*</span>}
        </label>
        {showPoints && (
          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-brand-subtle text-[var(--brand-bright)]">
            <Scale className="w-2.5 h-2.5" /> {weight} pt{weight === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {field.type === 'text' && (
        <input disabled placeholder="Short text answer" className={`${INPUT_CLS} cursor-not-allowed`} />
      )}
      {field.type === 'textarea' && (
        <textarea disabled rows={2} placeholder="Longer note…" className={`${INPUT_CLS} cursor-not-allowed resize-none`} />
      )}
      {field.type === 'number' && (
        <input
          disabled
          type="number"
          placeholder={
            field.min != null || field.max != null
              ? `${field.min ?? '−∞'} … ${field.max ?? '∞'}`
              : 'Numeric value'
          }
          className={`${INPUT_CLS} cursor-not-allowed`}
        />
      )}
      {field.type === 'date' && (
        <input disabled type="date" className={`${INPUT_CLS} cursor-not-allowed`} />
      )}
      {field.type === 'select' && (
        <select disabled className={`${INPUT_CLS} cursor-not-allowed`}>
          <option>{options[0] || 'Choose one…'}</option>
        </select>
      )}
      {field.type === 'multiselect' && (
        <div className="flex flex-wrap gap-2">
          {(options.length ? options : ['Option']).map((o, i) => (
            <span key={i} className="px-2.5 py-1 rounded-lg text-xs border border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
              {o}
            </span>
          ))}
        </div>
      )}
      {field.type === 'boolean' && (
        <div className="flex gap-2">
          {['Yes', 'No'].map((o) => (
            <span key={o} className="px-4 py-1.5 rounded-lg text-sm border border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
              {o}
            </span>
          ))}
        </div>
      )}
      {field.type === 'rating' && (
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className="w-5 h-5 text-[var(--text-muted)]" />
          ))}
        </div>
      )}
      {isReferenceField(field.type) && (() => {
        const meta = referenceMeta(field.type)
        return (
          <div className={`${INPUT_CLS} cursor-not-allowed flex items-center gap-2 text-[var(--text-muted)]`}>
            <meta.Icon className="w-4 h-4 shrink-0 text-[var(--brand-bright)]" />
            <span className="flex-1 truncate">{meta.placeholder}</span>
            <ChevronDown className="w-4 h-4 shrink-0" />
          </div>
        )
      })()}
      {field.type === 'photo' && (
        <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-dashed border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-muted)] text-sm">
          <Camera className="w-4 h-4" /> Photo capture
        </div>
      )}
      {field.type === 'signature' && (
        <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-dashed border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-muted)] text-sm">
          <PenLine className="w-4 h-4" /> Signature
        </div>
      )}

      {field.help && <p className="text-xs text-[var(--text-muted)] mt-1">{field.help}</p>}
      {field.allow_photo && field.type !== 'photo' && field.type !== 'signature' && (
        <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
          <Camera className="w-3 h-3" /> Photo attachment allowed
        </p>
      )}
      {field.visibleWhen && field.visibleWhen.field && (
        <div className="mt-1.5">
          <ConditionalBadge field={field} allFields={allFields} />
        </div>
      )}
    </div>
  )
}

// ─── Draft helpers ────────────────────────────────────────────────────────────

function blankDraft(country) {
  return {
    name: '',
    description: '',
    category: '',
    icon: '📋',
    country: country && country !== 'All' ? country : null,
    status: 'draft',
    require_signature: false,
    require_approval: false,
    scored: false,
    pass_threshold: null,
    fields: [],
  }
}

function toDraft(row, country) {
  return {
    name: row.name || '',
    description: row.description || '',
    category: row.category || '',
    icon: row.icon || '📋',
    country: row.country || (country && country !== 'All' ? country : null),
    status: row.status || 'draft',
    require_signature: !!row.require_signature,
    require_approval: !!row.require_approval,
    scored: !!row.scored,
    pass_threshold:
      row.pass_threshold == null || row.pass_threshold === ''
        ? null
        : Math.min(100, Math.max(0, Number(row.pass_threshold))),
    fields: Array.isArray(row.fields) ? row.fields.map((f) => ({ ...newField(f.type), ...f })) : [],
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChecklistBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const isEdit = !!id

  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState(null)
  const [draft, setDraft] = useState(() => (isEdit ? null : blankDraft(activeCountry)))
  const [templateId, setTemplateId] = useState(isEdit ? id : null)

  const [expandedId, setExpandedId] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({}) // fieldId → message
  const [problems, setProblems] = useState([]) // publish validation problems
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  const [dirty, setDirty] = useState(false)

  // ── Load (edit mode) ──
  const load = useCallback(async () => {
    if (!isEdit) return
    setLoading(true)
    setLoadError(null)
    try {
      const row = await getTemplate(id)
      if (!row) {
        setLoadError('This checklist template no longer exists or you do not have access to it.')
        return
      }
      setDraft(toDraft(row, activeCountry))
      setTemplateId(row.id)
      setDirty(false)
    } catch (err) {
      setLoadError(err?.message || 'Failed to load the template.')
    } finally {
      setLoading(false)
    }
  }, [isEdit, id, activeCountry])

  useEffect(() => { load() }, [load])

  // ── Mutators ──
  const set = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
    setSavedNote(null)
  }

  const addField = (type) => {
    const f = newField(type)
    setDraft((d) => ({ ...d, fields: [...(d.fields || []), f] }))
    setExpandedId(f.id)
    setDirty(true)
    setSavedNote(null)
  }

  const addFromLibrary = (preset) => {
    const f = fieldFromLibrary(preset || {})
    setDraft((d) => ({ ...d, fields: [...(d.fields || []), f] }))
    setExpandedId(f.id)
    setDirty(true)
    setSavedNote(null)
    // Bring the newly added field into view on the next paint.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const el = document.getElementById(`field-${f.id}`)
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }

  const changeField = (fieldId, next) => {
    setDraft((d) => ({ ...d, fields: (d.fields || []).map((f) => (f.id === fieldId ? next : f)) }))
    setFieldErrors((e) => { const n = { ...e }; delete n[fieldId]; return n })
    setDirty(true)
    setSavedNote(null)
  }

  const removeField = (index) => {
    setDraft((d) => ({ ...d, fields: (d.fields || []).filter((_, i) => i !== index) }))
    setDirty(true)
    setSavedNote(null)
  }

  const duplicateField = (index) => {
    setDraft((d) => {
      const list = d.fields || []
      const src = list[index]
      if (!src) return d
      const copy = { ...src, ...newField(src.type), label: src.label, help: src.help, required: src.required, allow_photo: src.allow_photo, options: [...(src.options || [])], min: src.min, max: src.max }
      const next = [...list]
      next.splice(index + 1, 0, copy)
      return { ...d, fields: next }
    })
    setDirty(true)
    setSavedNote(null)
  }

  const moveField = (from, to) => {
    setDraft((d) => {
      const list = [...(d.fields || [])]
      if (to < 0 || to >= list.length) return d
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { ...d, fields: list }
    })
    setDirty(true)
    setSavedNote(null)
  }

  const toggleExpand = (fieldId) => setExpandedId((cur) => (cur === fieldId ? null : fieldId))

  // ── Derived counts ──
  const fields = draft?.fields || []
  const contentCount = useMemo(() => fields.filter((f) => !isLayoutField(f.type)).length, [fields])
  const totalPoints = useMemo(
    () =>
      fields.reduce((sum, f) => {
        const w = Number(f?.weight)
        return isValueField(f.type) && Number.isFinite(w) && w > 0 ? sum + w : sum
      }, 0),
    [fields],
  )

  // ── Persistence ──
  // Sanitize a conditional-visibility rule; returns null when incomplete/invalid.
  const sanitizeVisibleWhen = (f, allFields) => {
    const c = f?.visibleWhen
    if (!c || typeof c !== 'object' || !c.field || !c.op) return null
    if (!CONDITION_OP_SET.has(c.op)) return null
    // Guard against self-reference and dangling ids.
    if (c.field === f.id) return null
    const ref = (Array.isArray(allFields) ? allFields : []).find((x) => x && x.id === c.field)
    if (!ref) return null
    const meta = CONDITION_OPS.find((o) => o.op === c.op)
    return {
      field: c.field,
      op: c.op,
      value: meta && meta.needsValue ? String(c.value ?? '') : '',
    }
  }

  const scored = !!draft.scored
  const passThreshold =
    draft.pass_threshold == null || draft.pass_threshold === ''
      ? null
      : Math.min(100, Math.max(0, Number(draft.pass_threshold)))

  const buildValues = (status) => {
    const list = draft.fields || []
    return {
      name: String(draft.name || '').trim(),
      description: String(draft.description || '').trim() || null,
      category: draft.category || null,
      icon: draft.icon || null,
      country: draft.country || (activeCountry !== 'All' ? activeCountry : null),
      status,
      require_signature: !!draft.require_signature,
      require_approval: !!draft.require_approval,
      scored,
      pass_threshold: scored ? passThreshold : null,
      fields: list.map((f) => {
        const valueField = isValueField(f.type)
        const w = Number(f.weight)
        const weight = valueField && Number.isFinite(w) && w > 0 ? w : null
        const passValues =
          valueField && Array.isArray(f.passValues)
            ? f.passValues.filter((v) => v != null && v !== '')
            : []
        return {
          id: f.id,
          type: f.type,
          label: String(f.label || '').trim(),
          help: String(f.help || '').trim(),
          section: f.section ?? null,
          required: !!f.required,
          allow_photo: !!f.allow_photo,
          options: typeHasOptions(f.type) ? (f.options || []).map((o) => String(o).trim()).filter(Boolean) : [],
          min: f.type === 'number' ? (f.min ?? null) : null,
          max: f.type === 'number' ? (f.max ?? null) : null,
          default: f.default ?? '',
          visibleWhen: sanitizeVisibleWhen(f, list),
          weight,
          passValues,
        }
      }),
    }
  }

  // Persist and return the row id (create → new id, update → existing).
  const persist = async (status) => {
    const values = buildValues(status)
    if (templateId) {
      await updateTemplate(templateId, values)
      return templateId
    }
    const row = await createTemplate(values)
    if (row?.id) setTemplateId(row.id)
    return row?.id || null
  }

  const handleSaveDraft = async () => {
    if (!String(draft.name || '').trim()) {
      setSaveError('Give the template a name before saving.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSavedNote(null)
    try {
      const newId = await persist('draft')
      setDirty(false)
      setSavedNote('Draft saved.')
      // Reflect the id in the URL so subsequent saves update (not duplicate).
      if (newId && !isEdit) navigate(`/checklist-builder/${newId}`, { replace: true })
    } catch (err) {
      setSaveError(err?.message || 'Could not save the draft.')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    const found = validateTemplate(buildValues('published'))
    setProblems(found)
    if (found.length) {
      setSaveError(null)
      // Map "Field N needs a label" problems onto rows for inline hints.
      const errs = {}
      fields.forEach((f, i) => {
        if (!String(f.label || '').trim()) errs[f.id] = 'A label is required.'
        else if (typeHasOptions(f.type) && !(f.options || []).filter((o) => String(o).trim()).length) {
          errs[f.id] = 'Add at least one option.'
        }
      })
      setFieldErrors(errs)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSavedNote(null)
    try {
      const newId = await persist('draft')
      if (!newId) throw new Error('Could not resolve the saved template id.')
      await publishTemplate(newId)
      navigate(CHECKLISTS_ROUTE)
    } catch (err) {
      setSaveError(err?.message || 'Publishing failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Checklist Template Builder" subtitle="Loading template…" icon={ClipboardList} />
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,1fr] gap-6">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] animate-pulse" />
            ))}
          </div>
          <div className="h-72 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] animate-pulse" />
        </div>
      </div>
    )
  }

  // ── Load error state ──
  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Checklist Template Builder" subtitle="Design a reusable inspection checklist" icon={ClipboardList} />
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30 max-w-lg">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{loadError}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="btn-secondary text-sm">Retry</button>
            <button onClick={() => navigate(CHECKLISTS_ROUTE)} className="btn-secondary text-sm">Back to checklists</button>
          </div>
        </div>
      </div>
    )
  }

  if (!draft) return null

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title={isEdit ? 'Edit Checklist Template' : 'Checklist Template Builder'}
        subtitle="Design a reusable inspection checklist your team fills out in the field"
        icon={ClipboardList}
        badge={isEdit ? 'Editing' : 'New'}
        actions={
          <button
            type="button"
            onClick={() => navigate(CHECKLISTS_ROUTE)}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,1fr] gap-6">
        {/* ── Left: builder ── */}
        <div className="space-y-6">
          {/* Template settings */}
          <section className="card space-y-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Info className="w-4 h-4 text-[var(--brand-bright)]" /> Template settings
            </h3>

            <div>
              <label className={LABEL_CLS}>
                Template name <span className="text-[var(--brand-bright)]">*</span>
              </label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Daily Pre-Trip Tyre Inspection"
                className={INPUT_CLS}
              />
            </div>

            <div>
              <label className={LABEL_CLS}>
                Description <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                placeholder="What this checklist covers and when to complete it"
                className={`${INPUT_CLS} resize-none`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Category</label>
                <select
                  value={draft.category || ''}
                  onChange={(e) => set('category', e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— Select —</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Country scope</label>
                <input
                  type="text"
                  value={draft.country || 'All countries'}
                  disabled
                  className={`${INPUT_CLS} cursor-not-allowed opacity-70`}
                  title="Scoped to your active country"
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Icon</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {ICON_PRESETS.map((emo) => (
                  <button
                    key={emo}
                    type="button"
                    onClick={() => set('icon', emo)}
                    className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center border transition-all ${
                      draft.icon === emo
                        ? 'border-[var(--brand-bright)] bg-brand-subtle'
                        : 'border-[var(--border-dim)] bg-[var(--surface-2)] hover:border-[var(--brand-bright)]'
                    }`}
                    title={`Use ${emo}`}
                  >
                    {emo}
                  </button>
                ))}
                <input
                  type="text"
                  value={draft.icon || ''}
                  onChange={(e) => set('icon', e.target.value.slice(0, 4))}
                  placeholder="🙂"
                  className="w-16 bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg px-2 py-2 text-center text-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-bright)]"
                  aria-label="Custom emoji"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)]">
                <Toggle
                  checked={!!draft.require_signature}
                  onChange={(v) => set('require_signature', v)}
                  label="Require signature"
                  hint="Sign-off before submitting"
                />
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)]">
                <Toggle
                  checked={!!draft.require_approval}
                  onChange={(v) => set('require_approval', v)}
                  label="Require approval"
                  hint="Route through the approval engine"
                />
              </div>
            </div>

            {/* Scoring */}
            <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] space-y-3">
              <Toggle
                checked={!!draft.scored}
                onChange={(v) => set('scored', v)}
                label="Scored checklist"
                hint="Weight answers and compute a pass/fail percentage"
              />
              {draft.scored && (
                <div className="pt-1 border-t border-[var(--border-dim)]">
                  <label className={`${LABEL_CLS} mt-2 flex items-center gap-1.5`}>
                    <Target className="w-3 h-3" /> Pass threshold %
                  </label>
                  <div className="flex items-center gap-2 max-w-[180px]">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={draft.pass_threshold ?? ''}
                      onChange={(e) =>
                        set(
                          'pass_threshold',
                          e.target.value === ''
                            ? null
                            : Math.min(100, Math.max(0, Number(e.target.value))),
                        )
                      }
                      placeholder="e.g. 80"
                      className={INPUT_CLS}
                    />
                    <span className="text-sm text-[var(--text-muted)]">%</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                    Set the minimum score needed to pass. Give each field a weight in its editor.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Fields */}
          <section className="card space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                  Fields
                  {dirty && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      Unsaved changes
                    </span>
                  )}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {fields.length} field{fields.length === 1 ? '' : 's'} · {contentCount} answerable
                  {scored && totalPoints > 0 ? ` · ${totalPoints} pt${totalPoints === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <AddFieldMenu onAdd={addField} />
            </div>

            <FieldLibraryPanel onAdd={addFromLibrary} />

            {fields.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-[var(--border-dim)] bg-[var(--surface-2)]">
                <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-3">
                  <ClipboardList className="w-6 h-6 text-[var(--brand-bright)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">No fields yet</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs">
                  Start from the <span className="text-[var(--brand-bright)] font-medium">library</span> above for common
                  tyre &amp; safety checks, or use <span className="text-[var(--brand-bright)] font-medium">Add field</span> to
                  build one from scratch. Reference fields (Asset, Site, User) pull live data at check time.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {fields.map((f, i) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    index={i}
                    total={fields.length}
                    expanded={expandedId === f.id}
                    error={fieldErrors[f.id]}
                    allFields={fields}
                    scored={!!draft.scored}
                    onToggleExpand={toggleExpand}
                    onChange={(next) => changeField(f.id, next)}
                    onMove={moveField}
                    onRemove={removeField}
                    onDuplicate={duplicateField}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Publish problems */}
          {problems.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1.5">
              <p className="text-amber-300 text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Resolve before publishing
              </p>
              <ul className="list-disc list-inside text-amber-200/90 text-xs space-y-0.5">
                {problems.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}

          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-400 text-xs">{saveError}</p>
            </div>
          )}
          {savedNote && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <CheckCircle2 className="w-4 h-4 text-[var(--brand-bright)] shrink-0" />
              <p className="text-[var(--brand-bright)] text-xs font-medium">{savedNote}</p>
            </div>
          )}
        </div>

        {/* ── Right: live preview ── */}
        <div className="lg:sticky lg:top-4 self-start">
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-4 h-4 text-[var(--brand-bright)]" />
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Live preview</h3>
            </div>

            <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] p-4">
              <div className="flex items-start gap-3 pb-4 mb-4 border-b border-[var(--border-dim)]">
                <span className="text-2xl leading-none">{draft.icon || '📋'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                    {String(draft.name || '').trim() || <span className="text-[var(--text-muted)] italic">Untitled checklist</span>}
                  </p>
                  {draft.description
                    ? <p className="text-xs text-[var(--text-muted)] mt-0.5">{draft.description}</p>
                    : draft.category
                      ? <p className="text-xs text-[var(--text-muted)] mt-0.5">{draft.category}</p>
                      : null}
                  {draft.scored && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-brand-subtle text-[var(--brand-bright)]">
                        <Scale className="w-2.5 h-2.5" /> {totalPoints} pt{totalPoints === 1 ? '' : 's'} total
                      </span>
                      {draft.pass_threshold != null && draft.pass_threshold !== '' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-brand-subtle text-[var(--brand-bright)]">
                          <Target className="w-2.5 h-2.5" /> pass ≥ {Number(draft.pass_threshold)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {fields.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic text-center py-8">
                  Fields you add appear here exactly as they will at runtime.
                </p>
              ) : (
                <div className="space-y-4">
                  {fields.map((f) => (
                    <PreviewField key={f.id} field={f} allFields={fields} scored={!!draft.scored} />
                  ))}
                </div>
              )}

              {(draft.require_signature || draft.require_approval) && (
                <div className="mt-4 pt-4 border-t border-[var(--border-dim)] space-y-3">
                  {draft.require_signature && (
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)] mb-1.5">Signature <span className="text-red-400">*</span></p>
                      <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-dashed border-[var(--border-dim)] text-[var(--text-muted)] text-sm">
                        <PenLine className="w-4 h-4" /> Signature
                      </div>
                    </div>
                  )}
                  {draft.require_approval && (
                    <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Submission routes for approval
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-3 leading-relaxed">
              Fields render read-only here. Required questions are marked with a red asterisk.
              Reference fields (Asset, Site, User) load live options at check time.
            </p>
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-10 lg:pl-[var(--sidebar-w,0px)]">
        <div className="border-t border-[var(--border-dim)] bg-[var(--surface-1)]/95 backdrop-blur-sm px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)] hidden sm:flex items-center gap-1.5">
            <span>
              {contentCount} answerable field{contentCount === 1 ? '' : 's'}
              {draft.status === 'published' ? ' · currently published' : ' · draft'}
            </span>
            {dirty && (
              <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Unsaved
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              className="btn-secondary text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save draft
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Publish
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
