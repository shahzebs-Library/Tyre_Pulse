import { approvalPolicyCopy } from '../lib/approvalPolicyCopy'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), query: {} }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))
import { listApprovalPolicies, listApprovalRoles, saveApprovalPolicy, publishApprovalPolicy, simulateApprovalPolicy, listApprovalPeople } from '../lib/api/approvalMatrix'
beforeEach(() => {
  vi.clearAllMocks()
  h.rpc.mockResolvedValue({ data: { id: 'p', updated_at: 'new' }, error: null })
  h.query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], error: null }) }
  h.from.mockReturnValue(h.query)
})
it('keeps missing table errors distinct from an empty configured list', async () => {
  h.query.range.mockResolvedValue({ data: null, error: { code: '42P01', message: 'missing' } })
  await expect(listApprovalPolicies()).rejects.toMatchObject({ code: '42P01' })
})
it('strips tenant ownership, state and author from draft payloads', async () => {
  await saveApprovalPolicy({ id: 'p', name: 'Review', entity_type: 'inspection', stages: [], organisation_id: 'other', created_by: 'other', state: 'published' }, 'old')
  expect(h.rpc).toHaveBeenCalledWith('approval_policy_save', { p_policy: { id: 'p', name: 'Review', entity_type: 'inspection', stages: [] }, p_expected_updated_at: 'old' })
})
it('publishes only through the server with reason and exact concurrency token', async () => {
  await publishApprovalPolicy({ id: 'p', updated_at: 'old' }, 'Reviewed')
  expect(h.rpc).toHaveBeenCalledWith('approval_policy_publish', { p_policy_id: 'p', p_expected_updated_at: 'old', p_reason: 'Reviewed' })
})
it('includes person and draft context in simulation without supplying tenant authority', async () => {
  h.rpc.mockResolvedValue({ data: { mode: 'enforced', status: 'no_route', policy: null, candidates: [] }, error: null })
  await simulateApprovalPolicy({ entity_type: 'checklist', country: 'KSA', site: 'West', role: 'Manager', user_id: 'u', organisation_id: 'other' }, 'draft')
  expect(h.rpc).toHaveBeenCalledWith('approval_policy_simulate', { p_entity_type: 'checklist', p_country: 'KSA', p_site: 'West', p_role: 'Manager', p_user_id: 'u', p_draft_id: 'draft' })
})
it('does not confirm success for an empty RPC response', async () => {
  h.rpc.mockResolvedValue({ data: null, error: null })
  await expect(saveApprovalPolicy({ name: 'Review' })).rejects.toMatchObject({ code: 'invalid_response' })
})
it('allows a genuine empty people list', async () => {
  h.rpc.mockResolvedValue({ data: [], error: null })
  await expect(listApprovalPeople()).resolves.toEqual([])
})

it('sends a scheduled publication in UTC without changing the client timezone', async () => {
  await publishApprovalPolicy({ id: 'p', updated_at: 'old' }, 'Scheduled', '2026-10-01T06:00:00.000Z')
  expect(h.rpc).toHaveBeenCalledWith('approval_policy_publish', { p_policy_id: 'p', p_expected_updated_at: 'old', p_reason: 'Scheduled', p_effective_at: '2026-10-01T06:00:00.000Z' })
})

it('does not silently fall back to builtin roles when custom role lookup fails', async () => {
  h.query.range.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
  await expect(listApprovalRoles()).rejects.toMatchObject({ code: '42501' })
})

it('keeps Arabic and English policy copy complete', () => {
  expect(Object.keys(approvalPolicyCopy.ar).sort()).toEqual(Object.keys(approvalPolicyCopy.en).sort())
})
