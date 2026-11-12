import { describe, it, expect } from 'vitest'
import { visibleTabs, EXECUTIVE_TABS, KPI_TABS } from '../components/ui/SectionTabs'
import { isCommandVisible, NAV_COMMANDS } from '../lib/commandSearch'

const auth = (role, { perms = [], isSuperAdmin = false, grants = [] } = {}) => ({
  profile: { role }, isSuperAdmin,
  hasPermission: (k) => isSuperAdmin || perms.includes(k),
  grantedModules: new Set(grants),
})
const paths = (tabs) => tabs.map((t) => t.to)

describe('Executive tab bar shows each tab only to those who can open it', () => {
  it('a Manager without the executive_report module sees only Executive Analytics', () => {
    expect(paths(visibleTabs(EXECUTIVE_TABS, auth('Manager')))).toEqual(['/executive-analytics'])
  })
  it('an Admin with the module sees both', () => {
    expect(paths(visibleTabs(EXECUTIVE_TABS, auth('Admin', { perms: ['executive_report'] }))))
      .toEqual(['/executive-report', '/executive-analytics'])
  })
  it('a role with the report module but outside Admin/Manager/Director sees only the report', () => {
    expect(paths(visibleTabs(EXECUTIVE_TABS, auth('Reporter', { perms: ['executive_report'] })))).toEqual(['/executive-report'])
  })
  it('an explicit grant opens Executive Analytics; no access shows nothing', () => {
    expect(paths(visibleTabs(EXECUTIVE_TABS, auth('Reporter', { grants: ['executive-analytics'] })))).toEqual(['/executive-analytics'])
    expect(visibleTabs(EXECUTIVE_TABS, auth('Driver'))).toEqual([])
    expect(visibleTabs(EXECUTIVE_TABS, null)).toEqual([])
  })
  it('tab bars with no access rule are unchanged', () => {
    expect(visibleTabs(KPI_TABS, null)).toHaveLength(KPI_TABS.length)
  })
})

describe('the Executive search entry follows the two old commands', () => {
  const cmd = NAV_COMMANDS.find((c) => c.path === '/executive')
  const visible = (a) => isCommandVisible(cmd, a.profile, a.hasPermission, a.grantedModules, a.isSuperAdmin)
  it('exists once and the two old entries are gone', () => {
    expect(cmd).toBeTruthy()
    expect(NAV_COMMANDS.some((c) => c.path === '/executive-report' || c.path === '/executive-analytics')).toBe(false)
  })
  it('is offered to Admin, Manager and Director and not to a Driver', () => {
    expect(visible(auth('Admin', { perms: ['executive_report'] }))).toBe(true)
    expect(visible(auth('Manager'))).toBe(true)
    expect(visible(auth('Director'))).toBe(true)
    expect(visible(auth('Driver'))).toBe(false)
  })
})
