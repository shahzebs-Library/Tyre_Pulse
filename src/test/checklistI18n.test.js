import { describe, it, expect } from 'vitest'
import {
  CHECKLIST_LANGS, DEFAULT_LANG, TRANSLATABLE_LANGS,
  isChecklistLang, normalizeLang, langDir, isRtlLang, langMeta,
  fieldLabel, fieldOptions, fieldOptionValues, optionLabel, optionSet, optionSetNames,
  templateName, templateDescription,
  hasTranslations, translatedLangs, missingTranslations, translationCoverage,
} from '../lib/checklist/checklistI18n'

// The real shape loaded for the two Green Concrete sheets: one shared 'legend'
// option set every inspected line points at.
const LEGEND = ['OK', 'Not OK', 'Not applicable', 'Changed', 'Repaired', 'Added / Top-Up']

const template = {
  name: 'Workshop Daily TM Inspection Checklist',
  name_i18n: { ar: 'AR name', hi: 'HI name', ur: 'UR name' },
  description: 'Daily workshop inspection',
  description_i18n: { ar: 'AR desc' },
  option_sets: {
    legend: {
      options: LEGEND,
      i18n: {
        ar: ['AR OK', 'AR Not OK', 'AR N/A', 'AR Changed', 'AR Repaired', 'AR Added'],
        // Deliberately short: Hindi covers only the first two options.
        hi: ['HI OK', 'HI Not OK'],
      },
    },
  },
  fields: [
    { id: 'f_sec', type: 'section', label: 'Identification', labels: { ar: 'AR Identification' } },
    {
      id: 'f_grill', type: 'select', label: 'Grill and bumpers',
      labels: { ar: 'AR Grill', hi: 'HI Grill' },
      options: LEGEND, options_ref: 'legend', allow_note: true, required: true,
    },
    {
      id: 'f_own', type: 'select', label: 'Own options line',
      options: ['Pass', 'Fail'],
      options_i18n: { ar: ['AR Pass', 'AR Fail'] },
    },
    { id: 'f_blank', type: 'text', label: '' },
  ],
}

describe('language table', () => {
  it('carries en, ar, hi, ur with ar and ur right to left', () => {
    expect(CHECKLIST_LANGS.map((l) => l.code)).toEqual(['en', 'ar', 'hi', 'ur'])
    expect(langDir('ar')).toBe('rtl')
    expect(langDir('ur')).toBe('rtl')
    expect(langDir('en')).toBe('ltr')
    expect(langDir('hi')).toBe('ltr')
    expect(isRtlLang('ur')).toBe(true)
    expect(isRtlLang('hi')).toBe(false)
  })

  it('treats an unknown or missing language as English, left to right', () => {
    expect(normalizeLang('fr')).toBe('en')
    expect(normalizeLang(null)).toBe('en')
    expect(normalizeLang(undefined)).toBe('en')
    expect(normalizeLang(7)).toBe('en')
    expect(langDir('fr')).toBe('ltr')
    expect(langMeta('zz').code).toBe('en')
    expect(isChecklistLang('ur')).toBe(true)
    expect(isChecklistLang('fr')).toBe(false)
    expect(TRANSLATABLE_LANGS).toEqual(['ar', 'hi', 'ur'])
    expect(DEFAULT_LANG).toBe('en')
  })
})

describe('fieldLabel fallback chain', () => {
  const f = template.fields[1]

  it('uses the translation when there is one', () => {
    expect(fieldLabel(f, 'ar')).toBe('AR Grill')
    expect(fieldLabel(f, 'hi')).toBe('HI Grill')
  })

  it('falls back to English, never to a blank or a raw key', () => {
    expect(fieldLabel(f, 'ur')).toBe('Grill and bumpers')   // no Urdu label
    expect(fieldLabel(f, 'en')).toBe('Grill and bumpers')
    expect(fieldLabel(f, 'fr')).toBe('Grill and bumpers')   // unknown language
    expect(fieldLabel({ id: 'f_x', label: 'Plain' }, 'ar')).toBe('Plain')
  })

  it('falls back to the field id only when there is no label at all', () => {
    expect(fieldLabel({ id: 'f_x' }, 'ar')).toBe('f_x')
    expect(fieldLabel({ id: 'f_x', label: '   ' }, 'ar')).toBe('f_x')
    expect(fieldLabel({}, 'ar')).toBe('')
    expect(fieldLabel(null, 'ar')).toBe('')
  })

  it('ignores a translation that is blank or not a string', () => {
    expect(fieldLabel({ id: 'a', label: 'Eng', labels: { ar: '' } }, 'ar')).toBe('Eng')
    expect(fieldLabel({ id: 'a', label: 'Eng', labels: { ar: '  ' } }, 'ar')).toBe('Eng')
    expect(fieldLabel({ id: 'a', label: 'Eng', labels: { ar: 42 } }, 'ar')).toBe('Eng')
    expect(fieldLabel({ id: 'a', label: 'Eng', labels: 'nope' }, 'ar')).toBe('Eng')
  })
})

describe('fieldOptions: options_ref resolution and the English-answer invariant', () => {
  const shared = template.fields[1]
  const own = template.fields[2]

  it('resolves options_ref against the template option set', () => {
    const opts = fieldOptions(shared, template, 'ar')
    expect(opts).toHaveLength(6)
    expect(opts[0]).toEqual({ value: 'OK', label: 'AR OK' })
    expect(opts[5]).toEqual({ value: 'Added / Top-Up', label: 'AR Added' })
  })

  it('THE STORED VALUE IS ALWAYS THE ENGLISH OPTION, in every language', () => {
    for (const lang of ['en', 'ar', 'hi', 'ur', 'fr']) {
      expect(fieldOptions(shared, template, lang).map((o) => o.value)).toEqual(LEGEND)
      expect(fieldOptions(own, template, lang).map((o) => o.value)).toEqual(['Pass', 'Fail'])
    }
    expect(fieldOptionValues(shared, template)).toEqual(LEGEND)
  })

  it('falls back to English per index when the translation array is short', () => {
    const hi = fieldOptions(shared, template, 'hi')
    expect(hi[0].label).toBe('HI OK')
    expect(hi[1].label).toBe('HI Not OK')
    expect(hi[2].label).toBe('Not applicable')     // untranslated tail stays English
    expect(hi[5].label).toBe('Added / Top-Up')
  })

  it('falls back to English wholesale when the language has no array', () => {
    expect(fieldOptions(shared, template, 'ur').map((o) => o.label)).toEqual(LEGEND)
    expect(fieldOptions(shared, template, 'en').map((o) => o.label)).toEqual(LEGEND)
  })

  it('uses the field own options + options_i18n when there is no ref', () => {
    expect(fieldOptions(own, template, 'ar')).toEqual([
      { value: 'Pass', label: 'AR Pass' },
      { value: 'Fail', label: 'AR Fail' },
    ])
    expect(fieldOptions(own, template, 'ur').map((o) => o.label)).toEqual(['Pass', 'Fail'])
  })

  it('falls back to the field own options when the named set is missing', () => {
    const orphan = { id: 'f_o', type: 'select', options: ['A', 'B'], options_ref: 'nope' }
    expect(fieldOptions(orphan, template, 'ar')).toEqual([
      { value: 'A', label: 'A' }, { value: 'B', label: 'B' },
    ])
    // and with no template at all
    expect(fieldOptions(shared, null, 'ar').map((o) => o.value)).toEqual(LEGEND)
  })

  it('degrades on junk input', () => {
    expect(fieldOptions(null, template, 'ar')).toEqual([])
    expect(fieldOptions({ id: 'x' }, null, 'ar')).toEqual([])
    expect(fieldOptions({ id: 'x', options: 'not-an-array' }, null, 'ar')).toEqual([])
    expect(fieldOptions({ id: 'x', options: [1, 2] }, null, 'en').map((o) => o.value)).toEqual(['1', '2'])
  })
})

describe('optionLabel', () => {
  const shared = template.fields[1]

  it('translates a stored English value for display', () => {
    expect(optionLabel(shared, template, 'OK', 'ar')).toBe('AR OK')
    expect(optionLabel(shared, template, 'OK', 'en')).toBe('OK')
    expect(optionLabel(shared, template, 'Not applicable', 'hi')).toBe('Not applicable')
  })

  it('renders an unknown or empty value honestly, never blank-by-accident', () => {
    expect(optionLabel(shared, template, 'Retired option', 'ar')).toBe('Retired option')
    expect(optionLabel(shared, template, '', 'ar')).toBe('')
    expect(optionLabel(shared, template, null, 'ar')).toBe('')
    expect(optionLabel(null, null, 'OK', 'ar')).toBe('OK')
  })
})

describe('option sets', () => {
  it('normalises a named set and lists the names', () => {
    expect(optionSet(template, 'legend').options).toEqual(LEGEND)
    expect(optionSetNames(template)).toEqual(['legend'])
  })

  it('returns null for a missing, empty or malformed set', () => {
    expect(optionSet(template, 'nope')).toBeNull()
    expect(optionSet(template, '')).toBeNull()
    expect(optionSet(null, 'legend')).toBeNull()
    expect(optionSet({ option_sets: { a: { options: [] } } }, 'a')).toBeNull()
    expect(optionSet({ option_sets: { a: 'junk' } }, 'a')).toBeNull()
    expect(optionSetNames(null)).toEqual([])
    expect(optionSetNames({})).toEqual([])
  })
})

describe('template name and description', () => {
  it('translates, then falls back to English', () => {
    expect(templateName(template, 'ur')).toBe('UR name')
    expect(templateName(template, 'en')).toBe('Workshop Daily TM Inspection Checklist')
    expect(templateDescription(template, 'ar')).toBe('AR desc')
    expect(templateDescription(template, 'ur')).toBe('Daily workshop inspection')  // no Urdu desc
  })

  it('degrades on a null template', () => {
    expect(templateName(null, 'ar')).toBe('')
    expect(templateDescription(null, 'ar')).toBe('')
    expect(templateName({}, 'ar')).toBe('')
    expect(templateDescription({ description: null }, 'ar')).toBe('')
  })
})

describe('translation coverage for the builder', () => {
  it('reports which languages a template carries anything in', () => {
    expect(hasTranslations(template)).toBe(true)
    expect(translatedLangs(template)).toEqual(['ar', 'hi', 'ur'])
    expect(hasTranslations(null)).toBe(false)
    expect(hasTranslations({ name: 'x', fields: [] })).toBe(false)
    expect(translatedLangs({ name: 'x', fields: [{ id: 'a', label: 'b' }] })).toEqual([])
  })

  it('lists what is missing, and never reports English as incomplete', () => {
    expect(missingTranslations(template, 'en')).toEqual([])
    expect(missingTranslations(null, 'ar')).toEqual([])

    const ur = missingTranslations(template, 'ur')
    const kinds = ur.map((m) => `${m.kind}:${m.id}`)
    expect(kinds).toContain('description:description')   // no Urdu description
    expect(kinds).toContain('field:f_sec')               // section has only Arabic
    expect(kinds).toContain('field:f_grill')
    expect(kinds).toContain('option_set:legend')         // the shared set, reported ONCE
    expect(kinds).toContain('options:f_own')             // its own options, untranslated
    expect(kinds).not.toContain('name:name')             // name IS translated to Urdu
    expect(kinds).not.toContain('field:f_blank')         // no English label = not a gap
    // a line pointing at a shared set never reports its own options
    expect(kinds).not.toContain('options:f_grill')
  })

  it('counts a partly translated shared set as still missing', () => {
    const hi = missingTranslations(template, 'hi')
    const set = hi.find((m) => m.kind === 'option_set')
    expect(set.count).toBe(4)   // 6 options, 2 translated
  })

  it('summarises per language', () => {
    const cov = translationCoverage(template)
    expect(cov.map((c) => c.lang)).toEqual(['ar', 'hi', 'ur'])
    expect(cov.every((c) => c.missing >= 0)).toBe(true)
    const complete = translationCoverage({
      name: 'N', name_i18n: { ar: 'A', hi: 'H', ur: 'U' },
      fields: [{ id: 'a', label: 'L', labels: { ar: 'a', hi: 'h', ur: 'u' } }],
    })
    expect(complete.every((c) => c.complete)).toBe(true)
  })
})
