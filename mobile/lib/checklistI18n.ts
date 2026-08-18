/**
 * checklistI18n — MOBILE MIRROR of the runtime half of
 * src/lib/checklist/checklistI18n.js.
 *
 * WHAT WAS WRONG. Mobile rendered `field.label` and `field.options` raw, so the
 * whole checklist translation feature stopped at the office door: the Arabic-,
 * Hindi- and Urdu-reading fitters it was BUILT for read the sheet in English on
 * the phone, which is the one device they actually fill it on.
 *
 * Worse than cosmetic: mobile also ignored `options_ref`. A field may point at a
 * SHARED option set on the template (`template.option_sets`), and the builder
 * says in so many words that the field's own `options` are kept only "as a
 * fallback if that list is ever removed" - i.e. the shared list is the live
 * source and the copy is expected to drift. So once an admin edited the shared
 * legend, web users answered with the new vocabulary and phone users answered
 * (and were validated) against the old one. Two people filling "the same"
 * checklist recorded different answers.
 *
 * THE INVARIANT THAT MATTERS MOST, carried over verbatim: the stored ANSWER is
 * ALWAYS the English option, whatever language it was shown in. An answer whose
 * meaning changes with the reader's language cannot be compared across
 * submissions, scored, exported or reported on. Every resolver returns
 * { value, label } pairs - English value to store, translated label to show -
 * so a caller cannot accidentally store the translation.
 *
 * Everything degrades to English: a null template, a field with no labels, an
 * unknown language, a translation array shorter than its option list. A missing
 * translation never renders blank and never renders a raw key.
 *
 * CHANGE BOTH FILES TOGETHER.
 */

export interface ChecklistLang { code: string; label: string; native: string; dir: 'ltr' | 'rtl' }

export const CHECKLIST_LANGS: ChecklistLang[] = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl' },
]

/** English is the source language: always present, always the fallback. */
export const DEFAULT_LANG = 'en'

const BY_CODE: Record<string, ChecklistLang> = Object.fromEntries(CHECKLIST_LANGS.map((l) => [l.code, l]))
const RTL = new Set(CHECKLIST_LANGS.filter((l) => l.dir === 'rtl').map((l) => l.code))

export function isChecklistLang(code: unknown): boolean {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(BY_CODE, code)
}

export function normalizeLang(code: unknown): string {
  return isChecklistLang(code) ? (code as string) : DEFAULT_LANG
}

export function langDir(code: unknown): 'ltr' | 'rtl' {
  return RTL.has(normalizeLang(code)) ? 'rtl' : 'ltr'
}

export function isRtlLang(code: unknown): boolean {
  return langDir(code) === 'rtl'
}

export function langMeta(code: unknown): ChecklistLang {
  return BY_CODE[normalizeLang(code)]
}

// A usable string is a non-blank one. A translation stored as '' must fall back
// to English rather than rendering an empty line.
function usable(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}
function dict(v: unknown): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null
}
function list(v: unknown): any[] | null {
  return Array.isArray(v) ? v : null
}

/** The field's label in the reader's language, falling back to English. */
export function fieldLabel(field: any, lang: unknown = DEFAULT_LANG): string {
  if (!field) return ''
  const code = normalizeLang(lang)
  if (code !== DEFAULT_LANG) {
    const t = usable(dict(field.labels)?.[code])
    if (t) return t
  }
  return usable(field.label) || ''
}

/**
 * The template's shared option set named by `ref`, or null when there is none -
 * the caller then falls back to the field's own options, which is exactly why a
 * field keeps them even when it points at a set.
 */
export function optionSet(template: any, ref: unknown): { options: any[]; i18n: Record<string, any> } | null {
  if (!template || !usable(ref)) return null
  const set = dict(dict(template.option_sets)?.[ref as string])
  const opts = list(set?.options)
  if (!opts || opts.length === 0) return null
  return { options: opts, i18n: dict(set!.i18n) || {} }
}

export interface FieldOption { value: string; label: string }

/**
 * The choices for a field, resolved in this order:
 *   1. field.options_ref against template.option_sets (the shared list)
 *   2. the field's own options + options_i18n
 * `value` is ALWAYS the English option to store. A translation array shorter
 * than the option list falls back to English per index rather than rendering a
 * blank choice.
 */
export function fieldOptions(field: any, template: any = null, lang: unknown = DEFAULT_LANG): FieldOption[] {
  if (!field) return []
  const code = normalizeLang(lang)
  const set = optionSet(template, field.options_ref)
  const values = set ? set.options : (list(field.options) || [])
  const translated = code === DEFAULT_LANG
    ? null
    : list(set ? set.i18n?.[code] : dict(field.options_i18n)?.[code])

  return values.map((v: any, i: number) => {
    const value = typeof v === 'string' ? v : String(v ?? '')
    return { value, label: usable(translated?.[i]) || value }
  })
}

/** Just the storable English values, in display order. Use this to VALIDATE. */
export function fieldOptionValues(field: any, template: any = null): string[] {
  return fieldOptions(field, template, DEFAULT_LANG).map((o) => o.value)
}

/** Label for an already-stored (English) value. Unknown renders as itself. */
export function optionLabel(field: any, template: any, value: unknown, lang: unknown = DEFAULT_LANG): string {
  const v = value == null ? '' : String(value)
  if (v === '') return ''
  const hit = fieldOptions(field, template, lang).find((o) => o.value === v)
  return hit ? hit.label : v
}

export function templateName(template: any, lang: unknown = DEFAULT_LANG): string {
  if (!template) return ''
  const code = normalizeLang(lang)
  if (code !== DEFAULT_LANG) {
    const t = usable(dict(template.name_i18n)?.[code])
    if (t) return t
  }
  return usable(template.name) || ''
}

export function templateDescription(template: any, lang: unknown = DEFAULT_LANG): string {
  if (!template) return ''
  const code = normalizeLang(lang)
  if (code !== DEFAULT_LANG) {
    const t = usable(dict(template.description_i18n)?.[code])
    if (t) return t
  }
  return usable(template.description) || ''
}

/** Languages this template actually carries content for (English always). */
export function templateLangs(template: any): string[] {
  const out = [DEFAULT_LANG]
  for (const l of CHECKLIST_LANGS) {
    if (l.code === DEFAULT_LANG) continue
    const named = usable(dict(template?.name_i18n)?.[l.code])
    const fielded = (list(template?.fields) || []).some((f: any) => usable(dict(f?.labels)?.[l.code]))
    if (named || fielded) out.push(l.code)
  }
  return out
}
