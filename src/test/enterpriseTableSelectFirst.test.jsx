import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// A saved view owns column order, and its catalog is built from the page's own
// columns, so the injected select column is never in it. TanStack puts a column
// missing from columnOrder at the END: the checkbox sat on the right-hand side.
vi.mock('../components/ui/useRegisterView', () => ({
  default: () => ({
    active: true, customised: false, limits: { maxPinned: 3 },
    onDensityChange() {}, onPinChange() {}, onVisibilityChange() {}, onWidthChange() {}, reset() {},
    tableState: {
      columnOrder: ['name', 'site'],          // no '__select' in the saved order
      columnVisibility: {}, columnSizing: {}, columnPinning: { left: [], right: [] }, density: 'comfortable',
    },
  }),
  useRegisterView: () => ({
    active: true, customised: false, limits: { maxPinned: 3 },
    onDensityChange() {}, onPinChange() {}, onVisibilityChange() {}, onWidthChange() {}, reset() {},
    tableState: {
      columnOrder: ['name', 'site'],
      columnVisibility: {}, columnSizing: {}, columnPinning: { left: [], right: [] }, density: 'comfortable',
    },
  }),
}))

import EnterpriseTable from '../components/ui/EnterpriseTable'

const columns = [
  { id: 'name', header: 'Name', accessorFn: (r) => r.name },
  { id: 'site', header: 'Site', accessorFn: (r) => r.site },
]

describe('EnterpriseTable select column', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('stays the first column when a saved view has its own column order', () => {
    render(
      <EnterpriseTable
        columns={columns} data={[{ id: 'a', name: 'One', site: 'NHC' }]}
        getRowId={(r) => r.id} enableRowSelection viewKey="select-first-test"
        enableGlobalFilter={false} enableColumnFilters={false}
      />,
    )
    const headers = screen.getAllByRole('columnheader')
    // the first header cell holds the select-all checkbox, then Name, then Site
    expect(headers[0].querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(headers[1]).toHaveTextContent('Name')
    expect(headers[headers.length - 1].querySelector('input[type="checkbox"]')).toBeNull()
  })
})
