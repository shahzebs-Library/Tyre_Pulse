import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ policy: vi.fn(rows => rows), header: vi.fn(), footer: vi.fn() }))
vi.mock('../lib/exportUtils', () => ({ applyExportPolicy: h.policy, resolvePdfBrand: async () => ({ logoData: 'configured', accent: [21, 128, 61] }), pdfHeader: h.header, pdfFooter: h.footer, pdfTableTheme: () => ({ theme: 'grid' }) }))
vi.mock('../lib/api/brandLogo', () => ({ getCompanyLogo: async () => 'configured-logo' }))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrl: vi.fn() }))
import { exportVehicleWashPdf, groupVehicleWashes, washFilterLabel, washDateLabel } from '../lib/washReportPdf'
const row = { id: 'r1', organisation_id: 'org1', asset_no: 'TM651', country: 'KSA', site: 'JEDDAH', vehicle_type: 'TR-MIXER', wash_date: '2026-09-10', wash_type: 'Full', status: 'Completed', photos: [] }
beforeEach(() => { h.policy.mockImplementation(rows => rows); h.header.mockClear(); h.footer.mockClear() })
describe('vehicle washing PDFs', () => {
  it('uses one page for a single wash with three attachments and short notes', async () => {
    const result = await exportVehicleWashPdf([{ ...row, notes: 'Wash complete', photos: ['a', 'b', 'c'] }], { save: false, filters: { assetNo: 'TM651', site: 'JEDDAH' }, loadPhoto: async () => { throw new Error('Unavailable') } })
    expect(result.doc.internal.getNumberOfPages()).toBe(1)
    const text = Object.values(result.doc.internal.pages).flat().join(' ')
    expect(text).toContain('Vehicle: TM651')
    expect(text).toContain('Site: JEDDAH')
    expect(text).toContain('Wash complete')
  })
  it('prints selected filters distinctly from recorded dates', () => {
    expect(washFilterLabel({ from: '2026-09-01', to: '2026-09-10', site: 'JEDDAH', status: 'Completed', type: 'Full', assetNo: 'TM335' })).toBe('From: 01 Sept 2026 | To: 10 Sept 2026 | Site: JEDDAH | Status: Completed | Wash type: Full | Vehicle: TM335')
    expect(washDateLabel('2026-09-10')).toBe('10 Sept 2026')
  })
  it('uses one vehicle group across dates without mixing countries or organisations', () => {
    const groups = groupVehicleWashes([row, { ...row, id: 'older', wash_date: '2026-08-01' }, { ...row, id: 'uae', country: 'UAE' }, { ...row, id: 'other-org', organisation_id: 'org2' }])
    expect(groups).toHaveLength(3)
    expect(groups[0].map(r => r.id)).toEqual(['r1', 'older'])
  })
  it('generates a complete PDF with summary and all photo slots, marking unavailable photos', async () => {
    const loadPhoto = vi.fn().mockRejectedValue(new Error('Unavailable'))
    const result = await exportVehicleWashPdf([{ ...row, photos: ['1','2','3','4','5'] }], { save: false, loadPhoto })
    expect(result.doc.internal.getNumberOfPages()).toBe(2)
    expect(result.missingPhotos).toBe(5)
    expect(loadPhoto).toHaveBeenCalledTimes(5)
    expect(Object.values(result.doc.internal.pages).flat().join(' ')).toContain('Photo unavailable')
    expect(Object.values(result.doc.internal.pages).flat().join(' ')).toContain('TM651')
    expect(h.footer).toHaveBeenCalledTimes(2)
  })
  it('includes vehicles without photos and never silently truncates the selected records', async () => {
    const { doc } = await exportVehicleWashPdf([row], { save: false })
    expect(Object.values(doc.internal.pages).flat().join(' ')).toContain('No photos recorded')
    h.policy.mockReturnValue([])
    await expect(exportVehicleWashPdf([row], { save: false })).rejects.toThrow('export limit')
  })
  it('embeds a loaded photograph into the PDF', async () => {
    const photo = { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQ6jAGAAGtAN6XKKXwAAAAAElFTkSuQmCC', width: 1, height: 1 }
    const result = await exportVehicleWashPdf([{ ...row, photos: ['private-ref'] }], { save: false, loadPhoto: async () => photo })
    expect(result.missingPhotos).toBe(0)
    expect(result.doc.output()).toContain('/Subtype /Image')
  })
})
