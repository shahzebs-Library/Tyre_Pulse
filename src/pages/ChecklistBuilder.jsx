import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ClipboardList, Plus, Trash2, Save, Loader2, Upload, ArrowLeft,
  ChevronUp, ChevronDown, GripVertical, AlertCircle, CheckCircle2, XCircle,
  Type, AlignLeft, Hash, List, ListChecks, ToggleRight, Calendar, Star,
  Camera, PenLine, Heading, Eye, Copy, X, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  FIELD_TYPES, newField, typeHasOptions, isLayoutField, validateTemplate, fieldTypeDef,
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
  photo: Camera,
  signature: PenLine,
}

const GROUP_LABELS = {
  layout: 'Layout',
  input: 'Input',
  choice: 'Choice',
  media: 'Media',
}
const GROUP_ORDER = ['layout', 'input', 'choice', 'media']

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

// ─── Field editor row ─────────────────────────────────────────────────────────

function FieldRow({ field, index, total, expanded, error, onToggleExpand, onChange, onMove, onRemove, onDuplicate }) {
  const def = fieldTypeDef(field.type)
  const Icon = TYPE_ICON[field.type] || Type
  const layout = isLayoutField(field.type)
  const hasOptions = typeHasOptions(field.type)
  const isMedia = field.type === 'photo' || field.type === 'signature'

  const set = (key, value) => onChange({ ...field, [key]: value })

  return (
    <div
      className={`rounded-xl border bg-[var(--surface-2)] transition-all ${
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

// ─── Runtime preview of one field ─────────────────────────────────────────────

function PreviewField({ field }) {
  const label = String(field.label || '').trim()

  if (field.type === 'section') {
    return (
      <div className="pt-4 first:pt-0">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">
            {label || 'Section'}
          </h4>
          <div className="flex-1 h-px bg-[var(--border-dim)]" />
        </div>
      </div>
    )
  }

  const options = Array.isArray(field.options) ? field.options : []

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
        {label || <span className="text-[var(--text-muted)] italic">Untitled field</span>}
        {field.required && <span className="text-red-400 ml-1">*</span>}
      </label>

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
    setSavedNote(null)
  }

  const addField = (type) => {
    const f = newField(type)
    setDraft((d) => ({ ...d, fields: [...(d.fields || []), f] }))
    setExpandedId(f.id)
    setSavedNote(null)
  }

  const changeField = (fieldId, next) => {
    setDraft((d) => ({ ...d, fields: (d.fields || []).map((f) => (f.id === fieldId ? next : f)) }))
    setFieldErrors((e) => { const n = { ...e }; delete n[fieldId]; return n })
    setSavedNote(null)
  }

  const removeField = (index) => {
    setDraft((d) => ({ ...d, fields: (d.fields || []).filter((_, i) => i !== index) }))
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
    setSavedNote(null)
  }

  const toggleExpand = (fieldId) => setExpandedId((cur) => (cur === fieldId ? null : fieldId))

  // ── Derived counts ──
  const fields = draft?.fields || []
  const contentCount = useMemo(() => fields.filter((f) => !isLayoutField(f.type)).length, [fields])

  // ── Persistence ──
  const buildValues = (status) => ({
    name: String(draft.name || '').trim(),
    description: String(draft.description || '').trim() || null,
    category: draft.category || null,
    icon: draft.icon || null,
    country: draft.country || (activeCountry !== 'All' ? activeCountry : null),
    status,
    require_signature: !!draft.require_signature,
    require_approval: !!draft.require_approval,
    fields: (draft.fields || []).map((f) => ({
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
    })),
  })

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
          </section>

          {/* Fields */}
          <section className="card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Fields</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {fields.length} field{fields.length === 1 ? '' : 's'} · {contentCount} answerable
                </p>
              </div>
              <AddFieldMenu onAdd={addField} />
            </div>

            {fields.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-[var(--border-dim)] bg-[var(--surface-2)]">
                <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-3">
                  <ClipboardList className="w-6 h-6 text-[var(--brand-bright)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">No fields yet</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs">
                  Add sections and questions to build your checklist. Use “Add field” to choose a type.
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
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                    {String(draft.name || '').trim() || <span className="text-[var(--text-muted)] italic">Untitled checklist</span>}
                  </p>
                  {draft.description
                    ? <p className="text-xs text-[var(--text-muted)] mt-0.5">{draft.description}</p>
                    : draft.category
                      ? <p className="text-xs text-[var(--text-muted)] mt-0.5">{draft.category}</p>
                      : null}
                </div>
              </div>

              {fields.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic text-center py-8">
                  Fields you add appear here exactly as they will at runtime.
                </p>
              ) : (
                <div className="space-y-4">
                  {fields.map((f) => <PreviewField key={f.id} field={f} />)}
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
            </p>
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-10 lg:pl-[var(--sidebar-w,0px)]">
        <div className="border-t border-[var(--border-dim)] bg-[var(--surface-1)]/95 backdrop-blur-sm px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)] hidden sm:block">
            {contentCount} answerable field{contentCount === 1 ? '' : 's'}
            {draft.status === 'published' ? ' · currently published' : ' · draft'}
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
