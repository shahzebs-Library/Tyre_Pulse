import { describe, it, expect } from 'vitest'

// Smoke test only: confirms the 7 new accident-module service files parse,
// resolve their imports and export the expected functions/constants. Real
// behaviour is exercised once a panel wires them up; this just catches a
// syntax/import mistake before that happens.

describe('accident module service files load cleanly', () => {
  it('accidentLiability.js', async () => {
    const m = await import('../lib/api/accidentLiability.js')
    expect(typeof m.getLiabilityAssessment).toBe('function')
    expect(typeof m.saveLiabilityAssessment).toBe('function')
    expect(typeof m.approveLiabilityAssessment).toBe('function')
    expect(typeof m.listAuthorityReports).toBe('function')
    expect(typeof m.saveAuthorityReport).toBe('function')
  })

  it('accidentHandover.js', async () => {
    const m = await import('../lib/api/accidentHandover.js')
    expect(typeof m.listHandoverInspections).toBe('function')
    expect(typeof m.recordHandoverInspection).toBe('function')
  })

  it('accidentDamageAssessment.js', async () => {
    const m = await import('../lib/api/accidentDamageAssessment.js')
    expect(typeof m.getDamageAssessment).toBe('function')
    expect(typeof m.saveDamageAssessment).toBe('function')
    expect(typeof m.submitDamageAssessment).toBe('function')
    expect(typeof m.upsertDamageMark).toBe('function')
    expect(typeof m.removeDamageMark).toBe('function')
    expect(m.REPAIR_ROUTES).toContain('internal')
    expect(m.REPAIR_ROUTES).toContain('external')
  })

  it('accidentInsuranceClaims.js', async () => {
    const m = await import('../lib/api/accidentInsuranceClaims.js')
    expect(typeof m.getInsuranceClaim).toBe('function')
    expect(typeof m.listClaimDocuments).toBe('function')
    expect(typeof m.listRecoveries).toBe('function')
    expect(typeof m.registerClaim).toBe('function')
    expect(typeof m.decideClaim).toBe('function')
    expect(typeof m.settleClaim).toBe('function')
    expect(typeof m.recordRecovery).toBe('function')
    expect(typeof m.addClaimDocument).toBe('function')
    expect(typeof m.markClaimDocumentReceived).toBe('function')
    expect(m.CLAIM_DECISIONS).toContain('fully_approved')
  })

  it('accidentRepairOrders.js', async () => {
    const m = await import('../lib/api/accidentRepairOrders.js')
    expect(typeof m.getOpenRepairOrder).toBe('function')
    expect(typeof m.listRepairOrders).toBe('function')
    expect(typeof m.listRepairTasks).toBe('function')
    expect(typeof m.listQualityChecks).toBe('function')
    expect(typeof m.upsertRepairOrder).toBe('function')
    expect(typeof m.addRepairTask).toBe('function')
    expect(typeof m.completeRepairTask).toBe('function')
    expect(typeof m.recordQualityCheck).toBe('function')
    expect(typeof m.completeRepairOrder).toBe('function')
    expect(m.QC_RESULTS).toEqual(['pass', 'fail', 'conditional'])
  })

  it('accidentSla.js', async () => {
    const m = await import('../lib/api/accidentSla.js')
    expect(typeof m.listSlaInstances).toBe('function')
    expect(typeof m.nextDueInstance).toBe('function')
    expect(typeof m.startWorkstreamSla).toBe('function')
    expect(typeof m.pauseSla).toBe('function')
    expect(typeof m.resumeSla).toBe('function')
    // nextDueInstance is pure - exercise it directly, no network involved.
    const now = Date.now()
    const soon = { id: 'a', state: 'running', due_at: new Date(now + 1000).toISOString() }
    const later = { id: 'b', state: 'running', due_at: new Date(now + 99999).toISOString() }
    const paused = { id: 'c', state: 'paused', due_at: new Date(now - 1000).toISOString() }
    expect(m.nextDueInstance([later, soon, paused]).id).toBe('a')
    expect(m.nextDueInstance([])).toBeNull()
    expect(m.nextDueInstance([paused])).toBeNull()
  })

  it('accidentCommunications.js', async () => {
    const m = await import('../lib/api/accidentCommunications.js')
    expect(typeof m.listCommunications).toBe('function')
    expect(typeof m.logCommunication).toBe('function')
    expect(m.COMMS_CHANNELS).toContain('call')
    expect(m.COMMS_DIRECTIONS).toEqual(['outbound', 'inbound', 'internal'])
  })
})
