/**
 * A NEW record must never be stamped with a country the user did not choose.
 *
 * The bug: five create/edit forms defaulted their country field with
 * `activeCountry !== 'All' ? activeCountry : 'KSA'`, so a record created from
 * the All-countries view was SILENTLY filed under KSA. Country drives currency
 * (KSA=SAR, UAE=AED, Egypt=EGP), RLS visibility and every cost report, so the
 * wrong country is a data-integrity fault, not a cosmetic one.
 *
 * The rule now: inherit the country when one is in scope, otherwise leave the
 * field BLANK and make the user pick before the record can be saved.
 *
 * These tests read the source (the rowCapGuard / consoleSurfaceGuard style)
 * because the fix is a property of how each page is WIRED, and a regression
 * looks exactly like working code in review. The behavioural half evaluates the
 * helper LIFTED OUT OF EACH FILE rather than a copy of it, so it fails if any
 * page's own rule drifts back to a fabricated default.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { COUNTRIES } from '../contexts/SettingsContext'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

/** The five create/edit surfaces that used to fabricate a KSA default. */
const PAGES = [
  'src/pages/TyreRecords.jsx',
  'src/pages/FleetMaster.jsx',
  'src/pages/RcaRecords.jsx',
  'src/pages/SanyDelayPenalty.jsx',
  'src/pages/InsurancePolicies.jsx',
]

/**
 * Pull `defaultCountryFor` out of a page and make it callable, so the assertions
 * below run against that file's REAL rule. Anchored on the declaration and cut
 * at the end of the line, which is how every page writes it.
 */
function liftDefaultCountryFor(src) {
  const m = src.match(/const defaultCountryFor = (\(.*)/)
  expect(m, 'each page must declare defaultCountryFor').toBeTruthy()
  return new Function(`return ${m[1]}`)()
}

describe('create-form country default', () => {
  it.each(PAGES)('%s inherits a real country and blanks under All', (page) => {
    const defaultCountryFor = liftDefaultCountryFor(read(page))

    // A country in scope is inherited unchanged - the single-country user, which
    // is nearly everyone, sees no change at all.
    for (const c of COUNTRIES) expect(defaultCountryFor(c)).toBe(c)

    // The All-countries view has nothing to inherit, so the field opens blank.
    expect(defaultCountryFor('All')).toBe('')

    // The precise regression: it must never resolve to a country nobody picked.
    expect(defaultCountryFor('All')).not.toBe('KSA')
    for (const c of COUNTRIES) expect(defaultCountryFor('All')).not.toBe(c)

    // A missing/blank context is the same "nothing chosen" case, never a guess.
    for (const empty of [undefined, null, '']) expect(defaultCountryFor(empty)).toBe('')
  })

  it.each(PAGES)('%s no longer carries a hardcoded KSA fallback', (page) => {
    const src = read(page)

    // The ternary fallback that caused the bug, in any spacing, single or double
    // quoted: `: 'KSA'`, `:'KSA'`, `:   "KSA"`.
    expect(src).not.toMatch(/:\s*['"]KSA['"]/)

    // The same fabrication one step later, in the payload builders:
    // `country: form.country || 'KSA'`.
    expect(src).not.toMatch(/\|\|\s*['"]KSA['"]/)

    // And the whole original expression, whatever the whitespace, in case a
    // future edit reintroduces it in a shape the two patterns above miss.
    expect(src).not.toMatch(/!==\s*['"]All['"][\s\S]{0,60}['"]KSA['"]/)
  })

  it.each(PAGES)('%s offers the app country list, not a hardcoded one', (page) => {
    const src = read(page)
    // COUNTRIES is the single source for which countries exist; a local literal
    // list drifts the moment a country is added.
    expect(src).toMatch(/import\s*\{[^}]*\bCOUNTRIES\b[^}]*\}\s*from\s*['"]\.\.\/contexts\/SettingsContext['"]/)
    expect(src).not.toMatch(/\[\s*['"]KSA['"]\s*,\s*['"]UAE['"]\s*,\s*['"]Egypt['"]\s*\]/)
  })

  it.each(PAGES)('%s blocks a save while the country is unchosen', (page) => {
    const src = read(page)
    // Every page must refuse to write a blank country somewhere in its save
    // path, so an empty field can never reach the database as a fabricated one.
    expect(src).toContain('COUNTRY_REQUIRED_HINT')
  })

  it('the guard patterns actually fire on the original code', () => {
    // A source scan that cannot fail is worthless, so prove each pattern
    // rejects the exact expression this change removed.
    const before = "const c = activeCountry !== 'All' ? activeCountry : 'KSA'"
    expect(before).toMatch(/:\s*['"]KSA['"]/)
    expect(before).toMatch(/!==\s*['"]All['"][\s\S]{0,60}['"]KSA['"]/)
    expect("country: form.country || 'KSA',").toMatch(/\|\|\s*['"]KSA['"]/)
    // Spacing must not defeat it.
    expect("x ?  y  :   'KSA'").toMatch(/:\s*['"]KSA['"]/)
    expect('y:"KSA"').toMatch(/:\s*['"]KSA['"]/)
    // The edit-path hydration (`r.country ?? 'KSA'`) is deliberately NOT the
    // target: an existing record must keep showing its own stored country.
    expect("country: r.country ?? 'KSA',").not.toMatch(/:\s*['"]KSA['"]/)
    expect("country: r.country ?? 'KSA',").not.toMatch(/\|\|\s*['"]KSA['"]/)
  })
})
