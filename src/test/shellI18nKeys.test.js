import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard for translated strings in the app shell.
 *
 * The shell components deliberately call their translator through a small
 * fallback wrapper - `tx(t, key, english)`, `tOr(...)`, `labelOr(...)` - because
 * this repo's `t(key, vars)` takes interpolation VARS as its second argument, not
 * a fallback, so a missing key renders the raw key on screen. The wrapper means a
 * missing key degrades to readable English instead.
 *
 * That safety net has a cost: a key can be missing from every locale file and
 * nothing looks broken in English, while Arabic silently renders English. That is
 * exactly what happened - four nav keys and one palette key shipped with no
 * locale entry, and a hand-rolled grep missed them because it only matched one of
 * the three wrapper names.
 *
 * So this scans the source for every wrapped key and asserts it resolves in BOTH
 * locales, and that the English value matches the fallback written in the code
 * (otherwise the two drift and the fallback quietly becomes a lie).
 */

const SRC_FILES = [
  'src/components/Layout.jsx',
  'src/components/CommandPalette.jsx',
  ...readdirSync('src/components/shell').map((f) => join('src/components/shell', f)),
].filter((f) => f.endsWith('.jsx'))

// tx(t, 'ns.key', 'English fallback') and its aliases.
const CALL = /(?:tx|tOr|labelOr)\(\s*t,\s*'([a-zA-Z][\w.]*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g

function collect() {
  const out = new Map()
  for (const file of SRC_FILES) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(CALL)) {
      out.set(m[1], { fallback: m[2].replace(/\\'/g, "'"), file })
    }
  }
  return out
}

function lookup(locale, key) {
  const [ns, ...rest] = key.split('.')
  let json
  try { json = JSON.parse(readFileSync(`src/locales/${locale}/${ns}.json`, 'utf8')) }
  catch { return undefined }
  return rest.reduce((cur, part) => (cur && typeof cur === 'object' ? cur[part] : undefined), json)
}

describe('shell i18n keys', () => {
  const keys = collect()

  it('finds the wrapped keys at all, so an empty scan cannot pass vacuously', () => {
    expect(keys.size).toBeGreaterThan(20)
  })

  it('resolves every wrapped key in English', () => {
    const missing = [...keys].filter(([k]) => typeof lookup('en', k) !== 'string').map(([k]) => k)
    expect(missing).toEqual([])
  })

  it('resolves every wrapped key in Arabic, so Arabic never renders English', () => {
    const missing = [...keys].filter(([k]) => typeof lookup('ar', k) !== 'string').map(([k]) => k)
    expect(missing).toEqual([])
  })

  it('keeps the English value identical to the fallback written in the code', () => {
    const drifted = [...keys]
      .filter(([k, v]) => lookup('en', k) !== v.fallback)
      .map(([k, v]) => `${k}: locale "${lookup('en', k)}" vs code "${v.fallback}"`)
    expect(drifted).toEqual([])
  })

  it('does not leave an Arabic value identical to the English one by accident', () => {
    // A handful legitimately match (proper nouns, "EN"). Everything else being
    // identical means the key was copied rather than translated.
    const ALLOWED_IDENTICAL = new Set(['shell.fleetIntelligence'])
    const untranslated = [...keys]
      .filter(([k]) => !ALLOWED_IDENTICAL.has(k))
      .filter(([k]) => {
        const en = lookup('en', k); const ar = lookup('ar', k)
        return typeof en === 'string' && en === ar && /[a-z]{4}/i.test(en)
      })
      .map(([k]) => k)
    expect(untranslated).toEqual([])
  })
})
