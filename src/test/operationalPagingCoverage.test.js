import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pageSource = (name) => readFileSync(
  resolve(process.cwd(), 'src', 'pages', `${name}.jsx`),
  'utf8',
)

describe('operational registers expose honest paging', () => {
  it('RfidRegistry registers page every row through EnterpriseTable', () => {
    // KitTable is the kit skin over EnterpriseTable (src/components/commandCenter/kit.jsx).
    const source = pageSource('RfidRegistry')
    expect(source).toMatch(/<(EnterpriseTable|KitTable)\b/)
    expect(source).not.toMatch(/\.slice\(0,\s*\d+\)\.map/)
  })

  it('UploadApprovals pages every queue and staged-row preview through EnterpriseTable', () => {
    // Moved off usePagedRows: EnterpriseTable pages and sorts the WHOLE set,
    // and no queue or preview clips rows before handing them in.
    const source = pageSource('UploadApprovals')
    expect(source).toContain('<EnterpriseTable')
    expect(source).not.toMatch(/\.slice\(0,\s*\d+\)\.map/)
  })

  it('CustomData pages every register through the kit table (EnterpriseTable)', () => {
    // Rebuilt on the Command Center kit: KitTable pages the whole set and the
    // records register is server paged with the kit Pager; nothing clips rows.
    const source = pageSource('CustomData')
    expect(source).toMatch(/<KitTable\b/)
    expect(source).not.toMatch(/\.slice\(0,\s*\d+\)\.map/)
  })

  it.each([
    'TyreScrapManagement',
    'DataIntakeHistory',
    'StockManagement',
  ])('%s uses the shared paging contract', (page) => {
    const source = pageSource(page)
    expect(source).toContain('usePagedRows')
    expect(source).toContain('TablePagination')
  })

  it('WorkshopLive delay register pages the whole set inside EnterpriseTable', () => {
    // The delay panel moved into the page's parts module (src/components/workshop).
    const source = pageSource('WorkshopLive') + readFileSync(
      resolve(process.cwd(), 'src', 'components', 'workshop', 'WorkshopLiveParts.jsx'),
      'utf8',
    )
    expect(source).toContain('<EnterpriseTable')
    expect(source).not.toContain('delaysPager.pageRows')
  })

  it('RFID registers page through PostgREST instead of silently capping rows', () => {
    const source = pageSource('RfidRegistry')
    expect(source).toContain('fetchAllPages')
    expect(source).not.toMatch(/\.limit\((?:100|200|500)\)/)
  })

  it('upload row previews do not discard matches at a fixed display cap', () => {
    const source = pageSource('UploadApprovals')
    expect(source).not.toContain('MAX_VISIBLE')
    expect(source).not.toMatch(/rows\.slice\(0,\s*300\)/)
    expect(source).toContain('getBatchRows(b.id, null)')
  })
})
