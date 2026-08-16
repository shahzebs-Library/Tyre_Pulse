import { describe, it, expect } from 'vitest'
import {
  CONTEXT_RULES, CONTEXT_RULE_ROUTES, CONTEXT_MODES,
  contextRuleFor, isModuleInContext, isModuleHiddenInContext, contextNoticeFor,
} from '../lib/contextRules'
import { NAV_CATALOG } from '../components/Layout'

describe('context rules', () => {
  it('lets a module with no rule through in every context', () => {
    for (const c of ['KSA', 'UAE', 'Egypt', 'All', '', null, undefined]) {
      expect(isModuleInContext('/tyres', c)).toBe(true)
      expect(contextNoticeFor('/tyres', c)).toBeNull()
    }
  })

  it('always passes the All-countries view', () => {
    // The all-countries reader opened that view precisely to compare, so hiding a
    // module that applies to one country would defeat it.
    for (const route of CONTEXT_RULE_ROUTES) {
      for (const c of ['All', 'all', '', null, undefined]) {
        expect(isModuleInContext(route, c), `${route} @ ${c}`).toBe(true)
      }
    }
  })

  it('flags an out-of-context module and explains it in plain words', () => {
    expect(isModuleInContext('/cost-per-m3', 'UAE')).toBe(false)
    const n = contextNoticeFor('/cost-per-m3', 'UAE')
    expect(n).toBeTruthy()
    expect(n.availableIn).toEqual(['KSA'])
    expect(n.reason.length).toBeGreaterThan(20)
    // It must never read as broken or forbidden.
    expect(n.reason.toLowerCase()).not.toMatch(/error|denied|forbidden|not allowed/)
  })

  it('matches country case-insensitively', () => {
    expect(isModuleInContext('/sco-costs', 'ksa')).toBe(true)
    expect(isModuleInContext('/sco-costs', '  KSA ')).toBe(true)
  })

  it('NEVER hides by default, because empty is not the same as inapplicable', () => {
    // The whole point of this file: a module with no rows in a country is either
    // structurally absent or simply not used there yet, and hiding the second kind
    // would stop the first record ever being entered.
    for (const route of CONTEXT_RULE_ROUTES) {
      expect(CONTEXT_RULES[route].mode, route).toBe(CONTEXT_MODES.NOTICE)
      expect(isModuleHiddenInContext(route, 'UAE'), route).toBe(false)
    }
  })

  it('never marks a not-yet-used module as structural', () => {
    // Claiming 'structural' asserts the module can never apply there. That is a
    // claim about the business, and only the four supplier/production modules
    // carry evidence for it.
    const STRUCTURAL_OK = new Set([
      '/cost-per-m3', '/production-m3', '/sco-costs', '/sany-invoices', '/sany-delay-penalty',
    ])
    for (const [route, rule] of Object.entries(CONTEXT_RULES)) {
      expect(['structural', 'not_rolled_out']).toContain(rule.why)
      if (rule.why === 'structural') expect(STRUCTURAL_OK.has(route), route).toBe(true)
    }
  })

  it('only names routes that really exist in the sidebar', () => {
    // A rule for a dead route would silently never fire.
    const routes = new Set(NAV_CATALOG.flatMap((g) => g.items).map((i) => i.key))
    const unknown = CONTEXT_RULE_ROUTES.filter((r) => !routes.has(r))
    expect(unknown).toEqual([])
  })

  it('uses ASCII only in anything shown to a user', () => {
    for (const route of CONTEXT_RULE_ROUTES) {
      const n = contextNoticeFor(route, 'UAE')
      for (const s of [n.reason, n.hint]) {
        expect(s, route).not.toMatch(/[–—·→‘’“”]/)
      }
    }
  })

  it('exposes a rule object with everything a surface needs', () => {
    const rule = contextRuleFor('/inspections')
    expect(rule.countries).toContain('KSA')
    expect(rule.why).toBe('not_rolled_out')
    expect(typeof rule.reason).toBe('string')
  })
})
