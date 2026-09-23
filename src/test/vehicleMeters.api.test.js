import { beforeEach, it, expect, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/_client', () => ({ supabase: { rpc }, unwrap: result => { if (result.error) throw result.error; return result.data }, applyCountry: vi.fn(), fetchAllPages: vi.fn() }))
import { saveVehicleMeters, correctVehicleMeter } from '../lib/api/vehicleMeters'
beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null }))
it('sends one atomic RPC, keeps a true zero, and leaves a blank meter absent', async () => {
  await saveVehicleMeters({ id: 'v', km: 100, engineHours: 20, country: 'KSA' }, { km: '', hours: '0', date: '2026-09-10', requestId: 'request', notes: '' })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('save_vehicle_meter_readings', { p_vehicle_id: 'v', p_reading_date: '2026-09-10', p_km: null, p_hours: 0, p_request_id: 'request', p_expected_km: 100, p_expected_hours: 20, p_notes: null })
})
it('turns a stale reading conflict into an actionable message', async () => {
  rpc.mockResolvedValue({ error: { code: '40001', message: 'internal database details' } })
  await expect(saveVehicleMeters({ id: 'v' }, { km: '1', hours: '', date: '2026-09-10' })).rejects.toThrow('Another reading was saved')
})
it('corrections include the concurrency token and reason but cannot replace source or ownership', async () => {
  await correctVehicleMeter({ id: 'r', kind: 'hours', updated_at: 'stamp', source: 'Mobile' }, { value: '15', date: '2026-09-10', reason: 'Corrected entry', source: 'Telematics', organisation_id: 'other' })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('correct_vehicle_meter_reading', { p_kind: 'hours', p_id: 'r', p_value: 15, p_reading_date: '2026-09-10', p_reason: 'Corrected entry', p_expected_updated_at: 'stamp' })
})

it('explains the required permissions without exposing database details', async () => {
  rpc.mockResolvedValue({ error: { code: '42501', message: 'private details' } })
  await expect(saveVehicleMeters({ id: 'v' }, { km: '1', hours: '' })).rejects.toThrow('Meter Logs access')
})
