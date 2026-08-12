/**
 * Checklist content i18n - the single resolver for "what does this line say in
 * the reader's language". Pure module: no React, no network, no I/O.
 *
 * This is the CONTENT language of a checklist (what a fitter on the floor
 * reads), which is a different axis from the app UI language in
 * LanguageContext: the app ships en + ar, while a paper checklist has to be
 * readable by mechanics who read Hindi or Urdu.
 *
 * Where the translations live (all optional, all jsonb, no migration needed):
 *   checklist_templates.name_i18n        { ar, hi, ur }
 *   checklist_templates.description_i18n { ar, hi, ur }
 *   checklist_templates.option_sets      { legend: { options:[...], i18n:{ ar:[...], ... } } }
 *   field.labels                         { ar, hi, ur }   beside the English `label`
 *   field.options_i18n                   { ar:[...], ... } parallel to `options`
 *   field.options_ref                    'legend'         take options from the template set
 *
 * THE INVARIANT THAT MATTERS MOST: the stored ANSWER is always the ENGLISH
 * option, whatever language it was shown in. An answer whose meaning changes
 * with the reader's language cannot be compared across submissions, exported,
 * scored or reported on. Every resolver here therefore returns
 * { value, label } pairs - the English value to store, the translated label to
 * show - so a caller cannot accidentally store the translation.
 *
 * Everything degrades: a null template, a field with no labels, an unknown
 * language, a translation array shorter than its option list. A missing
 * translation falls back to English, never to a blank and never to a raw key.
 */

export const CHECKLIST_LANGS = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl' },
]

/** English is the source language: it is always present and is the fallback. */
export const DEFAULT_LANG = 'en'

/** Languages a template can carry a translation for (English is the source). */
export const TRANSLATABLE_LANGS = CHECKLIST_LANGS.filter((l) => l.code !== DEFAULT_LANG).map((l) => l.code)

const BY_CODE = Object.fromEntries(CHECKLIST_LANGS.map((l) => [l.code, l]))
const RTL = new Set(CHECKLIST_LANGS.filter((l) => l.dir === 'rtl').map((l) => l.code))

/** Is this a language the checklist runtime knows how to render? */
export function isChecklistLang(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(BY_CODE, code)
}

/** Coerce anything to a supported language code; unknown falls back to English. */
export function normalizeLang(code) {
  return isChecklistLang(code) ? code : DEFAULT_LANG
}

/** 'rtl' for Arabic and Urdu, 'ltr' otherwise. Unknown languages read ltr. */
export function langDir(code) {
  return RTL.has(normalizeLang(code)) ? 'rtl' : 'ltr'
}

export function isRtlLang(code) {
  return langDir(code) === 'rtl'
}

/** The descriptor row for a language, or the English one when unknown. */
export function langMeta(code) {
  return BY_CODE[normalizeLang(code)]
}

// A usable translated string: a non-blank string. Anything else (null, '', a
// number, an object left behind by a bad import) counts as "not translated" so
// the caller falls back rather than rendering junk.
function usable(v) {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function dict(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

function list(v) {
  return Array.isArray(v) ? v : null
}

/**
 * A field's label in `lang`. Fallback chain, in order:
 *   field.labels[lang] -> field.label (English) -> field.id -> ''
 * The field id is a last resort so a label-less field is still identifiable in
 * the form; it is never a raw translation key.
 */
export function fieldLabel(field, lang = DEFAULT_LANG) {
  if (!field) return ''
  const code = normalizeLang(lang)
  if (code !== DEFAULT_LANG) {
    const t = usable(dict(field.labels)?.[code])
    if (t) return t
  }
  return usable(field.label) || usable(field.id) || ''
}

/**
 * The template's option set named by `ref`, normalised to
 * { options:[English], i18n:{lang:[...]} }. Returns null when the template has
 * no such set - the caller then falls back to the field's own options, which is
 * why a field keeps them even when it points at a set.
 */
export function optionSet(template, ref) {
  if (!template || !usable(ref)) return null
  const set = dict(dict(template.option_sets)?.[ref])
  const opts = list(set?.options)
  if (!opts || opts.length === 0) return null
  return { options: opts, i18n: dict(set.i18n) || {} }
}

/** Every option set defined on a template, as [{ name, options, i18n }]. */
export function optionSetNames(template) {
  const sets = dict(template?.option_sets)
  if (!sets) return []
  return Object.keys(sets).filter((k) => optionSet(template, k))
}

/**
 * The choices for a field, resolved in this order:
 *   1. field.options_ref against template.option_sets (a shared list, defined
 *      once and pointed at by many lines - both seeded sheets use 'legend')
 *   2. the field's own options + options_i18n
 * Returns [{ value, label }] where `value` is ALWAYS the English option to
 * store and `label` is what the reader sees. A translation array that is
 * shorter than the option list falls back to English per index rather than
 * rendering a blank choice.
 */
export function fieldOptions(field, template = null, lang = DEFAULT_LANG) {
  if (!field) return []
  const code = normalizeLang(lang)
  const set = optionSet(template, field.options_ref)
  const values = set ? set.options : (list(field.options) || [])
  const translated = code === DEFAULT_LANG
    ? null
    : list(set ? set.i18n?.[code] : dict(field.options_i18n)?.[code])

  return values.map((v, i) => {
    const value = typeof v === 'string' ? v : String(v ?? '')
    return { value, label: usable(translated?.[i]) || value }
  })
}

/** Just the storable English values for a field, in display order. */
export function fieldOptionValues(field, template = null) {
  return fieldOptions(field, template, DEFAULT_LANG).map((o) => o.value)
}

/**
 * The label to show for an already-stored (English) answer value. Used by the
 * runtime and any reader that has the value but not the option row. Unknown
 * values render as themselves, never blank.
 */
export function optionLabel(field, template, value, lang = DEFAULT_LANG) {
  const v = value == null ? '' : String(value)
  if (v === '') return ''
  const hit = fieldOptions(field, template, lang).find((o) => o.value === v)
  return hit ? hit.label : v
}

/** The template name in `lang`, falling back to the English `name`. */
export function templateName(template, lang = DEFAULT_LANG) {
  if (!template) return ''
  const code = normalizeLang(lang)
  if (code !== DEFAULT_LANG) {
    const t = usable(dict(template.name_i18n)?.[code])
    if (t) return t
  }
  return usable(template.name) || ''
}

/** The template description in `lang`, falling back to English. May be ''. */
export function templateDescription(template, lang = DEFAULT_LANG) {
  if (!template) return ''
  const code = normalizeLang(lang)
  if (code !== DEFAULT_LANG) {
    const t = usable(dict(template.description_i18n)?.[code])
    if (t) return t
  }
  return usable(template.description) || ''
}

/** Does this template carry ANY translation at all, in any language? */
export function hasTranslations(template) {
  if (!template) return false
  return translatedLangs(template).length > 0
}

/** The languages this template has at least one translated string in. */
export function translatedLangs(template) {
  if (!template) return []
  return TRANSLATABLE_LANGS.filter((code) => {
    if (usable(dict(template.name_i18n)?.[code])) return true
    if (usable(dict(template.description_i18n)?.[code])) return true
    for (const name of optionSetNames(template)) {
      if ((list(optionSet(template, name).i18n?.[code]) || []).some(usable)) return true
    }
    for (const f of list(template.fields) || []) {
      if (usable(dict(f?.labels)?.[code])) return true
      if ((list(dict(f?.options_i18n)?.[code]) || []).some(usable)) return true
    }
    return false
  })
}

/**
 * What is NOT yet translated into `lang`. Drives the builder's "this template
 * is incomplete in Urdu, here is what is missing" panel. Returns
 * [{ kind, id, label }] where kind is 'name' | 'description' | 'field' |
 * 'options' | 'option_set'. English returns [] - it is the source language, so
 * nothing can be missing from it.
 *
 * A field with no English label at all is not reported: it is an empty row, a
 * template-validation problem rather than a translation gap.
 */
export function missingTranslations(template, lang) {
  const code = normalizeLang(lang)
  if (!template || code === DEFAULT_LANG) return []
  const out = []

  if (usable(template.name) && !usable(dict(template.name_i18n)?.[code])) {
    out.push({ kind: 'name', id: 'name', label: template.name })
  }
  if (usable(template.description) && !usable(dict(template.description_i18n)?.[code])) {
    out.push({ kind: 'description', id: 'description', label: template.description })
  }

  for (const name of optionSetNames(template)) {
    const set = optionSet(template, name)
    const t = list(set.i18n?.[code]) || []
    const gaps = set.options.filter((_, i) => !usable(t[i]))
    if (gaps.length) {
      out.push({ kind: 'option_set', id: name, label: name, count: gaps.length })
    }
  }

  for (const f of list(template.fields) || []) {
    if (!f || !usable(f.label)) continue
    if (!usable(dict(f.labels)?.[code])) {
      out.push({ kind: 'field', id: f.id, label: f.label })
    }
    // Options are only the field's own problem when it does not point at a
    // shared set - a set is reported once above rather than once per line.
    if (!usable(f.options_ref)) {
      const opts = list(f.options) || []
      if (opts.length) {
        const t = list(dict(f.options_i18n)?.[code]) || []
        const gaps = opts.filter((_, i) => !usable(t[i]))
        if (gaps.length) {
          out.push({ kind: 'options', id: f.id, label: f.label, count: gaps.length })
        }
      }
    }
  }
  return out
}

/**
 * Per-language completeness for the builder's language strip:
 * [{ lang, missing, complete }] over the translatable languages.
 */
export function translationCoverage(template) {
  return TRANSLATABLE_LANGS.map((lang) => {
    const missing = missingTranslations(template, lang)
    return { lang, missing: missing.length, complete: missing.length === 0 }
  })
}

export default {
  CHECKLIST_LANGS, DEFAULT_LANG, TRANSLATABLE_LANGS,
  isChecklistLang, normalizeLang, langDir, isRtlLang, langMeta,
  fieldLabel, fieldOptions, fieldOptionValues, optionLabel, optionSet, optionSetNames,
  templateName, templateDescription,
  hasTranslations, translatedLangs, missingTranslations, translationCoverage,
}
