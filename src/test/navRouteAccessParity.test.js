import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The sidebar must not offer a page the route will refuse, and a page must not be
 * reachable by a role the sidebar would never show it to.
 *
 * WHY THIS EXISTS, measured rather than imagined. `shouldShowNavItem` ends in a bare
 * `return true`: an item with no NAV_MODULE_KEY, no `adminOnly`, no `roles` and no `flag`
 * is visible to EVERY role. An audit of the live nav found 22 of 210 items in exactly
 * that state, and 20 of their routes carried NO guard at all - so they were not merely
 * visible to a Tyre Man or a Driver, they were reachable.
 *
 * That is two different defects and this file pins both directions:
 *
 *   nav open  + route guarded   -> the user sees the item and hits Access Denied
 *   nav open  + route unguarded -> the user can actually open it
 *
 * Neither is caught by a build, by eslint, or by any render test, because both files are
 * individually valid. Only the RELATIONSHIP between them is wrong.
 *
 * This reads source rather than importing, deliberately: NAV_CATALOG is exported
 * icon-free and drops `adminOnly` / `roles` / `flag`, so the real gate is only visible in
 * NAV_GROUPS itself. A test that imported the catalog would silently check nothing.
 */

const APP = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')
const LAYOUT = readFileSync(join(process.cwd(), 'src/components/Layout.jsx'), 'utf8')
const NAV_ACCESS = readFileSync(join(process.cwd(), 'src/lib/navAccess.js'), 'utf8')

/** Every `{ to: '/x', ... }` entry in NAV_GROUPS, with the raw text of its options. */
function navItems() {
  const start = LAYOUT.indexOf('const NAV_GROUPS = [')
  const end = LAYOUT.indexOf('export const NAV_CATALOG')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = LAYOUT.slice(start, end)
  const out = []
  const re = /\{\s*to:\s*'([^']+)'([^}]*)\}/g
  let m
  while ((m = re.exec(block))) out.push({ to: m[1], opts: m[2] })
  return out
}

/** Module keys that make an item follow the admin-managed access matrix. */
const KEYED = new Set([...NAV_ACCESS.matchAll(/'(\/[^']*)'\s*:/g)].map((m) => m[1]))

/** Is this nav item gated by anything at all? */
const isGated = (it) =>
  KEYED.has(it.to) ||
  /adminOnly/.test(it.opts) ||
  /roles:/.test(it.opts) ||
  /flag:/.test(it.opts)

/** The `<RoleRoute allowed={[...]}>` guarding a route, or null. */
function routeRoles(route) {
  // Split on Route boundaries so one route's guard can never bleed into the next.
  for (const chunk of APP.split(/(?=<Route\s)/)) {
    const head = chunk.match(/^<Route\s+path="([^"]+)"/)
    if (!head || head[1] !== route) continue
    const seg = chunk.slice(0, 600)
    if (!/<RoleRoute/.test(seg)) return null
    const allowed = seg.match(/allowed=\{\[([^\]]*)\]\}/)
    if (!allowed) return null
    return allowed[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  }
  return null
}

describe('nav visibility matches route access', () => {
  it('no nav item is visible to every role while its route restricts by role', () => {
    // The mismatch a user actually notices: the item is in the sidebar, and clicking it
    // lands on Access Denied.
    const offenders = navItems()
      .filter((it) => !isGated(it))
      .filter((it) => routeRoles(it.to) !== null)
      .map((it) => `${it.to} route allows [${routeRoles(it.to).join(', ')}] but the nav shows it to everyone`)

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('a nav item gated by roles has a route guard that agrees', () => {
    // The opposite direction: hiding it in the sidebar is not access control. Typing the
    // URL must be refused too, or the gate is decorative.
    const offenders = []
    for (const it of navItems()) {
      const m = it.opts.match(/roles:\s*\[([^\]]*)\]/)
      if (!m) continue
      const navRoles = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
      const guard = routeRoles(it.to)
      if (guard === null) {
        offenders.push(`${it.to} is hidden from the sidebar for all but [${navRoles.join(', ')}] but its route has NO RoleRoute`)
        continue
      }
      // The route may be broader than the nav (a grant can open it) but never narrower
      // in a way that shows someone an item they cannot open.
      const shownButRefused = navRoles.filter((r) => !guard.includes(r))
      if (shownButRefused.length > 0) {
        offenders.push(`${it.to} shows for [${shownButRefused.join(', ')}] but the route refuses them`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('report builders stay Admin-only in both the nav and the route', () => {
    // The owner's explicit instruction, and the one gate a per-user grant must NOT open -
    // shouldShowNavItem checks it BEFORE the grant short-circuit.
    expect(LAYOUT).toMatch(/REPORT_BUILDER_ROUTES\.includes\(item\.to\)/)
    expect(LAYOUT).toMatch(/!canUseReportBuilder\(profile, isSuperAdmin\)\) return false/)
  })

  it('favourites cannot reach a route the sidebar hides', () => {
    // canSeeRoute must DELEGATE to shouldShowNavItem rather than re-deriving the rule,
    // or a favourite becomes a way around the sidebar.
    expect(LAYOUT).toMatch(/canSeeRoute[\s\S]{0,400}shouldShowNavItem\(entry\.item/)
  })
})
