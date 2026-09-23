import { canApproveChecklists, canManageUsers, canReviewAccidents, resolveModuleAccess } from '../lib/permissions'
import { canDecide } from '../lib/checklistApproval'
import { UserRole } from '../lib/types'

describe('checklist approval queue access', () => {
  it.each<UserRole>([
    'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager',
    'workshop_area_manager', 'workshop_maintenance_area_manager', 'tyre_data_collector',
  ])('admits an eligible signer: %s', role => {
    expect(canApproveChecklists(role)).toBe(true)
  })

  it.each<UserRole>(['reporter', 'driver', 'mechanic', 'electrician', 'tyre_man'])('denies a non-signer: %s', role => {
    expect(canApproveChecklists(role)).toBe(false)
  })

  it('keeps the second rung restricted and unrelated privileges unchanged', () => {
    expect(canDecide({ require_area_manager: true }, { approval_status: 'pending_area_manager' }, 'maintenance_supervisor')).toBe(false)
    expect(canDecide({ require_area_manager: true }, { approval_status: 'pending_area_manager' }, 'workshop_maintenance_area_manager')).toBe(true)
    expect(canManageUsers('workshop_maintenance_area_manager')).toBe(false)
    expect(canReviewAccidents('workshop_maintenance_area_manager')).toBe(false)
    expect(resolveModuleAccess('approvals', 'workshop_maintenance_area_manager', { approvals: 'revoke' })).toBe(false)
  })
})
