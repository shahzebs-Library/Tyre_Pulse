/**
 * checklistFields — runtime helpers for filling a checklist on mobile. A pure
 * TypeScript port of the web engine's runtime subset (src/lib/checklist/
 * fieldTypes.js): visibility, validation and scoring. The two stacks
 * intentionally keep independent copies (as with auditDiff).
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
  options?: string[]
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
export function isFieldAnswered(
  field: ChecklistField,
  answers: Answers = {},
  photos: Record<string, string[]> = {},
  signatureData: string | null = null,
): boolean {
  if (!field || field.type === 'section') return false
  if (field.type === 'photo') return (photos[field.id]?.length ?? 0) > 0
  if (field.type === 'signature') return !!signatureData
  const v = answers[field.id]
  return !(v == null || v === '' || (Array.isArray(v) && v.length === 0))
}

/** Short human summary of a field's current answer, for the tile status pill. */
export function fieldSummaryText(
  field: ChecklistField,
  answers: Answers = {},
  photos: Record<string, string[]> = {},
  signatureData: string | null = null,
): string {
  if (!field) return ''
  if (field.type === 'photo') {
    const n = photos[field.id]?.length ?? 0
    return n > 0 ? `${n} photo${n === 1 ? '' : 's'}` : ''
  }
  if (field.type === 'signature') return signatureData ? 'Signed' : ''
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

export function validateAnswer(field: ChecklistField, value: any): string | null {
  if (!field || isLayoutField(field.type)) return null
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
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
  if (field.type === 'rating') {
    const n = Number(value)
    if (Number.isNaN(n) || n < 0 || n > 5) return `${field.label || 'Rating'} must be 0-5`
  }
  return null
}

export function validateSubmission(fields: ChecklistField[], answers: Answers): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  for (const f of Array.isArray(fields) ? fields : []) {
    if (isLayoutField(f.type) || f.type === 'photo' || f.type === 'signature') continue
    if (!isFieldVisible(f, answers)) continue
    const err = validateAnswer(f, answers?.[f.id])
    if (err) errors[f.id] = err
  }
  return { valid: Object.keys(errors).length === 0, errors }
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
