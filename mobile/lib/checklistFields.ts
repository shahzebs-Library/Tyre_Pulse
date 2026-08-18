/**
 * checklistFields — runtime helpers for filling a checklist on mobile. A pure
 * TypeScript port of the web engine's runtime subset (src/lib/checklist/
 * fieldTypes.js): visibility, validation and scoring. The two stacks
 * intentionally keep independent copies (as with auditDiff).
 *
 * SIGNATURES ARE A MAP KEYED BY FIELD ID, NOT ONE VALUE. This file used to take
 * a single `signatureData: string | null`, mirroring the fill screen's single
 * piece of state, and that was the bug: a workshop sheet is signed off by three
 * trades (mechanic, auto electrician, inspecting engineer) as three separate
 * `signature` fields. With one slot, signing the second overwrote the first,
 * only the last survived to the database, and `isFieldAnswered` returned true
 * for EVERY signature field the moment any one of them was signed - so the
 * progress counter read "3 of 3 done" with one signature captured. The web
 * engine has been keyed by field id since ChecklistRun's own fix; mobile now
 * matches. `validateSignatures` is ported for the same reason: a required
 * signature that is missing must name WHICH one.
 */

export type FieldType =
  | 'section' | 'text' | 'textarea' | 'number' | 'select' | 'multiselect'
  | 'boolean' | 'date' | 'rating' | 'asset' | 'site' | 'user' | 'photo' | 'signature'

export type ReferenceSource = 'asset' | 'site' | 'user'
export const REFERENCE_TYPES: FieldType[] = ['asset', 'site', 'user']
export function isReferenceField(type?: string): boolean {
  return REFERENCE_TYPES.includes(type as FieldType)
}
export function referenceSource(type?: string): ReferenceSource | null {
  return isReferenceField(type) ? (type as ReferenceSource) : null
}

// Auto-filled + locked fields (inspector = current user, date = today).
export const AUTO_VALUES = ['current_user', 'today']
export function isAutoField(field: any): boolean {
  return AUTO_VALUES.includes(field?.autoValue)
}
export function resolveAutoValue(field: any, ctx: { userName?: string; today?: string } = {}): string {
  if (field?.autoValue === 'current_user') return ctx.userName || ''
  if (field?.autoValue === 'today') return ctx.today || new Date().toISOString().slice(0, 10)
  return ''
}

export interface VisibleWhen { field: string; op: string; value?: any }

export interface ChecklistField {
  id: string
  type: FieldType
  label?: string
  help?: string
  required?: boolean
  allow_photo?: boolean
  /** Renders the per-line Remarks box. On a paper-derived sheet this is where a
   *  fitter says WHY a line failed, so a submission without it records the fail
   *  with no reason and reads as "nothing to report" in the web viewer. */
  allow_note?: boolean
  options?: string[]
  /** Points at a SHARED option set on the template (template.option_sets). When
   *  present it is the live source and `options` is only a stale fallback. */
  options_ref?: string | null
  /** Per-language label overrides, { ar, hi, ur }, beside the English `label`. */
  labels?: Record<string, string> | null
  /** Per-language option lists parallel to `options`. */
  options_i18n?: Record<string, string[]> | null
  min?: number | null
  max?: number | null
  default?: any
  visibleWhen?: VisibleWhen | VisibleWhen[] | null
  weight?: number | null
  passValues?: any[]
}

export type Answers = Record<string, any>

export function isLayoutField(type?: string): boolean {
  return type === 'section'
}
export function isValueField(type?: string): boolean {
  return !['section', 'photo', 'signature'].includes(type || '')
}

/**
 * A field the run screen renders as a tappable tile (everything except the
 * layout-only `section` heading). Photo and signature items are recordable too.
 */
export function isRecordableField(type?: string): boolean {
  return type !== 'section'
}

/**
 * Whether a recordable field has been answered. Photos count when at least one
 * image is attached; a signature counts when data is present; value fields count
 * when non-empty. Used for live progress + tile state on the fill screen.
 */
export type Signatures = Record<string, string>

export function isFieldAnswered(
  field: ChecklistField,
  answers: Answers = {},
  photos: Record<string, string[]> = {},
  signatures: Signatures = {},
): boolean {
  if (!field || field.type === 'section') return false
  if (field.type === 'photo') return (photos[field.id]?.length ?? 0) > 0
  // Keyed by THIS field's id. Reading a single shared value here is what made
  // every signature tile flip to "done" as soon as one of them was signed.
  if (field.type === 'signature') return !!signatures?.[field.id]
  const v = answers[field.id]
  return !(v == null || v === '' || (Array.isArray(v) && v.length === 0))
}

/** Short human summary of a field's current answer, for the tile status pill. */
export function fieldSummaryText(
  field: ChecklistField,
  answers: Answers = {},
  photos: Record<string, string[]> = {},
  signatures: Signatures = {},
): string {
  if (!field) return ''
  if (field.type === 'photo') {
    const n = photos[field.id]?.length ?? 0
    return n > 0 ? `${n} photo${n === 1 ? '' : 's'}` : ''
  }
  if (field.type === 'signature') return signatures?.[field.id] ? 'Signed' : ''
  const v = answers[field.id]
  if (v == null || v === '') return ''
  if (field.type === 'boolean') return v === true ? 'Yes' : v === false ? 'No' : ''
  if (field.type === 'rating') return Number(v) > 0 ? `${Number(v)}/5` : ''
  if (Array.isArray(v)) return v.length ? `${v.length} selected` : ''
  return String(v)
}

export function blankAnswer(field: ChecklistField): any {
  switch (field?.type) {
    case 'multiselect': return []
    case 'boolean':     return null
    case 'rating':      return 0
    case 'number':      return ''
    default:            return field?.default ?? ''
  }
}

const COND_OPS = ['=', '!=', '>', '>=', '<', '<=', 'includes', 'in', 'empty', 'not_empty']

export function evalCondition(op: string, actual: any, expected: any): boolean {
  const num = (x: any) => (x === '' || x == null ? NaN : Number(x))
  switch (op) {
    case '=':  return String(actual ?? '') === String(expected ?? '')
    case '!=': return String(actual ?? '') !== String(expected ?? '')
    case '>':  return num(actual) > num(expected)
    case '>=': return num(actual) >= num(expected)
    case '<':  return num(actual) < num(expected)
    case '<=': return num(actual) <= num(expected)
    case 'includes':
      return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').includes(String(expected ?? ''))
    case 'in':
      return Array.isArray(expected) ? expected.map(String).includes(String(actual ?? '')) : String(actual ?? '') === String(expected ?? '')
    case 'empty':     return actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0)
    case 'not_empty': return !(actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0))
    default: return true
  }
}

function conditionMet(cond: any, answers: Answers): boolean {
  if (!cond || !cond.field || !cond.op) return true
  if (!COND_OPS.includes(cond.op)) return true
  return evalCondition(cond.op, answers?.[cond.field], cond.value)
}

export function isFieldVisible(field: ChecklistField, answers: Answers = {}): boolean {
  const c: any = field?.visibleWhen
  if (!c) return true
  if (Array.isArray(c)) return c.every((cond) => conditionMet(cond, answers))
  return conditionMet(c, answers)
}

/**
 * Visible fields INCLUDING section pruning: a section header is dropped when
 * every check under it (up to the next section) is hidden by its visibleWhen
 * rule, so an interval-scoped checklist never shows empty category headers.
 * Mirrors web src/lib/checklist/fieldTypes.js visibleFields().
 */
export function visibleChecklistFields(
  fields: ChecklistField[] | null | undefined,
  answers: Answers = {},
): ChecklistField[] {
  const list = (Array.isArray(fields) ? fields : []).filter(
    (f) => f && f.type && isFieldVisible(f, answers),
  )
  return list.filter((f, i) => {
    if (f.type !== 'section') return true
    const next = list[i + 1]
    return !!next && next.type !== 'section'
  })
}

/**
 * Validate one answer.
 *
 * `opts.label`   - the TRANSLATED label, so the message names the line as the
 *                  reader sees it rather than in English.
 * `opts.options` - the allowed ENGLISH values when the field takes them from a
 *                  shared option set (`options_ref`) instead of its own list.
 *                  Validating against the field's stale `options` copy is how a
 *                  perfectly valid answer got rejected after an admin edited
 *                  the shared legend.
 */
export interface ValidateOpts { label?: string; options?: string[] }

export function validateAnswer(field: ChecklistField, value: any, opts: ValidateOpts = {}): string | null {
  if (!field || isLayoutField(field.type)) return null
  const name = String(opts.label || field.label || '').trim()
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
  if (field.required && empty) return `${name || 'This field'} is required`
  if (empty) return null
  if (field.type === 'number') {
    const n = Number(value)
    if (Number.isNaN(n)) return `${name || 'Value'} must be a number`
    if (field.min != null && n < Number(field.min)) return `${name || 'Value'} must be at least ${field.min}`
    if (field.max != null && n > Number(field.max)) return `${name || 'Value'} must be at most ${field.max}`
  }
  // Resolved shared-set values win; the field's own list is the fallback; when
  // neither is known the membership check is SKIPPED rather than rejecting a
  // valid answer.
  const allowed = Array.isArray(opts.options) && opts.options.length
    ? opts.options
    : (Array.isArray(field.options) ? field.options : [])
  if (field.type === 'select' && allowed.length && !allowed.includes(value)) {
    return `Choose a valid option for ${name || 'this field'}`
  }
  if (field.type === 'multiselect' && allowed.length) {
    const bad = (Array.isArray(value) ? value : []).filter((v) => !allowed.includes(v))
    if (bad.length) return `Invalid option(s) for ${name || 'this field'}`
  }
  if (field.type === 'rating') {
    const n = Number(value)
    if (Number.isNaN(n) || n < 0 || n > 5) return `${name || 'Rating'} must be 0-5`
  }
  return null
}

/** The signature-type fields of a template, in template order. */
export function signatureFields(fields: ChecklistField[] | null | undefined): ChecklistField[] {
  return (Array.isArray(fields) ? fields : []).filter((f) => f?.type === 'signature' && f.id)
}

/**
 * Required signature fields that have not been signed. A sheet signed off by
 * three trades has three separate required signatures, so each is validated
 * like any other required answer and a missing one names WHICH signature it is.
 * Hidden fields are exempt, exactly as for value fields.
 */
export function validateSignatures(
  fields: ChecklistField[] | null | undefined,
  signatures: Signatures = {},
  answers: Answers = {},
  opts: { labelFor?: (f: ChecklistField) => string } = {},
): Record<string, string> {
  const errors: Record<string, string> = {}
  const labelOf = typeof opts.labelFor === 'function' ? opts.labelFor : null
  for (const f of signatureFields(fields)) {
    if (!f.required) continue
    if (!isFieldVisible(f, answers)) continue
    const signed = signatures?.[f.id]
    if (typeof signed === 'string' && signed) continue
    const name = String((labelOf && labelOf(f)) || f.label || '').trim()
    errors[f.id] = `${name || 'Signature'} is required`
  }
  return errors
}

/**
 * Validate a whole template's answers.
 *
 * `opts.signatures` - the { fieldId: dataUrl } map. When provided, required
 *   signature FIELDS are validated too. Omitted (the historic two-argument
 *   call) they are skipped exactly as before, so no existing caller changes
 *   behaviour by upgrading.
 * `opts.labelFor` / `opts.optionsFor` - hooks the run screen supplies so the
 *   translated label and the resolved shared-set options reach validateAnswer.
 */
export interface SubmissionOpts {
  signatures?: Signatures
  labelFor?: (f: ChecklistField) => string
  optionsFor?: (f: ChecklistField) => string[]
}

export function validateSubmission(
  fields: ChecklistField[], answers: Answers, opts: SubmissionOpts = {},
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const labelOf = typeof opts.labelFor === 'function' ? opts.labelFor : null
  const optionsOf = typeof opts.optionsFor === 'function' ? opts.optionsFor : null
  for (const f of Array.isArray(fields) ? fields : []) {
    if (isLayoutField(f.type) || f.type === 'photo' || f.type === 'signature') continue
    if (!isFieldVisible(f, answers)) continue
    const err = validateAnswer(f, answers?.[f.id], {
      label: labelOf ? labelOf(f) : undefined,
      options: optionsOf ? optionsOf(f) : undefined,
    })
    if (err) errors[f.id] = err
  }
  if (opts.signatures) {
    Object.assign(errors, validateSignatures(fields, opts.signatures, answers, opts))
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

/**
 * Is the template's TEMPLATE-LEVEL signature requirement satisfied?
 *
 * `require_signature` is a flag on the template, but the only way to capture a
 * signature is a `signature` FIELD. A template with the flag set and no such
 * field was therefore impossible to submit on mobile: the operator filled every
 * line, pressed Submit, was told a signature was required, and had no control
 * anywhere on the screen that could produce one. Work was lost on back-out.
 *
 * The web solves it with a template-level pad rendered independently of the
 * fields, satisfied by that pad OR any signed signature field. This returns the
 * same answer, so the caller can render the standalone pad only when it is
 * actually needed.
 */
export function requiresPrimarySignature(template: { require_signature?: boolean; fields?: ChecklistField[] } | null | undefined): boolean {
  return !!template?.require_signature
}

export function primarySignatureSatisfied(
  template: { require_signature?: boolean; fields?: ChecklistField[] } | null | undefined,
  signatures: Signatures = {},
  primary: string | null = null,
): boolean {
  if (!template?.require_signature) return true
  if (typeof primary === 'string' && primary) return true
  return signatureFields(template?.fields).some((f) => !!signatures?.[f.id])
}

export interface Score { scored: number; earned: number; possible: number; pct: number | null; passed: boolean | null }

export function computeScore(fields: ChecklistField[], answers: Answers = {}, passThreshold: number | null = null): Score {
  let earned = 0, possible = 0, scored = 0
  for (const f of Array.isArray(fields) ? fields : []) {
    const w = Number(f?.weight)
    if (!f || isLayoutField(f.type) || !Number.isFinite(w) || w <= 0) continue
    if (!isFieldVisible(f, answers)) continue
    scored += 1
    possible += w
    const val = answers?.[f.id]
    let pass: boolean
    if (Array.isArray(f.passValues) && f.passValues.length) {
      pass = Array.isArray(val) ? val.some((v) => f.passValues!.includes(v)) : f.passValues.includes(val)
    } else {
      pass = !(val == null || val === '' || (Array.isArray(val) && val.length === 0))
    }
    if (pass) earned += w
  }
  const pct = possible > 0 ? Math.round((earned / possible) * 100) : null
  const passed = pct != null && passThreshold != null ? pct >= Number(passThreshold) : null
  return { scored, earned, possible, pct, passed }
}
