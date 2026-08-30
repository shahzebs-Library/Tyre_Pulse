import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pageSource = (name) => readFileSync(
  resolve(process.cwd(), 'src', 'pages', `${name}.jsx`),
  'utf8',
)

describe('operational registers expose honest paging', () => {
  it.each([
    'RfidRegistry',
    'UploadApprovals',
    'WorkshopLive',
    'TyreScrapManagement',
    'DataIntakeHistory',
    'CustomData',
    'StockManagement',
  ])('%s uses the shared paging contract', (page) => {
    const source = pageSource(page)
    expect(source).toContain('usePagedRows')
    expect(source).toContain('TablePagination')
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
