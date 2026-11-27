import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: vi.fn(), storage: { from: vi.fn() } } }))

const api = await import('../lib/api/fleetVerification')

beforeEach(() => rpc.mockReset())

describe('fleetVerification service', () => {
  it('reports notSetUp when the function is missing (pre-migration)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    expect(await api.listPendingFleetVerifications('KSA')).toEqual({ rows: [], notSetUp: true })
    expect(await api.listPossibleTransfers('KSA')).toEqual({ rows: [], notSetUp: true })
    expect(await api.decideFleetVerification('x', true)).toEqual({ notSetUp: true })
  })
  it('throws a clean error on a refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'This verification was already decided' } })
    await expect(api.decideFleetVerification('x', true)).rejects.toThrow()
  })
  it('sends the outcome, GPS and other country only for other_country', async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'pending' }, error: null })
    await api.submitFleetVerification({ verificationId: 'id1', vehicle: { id: 'v1' }, outcome: 'present', otherCountry: 'UAE', position: { lat: 1, lng: 2, accuracy: 5 } })
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('submit_fleet_verification')
    expect(args).toMatchObject({ p_client_uuid: 'id1', p_vehicle_id: 'v1', p_outcome: 'present', p_other_country: null, p_lat: 1, p_lng: 2, p_accuracy_m: 5 })
  })
  it('passes null country for All', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await api.listPendingFleetVerifications('All')
    expect(rpc.mock.calls[0][1]).toEqual({ p_country: null })
  })
  it('mints a uuid', () => {
    expect(api.newVerificationId()).toMatch(/^[0-9a-f-]{36}$/)
  })
})
