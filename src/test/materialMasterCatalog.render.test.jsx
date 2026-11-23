// Material Master list: brand, part type, posted stock and pending opening stock
// read from the catalogue lookups, with honest "Not stated" / N/A values.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  listMaterialCatalog: vi.fn(),
  loadMaterialCatalogDetail: vi.fn(),
  loadMaterialCatalogFacets: vi.fn(),
  searchMaterials: vi.fn(),
  listCorrections: vi.fn(),
  listPhotos: vi.fn(),
  getMaterial: vi.fn(),
}))
vi.mock('../lib/api/physicalInventory', async (orig) => ({ ...(await orig()), ...api }))

import MaterialMasterSection from '../components/inventory/MaterialMasterSection'
import { LanguageProvider } from '../contexts/LanguageContext'

const MATS = [
  { id: 'c1', company_sku: '223531-O', description: 'STRAP', category: 'Body & cab', brand: 'SANY', manufacturer: 'SANY', status: 'proposed',
    specs: { sub_category: 'Body, glass & cab', fits_vehicle: 'SANY (model not stated)', size: 'M16' } },
  { id: 'c2', company_sku: '223218-O', description: 'WEDGE HOLDER', category: 'Other', brand: null, manufacturer: null, status: 'proposed', specs: {} },
]

const ui = () => render(<LanguageProvider><MaterialMasterSection scope={{ country: 'KSA', site: 'all' }} userId="u1" onNavigate={() => {}} /></LanguageProvider>)

describe('MaterialMasterSection catalogue', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset())
    api.loadMaterialCatalogFacets.mockResolvedValue({ status: 'ok', rows: [{ category: 'Other', brand: 'SANY' }] })
    api.listMaterialCatalog.mockResolvedValue({ status: 'ok', rows: MATS, total: 2, truncated: false })
    api.loadMaterialCatalogDetail.mockResolvedValue({
      variants: [{ canonical_id: 'c1', part_classification: 'genuine', status: 'proposed', part_number: 'OEM-7' }],
      aliases: [],
      balances: [],
      openingLines: [{ item_code_raw: '223531-O', qty: 4, batch_id: 'b1', batch: { status: 'draft', site: 'NHC', country: 'KSA' } }],
    })
    api.searchMaterials.mockResolvedValue({ status: 'ok', results: [] })
    api.listCorrections.mockResolvedValue({ status: 'ok', rows: [], total: 0 })
    api.listPhotos.mockResolvedValue([])
    api.getMaterial.mockResolvedValue(null)
  })

  it('shows brand, part type and pending opening stock without inventing a value', async () => {
    ui()
    expect(await screen.findByText('WEDGE HOLDER')).toBeTruthy()
    expect(screen.getAllByText(/Not stated/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Genuine').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pending opening 4').length).toBeGreaterThan(0)
    expect(screen.getByText('Opening stock waiting for approval')).toBeTruthy()
    expect(screen.getByText(/Not yet approved/)).toBeTruthy()
    expect(screen.getByText('No posted stock of this item code in the stores you can see.')).toBeTruthy()
  })

  it('sends filters to the server and resets to the first page', async () => {
    ui()
    await screen.findByText('WEDGE HOLDER')
    fireEvent.change(screen.getByLabelText('Part type'), { target: { value: 'not_stated' } })
    await waitFor(() => expect(api.listMaterialCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ partType: 'not_stated', page: 0 })))
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: 'pending' } })
    await waitFor(() => expect(api.listMaterialCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ stock: 'pending' })))
  })

  it('reports an unreadable lookup instead of showing zero', async () => {
    api.loadMaterialCatalogDetail.mockResolvedValue({ variants: [], aliases: [], balances: null, openingLines: [] })
    ui()
    expect(await screen.findByText(/could not be read \(posted stock\)/)).toBeTruthy()
    expect(screen.getAllByText('On hand N/A').length).toBeGreaterThan(0)
  })

  it('offers Retry when the list fails', async () => {
    api.listMaterialCatalog.mockRejectedValue(new Error('network down'))
    ui()
    expect(await screen.findByRole('button', { name: /Retry/i })).toBeTruthy()
  })
})
