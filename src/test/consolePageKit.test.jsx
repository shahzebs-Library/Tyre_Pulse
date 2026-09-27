import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, renderHook, cleanup } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  refreshedLabel, usePaged, Pager, useUrlTab, useUrlParam, Collapsible, AttentionList, Drawer,
  normalizeAttentionItem, PageHeader,
} from '../console/pages/shared/pageKit'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('refreshedLabel', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  it('says not loaded when there is no timestamp', () => {
    expect(refreshedLabel(null, now)).toBe('Not loaded yet')
    expect(refreshedLabel('garbage', now)).toBe('Not loaded yet')
  })
  it('is relative', () => {
    expect(refreshedLabel(new Date(now - 10_000), now)).toBe('Updated just now')
    expect(refreshedLabel(new Date(now - 5 * 60000), now)).toBe('Updated 5 min ago')
  })
})

describe('useUrlTab', () => {
  it('inside a router: reads and writes ?tab= and falls back on an unknown value', () => {
    let loc
    const Probe = () => { loc = useLocation(); return null }
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/x?tab=nope&keep=1']}>{children}<Probe /></MemoryRouter>
    )
    const { result } = renderHook(() => useUrlTab(['a', 'b'], 'a'), { wrapper })
    expect(result.current[0]).toBe('a')
    act(() => result.current[1]('b'))
    expect(result.current[0]).toBe('b')
    expect(new URLSearchParams(loc.search).get('tab')).toBe('b')
    expect(new URLSearchParams(loc.search).get('keep')).toBe('1')
    act(() => result.current[1]('a'))
    expect(loc.search).toBe('?keep=1')
  })

  it('outside a router: syncs through window.history and follows back/forward', () => {
    window.history.replaceState(null, '', '/page?tab=b')
    const { result } = renderHook(() => useUrlTab(['a', 'b', 'c'], 'a'))
    expect(result.current[0]).toBe('b')
    act(() => result.current[1]('c'))
    expect(result.current[0]).toBe('c')
    expect(window.location.search).toBe('?tab=c')
    act(() => result.current[1]('zzz'))
    expect(result.current[0]).toBe('a')
    expect(window.location.search).toBe('')
    act(() => {
      window.history.replaceState(null, '', '/page?tab=b')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current[0]).toBe('b')
  })

  it('honours a custom parameter name', () => {
    window.history.replaceState(null, '', '/page?view=b')
    const { result } = renderHook(() => useUrlTab(['a', 'b'], 'a', 'view'))
    expect(result.current[0]).toBe('b')
  })

  it('useUrlParam holds a free value', () => {
    const { result } = renderHook(() => useUrlParam('review'))
    expect(result.current[0]).toBeNull()
    act(() => result.current[1]('abc'))
    expect(result.current[0]).toBe('abc')
    expect(window.location.search).toBe('?review=abc')
  })
})

describe('usePaged', () => {
  const rows = Array.from({ length: 55 }, (_, i) => i)
  it('slices one page at a time with every field name the pages read', () => {
    const { result } = renderHook(() => usePaged(rows, 25))
    expect(result.current.pageCount).toBe(3)
    expect(result.current.pages).toBe(3)
    expect(result.current.rows).toHaveLength(25)
    expect(result.current.pageRows).toBe(result.current.rows)
    expect(result.current.slice).toBe(result.current.rows)
    act(() => result.current.setPage(2))
    expect(result.current.rows).toEqual([50, 51, 52, 53, 54])
    expect(result.current).toMatchObject({ page: 2, pageNumber: 3, from: 51, to: 55, total: 55 })
  })
  it('resets to the first page when the reset key changes', () => {
    const { result, rerender } = renderHook(({ k }) => usePaged(rows, 25, k), { initialProps: { k: 'a' } })
    act(() => result.current.setPage(2))
    rerender({ k: 'b' })
    expect(result.current.page).toBe(0)
  })
  it('clamps when the rows shrink and changes the page size', () => {
    const { result, rerender } = renderHook(({ r }) => usePaged(r, 25, 'fixed'), { initialProps: { r: rows } })
    act(() => result.current.setPage(2))
    rerender({ r: rows.slice(0, 10) })
    expect(result.current.page).toBe(0)
    rerender({ r: rows })
    act(() => result.current.setSize(10))
    expect(result.current.pageCount).toBe(6)
    expect(result.current.page).toBe(0)
  })
})

describe('Pager', () => {
  it('works with plain props (0-based page) and moves between pages', () => {
    let page = 0
    render(<Pager page={0} pageCount={3} total={55} pageSize={25} onPage={(p) => { page = p }} label="checks" />)
    expect(screen.getByText('Showing 1 to 25 of 55 checks')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous page' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(page).toBe(1)
  })
  it('drives the hook, including the page-size choice', () => {
    function Harness() {
      const paged = usePaged(Array.from({ length: 60 }, (_, i) => i), 25)
      return <><span data-testid="first">{paged.rows[0]}</span><Pager paged={paged} label="rows" /></>
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByTestId('first').textContent).toBe('25')
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } })
    expect(screen.getByText('Showing 1 to 50 of 60 rows')).toBeTruthy()
  })
  it('renders nothing for an empty list', () => {
    const { container } = render(<Pager total={0} />)
    expect(container.textContent).toBe('')
  })
})

describe('Drawer', () => {
  it('closes on Escape and returns focus to the opener', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open detail</button>
          <Drawer open={open} title="Record" onClose={() => setOpen(false)}><button type="button">Inside</button></Drawer>
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open detail' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Record' })
    expect(dialog).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('Collapsible, AttentionList, PageHeader', () => {
  it('starts closed and opens on click', () => {
    render(<Collapsible title="Rules" count={4}><p>inside</p></Collapsible>)
    expect(screen.queryByText('inside')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Rules/ }))
    expect(screen.getByText('inside')).toBeTruthy()
  })
  it('stays silent before the data is in, and when quiet with nothing to say', () => {
    const a = render(<AttentionList ready={false} items={[]} />)
    expect(a.container.textContent).toBe('')
    a.unmount()
    const b = render(<AttentionList quiet items={[]} />)
    expect(b.container.textContent).toBe('')
  })
  it('says a failed read is unknown rather than all clear', () => {
    render(<AttentionList items={[]} unknown="Could not check." />)
    expect(screen.getByText('Could not check.')).toBeTruthy()
    expect(screen.queryByText(/Nothing needs attention/)).toBeNull()
  })
  it('states the all-clear and renders one action per item', () => {
    let clicked = false
    render(<MemoryRouter><AttentionList items={[
      { key: 'a', tone: 'danger', title: 'Broken', detail: 'why', action: { label: 'Fix', onClick: () => { clicked = true } } },
      { key: 'b', text: 'Go look', to: '/console/x', actionLabel: 'Open page' },
    ]} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    expect(clicked).toBe(true)
    expect(screen.getByRole('link', { name: /Open page/ }).getAttribute('href')).toBe('/console/x')
  })
  it('normalises every action spelling', () => {
    const fn = () => {}
    expect(normalizeAttentionItem({ title: 't', action: fn, actionLabel: 'Go' }).action).toMatchObject({ onClick: fn, label: 'Go' })
    expect(normalizeAttentionItem({ text: 't', onAction: fn }).action).toMatchObject({ onClick: fn, label: 'Open' })
    expect(normalizeAttentionItem({ text: 't', to: '/a' }).action).toMatchObject({ to: '/a' })
  })
  it('header states freshness and refreshes', () => {
    let n = 0
    render(<PageHeader title="Health" onRefresh={() => { n += 1 }} />)
    expect(screen.getByText('Not loaded yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    expect(n).toBe(1)
  })
})
