import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { renderHook } from '@testing-library/react'
import {
  refreshedLabel, usePaged, Pager, useUrlTab, Collapsible, AttentionList,
} from '../console/pages/dataTrust/kit'

describe('refreshedLabel', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  it('says not loaded when there is no timestamp', () => {
    expect(refreshedLabel(null, now)).toBe('Not loaded yet')
    expect(refreshedLabel('garbage', now)).toBe('Not loaded yet')
  })
  it('is relative for the first hour', () => {
    expect(refreshedLabel(new Date(now - 10_000), now)).toBe('Updated just now')
    expect(refreshedLabel(new Date(now - 5 * 60000), now)).toBe('Updated 5 min ago')
  })
})

describe('usePaged', () => {
  it('slices one page at a time and clamps when the rows shrink', () => {
    const rows = Array.from({ length: 55 }, (_, i) => i)
    const { result, rerender } = renderHook(({ r }) => usePaged(r, 25), { initialProps: { r: rows } })
    expect(result.current.pageCount).toBe(3)
    expect(result.current.pageRows).toHaveLength(25)
    act(() => result.current.setPage(2))
    expect(result.current.pageRows).toEqual([50, 51, 52, 53, 54])
    rerender({ r: rows.slice(0, 10) })
    expect(result.current.page).toBe(0)
    expect(result.current.pageRows).toHaveLength(10)
  })
})

describe('Pager', () => {
  it('shows the range and moves between pages', () => {
    let page = 0
    const setPage = (p) => { page = p }
    render(<Pager page={0} pageCount={3} total={55} pageSize={25} setPage={setPage} label="checks" />)
    expect(screen.getByText('1 to 25 of 55 checks')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Previous/ }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(page).toBe(1)
  })
})

describe('useUrlTab', () => {
  it('reads and writes ?tab= and falls back on an unknown value', () => {
    let loc
    const Probe = () => { loc = useLocation(); return null }
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/x?tab=nope']}>{children}<Probe /></MemoryRouter>
    )
    const { result } = renderHook(() => useUrlTab(['a', 'b'], 'a'), { wrapper })
    expect(result.current[0]).toBe('a')
    act(() => result.current[1]('b'))
    expect(result.current[0]).toBe('b')
    expect(loc.search).toBe('?tab=b')
    act(() => result.current[1]('a'))
    expect(loc.search).toBe('')
  })
})

describe('Collapsible and AttentionList', () => {
  it('starts closed and opens on click', () => {
    render(<Collapsible title="Rules" count={4}><p>inside</p></Collapsible>)
    expect(screen.queryByText('inside')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Rules/ }))
    expect(screen.getByText('inside')).toBeTruthy()
  })
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<MemoryRouter><AttentionList items={[]} /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })
  it('states the all-clear when asked to', () => {
    render(<MemoryRouter><AttentionList items={[]} clearText="All good." /></MemoryRouter>)
    expect(screen.getByText('All good.')).toBeTruthy()
  })
})
