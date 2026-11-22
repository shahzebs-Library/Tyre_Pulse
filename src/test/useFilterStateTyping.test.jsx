import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useFilterState } from '../hooks/useFilterState'

function Box() {
  const [filters, , , , setFilters] = useFilterState({ search: '', page: '1' })
  const loc = useLocation()
  return (
    <>
      <input aria-label="search" value={filters.search} onChange={e => setFilters({ search: e.target.value, page: '1' })} />
      <output data-testid="url">{loc.search}</output>
    </>
  )
}

describe('useFilterState with fast typing', () => {
  it('keeps every character when keys arrive faster than the router updates', async () => {
    render(<MemoryRouter initialEntries={['/x']}><Box /></MemoryRouter>)
    const input = screen.getByLabelText('search')
    // Fire each keystroke synchronously, without letting the router settle in between.
    let text = ''
    act(() => {
      for (const ch of 'DEMO-AUDIT') { text += ch; fireEvent.change(input, { target: { value: text } }) }
    })
    expect(input.value).toBe('DEMO-AUDIT')
    await act(async () => {})
    expect(screen.getByTestId('url').textContent).toBe('?search=DEMO-AUDIT')
  })

  it('still follows a URL change it did not make', async () => {
    render(<MemoryRouter initialEntries={['/x?search=TM']}><Box /></MemoryRouter>)
    expect(screen.getByLabelText('search').value).toBe('TM')
  })
})
