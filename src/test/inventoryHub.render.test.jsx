import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const db = { from: { data: null, error: { code: '42P01', message: 'relation does not exist' }, count: null }, rpc: { data: null, error: { code: 'PGRST202' } } }

function builder() {
  const b = {}
  for (const m of ['select', 'eq', 'not', 'in', 'or', 'gte', 'lte', 'order', 'range', 'limit', 'is']) b[m] = () => b
  b.maybeSingle = () => Promise.resolve(db.from)
  b.then = (res, rej) => Promise.resolve(db.from).then(res, rej)
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: { from: () => builder(), rpc: () => Promise.resolve(db.rpc) },
}))

const auth = { profile: { id: 'u-counter', role: 'Store Keeper' }, user: { id: 'u-counter' }, isSuperAdmin: false }
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    ...auth,
    hasCapability: (m, c) => (auth.caps ? auth.caps.includes(c) : true),
    canExport: () => true,
  }),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', appSettings: {} }) }))
vi.mock('../lib/api/sites', () => ({ listSites: () => Promise.resolve([{ name: 'NHC' }]) }))

import InventoryHub from '../components/inventory/InventoryHub'
import { LanguageProvider } from '../contexts/LanguageContext'
import AuditCounterView from '../components/inventory/AuditCounterView'

const renderHub = (section, onSection = () => {}) => render(
  <LanguageProvider>
    <MemoryRouter>
      <InventoryHub section={section} onSection={onSection} renderRegister={() => <div>legacy register</div>} />
    </MemoryRouter>
  </LanguageProvider>,
)

beforeEach(() => {
  db.from = { data: null, error: { code: '42P01', message: 'relation does not exist' }, count: null }
  db.rpc = { data: null, error: { code: 'PGRST202' } }
  auth.caps = null
})

describe('Inventory Control Center hub', () => {
  it('renders the shell, the grouped navigation and the legacy register section', async () => {
    const onSection = vi.fn()
    renderHub('register', onSection)
    expect(await screen.findByRole('heading', { name: 'Inventory Control Center' })).toBeTruthy()
    expect(screen.getByText('legacy register')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Audits' }))
    expect(onSection).toHaveBeenCalledWith('audits', null)
    // The left menu reaches every section too, including ones outside the top tabs.
    fireEvent.click(screen.getByRole('button', { name: /Master Data/ }))
    expect(onSection).toHaveBeenCalledWith('locations', null)
  })

  it('"Open evidence" lands on the named tab inside the section, and picking a tab reports it back', async () => {
    const onTab = vi.fn()
    render(
      <LanguageProvider>
        <MemoryRouter>
          <InventoryHub section="controls" tab="opening" onSection={() => {}} onTab={onTab} renderRegister={() => null} />
        </MemoryRouter>
      </LanguageProvider>,
    )
    const opening = await screen.findByRole('tab', { name: 'Opening balances' })
    expect(opening.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Approvals' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByRole('tab', { name: 'Master data reviews' }))
    expect(onTab).toHaveBeenCalledWith('master')
  })

  it('valuation honours the linked tab and ignores an unknown one', async () => {
    const { unmount } = render(
      <LanguageProvider><MemoryRouter>
        <InventoryHub section="valuation" tab="costs" onSection={() => {}} renderRegister={() => null} />
      </MemoryRouter></LanguageProvider>,
    )
    expect((await screen.findByRole('tab', { name: 'Cost reconciliation' })).getAttribute('aria-selected')).toBe('true')
    unmount()
    render(
      <LanguageProvider><MemoryRouter>
        <InventoryHub section="valuation" tab="nonsense" onSection={() => {}} renderRegister={() => null} />
      </MemoryRouter></LanguageProvider>,
    )
    expect((await screen.findByRole('tab', { name: 'Value' })).getAttribute('aria-selected')).toBe('true')
  })

  it('shows honest "not set up" states instead of fake data when the DB objects are missing', async () => {
    renderHub('audits')
    expect(await screen.findByText('Physical audits is not set up yet')).toBeTruthy()
  })

  it('overview reports every core object as not installed and never prints a zero for unknown counts', async () => {
    renderHub('overview')
    expect((await screen.findAllByText('Not installed')).length).toBeGreaterThan(5)
    expect(screen.queryAllByText('0').length).toBe(0)
  })

  // The old version of this test clicked a group tab whose handler was a no-op,
  // so it never looked at the Valuation entry. With caps ['view'] the
  // documented fallback (view_value -> view) legitimately SHOWS Valuation; a
  // user with no stock capability at all must not see it.
  it('hides Valuation from users without the view_value capability', async () => {
    auth.caps = []
    renderHub('overview')
    fireEvent.click(await screen.findByRole('button', { name: /More/ }))
    expect(screen.getByRole('button', { name: 'Stock classification' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Valuation' })).toBeNull()
  })
})

describe('blind counter view', () => {
  it('never shows the expected quantity even if the server leaks it', async () => {
    db.rpc = { data: { audit: { id: 'a1' }, lines: [{ id: 'l1', item_code: 'TYRE-315', description: 'Steer tyre', expected_qty: 47, book_qty: 47 }] }, error: null }
    render(<AuditCounterView audit={{ id: 'a1' }} />)
    expect(await screen.findByText('TYRE-315')).toBeTruthy()
    expect(screen.queryByText(/47/)).toBeNull()
    expect(screen.getByText('0 of 1 lines counted')).toBeTruthy()
  })

  it('requires a confirmation before submitting and refuses an empty count', async () => {
    db.rpc = { data: { lines: [{ id: 'l1', item_code: 'A' }] }, error: null }
    render(<AuditCounterView audit={{ id: 'a1' }} />)
    await screen.findByText('A')
    fireEvent.click(screen.getByRole('button', { name: /Submit count/ }))
    expect(screen.getByText('Enter at least one counted line before submitting.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Counted quantity for A'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit count/ }))
    expect(screen.getByRole('button', { name: /Yes, submit/ })).toBeTruthy()
  })
})
