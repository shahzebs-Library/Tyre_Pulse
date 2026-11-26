// The words a driver signs must be identical everywhere: the server function
// that stores them with the signature, the web locales and the Flutter ARB
// files. The single source is docs/document-specs/driver-charge-statements.json.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..', '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const spec = json('docs/document-specs/driver-charge-statements.json')
const sql = read('supabase/migrations/20261126170000_driver_charge_cases.sql')
const ARB_KEYS = { 'deduction-consent-v2': 'driverChargeStatementConsent', 'receipt-dispute-v2': 'driverChargeStatementDispute', 'refusal-witness-v2': 'driverChargeStatementWitness' }

function sqlStatements() {
  const out = {}
  for (const m of sql.matchAll(/WHEN '([a-z-]+-v\d+):([a-z]{2})' THEN '([^']*)'/g)) {
    out[m[1]] = { ...(out[m[1]] || {}), [m[2]]: m[3] }
  }
  return out
}

describe('driver charge statements', () => {
  it('cover en, ar and ur for every version, in plain text without dash punctuation', () => {
    expect(spec.languages).toEqual(['en', 'ar', 'ur'])
    expect(Object.keys(spec.statements)).toEqual(Object.keys(ARB_KEYS))
    for (const byLang of Object.values(spec.statements)) {
      for (const lang of spec.languages) {
        expect(byLang[lang]?.length).toBeGreaterThan(40)
        expect(/[–—']/.test(byLang[lang])).toBe(false)
      }
    }
  })
  it('the server stores exactly these words', () => {
    expect(sqlStatements()).toEqual(spec.statements)
  })
  it('the web locales carry the same words', () => {
    for (const lang of ['en', 'ar']) {
      const locale = json(`src/locales/${lang}/driverCharges.json`)
      for (const [version, byLang] of Object.entries(spec.statements)) expect(locale.statements[version]).toBe(byLang[lang])
    }
  })
  it('the Flutter ARB files carry the same words', () => {
    for (const lang of spec.languages) {
      const arb = json(`tyre_pulse_flutter/lib/l10n/app_${lang}.arb`)
      for (const [version, key] of Object.entries(ARB_KEYS)) expect(arb[key]).toBe(spec.statements[version][lang])
    }
  })
})
