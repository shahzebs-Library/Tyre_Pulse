/**
 * Checklist field-type registry — the single source of truth shared by the
 * template builder, the runtime form, and read-only rendering. Pure module: no
 * React, no network. Field shape (embedded in checklist_templates.fields):
 *   { id, type, label, help, section?, required, allow_photo, options[], min, max, default }
 */

// Stable id for a new field (browser crypto with a safe fallback).
export function newFieldId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `f_${crypto.randomUUID().slice(0, 8)}`
  } catch { /* fall through */ }
  return `f_${Math.abs(Date.now() ^ Math.floor(Math.random() * 1e9)).toString(36)}`
}

/**
 * The catalogue. `hasOptions` → the builder shows an options editor;
 * `standalone` types (section/photo/signature) carry no answer value of their
 * own (section is a layout divider; photo/signature are captured separately).
 */
export const FIELD_TYPES = [
  { type: 'section',     label: 'Section heading', hasOptions: false, group: 'layout',  desc: 'A titled divider to group fields.' },
  { type: 'text',        label: 'Short text',      hasOptions: false, group: 'input',   desc: 'A single line of free text.' },
  { type: 'textarea',    label: 'Long text',       hasOptions: false, group: 'input',   desc: 'A multi-line note.' },
  { type: 'number',      label: 'Number',          hasOptions: false, group: 'input',   desc: 'A numeric value with optional min/max.' },
  { type: 'select',      label: 'Single choice',   hasOptions: true,  group: 'choice',  desc: 'Pick one from a list.' },
  { type: 'multiselect', label: 'Multiple choice', hasOptions: true,  group: 'choice',  desc: 'Pick any number from a list.' },
  { type: 'boolean',     label: 'Yes / No',        hasOptions: false, group: 'choice',  desc: 'A pass/fail or yes/no toggle.' },
  { type: 'date',        label: 'Date',            hasOptions: false, group: 'input',   desc: 'A calendar date.' },
  { type: 'rating',      label: 'Rating (1-5)',    hasOptions: false, group: 'choice',  desc: 'A 1 to 5 star/score rating.' },
  // Reference fields resolve real data at fill time (no manual options).
  { type: 'asset',       label: 'Asset / Vehicle', hasOptions: false, group: 'reference', source: 'asset', desc: 'Pick a real asset from the fleet.' },
  { type: 'site',        label: 'Site',            hasOptions: false, group: 'reference', source: 'site',  desc: 'Pick a real site from the Sites master.' },
  { type: 'user',        label: 'User / Person',   hasOptions: false, group: 'reference', source: 'user',  desc: 'Pick a real user from your organisation.' },
  { type: 'photo',       label: 'Photo capture',   hasOptions: false, group: 'media',   desc: 'One or more photos.' },
  { type: 'signature',   label: 'Signature',       hasOptions: false, group: 'media',   desc: 'A captured signature.' },
]

// Reference field types resolve their choices from live data at fill time.
export const REFERENCE_TYPES = ['asset', 'site', 'user']
export function isReferenceField(type) { return REFERENCE_TYPES.includes(type) }
export function referenceSource(type) { return fieldTypeDef(type)?.source || null }

// Auto-filled fields are prefilled from context and locked at fill time.
export const AUTO_VALUES = ['current_user', 'today']
export function isAutoField(field) { return AUTO_VALUES.includes(field?.autoValue) }

/**
 * The value an auto field should carry, from live context. `ctx.userName` is the
 * signed-in operator; `ctx.today` an ISO date (defaults to now). Returns '' when
 * the field isn't auto.
 */
export function resolveAutoValue(field, ctx = {}) {
  if (field?.autoValue === 'current_user') return ctx.userName || ''
  if (field?.autoValue === 'today') return ctx.today || new Date().toISOString().slice(0, 10)
  return ''
}

/**
 * Curated, ready-to-add field suggestions grouped by category. The builder lets
 * a designer click one to drop a fully-configured field in — so common tyre /
 * fleet / safety checks don't have to be hand-built each time.
 */
export const FIELD_LIBRARY = [
  {
    category: 'Identification',
    fields: [
      { label: 'Asset / Vehicle', type: 'asset', required: true },
      { label: 'Site', type: 'site', required: true },
      { label: 'Inspector', type: 'user', required: true, autoValue: 'current_user' },
      { label: 'Date of check', type: 'date', required: true, autoValue: 'today' },
      { label: 'KM meter (km)', type: 'number', min: 0 },
      { label: 'Hour meter (hrs)', type: 'number', min: 0 },
      { label: 'Inspection interval', type: 'select', options: ['Monthly', 'Quarterly', 'Semi-annual', 'Annual', '4-Yearly'], required: true },
    ],
  },
  {
    category: 'Tyre',
    fields: [
      { label: 'Tyre pressure (bar)', type: 'number', min: 0, max: 15, weight: 2, allow_photo: true },
      { label: 'Tread depth (mm)', type: 'number', min: 0, max: 30, weight: 2 },
      { label: 'Tyre condition', type: 'select', options: ['Good', 'Worn', 'Damaged', 'Flat', 'Missing'], weight: 3, passValues: ['Good'] },
      { label: 'Visible damage?', type: 'boolean', allow_photo: true, weight: 2, passValues: [false] },
      { label: 'Tyre position', type: 'select', options: ['Steer', 'Drive', 'Trailer', 'Spare'] },
    ],
  },
  {
    category: 'Vehicle & Safety',
    fields: [
      { label: 'Brakes OK?', type: 'boolean', weight: 3, passValues: [true] },
      { label: 'Lights working?', type: 'boolean', weight: 2, passValues: [true] },
      { label: 'Wheel nuts torqued?', type: 'boolean', weight: 3, passValues: [true] },
      { label: 'Overall safety rating', type: 'rating' },
      { label: 'Photo of any issue', type: 'photo' },
    ],
  },
  {
    category: 'Sign-off',
    fields: [
      { label: 'Notes / observations', type: 'textarea' },
      { label: 'Action required?', type: 'boolean' },
      { label: 'Follow-up owner', type: 'user' },
      { label: 'Signature', type: 'signature' },
    ],
  },
]

/** Build a field from a library suggestion, merging its preset over defaults. */
export function fieldFromLibrary(preset = {}) {
  const base = newField(preset.type || 'text')
  return {
    ...base,
    ...preset,
    id: base.id, // always a fresh id
    options: preset.options ?? base.options,
    passValues: preset.passValues ?? base.passValues,
  }
}

const BY_TYPE = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f]))

export function fieldTypeDef(type) {
  return BY_TYPE[type] || null
}

export function typeHasOptions(type) {
  return !!BY_TYPE[type]?.hasOptions
}

// Layout-only field (no answer value).
export function isLayoutField(type) {
  return type === 'section'
}

// A field that stores an answer value (everything except section/photo/signature,
// which are handled through dedicated capture surfaces).
export function isValueField(type) {
  return !['section', 'photo', 'signature'].includes(type)
}

/** Build a fresh field of a given type with sensible defaults. */
export function newField(type = 'text') {
  const def = BY_TYPE[type] || BY_TYPE.text
  return {
    id: newFieldId(),
    type: def.type,
    label: def.type === 'section' ? 'New section' : '',
    help: '',
    required: false,
    allow_photo: false,
    options: def.hasOptions ? ['Option 1', 'Option 2'] : [],
    min: null,
    max: null,
    default: def.type === 'multiselect' ? [] : '',
    // Auto-fill + lock: 'current_user' prefills the signed-in user's name,
    // 'today' prefills the current date; both render read-only. `null` = normal.
    autoValue: null,
    // Conditional visibility: show this field only when another field's answer
    // matches. `null` = always visible. Shape: { field, op, value }.
    visibleWhen: null,
    // Scoring: an optional weight (points) + the answers that "pass". `null`
    // weight = the field is not scored.
    weight: null,
    passValues: [],
  }
}

const COND_OPS = ['=', '!=', '>', '>=', '<', '<=', 'includes', 'in', 'empty', 'not_empty']

/** Compare a value against a condition operator. Pure, null-safe. */
export function evalCondition(op, actual, expected) {
  const a = actual, e = expected
  const num = (x) => (x === '' || x == null ? NaN : Number(x))
  switch (op) {
    case '=':  return String(a ?? '') === String(e ?? '')
    case '!=': return String(a ?? '') !== String(e ?? '')
    case '>':  return num(a) > num(e)
    case '>=': return num(a) >= num(e)
    case '<':  return num(a) < num(e)
    case '<=': return num(a) <= num(e)
    case 'includes': return Array.isArray(a) ? a.includes(e) : String(a ?? '').includes(String(e ?? ''))
    // The answer (a single value) is one of the expected set (array). Used for
    // "this check applies to vehicle types X/Y/Z".
    case 'in': return Array.isArray(e) ? e.map(String).includes(String(a ?? '')) : String(a ?? '') === String(e ?? '')
    case 'empty':     return a == null || a === '' || (Array.isArray(a) && a.length === 0)
    case 'not_empty': return !(a == null || a === '' || (Array.isArray(a) && a.length === 0))
    default: return true
  }
}

// A single {field,op,value} rule. Fails open (visible) if malformed.
function conditionMet(cond, answers) {
  if (!cond || !cond.field || !cond.op) return true
  if (!COND_OPS.includes(cond.op)) return true
  return evalCondition(cond.op, answers?.[cond.field], cond.value)
}

/**
 * Is a field currently visible given the answers so far? `visibleWhen` may be:
 *   null                       → always visible
 *   { field, op, value }       → single condition
 *   [ {…}, {…}, … ]            → ALL conditions must hold (AND)
 * A malformed/incomplete rule fails open so a misconfigured template never hides
 * everything.
 */
export function isFieldVisible(field, answers = {}) {
  const c = field?.visibleWhen
  if (!c) return true
  if (Array.isArray(c)) return c.every((cond) => conditionMet(cond, answers))
  return conditionMet(c, answers)
}

/**
 * Compute a weighted score for a submission. Only fields with a numeric
 * `weight` count. A field "passes" when its answer is in `passValues` (for
 * choice/boolean) or is non-empty (fallback). Hidden fields are excluded.
 * Returns { scored, earned, possible, pct, passed:boolean|null } — `passed`
 * compares pct against `template.pass_threshold` when provided.
 */
export function computeScore(fields, answers = {}, passThreshold = null) {
  let earned = 0, possible = 0, scored = 0
  for (const f of Array.isArray(fields) ? fields : []) {
    const w = Number(f?.weight)
    if (!f || isLayoutField(f.type) || !Number.isFinite(w) || w <= 0) continue
    if (!isFieldVisible(f, answers)) continue
    scored += 1
    possible += w
    const val = answers?.[f.id]
    let pass
    if (Array.isArray(f.passValues) && f.passValues.length) {
      pass = Array.isArray(val) ? val.some((v) => f.passValues.includes(v)) : f.passValues.includes(val)
    } else {
      pass = !(val == null || val === '' || (Array.isArray(val) && val.length === 0))
    }
    if (pass) earned += w
  }
  const pct = possible > 0 ? Math.round((earned / possible) * 100) : null
  const passed = pct != null && passThreshold != null ? pct >= Number(passThreshold) : null
  return { scored, earned, possible, pct, passed }
}

/** The empty/initial answer for a field. */
export function blankAnswer(field) {
  switch (field?.type) {
    case 'multiselect': return []
    case 'boolean':     return null
    case 'rating':      return 0
    case 'number':      return ''
    default:            return field?.default ?? ''
  }
}

/**
 * Validate one answer against its field. Returns an error string, or null when
 * valid. Only enforces what the field declares (required, numeric bounds, that a
 * choice is within the option set).
 */
export function validateAnswer(field, value) {
  if (!field || isLayoutField(field.type)) return null
  const empty =
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)

  if (field.required && empty) return `${field.label || 'This field'} is required`
  if (empty) return null

  if (field.type === 'number') {
    const n = Number(value)
    if (Number.isNaN(n)) return `${field.label || 'Value'} must be a number`
    if (field.min != null && n < Number(field.min)) return `${field.label || 'Value'} must be ≥ ${field.min}`
    if (field.max != null && n > Number(field.max)) return `${field.label || 'Value'} must be ≤ ${field.max}`
  }
  if (field.type === 'select' && field.options?.length && !field.options.includes(value)) {
    return `Choose a valid option for ${field.label || 'this field'}`
  }
  if (field.type === 'multiselect' && field.options?.length) {
    const bad = (Array.isArray(value) ? value : []).filter((v) => !field.options.includes(v))
    if (bad.length) return `Invalid option(s) for ${field.label || 'this field'}`
  }
  if (field.type === 'rating') {
    const n = Number(value)
    if (Number.isNaN(n) || n < 0 || n > 5) return `${field.label || 'Rating'} must be 0-5`
  }
  return null
}

/**
 * Validate a whole template's answers. Returns { valid, errors:{fieldId:msg} }.
 * `fields` = template.fields, `answers` = { fieldId: value }.
 */
export function validateSubmission(fields, answers) {
  const errors = {}
  for (const f of Array.isArray(fields) ? fields : []) {
    if (isLayoutField(f.type) || f.type === 'photo' || f.type === 'signature') continue
    // A hidden (conditionally excluded) field is not required/validated.
    if (!isFieldVisible(f, answers)) continue
    const err = validateAnswer(f, answers?.[f.id])
    if (err) errors[f.id] = err
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

/**
 * Structural check for a template before publishing. Returns a list of
 * human-readable problems (empty = publishable).
 */
export function validateTemplate(template) {
  const problems = []
  if (!template) return ['Template is empty.']
  if (!String(template.name || '').trim()) problems.push('Give the template a name.')
  const fields = Array.isArray(template.fields) ? template.fields : []
  const content = fields.filter((f) => !isLayoutField(f.type))
  if (content.length === 0) problems.push('Add at least one field.')
  fields.forEach((f, i) => {
    if (!String(f.label || '').trim()) problems.push(`Field ${i + 1} needs a label.`)
    if (typeHasOptions(f.type) && !(f.options || []).filter((o) => String(o).trim()).length) {
      problems.push(`"${f.label || `Field ${i + 1}`}" needs at least one option.`)
    }
  })
  return problems
}

export default {
  FIELD_TYPES, fieldTypeDef, typeHasOptions, isLayoutField, isValueField,
  newField, newFieldId, blankAnswer, validateAnswer, validateSubmission, validateTemplate,
  evalCondition, isFieldVisible, computeScore,
  REFERENCE_TYPES, isReferenceField, referenceSource, FIELD_LIBRARY, fieldFromLibrary,
  AUTO_VALUES, isAutoField, resolveAutoValue,
}
