import { describe, expect, it } from 'vitest'
import classification from '../../audit/module-depth-classification-2026-08-30.json'

describe('module depth classification ledger', () => {
  it('leaves no legacy thin/data-state candidate unclassified', () => {
    expect(classification.unresolved).toEqual([])
    expect(classification.pages.every((page) => page.classification && page.status && page.evidence)).toBe(true)
  })

  it('credits shared engines instead of treating short wrappers as thin pages', () => {
    for (const pageName of ['ProductionM3', 'SanyInvoices', 'ScoCosts', 'SitesIntake', 'MasterAccessControl']) {
      expect(classification.pages.find((page) => page.page === pageName)).toMatchObject({ status: 'not-thin' })
    }
  })

  it('records the operational paths remediated in this pass', () => {
    for (const pageName of ['AccidentPortalView', 'Alerts', 'CpkIntelligence', 'CostPerM3', 'DailyOps', 'GatePass']) {
      expect(classification.pages.find((page) => page.page === pageName)).toMatchObject({ status: 'remediated' })
    }
  })
})
