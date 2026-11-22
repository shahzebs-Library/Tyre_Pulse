/**
 * Console link targets.
 *
 * Reads the source as text and proves that every place the System Console can
 * send you actually exists:
 *
 *   1. every /console/... string used anywhere in src/ resolves to a route in
 *      the /console block of App.jsx (the catch-all does not count: landing on
 *      the Overview by accident is what a broken link looks like);
 *   2. a link that names a tab (?tab=x) names one its page really has, and the
 *      old-route redirects in App.jsx point at real tabs too;
 *   3. nothing inside the console walks to a MAIN-APP page in the same tab. The
 *      console tab holds its own tab-local session, so such a jump lands on the
 *      app's sign-in page. Main-app targets must open a new tab
 *      (openConsoleRoute, ConsoleLink, or an anchor with target="_blank").
 *
 * A source scan, not a render test, because the failure being guarded is a
 * string typed wrongly, and a typo passes every render test until someone
 * clicks it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { NAV_GROUPS, activeNavTo } from '../console/components/ConsoleLayout'

const SRC = resolve(__dirname, '..')
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'test' && name !== '__tests__') walk(p, out) } else if (/\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

const APP = read(join(SRC, 'App.jsx'))
// The <Route path="/console/*"> block, up to the main-app catch-all.
const blockStart = APP.indexOf('<Route path="/console/*"')
const blockEnd = APP.indexOf('<Route path="*" element={<MainApp />}', blockStart)
const BLOCK = APP.slice(blockStart, blockEnd)

/** Every route line of the console block: { path, line }. */
const ROUTE_LINES = BLOCK.split('\n').map((line) => {
  const m = line.match(/<Route\s+(?:path="([^"]+)"|(index))/)
  return m ? { path: m[2] ? '' : m[1], line } : null
}).filter((r) => r && r.path !== '/console/*')

const PATTERNS = ROUTE_LINES.filter((r) => r.path !== '*').map((r) => {
  const src = r.path.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')
  return new RegExp(`^/console${src ? `/${src}` : ''}/?$`)
})
const hasRoute = (pathname) => pathname === '/console/login' || PATTERNS.some((re) => re.test(pathname))

/** Component name -> page file, from the lazy imports at the top of App.jsx. */
const COMPONENT_FILE = {}
for (const m of APP.matchAll(/const (\w+)\s*=\s*lazy\(\(\) => import\('\.\/console\/pages\/(\w+)'\)\)/g)) COMPONENT_FILE[m[1]] = m[2]
for (const m of APP.matchAll(/const (\w+)\s*=\s*lazyConsolePage\('(\w+)'/g)) COMPONENT_FILE[m[1]] = m[2]

/** Route path -> the page file that renders it (direct routes only). */
const ROUTE_FILE = {}
for (const r of ROUTE_LINES) {
  const m = r.line.match(/element=\{(?:<ConsoleAuthBridge>)?(?:<Suspense[^>]*>)?<(Console\w+)/)
  if (m && COMPONENT_FILE[m[1]]) ROUTE_FILE[`/console${r.path ? `/${r.path}` : ''}`] = join(SRC, 'console', 'pages', `${COMPONENT_FILE[m[1]]}.jsx`)
}

/** Does this page know a tab called `tab`? Quoted key, or an alias key. */
function pageKnowsTab(file, tab) {
  const text = read(file)
  const t = tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`['"\`]${t}['"\`]|[{,\\s]${t}:\\s`).test(text)
}

/** Every literal /console... target in the source, with where it was found. */
function consoleTargets() {
  const out = []
  for (const file of walk(SRC)) {
    if (file === join(SRC, 'App.jsx')) continue
    const text = read(file)
    for (const m of text.matchAll(/['"`](\/console(?:[/?#][^'"`\s]*)?)/g)) {
      // '/console/*' only ever appears in comments about the route itself.
      if (m[1].includes('*')) continue
      out.push({ target: m[1], file: relative(SRC, file) })
    }
  }
  return out
}

/** Split a target into pathname + query, with ${...} holes turned into "x". */
function parse(target) {
  const flat = target.replace(/\$\{[^}]*\}?/g, 'x')
  const [pathname, query = ''] = flat.split('#')[0].split('?')
  return { pathname: pathname.replace(/\/+$/, '') || '/console', params: new URLSearchParams(query) }
}

describe('console link targets', () => {
  it('finds the console route block and its pages', () => {
    expect(blockStart).toBeGreaterThan(-1)
    expect(blockEnd).toBeGreaterThan(blockStart)
    expect(PATTERNS.length).toBeGreaterThan(40)
    expect(Object.keys(ROUTE_FILE).length).toBeGreaterThan(20)
  })

  it('every /console link in the source has a route', () => {
    const targets = consoleTargets()
    expect(targets.length).toBeGreaterThan(100)
    const dead = targets
      // `/console/database${s ? ...}` builds a longer path at run time.
      .filter(({ target }) => !/\$\{[^}]*$/.test(target) || target.includes('?'))
      .filter(({ target }) => !hasRoute(parse(target).pathname))
      .map(({ target, file }) => `${target}  (${file})`)
    expect(dead).toEqual([])
  })

  it('every sidebar entry has a route, and its landing place does too', () => {
    const items = NAV_GROUPS.flatMap((g) => g.items)
    expect(items.filter((i) => !hasRoute(i.to)).map((i) => i.to)).toEqual([])
    expect(items.filter((i) => i.at && !hasRoute(i.at)).map((i) => i.at)).toEqual([])
  })

  it('a link that names a tab names one its page really has', () => {
    const bad = []
    for (const { target, file } of consoleTargets()) {
      const { pathname, params } = parse(target)
      const tab = params.get('tab')
      const page = ROUTE_FILE[pathname]
      // Old routes move ?tab= into a sub-parameter of the page they redirect to.
      if (!tab || tab === 'x' || !page) continue
      if (!pageKnowsTab(page, tab)) bad.push(`${target}  (${file})`)
    }
    expect(bad).toEqual([])
  })

  it('every old-route redirect lands on a real page and a real tab', () => {
    const bad = []
    for (const r of ROUTE_LINES) {
      const m = r.line.match(/<(?:ConsoleTabRedirect|LegacyRedirect|Navigate) to="([^"]+)"(?: tab="([^"]+)")?/)
      if (!m) continue
      const { pathname, params } = parse(m[1])
      if (!hasRoute(pathname)) { bad.push(`${r.path} -> ${m[1]} (no route)`); continue }
      const tab = m[2] || params.get('tab')
      const page = ROUTE_FILE[pathname]
      if (tab && page && !pageKnowsTab(page, tab)) bad.push(`${r.path} -> ${pathname}?tab=${tab} (no such tab)`)
    }
    expect(bad).toEqual([])
  })

  it('nothing in the console walks to a main-app page in the same tab', () => {
    const bad = []
    for (const file of walk(join(SRC, 'console'))) {
      const text = read(file)
      const rel = relative(SRC, file)
      // navigate('/somewhere-in-the-app') or <Link to="/somewhere-in-the-app">
      for (const m of text.matchAll(/navigate\(\s*['"`](\/(?!console\b)[^'"`]*)|<(?:Link|NavLink)\b[^>]*\bto=\{?['"`](\/(?!console\b)[^'"`]*)/g)) {
        bad.push(`${m[1] || m[2]}  (${rel})`)
      }
      // A page that reads the shared issue routes (some are main-app pages)
      // must open them through openConsoleRoute, never a bare navigate().
      if (/\bISSUE_ROUTE\b/.test(text) && !/openConsoleRoute/.test(text)) bad.push(`ISSUE_ROUTE without openConsoleRoute  (${rel})`)
      // A same-tab anchor to a main-app page.
      for (const m of text.matchAll(/<a\b[^>]*\bhref="(\/(?!console\b)[^"]*)"[^>]*>/g)) {
        const sameTab = !/target="_blank"/.test(m[0])
        // The sign-in screen links back to the user login on purpose.
        if (sameTab && !rel.endsWith('ConsoleLogin.jsx')) bad.push(`${m[1]}  (${rel})`)
      }
    }
    expect(bad).toEqual([])
  })

  it('highlights exactly one sidebar entry for a redirected page', () => {
    expect(activeNavTo('/console/database/backups')).toBe('/console/backups')
    expect(activeNavTo('/console/database/trust/lineage')).toBe('/console/lineage')
    expect(activeNavTo('/console/database')).toBe('/console/database')
    expect(activeNavTo('/console/database/tables')).toBe('/console/database')
    expect(activeNavTo('/console')).toBe('/console')
    expect(activeNavTo('/console/users/abc')).toBe('/console/users')
    expect(activeNavTo('/console/health')).toBe('/console/health')
  })
})
