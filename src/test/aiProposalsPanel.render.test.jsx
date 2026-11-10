import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const listAiProposals = vi.fn()
const decideAiProposal = vi.fn()
vi.mock('../lib/api/aiProposals', () => ({
  listAiProposals: (...a) => listAiProposals(...a),
  decideAiProposal: (...a) => decideAiProposal(...a),
  scanProposals: vi.fn(async () => ({ ok: true, detected: 0, sources: {} })),
  listProposalEvents: vi.fn(async () => []),
}))

const { default: AiProposalsPanel } = await import('../components/actionCenter/AiProposalsPanel')

const ROW = {
  id: 'p1', proposal_type: 'overdue_corrective_action', severity: 'high', title: 'Corrective action overdue 5 days: Fix rim',
  summary: 'Due 2026-11-05, still Open.', recommended_action: 'Assign an owner.', evidence: [{ table: 'corrective_actions', id: 'c1' }],
  evidence_total: 1, country: 'KSA', created_at: '2026-11-10T08:00:00Z', last_seen_at: '2026-11-10T08:00:00Z',
}

beforeEach(() => { listAiProposals.mockReset(); decideAiProposal.mockReset() })

describe('AiProposalsPanel', () => {
  it('shows the not-provisioned notice instead of an empty queue', async () => {
    listAiProposals.mockResolvedValue({ rows: [], notProvisioned: true })
    render(<AiProposalsPanel country="KSA" />)
    expect(await screen.findByText(/not enabled on this database/i)).toBeTruthy()
  })

  it('reject requires a reason before it can be sent', async () => {
    listAiProposals.mockResolvedValue({ rows: [ROW], notProvisioned: false })
    render(<AiProposalsPanel country="KSA" />)
    fireEvent.click(await screen.findByRole('button', { name: /^Reject$/ }))
    const confirm = (await screen.findAllByRole('button', { name: /^Reject$/ })).at(-1)
    expect(confirm.disabled).toBe(true)
  })

  it('accept with a corrective action tells the page to reload', async () => {
    listAiProposals.mockResolvedValue({ rows: [ROW], notProvisioned: false })
    decideAiProposal.mockResolvedValue({ ok: true, corrective_action_id: 'ca1' })
    const onActionCreated = vi.fn()
    render(<AiProposalsPanel country="KSA" onActionCreated={onActionCreated} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Accept$/ }))
    const confirm = (await screen.findAllByRole('button', { name: /^Accept$/ })).at(-1)
    fireEvent.click(confirm)
    await waitFor(() => expect(decideAiProposal).toHaveBeenCalledWith('p1', 'accepted', { note: '', createAction: true }))
    await waitFor(() => expect(onActionCreated).toHaveBeenCalled())
  })
})
