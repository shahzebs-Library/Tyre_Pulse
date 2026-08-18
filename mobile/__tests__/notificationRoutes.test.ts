/**
 * Every route this app can navigate to must actually exist.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * The product owner tapped a notification and got expo-router's raw
 * "Unmatched Route - Page could not be found" developer screen, Sitemap link
 * and all. `notificationRoute()` returned `/(app)/inspection` and
 * `/(app)/accident`, and NEITHER is a route: both are DIRECTORIES with no
 * `index` file (inspection has [id]/new/approvals, accident has
 * [id]/case/dashboard/report). expo-router only addresses a folder by its
 * folder path when that folder carries an `index`.
 *
 * WHY IT SURVIVED REVIEW, AND WHY THIS TEST IS SHAPED THE WAY IT IS
 * ----------------------------------------------------------------
 * A literal grep for route strings finds every static `router.push('/(app)/x')`
 * and all of those were valid. The two broken ones were COMPUTED - strings
 * RETURNED from a function - so they never appeared as a navigation call site
 * at all. A test that only checked the literals would have passed while the bug
 * shipped. So this suite does both:
 *
 *   1. resolves every route `notificationRoute()` can return, across a
 *      realistic spread of notification kinds (the computed half), and
 *   2. sweeps the source for route literals and template heads (the static
 *      half),
 *
 * against a route table READ OFF THE FILESYSTEM the same way expo-router
 * builds one - so it can never drift from the real app/ directory.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

// notificationsInbox imports the supabase client (react-native + expo native
// modules). This runner is plain Node; only the pure mapping is under test.
jest.mock('../lib/supabase', () => ({ supabase: {} }))

import { notificationRoute } from '../lib/notificationsInbox'

const MOBILE_DIR = join(__dirname, '..')
const APP_DIR = join(MOBILE_DIR, 'app')

// ── The route table, built the way expo-router builds one ────────────────────

/** Files under app/ that are NOT routes. */
const NON_ROUTE = /^(_layout|\+html|\+native-intent)\./
/** The catch-all. Deliberately EXCLUDED from the matchers below: it matches
 *  everything, so leaving it in would make every assertion vacuously pass -
 *  which is the whole failure this suite exists to catch. */
const NOT_FOUND = /^\+not-found\./

/** Expand a route whose segments include expo-router groups into every form a
 *  href may legally take: "(app)/records" is also reachable as "records". */
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

/** Static routes match by string; dynamic ones ([id], [...rest]) by pattern. */
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

/** "/(app)/inspection/new?x=1" -> "(app)/inspection/new" */
function normalise(href: string): string {
  return String(href)
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function resolves(href: string): boolean {
  const p = normalise(href)
  if (STATIC.has(p)) return true
  return DYNAMIC.some((re) => re.test(p))
}

// ── The scan is real ─────────────────────────────────────────────────────────

describe('the route table is read from the real app/ directory', () => {
  it('found the screens (a broken path would make every test below pass)', () => {
    expect(ROUTES.length).toBeGreaterThan(30)
    expect(STATIC.has('(app)/workshop')).toBe(true)
    expect(STATIC.has('(app)/accident/dashboard')).toBe(true)
    expect(STATIC.has('(app)/inspection/approvals')).toBe(true)
    // Group segments are optional in a href, so both forms resolve.
    expect(resolves('/(app)/records')).toBe(true)
    expect(resolves('/records')).toBe(true)
    // Dynamic segments resolve.
    expect(resolves('/(app)/accident/abc-123')).toBe(true)
  })

  it('knows a folder with no index file is NOT a route', () => {
    // This is the defect itself, stated as an assertion. `app/(app)/inspection`
    // and `app/(app)/accident` are directories of screens with no `index`, so
    // neither folder path is addressable - pushing one lands on +not-found.
    expect(existsSync(join(APP_DIR, '(app)', 'inspection'))).toBe(true)
    expect(existsSync(join(APP_DIR, '(app)', 'inspection', 'index.tsx'))).toBe(false)
    expect(resolves('/(app)/inspection')).toBe(false)

    expect(existsSync(join(APP_DIR, '(app)', 'accident'))).toBe(true)
    expect(existsSync(join(APP_DIR, '(app)', 'accident', 'index.tsx'))).toBe(false)
    expect(resolves('/(app)/accident')).toBe(false)
  })
})

// ── The computed half: notificationRoute() ───────────────────────────────────

/**
 * A realistic spread. Server-sent kinds come from the notification triggers and
 * push consumers (approval requested/decided, job assigned, parts, QC, accident,
 * alert); local kinds come from lib/notifications.ts. `entity_type` is what the
 * mapping keys on when present, falling back to `type`.
 */
const FIXTURES: { name: string; type: string | null; entity_type: string | null }[] = [
  { name: 'inspection approval requested', type: 'approval_requested', entity_type: 'inspection' },
  { name: 'checklist approval requested',  type: 'approval_requested', entity_type: 'checklist_submission' },
  { name: 'inspection decided',            type: 'approval_decision',  entity_type: 'inspection' },
  { name: 'checklist decided',             type: 'approval_decision',  entity_type: 'checklist_submission' },
  { name: 'job assigned',                  type: 'workshop.job_assigned', entity_type: 'wo_assignment' },
  { name: 'work order',                    type: 'work_order_update',  entity_type: 'work_order' },
  { name: 'parts request',                 type: 'parts_request',      entity_type: 'parts_request' },
  { name: 'QC failed',                     type: 'qc_failed',          entity_type: 'work_order' },
  { name: 'accident reported',             type: 'accident.reported',  entity_type: 'accident' },
  { name: 'accident closed',               type: 'accident_closed',    entity_type: 'accident' },
  { name: 'incident',                      type: 'incident_reported',  entity_type: 'incident_report' },
  { name: 'insurance claim',               type: 'claim_updated',      entity_type: 'insurance_claim' },
  { name: 'fleet alert',                   type: 'alert',              entity_type: 'alert' },
  { name: 'upload gap',                    type: 'upload_gap',         entity_type: null },
  { name: 'broadcast',                     type: 'broadcast',          entity_type: null },
  // Local device notifications.
  { name: 'daily inspection reminder',     type: 'inspection_reminder', entity_type: null },
  { name: 'sync failure',                  type: 'sync_failure',        entity_type: null },
  { name: 'sync success',                  type: 'sync_success',        entity_type: null },
  { name: 'photo upload failure',          type: 'photo_failure',       entity_type: null },
  { name: 'wash due',                      type: 'wash_due',            entity_type: null },
  // Degenerate rows the table can genuinely hold.
  { name: 'unknown kind',                  type: 'something_new',       entity_type: 'mystery' },
  { name: 'empty row',                     type: null,                  entity_type: null },
]

describe('notificationRoute only returns routes that exist', () => {
  it.each(FIXTURES)('$name resolves (or is honestly null)', ({ type, entity_type }) => {
    const route = notificationRoute({ type, entity_type })
    if (route === null) return          // "nowhere sensible to go" is allowed
    expect(typeof route).toBe('string')
    expect(route.trim()).not.toBe('')
    if (!resolves(route)) {
      throw new Error(
        `notificationRoute returned "${route}", which is not a route. `
        + 'expo-router will render +not-found. If it is a folder, that folder '
        + 'has no index file - point at a real screen inside it instead.',
      )
    }
  })

  it('sends the two kinds that were broken to a screen that can act', () => {
    // Pinned by name as well as by resolution, so a regression back to a bare
    // folder path fails loudly rather than quietly landing somewhere else.
    expect(notificationRoute({ type: 'approval_requested', entity_type: 'inspection' }))
      .toBe('/(app)/inspection/approvals')
    expect(notificationRoute({ type: 'accident.reported', entity_type: 'accident' }))
      .toBe('/(app)/accident/dashboard')
  })

  it('a local reminder still opens a NEW inspection, not the approval queue', () => {
    // 'inspection_reminder' contains the word "inspection"; the exact-type
    // branch must win over the entity bucket.
    expect(notificationRoute({ type: 'inspection_reminder', entity_type: null }))
      .toBe('/(app)/inspection/new')
  })

  it('an unmappable notification returns null so the tap stays put', () => {
    expect(notificationRoute({ type: null, entity_type: null })).toBeNull()
    expect(notificationRoute({ type: 'something_new', entity_type: 'mystery' })).toBeNull()
  })
})

// ── The static half: every route literal in the source ───────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const SOURCE_DIRS = ['app', 'lib', 'components', 'hooks', 'contexts']
  .map((d) => join(MOBILE_DIR, d))
  .filter((d) => existsSync(d))

const SOURCE_FILES = SOURCE_DIRS.flatMap((d) => walk(d))

/**
 * Blank out comments before scanning for route literals.
 *
 * Needed for accuracy in BOTH directions: a route string quoted inside an
 * explanatory comment is not a navigation, and (the reason this exists) the
 * comment in notificationsInbox.ts that names the two broken folder paths would
 * otherwise be reported as live defects forever. A naive regex would also cut a
 * "https://" in half, so this walks the source tracking string / template /
 * comment state instead.
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'tpl' = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === "'") state = 'single'
      else if (c === '"') state = 'double'
      else if (c === '`') state = 'tpl'
      out += c; i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c } else out += ' '
      i++; continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? c : ' '
      i++; continue
    }
    // Inside a string / template literal.
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'
    }
    out += c; i++
  }
  return out
}

/** Any quoted string that starts with a group segment, i.e. an in-app href. */
const HREF_LITERAL = /['"`](\/\((?:app|auth)\)[^'"`]*)['"`]/g

/**
 * Reduce a literal (possibly a template) to something resolvable:
 *   `/(app)/accident/${id}`        -> /(app)/accident/__id__
 *   `/(app)/accident/case?id=${x}` -> /(app)/accident/case
 * A head that stops mid-segment (e.g. `/(app)/rec${x}`) cannot be checked and
 * is skipped rather than guessed at.
 */
function probeFor(literal: string): string | null {
  const cut = literal.indexOf('${')
  if (cut === -1) return literal
  const head = literal.slice(0, cut)
  if (head.includes('?')) return head.split('?')[0]
  if (head.endsWith('/')) return head + '__dynamic__'
  return null
}

const HREFS: { file: string; href: string; probe: string }[] = []
for (const file of SOURCE_FILES) {
  const src = stripComments(readFileSync(file, 'utf8'))
  for (const m of src.matchAll(HREF_LITERAL)) {
    const probe = probeFor(m[1])
    if (probe) HREFS.push({ file: relative(MOBILE_DIR, file), href: m[1], probe })
  }
}

describe('every in-app route literal in the source resolves', () => {
  it('found route literals to check (the sweep is not vacuous)', () => {
    expect(HREFS.length).toBeGreaterThan(20)
    expect(HREFS.some((h) => h.href === '/(app)/accident/dashboard')).toBe(true)
  })

  it('none of them points at a screen that does not exist', () => {
    const broken = HREFS
      .filter((h) => !resolves(h.probe))
      .map((h) => `${h.file}: ${h.href}`)
    expect(Array.from(new Set(broken))).toEqual([])
  })

  it('no literal uses the /index form expo-router does not address', () => {
    // Recorded rule: push the FOLDER path, never folder + "/index".
    const offenders = HREFS
      .filter((h) => /\/index$/.test(normalise(h.href)))
      .map((h) => `${h.file}: ${h.href}`)
    expect(offenders).toEqual([])
  })
})

// ── The safety net itself ────────────────────────────────────────────────────

describe('the app owns its not-found screen', () => {
  it('app/+not-found.tsx exists, so expo-router does not show its own', () => {
    // Without this file expo-router substitutes views/Unmatched.js - a black
    // developer screen with the raw deep-link URL and a Sitemap link listing
    // every route. That is what reached the owner's phone.
    expect(existsSync(join(APP_DIR, '+not-found.tsx'))).toBe(true)
  })

  it('it does not expose internals or a sitemap', () => {
    // Comments explain WHY the screen exists (and must name the thing it
    // replaces); what matters is that nothing internal is RENDERED.
    const src = stripComments(readFileSync(join(APP_DIR, '+not-found.tsx'), 'utf8'))
    expect(src).not.toMatch(/_sitemap|Sitemap/)
    expect(src).not.toMatch(/Unmatched Route/)
    // Plain language comes from the locale files, not hardcoded route names.
    expect(src).toMatch(/modules\.notFound\./)
  })
})

// ── The strings it renders exist in BOTH locales ─────────────────────────────

describe('not-found copy is translated', () => {
  // A missing key does not fall back to English unless it exists in en.json;
  // absent from both, the RAW KEY PATH renders on screen.
  const KEYS = ['title', 'body', 'home']
  it.each(['en', 'ar'])('%s.json carries every modules.notFound key', (lang) => {
    const dict = JSON.parse(readFileSync(join(MOBILE_DIR, 'locales', `${lang}.json`), 'utf8'))
    for (const k of KEYS) {
      expect(typeof dict?.modules?.notFound?.[k]).toBe('string')
      expect(String(dict.modules.notFound[k]).trim()).not.toBe('')
    }
  })
})
