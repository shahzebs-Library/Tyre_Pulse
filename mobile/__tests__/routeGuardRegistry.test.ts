/**
 * Route guards must come from the module registry, not a second hardcoded list.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * Home and the tab bar gate on `canAccess(moduleKey)` — registry role defaults,
 * the role matrix, and per-user grants. Screens used to gate on their OWN
 * `useRoleGuard(['a','b'])` list. The two DRIFTED: `stock` admitted inspectors
 * in the registry while the screen's list did not, so an inspector saw the tile,
 * tapped it, and `router.replace('/')` threw them back to Home. To the user that
 * reads as "it never opens / it spins". `meter` did the same to a DRIVER on
 * their own primary tab, and `reportIssue` did it to every role it was built for.
 *
 * Reviewing for this does not work: a drifted list looks identical to a correct
 * one. So this test READS THE SOURCE of every screen and fails when a screen
 * that has a module key still carries a literal role list.
 *
 * It also pins the other half: every guard key must resolve to a real entry in
 * MODULES. `tsc` already rejects a misspelled literal (the parameter is typed
 * `ModuleKey`), but it CANNOT see the gap these tests cover — a key added to the
 * `ModuleKey` union with no matching `M(...)` row in MODULES. That compiles
 * cleanly, leaves `MODULE_BY_KEY[key]` undefined, and makes
 * `moduleAllowedByRole` return false for everyone but admin: a screen that
 * silently denies the whole fleet with nothing failing at build time.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { MODULES, MODULE_BY_KEY, ModuleKey } from '../lib/permissions'

const APP_DIR = join(__dirname, '..', 'app', '(app)')

/**
 * Screens allowed to keep a literal role guard, each with the reason.
 *
 * The bar is deliberately high: an entry is only justified when the screen must
 * be STRICTER than any registry module. Convenience is not a reason — that is
 * exactly how the drift got in.
 */
const LITERAL_GUARD_EXEMPT: Record<string, string> = {
  'admin/approvals.tsx':
    'Approves accident closures and pending uploads; has always been admin-only, '
    + 'while the `approvals` module admits manager + director. Using the module '
    + 'key here would LOOSEN an admin gate.',
}

const VALID_KEYS = new Set<string>(MODULES.map((m) => m.key))

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full)
  }
  return out
}

const FILES = walk(APP_DIR).map((f) => ({
  path: relative(APP_DIR, f).split('\\').join('/'),
  src: readFileSync(f, 'utf8'),
}))

/** Any call to the legacy list guard or its two convenience wrappers. */
const LITERAL_GUARD = /\buse(RoleGuard|ElevatedGuard|AdminGuard)\s*\(/

describe('route guards read the module registry', () => {
  it('finds the app screens (the scan is not vacuously passing)', () => {
    // A broken path would make every assertion below trivially true.
    expect(FILES.length).toBeGreaterThan(25)
    expect(FILES.some((f) => f.path === 'stock.tsx')).toBe(true)
    expect(FILES.some((f) => f.path === 'meter-logs.tsx')).toBe(true)
  })

  it('no screen gates on a hardcoded role list', () => {
    const offenders = FILES
      .filter((f) => LITERAL_GUARD.test(f.src))
      .map((f) => f.path)
      .filter((p) => !(p in LITERAL_GUARD_EXEMPT))

    expect(offenders).toEqual([])
  })

  it('every useModuleGuard key is a real module in MODULES', () => {
    // A typo'd key denies everyone but admin, silently and at runtime only.
    const bad: string[] = []
    for (const f of FILES) {
      for (const m of f.src.matchAll(/useModuleGuard\(\s*'([^']+)'\s*\)/g)) {
        if (!VALID_KEYS.has(m[1])) bad.push(`${f.path}: '${m[1]}'`)
      }
    }
    expect(bad).toEqual([])
  })

  it('every withModuleGuard key is a real module in MODULES', () => {
    const bad: string[] = []
    for (const f of FILES) {
      for (const m of f.src.matchAll(/withModuleGuard\([^,]+,\s*'([^']+)'\s*\)/g)) {
        if (!VALID_KEYS.has(m[1])) bad.push(`${f.path}: '${m[1]}'`)
      }
    }
    expect(bad).toEqual([])
  })

  it('a screen guarded twice uses the SAME key on both layers', () => {
    // withModuleGuard wraps the screen; useModuleGuard runs inside it. Two
    // different keys would let the wrapper admit a user the hook then bounces -
    // the original bug wearing a registry costume.
    const mismatched: string[] = []
    for (const f of FILES) {
      const outer = [...f.src.matchAll(/withModuleGuard\([^,]+,\s*'([^']+)'\s*\)/g)].map((m) => m[1])
      const inner = [...f.src.matchAll(/useModuleGuard\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
      if (!outer.length || !inner.length) continue
      for (const k of inner) {
        if (!outer.includes(k)) mismatched.push(`${f.path}: inner '${k}' vs outer '${outer.join("','")}'`)
      }
    }
    expect(mismatched).toEqual([])
  })

  it('the exemption list stays honest', () => {
    // An exemption whose screen no longer carries a literal guard is stale, and
    // a stale exemption is how a fixed bug creeps back in unnoticed.
    for (const [path, reason] of Object.entries(LITERAL_GUARD_EXEMPT)) {
      const f = FILES.find((x) => x.path === path)
      expect(f).toBeDefined()
      expect(LITERAL_GUARD.test(f!.src)).toBe(true)
      expect(reason.length).toBeGreaterThan(40)
    }
  })
})

describe('the module registry itself is intact', () => {
  it('covers the keys the reported bug touched', () => {
    // Pins the exact modules behind the owner's report, so a rename of any of
    // them has to come past this test.
    const keys: ModuleKey[] = ['stock', 'meter', 'vehicles', 'calendar', 'reportIssue', 'serial']
    for (const k of keys) expect(MODULE_BY_KEY[k]).toBeDefined()
  })

  it('declares each key exactly once', () => {
    // MODULE_BY_KEY is built by reduce, so a duplicated M(...) row silently
    // wins and one of the two role lists stops applying.
    const seen = MODULES.map((m) => m.key)
    expect(seen.length).toBe(new Set(seen).size)
  })

  it('every guard key used by a screen resolves to a module definition', () => {
    // The union-without-registry-entry gap tsc cannot see.
    const used = new Set<string>()
    for (const f of FILES) {
      for (const m of f.src.matchAll(/(?:use|with)ModuleGuard\((?:[^,]+,\s*)?'([^']+)'\s*\)/g)) {
        used.add(m[1])
      }
    }
    expect(used.size).toBeGreaterThan(10)
    for (const k of used) expect(MODULE_BY_KEY[k as ModuleKey]).toBeDefined()
  })
})
