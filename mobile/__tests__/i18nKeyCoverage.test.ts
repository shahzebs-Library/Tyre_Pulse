/**
 * Every static t('a.b.c') key used by the app must exist in the locales.
 *
 * LanguageContext.resolve falls back to ENGLISH when the active language lacks
 * a key, but when en.json lacks it too it renders the RAW KEY PATH on screen
 * ("modules.meter.photographGauge"). A missing Arabic key is softer (the user
 * sees English inside an Arabic screen) but is still a defect for the readers
 * the Arabic locale exists for, so both are enforced.
 *
 * Only STATIC single-quoted/double-quoted keys are checked. Template-literal
 * keys (t(`accident.statuses.${s}`)) are built at runtime from DB tokens and
 * cannot be resolved by a source scan.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const SCAN_DIRS = ['app', 'components', 'lib', 'contexts']
const KEY_RE = /\bt\(\s*['"]([A-Za-z0-9_.-]+)['"]/g

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p)
  }
  return out
}

const load = (l: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${l}.json`), 'utf8'))

function has(dict: Record<string, unknown>, key: string): boolean {
  const v = key.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict)
  return typeof v === 'string' && v.trim().length > 0
}

// key -> files that use it
const used = new Map<string, Set<string>>()
for (const d of SCAN_DIRS) {
  for (const file of walk(path.join(ROOT, d), [])) {
    const src = fs.readFileSync(file, 'utf8').replace(/\r/g, '')
    let m: RegExpExecArray | null
    KEY_RE.lastIndex = 0
    while ((m = KEY_RE.exec(src))) {
      const key = m[1]
      if (!key.includes('.')) continue // not a namespaced locale key
      if (!used.has(key)) used.set(key, new Set())
      used.get(key)!.add(path.relative(ROOT, file))
    }
  }
}

describe('mobile i18n key coverage', () => {
  it('the scan actually finds keys (guards against a vacuous pass)', () => {
    expect(used.size).toBeGreaterThan(500)
  })

  it.each(['en', 'ar'])('%s.json carries every static key the app asks for', (lang) => {
    const dict = load(lang)
    const missing = [...used.entries()]
      .filter(([k]) => !has(dict, k))
      .map(([k, files]) => `${k}  (${[...files].join(', ')})`)
    expect(missing).toEqual([])
  })

  it('the accessibility and photo capture namespaces match between en and ar', () => {
    const en = load('en')
    const ar = load('ar')
    for (const ns of ['a11y', 'photoCapture']) {
      expect(Object.keys(ar[ns] ?? {}).sort()).toEqual(Object.keys(en[ns] ?? {}).sort())
    }
  })
})
