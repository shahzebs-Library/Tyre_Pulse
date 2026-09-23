import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

/**
 * Level 2 — operator-grade register layout on EnterpriseTable.
 *
 * `EnterpriseTable` is shared by many pages, so the FIRST thing pinned here is
 * that a caller which does not opt in is completely unchanged. Everything else
 * covers a failure that is SILENT in a browser:
 *
 *   - a visibility tick that writes to state the saved view overwrites, so the
 *     checkbox moves and the column does not;
 *   - a save that fires before the load resolves, overwriting the operator's
 *     real layout with mount-time defaults;
 *   - a keyboard handler that hijacks keys while someone is typing.
 */

const loadView = vi.fn()
const saveView = vi.fn()

vi.mock('../lib/api/registerViews', () => ({
  CURRENT_VIEW_NAME: '',
  loadView: (...a) => loadView(...a),
  saveView: (...a) => saveView(...a),
  listSavedViews: vi.fn(async () => []),
  deleteView: vi.fn(async () => ({ ok: true })),
  setDefaultView: vi.fn(async () => ({ ok: true })),
}))

const EnterpriseTable = (await import('../components/ui/EnterpriseTable')).default
const { emptyView } = await import('../lib/registerViews')

const DATA = [
  { id: 'a', name: 'Alpha', site: 'NHC', qty: 3 },
  { id: 'b', name: 'Bravo', site: 'JED', qty: 5 },
  { id: 'c', name: 'Charlie', site: 'NHC', qty: 9 },
]
const COLUMNS = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'site', header: 'Site' },
  { accessorKey: 'qty', header: 'Qty' },
]

function renderTable(props = {}) {
  return render(
    <EnterpriseTable columns={COLUMNS} data={DATA} getRowId={r => r.id} searchDebounceMs={0} {...props} />
  )
}
const headerText = () => [...document.querySelectorAll('thead th')].map(th => th.textContent.trim())
const dataRows = () =>
  [...document.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll('td').length > 1)

beforeEach(() => {
  loadView.mockReset()
  saveView.mockReset()
  loadView.mockResolvedValue(emptyView('demo'))
  saveView.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('EnterpriseTable — no viewKey (every existing caller)', () => {
  it('renders no Level 2 controls and never touches the view service', async () => {
    renderTable()
    expect(screen.queryByTitle(/compact rows/i)).toBeNull()
    expect(screen.queryByText(/Reset view/i)).toBeNull()
    // The whole point of the opt-in: an existing page must not start reading or
    // writing a preference table it never asked for.
    expect(loadView).not.toHaveBeenCalled()
    expect(saveView).not.toHaveBeenCalled()
  })

  it('still shows every column and its rows', () => {
    renderTable()
    expect(headerText()).toEqual(['Name', 'Site', 'Qty'])
    expect(dataRows()).toHaveLength(3)
  })
})

describe('EnterpriseTable — viewKey opts into the saved view', () => {
  it('renders rows immediately, before the saved view resolves', async () => {
    // Deliberately never resolve: a slow or unprovisioned preference table must
    // not hold the register's data back.
    loadView.mockReturnValue(new Promise(() => {}))
    renderTable({ viewKey: 'demo' })
    expect(dataRows()).toHaveLength(3)
    expect(headerText()).toEqual(['Name', 'Site', 'Qty'])
  })

  it('applies a stored layout: hidden column and pin order', async () => {
    loadView.mockResolvedValue({
      ...emptyView('demo'),
      columns: ['name', 'site', 'qty'],
      hidden: ['site'],
      pinned: ['qty'],
    })
    renderTable({ viewKey: 'demo' })
    // Pinned first, hidden dropped.
    await waitFor(() => expect(headerText()).toEqual(['Qty', 'Name']))
  })

  it('a NEW column absent from the stored view still appears', async () => {
    // Rule 1 of the engine, pinned here end-to-end: an operator holding a saved
    // view must not be the last to see a column that shipped months ago.
    loadView.mockResolvedValue({ ...emptyView('demo'), columns: ['name', 'site'], hidden: [] })
    renderTable({ viewKey: 'demo' })
    await waitFor(() => expect(headerText()).toContain('Qty'))
  })

  it('a retired column in the stored view is dropped, not rendered as a ghost', async () => {
    loadView.mockResolvedValue({
      ...emptyView('demo'),
      columns: ['name', 'gone_away', 'site', 'qty'],
    })
    renderTable({ viewKey: 'demo' })
    await waitFor(() => expect(headerText()).toEqual(['Name', 'Site', 'Qty']))
  })

  it('does not save the mount-time defaults before the load resolves', async () => {
    let release
    loadView.mockReturnValue(new Promise(r => { release = r }))
    renderTable({ viewKey: 'demo' })
    // If the hook wrote here it would clobber the real stored layout with
    // defaults - the classic way "remember my columns" eats what it remembers.
    await act(async () => { await Promise.resolve() })
    expect(saveView).not.toHaveBeenCalled()
    await act(async () => { release(emptyView('demo')); await Promise.resolve() })
    expect(saveView).not.toHaveBeenCalled()  // loading alone is not a change
  })
})

describe('EnterpriseTable — density', () => {
  it('toggles and persists, and the label states the CURRENT density', async () => {
    vi.useFakeTimers()
    try {
      renderTable({ viewKey: 'demo' })
      await act(async () => { await Promise.resolve() })
      const btn = screen.getByRole('button', { name: /Comfortable/i })
      expect(btn.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(btn)
      await act(async () => { vi.advanceTimersByTime(700) })
      expect(screen.getByRole('button', { name: /Compact/i }).getAttribute('aria-pressed')).toBe('true')
      expect(saveView).toHaveBeenCalled()
      expect(saveView.mock.calls.at(-1)[1].density).toBe('compact')
    } finally { vi.useRealTimers() }
  })
})

describe('EnterpriseTable — keyboard path', () => {
  it('"/" focuses the search box', () => {
    renderTable({ viewKey: 'demo' })
    const input = screen.getByPlaceholderText(/Search/i)
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(document, { key: '/' })
    expect(document.activeElement).toBe(input)
  })

  it('j and k move a row cursor that is visually distinct from selection', () => {
    renderTable({ viewKey: 'demo' })
    fireEvent.keyDown(document, { key: 'j' })
    expect(dataRows()[0].className).toMatch(/outline/)
    fireEvent.keyDown(document, { key: 'j' })
    expect(dataRows()[1].className).toMatch(/outline/)
    expect(dataRows()[0].className).not.toMatch(/outline/)
    fireEvent.keyDown(document, { key: 'k' })
    expect(dataRows()[0].className).toMatch(/outline/)
  })

  it('Enter opens the row under the cursor', () => {
    const onRowClick = vi.fn()
    renderTable({ viewKey: 'demo', onRowClick })
    fireEvent.keyDown(document, { key: 'j' })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onRowClick).toHaveBeenCalledWith(DATA[0])
  })

  it('Escape clears the cursor', () => {
    renderTable({ viewKey: 'demo' })
    fireEvent.keyDown(document, { key: 'j' })
    expect(dataRows()[0].className).toMatch(/outline/)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dataRows()[0].className).not.toMatch(/outline/)
  })

  it('NEVER hijacks a key while someone is typing in a field', () => {
    const onRowClick = vi.fn()
    renderTable({ viewKey: 'demo', onRowClick })
    const input = screen.getByPlaceholderText(/Search/i)
    // A search for "jk/" must type, not navigate.
    fireEvent.keyDown(input, { key: 'j' })
    fireEvent.keyDown(input, { key: 'k' })
    fireEvent.keyDown(input, { key: '/' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(dataRows().some(tr => /outline/.test(tr.className))).toBe(false)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('leaves the keyboard alone when a modifier is held', () => {
    renderTable({ viewKey: 'demo' })
    fireEvent.keyDown(document, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'j', metaKey: true })
    expect(dataRows().some(tr => /outline/.test(tr.className))).toBe(false)
  })

  it('can be switched off', () => {
    renderTable({ viewKey: 'demo', enableKeyboard: false })
    fireEvent.keyDown(document, { key: 'j' })
    expect(dataRows().some(tr => /outline/.test(tr.className))).toBe(false)
  })
})

describe('EnterpriseTable — the view service failing is never an error state', () => {
  it('renders normally when the preference table is not provisioned', async () => {
    loadView.mockRejectedValue(new Error('relation "user_view_prefs" does not exist'))
    renderTable({ viewKey: 'demo' })
    await waitFor(() => expect(dataRows()).toHaveLength(3))
    expect(screen.queryByText(/Failed to load/i)).toBeNull()
    expect(headerText()).toEqual(['Name', 'Site', 'Qty'])
  })

  it('a failing save does not surface to the operator', async () => {
    vi.useFakeTimers()
    try {
      saveView.mockRejectedValue(new Error('network'))
      renderTable({ viewKey: 'demo' })
      await act(async () => { await Promise.resolve() })
      fireEvent.click(screen.getByRole('button', { name: /Comfortable/i }))
      await act(async () => { vi.advanceTimersByTime(700) })
      expect(screen.queryByText(/Failed/i)).toBeNull()
      expect(dataRows()).toHaveLength(3)
    } finally { vi.useRealTimers() }
  })
})
