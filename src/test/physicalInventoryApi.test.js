// uploadPhoto takes the company folder from the database (app_current_org), because
// the profile loaded by AuthContext carries no organisation_id (Codex P1 on #585).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ upload: vi.fn(), rpc: vi.fn(), currentOrgId: vi.fn() }))
vi.mock('../lib/api/_client', async (orig) => ({
  ...(await orig()),
  supabase: { rpc: h.rpc, storage: { from: () => ({ upload: h.upload }) } },
}))
vi.mock('../lib/api/companyScope', async (orig) => ({ ...(await orig()), currentOrgId: h.currentOrgId }))

import { uploadPhoto } from '../lib/api/physicalInventory'

const ORG = '11111111-2222-4333-8444-555555555555'
const file = () => ({ type: 'image/jpeg', size: 3, arrayBuffer: async () => new Uint8Array([97, 98, 99]).buffer })

describe('uploadPhoto company folder', () => {
  beforeEach(() => { h.upload.mockReset().mockResolvedValue({ error: null }); h.rpc.mockReset().mockResolvedValue({ data: { id: 'p1' }, error: null }); h.currentOrgId.mockReset() })

  it('resolves the company from the database when the caller has none', async () => {
    h.currentOrgId.mockResolvedValue(ORG)
    await uploadPhoto(file(), { orgId: null, sessionId: 's1', target: { captureId: 'c1' }, clientUuid: 'u1' })
    expect(h.upload.mock.calls[0][0]).toBe(`physical_inventory/${ORG}/s1/u1.jpg`)
    expect(h.rpc.mock.calls[0][1].p_payload.storage_path).toBe(`physical_inventory/${ORG}/s1/u1.jpg`)
  })

  it('refuses (nothing uploaded) when the company cannot be determined', async () => {
    h.currentOrgId.mockResolvedValue(null)
    await expect(uploadPhoto(file(), { sessionId: 's1', target: { captureId: 'c1' } })).rejects.toThrow(/company/)
    expect(h.upload).not.toHaveBeenCalled()
  })
})
