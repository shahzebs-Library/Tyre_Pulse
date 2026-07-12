/**
 * checklistFields — runtime helpers for filling a checklist on mobile. A pure
 * TypeScript port of the web engine's runtime subset (src/lib/checklist/
 * fieldTypes.js): visibility, validation and scoring. The two stacks
 * intentionally keep independent copies (as with auditDiff).
 */

export type FieldType =
  | 'section' | 'text' | 'textarea' | 'number' | 'select' | 'multiselect'
  | 'boolean' | 'date' | 'rating' | 'photo' | 'signature'

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
  visibleWhen?: VisibleWhen | null
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

export function blankAnswer(field: ChecklistField): any {
  switch (field?.type) {
    case 'multiselect': return []
    case 'boolean':     return null
    case 'rating':      return 0
    case 'number':      return ''
    default:            return field?.default ?? ''
  }
}

const COND_OPS = ['=', '!=', '>', '>=', '<', '<=', 'includes', 'empty', 'not_empty']

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
    case 'empty':     return actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0)
    case 'not_empty': return !(actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0))
    default: return true
  }
}

export function isFieldVisible(field: ChecklistField, answers: Answers = {}): boolean {
  const c = field?.visibleWhen
  if (!c || !c.field || !c.op) return true
  if (!COND_OPS.includes(c.op)) return true
  return evalCondition(c.op, answers?.[c.field], c.value)
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
