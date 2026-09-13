jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }))
jest.mock('../lib/secureStorage', () => ({ readItem: jest.fn(), secureStorage: { setItem: jest.fn(), removeItem: jest.fn() } }))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))
import { supabase } from '../lib/supabase'
import { readItem, secureStorage } from '../lib/secureStorage'
import { loadDriverWorkspace, readWorkspaceSaved, saveWorkspaceData, validateFineResponse } from '../lib/driverWorkspace'

beforeEach(() => jest.clearAllMocks())
test('pages beyond the server boundary without duplicating the sentinel row', async () => {
  const rows = Array.from({ length: 101 }, (_, id) => ({ id: String(id) }))
  ;(supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: { drivers: rows }, error: null }).mockResolvedValueOnce({ data: { drivers: [rows[100]] }, error: null })
  const result = await loadDriverWorkspace()
  expect(result.drivers).toHaveLength(101)
  expect(new Set(result.drivers.map((r: any) => r.id)).size).toBe(101)
  expect(supabase.rpc).toHaveBeenLastCalledWith('driver_workspace', { p_driver_id: null, p_offset: 100 })
})
test('permission failure is thrown instead of an empty list', async () => {
  ;(supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { code: '42501' } })
  await expect(loadDriverWorkspace()).rejects.toEqual({ code: '42501' })
})
test('corrupted draft reads fail without overwriting the saved work', async () => {
  ;(readItem as jest.Mock).mockResolvedValue({ status: 'torn', value: null })
  await expect(readWorkspaceSaved('user1_org1','draft_case')).rejects.toThrow('Nothing has been overwritten')
  expect(secureStorage.setItem).not.toHaveBeenCalled()
})
test('draft keys are separated by account and tenant', async () => {
  await saveWorkspaceData('user1_org1','draft_case',{ explanation:'first' })
  await saveWorkspaceData('user2_org1','draft_case',{ explanation:'second' })
  const calls=(secureStorage.setItem as jest.Mock).mock.calls
  expect(calls[0][0]).not.toBe(calls[1][0])
})
test('company recovery and instalments remain signed requests', () => {
  const values={ explanation:'Please review my proposed arrangement',signature:'signed',acknowledged:true }
  expect(validateFineResponse({...values,resolution:'company_recovery'})).toBeNull()
  expect(validateFineResponse({...values,resolution:'instalments'})).toBeNull()
  expect(validateFineResponse({...values,resolution:'direct_payment'})).toContain('date')
  expect(validateFineResponse({...values,resolution:'already_paid'})).toContain('reference')
  expect(validateFineResponse({...values,resolution:'instalments',acknowledged:false})).toContain('sign')
})
