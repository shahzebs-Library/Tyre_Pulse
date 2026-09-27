import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import EnterpriseTable from '../components/ui/EnterpriseTable'

// Chosen behaviour (documented in EnterpriseTable's header comment):
//   - sorting never resets the page (autoResetPageIndex stays off);
//   - a shrinking row count CLAMPS to the last valid page, never a blank page;
//   - internal search/column filters and `resetPageKey` changes reset to page 1.
const make = n => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${String(i + 1).padStart(3, '0')}`, qty: i }))
const COLUMNS = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'qty', header: 'Qty' },
]
const bodyRows = c => [...c.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll('td').length > 1)
const view = (data, extra = {}) => (
  <EnterpriseTable columns={COLUMNS} data={data} getRowId={r => r.id} searchDebounceMs={0} initialPageSize={25} {...extra} />
)
const goToPage3 = () => {
  fireEvent.click(screen.getByLabelText('Next page'))
  fireEvent.click(screen.getByLabelText('Next page'))
}

afterEach(() => cleanup())

describe('EnterpriseTable page safety', () => {
  it('clamps to the last page when data shrinks below the current page', () => {
    const { container, rerender } = render(view(make(120)))
    goToPage3()
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
    rerender(view(make(30)))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(bodyRows(container)).toHaveLength(5)
  })

  it('shows the empty state (not a blank page) when data shrinks to nothing', () => {
    const { rerender } = render(view(make(120), { emptyMessage: 'Nothing here' }))
    goToPage3()
    rerender(view([], { emptyMessage: 'Nothing here' }))
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('keeps the page when data changes but the page is still valid', () => {
    const { rerender } = render(view(make(120)))
    goToPage3()
    rerender(view(make(110)))
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
  })

  it('resets to page 1 when resetPageKey changes', () => {
    const { container, rerender } = render(view(make(120), { resetPageKey: 'all' }))
    goToPage3()
    rerender(view(make(120), { resetPageKey: 'site:NHC' }))
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
    expect(bodyRows(container)).toHaveLength(25)
  })

  it('resets to page 1 when the table search changes', async () => {
    render(view(make(120)))
    goToPage3()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search…'), { target: { value: 'Row 0' } })
      await new Promise(r => setTimeout(r, 5))
    })
    expect(screen.getByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })

  it('does not reset the page when the user sorts', () => {
    render(view(make(120)))
    goToPage3()
    fireEvent.click(screen.getByText('Qty'))
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
  })
})
