/**
 * The console must NEVER open on the main app's session.
 *
 * The reported bug: a signed-in super admin clicked "System Console" in the
 * sidebar and walked STRAIGHT into the super-admin console - no console
 * sign-in - because the in-tab navigation carried the shared main-app session
 * and resolveAdmin admitted it. These tests pin the three layers that close
 * that path. They read the source (like rowCapGuard) because the behaviour is
 * a property of how the routes/link are WIRED, and a regression looks exactly
 * like the working code in review.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('console surface isolation', () => {
  it('the main-app frontend carries NO console entry at all', () => {
    // Explicit instruction: the frontend never surfaces the console - not a
    // NavLink, not an anchor, not even for admins or super admins. It is
    // reached only by opening /console directly in its own tab.
    const layout = read('src/components/Layout.jsx')
    expect(layout).not.toMatch(/NavLink\s*\n?\s*to="\/console"/)
    expect(layout).not.toMatch(/href="\/console"/)
    expect(layout).not.toContain('>System Console<')
    // The one page that used to deep-link the console theme editor no longer does.
    const sharing = read('src/pages/ReportSharing.jsx')
    expect(sharing).not.toMatch(/window\.open\(['"]\/console/)
    expect(sharing).not.toMatch(/navigate\(['"]\/console/)
  })

  it('App.jsx gates BOTH console routes behind ConsoleSurfaceGate (login included)', () => {
    const app = read('src/App.jsx')
    // Both route elements must sit inside the gate. /console/login matters just
    // as much: a same-tab login would write to the SHARED main-app storage.
    const loginRoute = app.match(/path="\/console\/login"[\s\S]{0,400}/)[0]
    const consoleRoute = app.match(/path="\/console\/\*"[\s\S]{0,400}/)[0]
    expect(loginRoute).toContain('<ConsoleSurfaceGate>')
    expect(consoleRoute).toContain('<ConsoleSurfaceGate>')
    // And the gate is the real thing: keyed on the boot-time surface constant.
    expect(app).toMatch(/function ConsoleSurfaceGate[\s\S]{0,200}IS_CONSOLE_SURFACE/)
  })

  it('resolveAdmin refuses a super admin on a piggybacked main-app session', () => {
    const ctx = read('src/console/ConsoleAuthContext.jsx')
    // Defense in depth behind the UI gate: even if the gate were bypassed, the
    // auth context never grants console admin off the console surface.
    const superBranch = ctx.match(/if \(data\?\.is_super_admin\) \{[\s\S]{0,900}/)[0]
    expect(superBranch).toMatch(/if \(!IS_CONSOLE_SURFACE\)[\s\S]{0,80}setAdmin\(null\)/)
    // And it must NOT sign out there - the shared session is the user's
    // main-app login, not the console's to end.
    const refusal = superBranch.match(/if \(!IS_CONSOLE_SURFACE\)[^\n]*/)[0]
    expect(refusal).not.toContain('signOut')
  })
})
