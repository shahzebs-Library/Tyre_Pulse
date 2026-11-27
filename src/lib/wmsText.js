// Translatable text for warehouse helper functions (src/lib/**).
//
// Helpers that build user-facing sentences take an optional `t` (the
// LanguageContext translator). Called without one - in unit tests, in
// exports and in other non-React code - they fall back to `enText`, which
// reads the English dictionary directly, so the English output is unchanged.
// Components pass their own `t` and get Arabic or Urdu.
import floor from '../locales/en/wmsmsgfloor.json'
import parts from '../locales/en/wmsmsgparts.json'
import procure from '../locales/en/wmsmsgprocure.json'

const EN = { wmsmsgfloor: floor, wmsmsgparts: parts, wmsmsgprocure: procure }

const lookup = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), EN)

/** English translation of a `wmsmsg*` key, with {placeholder} interpolation. */
export function enText(key, vars) {
  const val = lookup(key)
  if (typeof val !== 'string') return key
  if (!vars) return val
  return val.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}

/** The translator to use: the caller's `t` when given, else English. */
export const textFn = (t) => (typeof t === 'function' ? t : enText)
