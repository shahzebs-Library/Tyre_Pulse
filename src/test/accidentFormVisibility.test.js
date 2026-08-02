import { describe, it, expect } from 'vitest'
import {
  canSeeSection, isStageWaived, SECTION_ROLES, SECTION_KEYS,
} from '../lib/accidentFormVisibility'

const waive = (stage) => ({ [stage]: { required: false, remark: '' } })

describe('accidentFormVisibility - SECTION_ROLES map', () => {
  it('exposes the five gated sections plus workflow', () => {
    expect(SECTION_KEYS).toEqual(
      expect.arrayContaining(['stageWaivers', 'hse', 'insurance', 'repair', 'costRecovery', 'workflow']),
    )
  })
  it('ties the team sections to the right workflow stage', () => {
    expect(SECTION_ROLES.hse.stage).toBe('hse_investigation')
    expect(SECTION_ROLES.insurance.stage).toBe('insurance_claim')
    expect(SECTION_ROLES.repair.stage).toBe('repair_in_progress')
    expect(SECTION_ROLES.costRecovery.stage).toBe('cost_recovery')
    expect(SECTION_ROLES.stageWaivers.stage).toBeNull()
    expect(SECTION_ROLES.workflow.stage).toBeNull()
  })
})

describe('isStageWaived', () => {
  it('is true only when required is explicitly false', () => {
    expect(isStageWaived(waive('hse_investigation'), 'hse_investigation')).toBe(true)
    expect(isStageWaived({ hse_investigation: { required: true } }, 'hse_investigation')).toBe(false)
    expect(isStageWaived({}, 'hse_investigation')).toBe(false)
    expect(isStageWaived(null, 'hse_investigation')).toBe(false)
    expect(isStageWaived(waive('hse_investigation'), null)).toBe(false)
  })
})

describe('canSeeSection - admins, super-admins and creator see everything (role-wise)', () => {
  const cases = [
    { role: 'Admin', isSuperAdmin: false },
    { role: 'Manager', isSuperAdmin: false },
    { role: 'Director', isSuperAdmin: false },
    { role: 'Reporter', isSuperAdmin: true },
  ]
  for (const base of cases) {
    for (const sec of ['stageWaivers', 'hse', 'insurance', 'repair', 'costRecovery', 'workflow']) {
      it(`${base.role}${base.isSuperAdmin ? '/super' : ''} sees ${sec}`, () => {
        expect(canSeeSection(sec, { ...base, isCreator: false, stageWaivers: {} })).toBe(true)
      })
    }
  }
  it('the case creator sees a section even with a non-owning role', () => {
    expect(canSeeSection('insurance', { role: 'Workshop', isCreator: true, stageWaivers: {} })).toBe(true)
    expect(canSeeSection('hse', { role: 'Reporter', isCreator: true, stageWaivers: {} })).toBe(true)
  })
})

describe('canSeeSection - team role gating (non-admin, non-creator)', () => {
  const ctx = (role) => ({ role, isSuperAdmin: false, isCreator: false, stageWaivers: {} })

  it('HSE section: only HSE/Safety roles', () => {
    expect(canSeeSection('hse', ctx('HSE Officer'))).toBe(true)
    expect(canSeeSection('hse', ctx('Safety Lead'))).toBe(true)
    expect(canSeeSection('hse', ctx('Insurance Officer'))).toBe(false)
    expect(canSeeSection('hse', ctx('Workshop'))).toBe(false)
  })

  it('Insurance section: only Insurance/Claims roles', () => {
    expect(canSeeSection('insurance', ctx('Insurance Officer'))).toBe(true)
    expect(canSeeSection('insurance', ctx('Claims Handler'))).toBe(true)
    expect(canSeeSection('insurance', ctx('Workshop'))).toBe(false)
    expect(canSeeSection('insurance', ctx('HSE Officer'))).toBe(false)
  })

  it('Repair section: only Workshop/Repair roles', () => {
    expect(canSeeSection('repair', ctx('Workshop Planner'))).toBe(true)
    expect(canSeeSection('repair', ctx('Mechanic'))).toBe(true)
    expect(canSeeSection('repair', ctx('Insurance Officer'))).toBe(false)
  })

  it('Cost Recovery section: Finance/Fleet roles', () => {
    expect(canSeeSection('costRecovery', ctx('Finance Controller'))).toBe(true)
    expect(canSeeSection('costRecovery', ctx('Fleet Officer'))).toBe(true)
    expect(canSeeSection('costRecovery', ctx('Workshop'))).toBe(false)
  })

  it('stageWaivers section: only the Fleet team (plus admin/creator)', () => {
    expect(canSeeSection('stageWaivers', ctx('Fleet Supervisor'))).toBe(true)
    expect(canSeeSection('stageWaivers', ctx('Insurance Officer'))).toBe(false)
    expect(canSeeSection('stageWaivers', ctx('Workshop'))).toBe(false)
  })

  it('workflow section is visible to any role', () => {
    expect(canSeeSection('workflow', ctx('Insurance Officer'))).toBe(true)
    expect(canSeeSection('workflow', ctx('Workshop'))).toBe(true)
    expect(canSeeSection('workflow', ctx('Reporter'))).toBe(true)
  })
})

describe('canSeeSection - stage waiver hides a section for everyone (absolute)', () => {
  it('hides HSE for its owning role, admin AND creator when hse_investigation is waived', () => {
    const w = waive('hse_investigation')
    expect(canSeeSection('hse', { role: 'HSE Officer', stageWaivers: w })).toBe(false)
    expect(canSeeSection('hse', { role: 'Admin', stageWaivers: w })).toBe(false)
    expect(canSeeSection('hse', { role: 'Reporter', isSuperAdmin: true, stageWaivers: w })).toBe(false)
    expect(canSeeSection('hse', { role: 'Reporter', isCreator: true, stageWaivers: w })).toBe(false)
  })

  it('hides Insurance when insurance_claim is waived, but not when a different stage is waived', () => {
    expect(canSeeSection('insurance', { role: 'Admin', stageWaivers: waive('insurance_claim') })).toBe(false)
    expect(canSeeSection('insurance', { role: 'Admin', stageWaivers: waive('cost_recovery') })).toBe(true)
  })

  it('hides Repair when repair_in_progress is waived; hides Cost Recovery when cost_recovery is waived', () => {
    expect(canSeeSection('repair', { role: 'Admin', stageWaivers: waive('repair_in_progress') })).toBe(false)
    expect(canSeeSection('costRecovery', { role: 'Admin', stageWaivers: waive('cost_recovery') })).toBe(false)
  })

  it('a required (non-waived) stage keeps the section visible to its team', () => {
    expect(canSeeSection('hse', { role: 'HSE Officer', stageWaivers: { hse_investigation: { required: true } } })).toBe(true)
  })

  it('the stageWaivers section itself is never stage-gated', () => {
    expect(canSeeSection('stageWaivers', { role: 'Fleet', stageWaivers: waive('hse_investigation') })).toBe(true)
  })
})

describe('canSeeSection - defensive defaults', () => {
  it('an unknown section fails open (visible)', () => {
    expect(canSeeSection('does_not_exist', { role: 'Workshop' })).toBe(true)
  })
  it('no context still resolves for an everyone-visible section', () => {
    expect(canSeeSection('workflow')).toBe(true)
  })
  it('an empty/blank role sees only everyone-visible and admin-bypass sections', () => {
    expect(canSeeSection('workflow', { role: '' })).toBe(true)
    expect(canSeeSection('insurance', { role: '' })).toBe(false)
  })
})
