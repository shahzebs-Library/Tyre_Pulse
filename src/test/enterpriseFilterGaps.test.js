import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (page) => readFileSync(resolve(root, 'pages', `${page}.jsx`), 'utf8')

const SURFACES = ['DataReconciliation', 'ExpenseImport', 'MaintenanceCostBoard']

describe('enterprise filter-gap rollout', () => {
  for (const page of SURFACES) {
    it(`${page} exposes shared filtering, bookmarkable state, and paging`, () => {
      const source = read(page)
      expect(source).toContain('<FilterBar')
      expect(source).toContain('useFilterState(')
      expect(source).toContain('usePagedRows(')
      expect(source).toContain('<TablePagination')
      expect(source).toMatch(/No .+ match (?:these|this) filter|No .+ match this search/)
    })
  }

  it('ExpenseImport display filters cannot reduce the rows submitted', () => {
    const source = read('ExpenseImport')
    expect(source).toContain('await importExpenseBatch(rows, {')
    expect(source).not.toContain('importExpenseBatch(previewRows')
    expect(source).not.toContain('importExpenseBatch(previewPager.pageRows')
  })

  it('MaintenanceCostBoard exports the full snapshot, never the visible page', () => {
    const source = read('MaintenanceCostBoard')
    expect(source).toContain('(snapshot.top_tasks || []).map')
    expect(source).toContain('(snapshot.spend_by_site || []).map')
    expect(source).not.toMatch(/exportToExcel\(\s*(?:filteredDetails|detailPager\.pageRows)/)
  })
})
