import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), inside: vi.fn(), order: vi.fn(), range: vi.fn(), pages: vi.fn() }))
vi.mock('../lib/api/_client', () => ({ supabase: { from: h.from }, unwrap: r => { if (r.error) throw r.error; return r.data }, fetchAllPages: h.pages, applyCountry: q => q, isMissingRelation: () => false }))
import { washExportFleet } from '../lib/api/washRecords'
beforeEach(() => {
  vi.clearAllMocks()
  const chain = { select: h.select, in: h.inside, order: h.order, range: h.range }
  for (const fn of [h.from,h.select,h.inside,h.order,h.range]) fn.mockReturnValue(chain)
  h.pages.mockImplementation(async callback => { callback(0,999); return { data: [{ asset_no: 'TM335', region: 'North' }] } })
})
it('requests only the selected asset identities once per asset', async () => {
  const result = await washExportFleet([{ asset_no: 'TM335' }, { asset_no: 'TM335' }])
  expect(h.inside).toHaveBeenCalledExactlyOnceWith('asset_no', ['TM335'])
  expect(h.select).toHaveBeenCalledWith('id,organisation_id,country,asset_no,registration_no,region')
  expect(result).toEqual([{ asset_no: 'TM335', region: 'North' }])
})
it('does not silently accept incomplete enrichment', async () => {
  h.pages.mockResolvedValue({ data: [], truncated: true })
  await expect(washExportFleet([{ asset_no: 'TM335' }])).rejects.toThrow('completely')
})
