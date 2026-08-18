/**
 * Every way out of a screen must land the user somewhere real - and somewhere
 * they came from, not the Home hub.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * The product owner reported three times that backing out of a checklist (and
 * out of checklist History) jumped to Home instead of the module he opened it
 * from. Two independent causes, both guarded here:
 *
 *  1. THE NAVIGATOR. Every screen under app/(app) is a TAB route - there is no
 *     nested Stack. @react-navigation/routers TabRouter defaults `backBehavior`
 *     to 'firstRoute', which builds a history of exactly [routes[0], current].
 *     routes[0] is `index` = Home, so `canGoBack()` was true everywhere and
 *     `back()` popped straight to Home. That is why the earlier fixes, which
 *     all tuned per-screen FALLBACKS, were partial: the fallback branch was
 *     never reached. `backBehavior="history"` on the Tabs navigator is the fix,
 *     and it is asserted below because deleting one prop silently restores the
 *     whole defect.
 *
 *  2. THE CALL SITES. A bare `router.back()` is a silent NO-OP with no history,
 *     and a hand-rolled canGoBack/back/replace triple is a second copy of the
 *     rule that drifts from lib/goBack.ts (the checklist fill screen had
 *     exactly that). Both are banned here.
 *
 * And every fallback route is resolved against a route table READ OFF THE
 * FILESYSTEM the way expo-router builds one, because a fallback pointing at a
 * folder with no index file does not error - it silently lands on +not-found.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const MOBILE_DIR = join(__dirname, '..')
const APP_DIR = join(MOBILE_DIR, 'app')

// ── The route table, built the way expo-router builds one ────────────────────

/** Files under app/ that are NOT routes. */
const NON_ROUTE = /^(_layout|\+html|\+native-intent)\./
/** The catch-all is EXCLUDED: it matches everything, so leaving it in would
 *  make every "does this route exist" assertion vacuously pass - which is the
 *  precise failure this suite exists to catch. */
const NOT_FOUND = /^\+not-found\./

/** "(app)/records" is also reachable as "records": group segments are optional. */
function groupVariants(segments: string[]): string[] {
  let forms: string[][] = [[]]
  for (const seg of segments) {
    const isGroup = seg.startsWith('(') && seg.endsWith(')')
    forms = forms.flatMap((f) => (isGroup ? [[...f, seg], [...f]] : [[...f, seg]]))
  }
  return Array.from(new Set(forms.map((f) => f.join('/'))))
}

function collectRoutes(dir: string, prefix: string[] = [], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      collectRoutes(full, [...prefix, name], out)
      continue
    }
    if (!/\.(tsx|ts|jsx|js)$/.test(name)) continue
    if (NON_ROUTE.test(name) || NOT_FOUND.test(name)) continue
    const base = name.replace(/\.(tsx|ts|jsx|js)$/, '')
    const segments = base === 'index' ? prefix : [...prefix, base]
    out.push(...groupVariants(segments))
  }
  return out
}

const ROUTES = Array.from(new Set(collectRoutes(APP_DIR)))
const STATIC = new Set(ROUTES.filter((r) => !r.includes('[')))
const DYNAMIC = ROUTES.filter((r) => r.includes('[')).map((r) => new RegExp(
  '^' + r
    .split('/')
    .map((seg) =>
      /^\[\.\.\..+\]$/.test(seg) ? '.+'
      : /^\[.+\]$/.test(seg) ? '[^/]+'
      : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/') + '$',
))

function normalise(href: string): string {
  return String(href).split('?')[0].split('#')[0].replace(/^\/+/, '').replace(/\/+$/, '')
}

function resolves(href: string): boolean {
  const p = normalise(href)
  if (STATIC.has(p)) return true
  return DYNAMIC.some((re) => re.test(p))
}

// ── The screen sweep ─────────────────────────────────────────────────────────

function collectScreens(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { collectScreens(full, out); continue }
    if (/\.(tsx|ts)$/.test(name)) out.push(full)
  }
  return out
}

const SCREENS = collectScreens(APP_DIR).map((f) => ({
  path: f,
  rel: relative(MOBILE_DIR, f).split('\\').join('/'),
  src: readFileSync(f, 'utf8'),
}))

/** Strip comments so a rule quoted in prose is never mistaken for real code. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// ── The scan is real ─────────────────────────────────────────────────────────

describe('the sweep actually reads the app', () => {
  it('found the screens and the route table', () => {
    expect(SCREENS.length).toBeGreaterThan(40)
    expect(ROUTES.length).toBeGreaterThan(30)
    expect(SCREENS.some((s) => s.rel.endsWith('app/(app)/checklists/[templateId].tsx'))).toBe(true)
    expect(SCREENS.some((s) => s.rel.endsWith('app/(app)/checklists/history.tsx'))).toBe(true)
    expect(resolves('/(app)/checklists')).toBe(true)
    expect(resolves('/(app)/accident/abc-123')).toBe(true)
    // A folder with no index file must NOT resolve - that is the whole point.
    expect(resolves('/(app)/inspection')).toBe(false)
  })

  it('the comment stripper leaves real code alone', () => {
    expect(code('a // router.back()\nb')).not.toContain('router.back()')
    expect(code('/* router.back() */ x')).not.toContain('router.back()')
    expect(code("router.back()")).toContain('router.back()')
    // A route literal contains "//" only after a scheme; ours never do.
    expect(code("backTo(router, '/(app)/admin')")).toContain("'/(app)/admin'")
  })
})

// ── 1. The navigator must not send Back to Home ──────────────────────────────

describe('the tab navigator records real history', () => {
  const layout = SCREENS.find((s) => s.rel === 'app/(app)/_layout.tsx')

  it('the (app) layout exists and is a Tabs navigator', () => {
    expect(layout).toBeDefined()
    expect(code(layout!.src)).toMatch(/<Tabs\b/)
  })

  it('declares backBehavior="history" - without it back() is hardwired to Home', () => {
    const src = code(layout!.src)
    expect(src).toMatch(/backBehavior\s*=\s*(["']history["']|\{\s*['"]history['"]\s*\})/)
  })

  it('does not use firstRoute/initialRoute, which both pin Back to one screen', () => {
    const src = code(layout!.src)
    expect(src).not.toMatch(/backBehavior\s*=\s*(["']|\{\s*['"])(firstRoute|initialRoute)/)
  })
})

// ── 2. No bare back(), no hand-rolled copy of the helper ─────────────────────

/**
 * `admin/access.tsx` has a LOCAL `backToList()` that closes an in-page detail
 * pane - it sets component state and never touches the router, so it is not a
 * navigation call site. Matched by name only, and asserted to still exist so a
 * rename cannot leave a silent hole here.
 */
describe('every screen leaves via the shared helper', () => {
  it('no screen calls a bare router.back()', () => {
    const offenders: string[] = []
    for (const s of SCREENS) {
      const src = code(s.src)
      // `backTo` internally owns the only legitimate .back() call, and it does
      // not live under app/.
      if (/\brouter\s*\.\s*back\s*\(/.test(src)) offenders.push(s.rel)
    }
    expect(offenders).toEqual([])
  })

  it('no screen hand-rolls the canGoBack/back/replace triple', () => {
    const offenders: string[] = []
    for (const s of SCREENS) {
      const src = code(s.src)
      const hasCanGoBack = /\bcanGoBack\s*\(/.test(src)
      const hasReplace = /\brouter\s*\.\s*replace\s*\(/.test(src)
      if (hasCanGoBack && hasReplace) offenders.push(s.rel)
    }
    expect(offenders).toEqual([])
  })

  it('the local admin/access backToList is state, not navigation', () => {
    const s = SCREENS.find((x) => x.rel === 'app/(app)/admin/access.tsx')
    expect(s).toBeDefined()
    expect(code(s!.src)).toMatch(/function\s+backToList\s*\(/)
  })
})

// ── 3. Every fallback names a route that exists ──────────────────────────────

/**
 * Collect the fallback argument of every `backTo(router, '<route>')`, every
 * `useGoBack('<route>')` and every `<BackButton fallback="<route>" />`.
 * Template literals with a `${}` head are resolved on their literal prefix plus
 * a placeholder segment, so `/(app)/accident/${id}` is checked as a real route.
 */
interface Fallback { screen: string; raw: string; href: string }

function collectFallbacks(): Fallback[] {
  const out: Fallback[] = []
  const push = (screen: string, raw: string) => {
    // A template head like `/(app)/accident/${id}` -> `/(app)/accident/x`.
    const href = raw.replace(/\$\{[^}]*\}/g, 'x')
    out.push({ screen, raw, href })
  }
  /** Every quoted string / template on one line, so a ternary fallback like
   *  `id ? \`/(app)/accident/${id}\` : '/(app)/accident/dashboard'` has BOTH of
   *  its branches checked. Line-based on purpose: a route literal CONTAINS
   *  parentheses - "/(app)/x" - so any paren-bounded match for the call's
   *  argument list stops inside the route itself and silently checks nothing. */
  const literalsIn = (line: string): string[] =>
    Array.from(line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)).map((m) => m[2])

  for (const s of SCREENS) {
    for (const line of code(s.src).split('\n')) {
      // backTo(router, <expr>) and useGoBack(<expr>): the router argument
      // carries no quotes, so every literal on the line is a candidate route.
      if (/\b(backTo|useGoBack)\s*\(/.test(line)) {
        // Keep only what can be a route: every href in this app is absolute.
        // Without this an unrelated t('modules.x') on the same line would be
        // reported as a broken route. An EMPTY literal is kept deliberately -
        // a blank fallback silently becomes the Home hub, which is the bug.
        for (const lit of literalsIn(line)) {
          if (lit.startsWith('/') || lit.trim() === '') push(s.rel, lit)
        }
      }
      // <BackButton fallback="<route>" />  |  fallback={'<route>'}
      for (const m of line.matchAll(/fallback\s*=\s*\{?\s*(['"`])([^'"`]*)\1/g)) {
        push(s.rel, m[2])
      }
    }
  }
  return out
}

const FALLBACKS = collectFallbacks()

describe('every back fallback points at a route that exists', () => {
  it('found fallbacks to check', () => {
    // If this drops to nothing the assertions below become vacuous.
    expect(FALLBACKS.length).toBeGreaterThan(20)
  })

  it('resolves every one against the real app/ directory', () => {
    const broken = FALLBACKS
      .filter((f) => !resolves(f.href))
      .map((f) => `${f.screen}: "${f.raw}" is not a route (a folder with no index lands on +not-found)`)
    expect(broken).toEqual([])
  })

  it('no fallback is blank - a blank one silently becomes the Home hub', () => {
    const blank = FALLBACKS.filter((f) => !f.raw.trim()).map((f) => f.screen)
    expect(blank).toEqual([])
  })
})

// ── 4. The screens the owner reported, named explicitly ──────────────────────

describe('the screens in the owner report land in their own module', () => {
  const fallbacksFor = (rel: string) =>
    FALLBACKS.filter((f) => f.screen === rel).map((f) => f.raw)

  it('the checklist fill screen falls back to the checklists list, not Home', () => {
    const fbs = fallbacksFor('app/(app)/checklists/[templateId].tsx')
    expect(fbs).toContain('/(app)/checklists')
    expect(fbs).not.toContain('/(app)')
  })

  it('checklist History falls back to the checklists list, not Home', () => {
    const fbs = fallbacksFor('app/(app)/checklists/history.tsx')
    expect(fbs).toContain('/(app)/checklists')
    expect(fbs).not.toContain('/(app)')
  })

  it('the checklist approval queue and one submission stay inside checklists', () => {
    expect(fallbacksFor('app/(app)/checklists/approvals/index.tsx')).toContain('/(app)/checklists')
    const sub = SCREENS.find((s) => s.rel === 'app/(app)/checklists/approvals/[submissionId].tsx')
    expect(code(sub!.src)).toMatch(/useGoBack\s*\(\s*APPROVALS_QUEUE\s*\)/)
    expect(code(sub!.src)).toMatch(/APPROVALS_QUEUE\s*=\s*['"]\/\(app\)\/checklists\/approvals['"]/)
  })

  it('closing a submission in History is a modal, not a navigation', () => {
    const s = SCREENS.find((x) => x.rel === 'app/(app)/checklists/history.tsx')
    const src = code(s!.src)
    // The viewer is a <Modal> closed by clearing state; if it ever starts
    // navigating on close it will pop a screen the user never pushed.
    expect(src).toMatch(/<Modal\b/)
    expect(src).toMatch(/onClose=\{\(\)\s*=>\s*set\w+\(null\)\}/)
  })

  it('every admin sub-page falls back to the admin hub', () => {
    for (const rel of [
      'app/(app)/admin/access.tsx',
      'app/(app)/admin/ai-chat.tsx',
      'app/(app)/admin/approvals.tsx',
      'app/(app)/admin/sites.tsx',
      'app/(app)/admin/users.tsx',
    ]) {
      expect(fallbacksFor(rel)).toContain('/(app)/admin')
    }
  })

  it('an inspection detail falls back to History, the only screen that opens it', () => {
    expect(fallbacksFor('app/(app)/inspection/[id].tsx')).toContain('/(app)/history')
  })

  it('an accident case names its own accident, with the register only as a last resort', () => {
    // A ternary fallback: BOTH branches must be real routes, which is why the
    // collector reads every literal in the expression rather than the first.
    const fbs = fallbacksFor('app/(app)/accident/case.tsx')
    expect(fbs).toContain('/(app)/accident/${id}')
    expect(fbs).toContain('/(app)/accident/dashboard')
  })
})
