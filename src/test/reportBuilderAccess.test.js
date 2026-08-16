import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  canUseReportBuilder, REPORT_BUILDER_ROUTES, REPORT_BUILDER_ROLE,
} from '../lib/reportBuilderAccess'
import { isCommandVisible, NAV_COMMANDS, ACTION_COMMANDS } from '../lib/commandSearch'

/**
 * Owner instruction: only an Admin may reach any kind of report builder, and no
 * per-user grant may open one.
 *
 * The builders are not all routes. Three are panels embedded in ordinary pages
 * (PresentationStudio on Board Overview / Expenses / Cost per M3, the Report
 * Builder tab in Accidents, and the share-layout designer in Report Sharing), so
 * guarding the two builder ROUTES alone would leave those open to anyone who can
 * already reach the host page. These tests pin the rule at every layer.
 */

const asRole = (role, extra = {}) => ({ role, ...extra })
const MANAGERS = ['Manager', 'Director', 'Inspector', 'Reporter', 'Tyre Man',
                  'Data Monitor Officer', 'PMV Manager', 'Tire Planning Engineer']

describe('report builder access', () => {
  it('admits Admin and super-admin, and nobody else', () => {
    expect(canUseReportBuilder(asRole(REPORT_BUILDER_ROLE))).toBe(true)
    expect(canUseReportBuilder(asRole('Reporter'), true)).toBe(true)
    expect(canUseReportBuilder(asRole('Manager', { is_super_admin: true }))).toBe(true)
    for (const role of MANAGERS) {
      expect(canUseReportBuilder(asRole(role)), role).toBe(false)
    }
    expect(canUseReportBuilder(null)).toBe(false)
    expect(canUseReportBuilder(undefined)).toBe(false)
    expect(canUseReportBuilder({})).toBe(false)
  })

  it('hides every builder command from a Manager in the palette', () => {
    const all = [...NAV_COMMANDS, ...ACTION_COMMANDS]
    const builders = all.filter((c) => REPORT_BUILDER_ROUTES.includes(c.path))
    expect(builders.length).toBeGreaterThan(0)
    for (const cmd of builders) {
      expect(isCommandVisible(cmd, asRole('Manager'), () => true, new Set(), false), cmd.path).toBe(false)
      expect(isCommandVisible(cmd, asRole('Admin'), () => true, new Set(), false), cmd.path).toBe(true)
    }
  })

  it('does not let a per-user GRANT open a builder', () => {
    // A grant normally short-circuits visibility. It must not here: the builder
    // components refuse to render for a non-Admin, so a granted entry would only
    // lead to a dead page, and the instruction was that nobody else gets access.
    const all = [...NAV_COMMANDS, ...ACTION_COMMANDS]
    const builders = all.filter((c) => REPORT_BUILDER_ROUTES.includes(c.path))
    for (const cmd of builders) {
      const grantedEverything = new Set(['report_builder', 'dashboard_builder',
        'report_sharing', 'reports', cmd.path.replace('/', '').replace(/-/g, '_')])
      expect(isCommandVisible(cmd, asRole('Manager'), () => true, grantedEverything, false), cmd.path)
        .toBe(false)
    }
  })

  it('gates every embedded builder component, not just the routes', () => {
    // Source scan: each builder must self-gate, so a NEW mount inherits the rule
    // without anyone remembering to add a guard at the call site.
    const EMBEDDED = [
      'src/components/present/PresentationStudio.jsx',
      'src/components/accidents/AccidentReportBuilder.jsx',
      'src/components/display/ReportShareBuilder.jsx',
    ]
    for (const file of EMBEDDED) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).toContain('canUseReportBuilder')
      // The gate must sit in the exported wrapper, not behind other hooks.
      expect(src, file).toMatch(/export default function \w+\(props\) \{[\s\S]{0,400}canUseReportBuilder/)
    }
  })

  it('keeps the builder ROUTES Admin-only in App.jsx', () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    for (const route of REPORT_BUILDER_ROUTES) {
      const line = app.split('\n').find((l) => l.includes(`path="${route}"`))
      expect(line, route).toBeTruthy()
      expect(line, route).toContain("allowed={['Admin']}")
    }
  })

  it('leaves report READING alone - only building is restricted', () => {
    // Running, viewing and scheduling an existing report are unchanged; taking
    // those away would stop managers doing their job.
    for (const path of ['/reports', '/report-center', '/scheduled-reports']) {
      expect(REPORT_BUILDER_ROUTES).not.toContain(path)
    }
  })
})
