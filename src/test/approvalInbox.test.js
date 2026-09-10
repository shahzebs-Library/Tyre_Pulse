import { describe, expect, it } from 'vitest'
import { mergePendingApprovals } from '../lib/approvalInbox'
describe('governed approval inbox', () => {
  const workflow = { id: 'run', entity_type: 'checklist', entity_id: 'sheet', approval_matrix: true,
    entity_label: 'Safety check', current_step_name: 'Supervisor', site: 'West', status: 'pending' }
  const document = { id: 'sheet', source: 'checklist', title: 'Recorded safety check', raw: { approval_status: 'pending' } }
  it('shows one document with the canonical decision path when both sources return it', () => {
    const rows = mergePendingApprovals([workflow], [document])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'sheet', source: 'checklist', governed: true, workflowId: 'run', title: document.title })
  })
  it('retains a governed request when the separate document source is unavailable', () => {
    expect(mergePendingApprovals([workflow], [])[0]).toMatchObject({ id: 'sheet', title: 'Safety check', governed: true, site: 'West' })
  })
  it('preserves unrelated legacy workflows and documents', () => {
    expect(mergePendingApprovals([{ ...workflow, approval_matrix: false }], [document])).toHaveLength(2)
  })
})
