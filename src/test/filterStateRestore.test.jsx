import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * Spec 64: "If a user opens a list with Site/Brand/Status filters, opens a
 * record, and returns, preserve the filter, search, sort, page and scroll
 * position where practical."
 *
 * These tests assert the BEHAVIOUR the user sees, not the plumbing:
 *  1. a filter set on the list appears in the URL (so it survives a remount),
 *  2. loading that URL applies the filter,
 *  3. a param the page already supported still applies and is not clobbered.
 *
 * FleetMaster is rendered for real, because it is the smallest of the four
 * registers and its Supabase read is a single mockable query builder. The other
 * three (AssetManagement, DriverManagement, Inspections) pull chart.js, a
 * virtualiser and the PDF/export engines at module scope, so a full render is
 * not practical here; their URL contract is covered through the same shared
 * hook with each page's REAL defaults, which is the piece the pages delegate to.
 */

// ── Live URL probe ────────────────────────────────────────────────────────────
function UrlProbe() {
  const loc = useLocation()
  return <output data-testid="url">{loc.search}</output>
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The real register page
// ─────────────────────────────────────────────────────────────────────────────

// Rows the mocked Supabase read returns; the page paints them into the table.
const FLEET_ROWS = [
  { id: 1, asset_no: 'TM001', fleet_number: 'F1', make: 'Volvo', model: 'FM',  site: 'JED', status: 'Active',   country: 'KSA' },
  { id: 2, asset_no: 'TM002', fleet_number: 'F2', make: 'Scania', model: 'R500', site: 'NHC', status: 'Inactive', country: 'KSA' },
]

// Every filter the page applies is recorded here, so a test can assert what the
// restored URL actually asked the server for.
let lastQuery = null

function makeQueryBuilder(rows) {
  const q = {
    _filters: { eq: {}, or: null, range: null },
    select() { return q },
    order() { return q },
    not() { return q },
    range(from, to) { q._filters.range = [from, to]; return q },
    eq(col, val) { q._filters.eq[col] = val; return q },
    or(expr) { q._filters.or = expr; return q },
    then(resolve) {
      lastQuery = q._filters
      return Promise.resolve(resolve({ data: rows, count: rows.length, error: null }))
    },
  }
  return q
}

vi.mock('../lib/supabase', () => ({
  supabase: { from: () => makeQueryBuilder(FLEET_ROWS) },
}))
vi.mock('../lib/fetchAll', () => ({
  fetchAllPages: vi.fn(() => Promise.resolve({ data: [{ site: 'JED' }, { site: 'NHC' }], truncated: false })),
}))
vi.mock('../lib/api/billing', () => ({ canAddResource: () => Promise.resolve(true) }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'Manager', full_name: 'Sam' } }),
}))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, vars) => (vars ? `${k}` : k) }),
}))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn() }))

import FleetMaster from '../pages/FleetMaster'

function renderFleet(initialUrl = '/fleet-master') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <UrlProbe />
      <FleetMaster />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  lastQuery = null
  try { sessionStorage.clear() } catch { /* jsdom always has it */ }
})

describe('Fleet Master keeps its filters in the URL', () => {
  it('opens with no filter params, exactly as before', async () => {
    renderFleet()
    await waitFor(() => expect(lastQuery).not.toBeNull())
    // A clean first load: nothing added to the URL, and the query carries only
    // the working-country scope the page always applied.
    expect(screen.getByTestId('url').textContent).toBe('')
    expect(lastQuery.eq).toEqual({ country: 'KSA' })
    expect(lastQuery.or).toBeNull()
  })

  it('puts a chosen status filter in the URL so it survives a remount', async () => {
    renderFleet()
    await waitFor(() => expect(lastQuery).not.toBeNull())

    const statusSelect = screen.getByDisplayValue('fleetmaster.filters.allStatuses')
    fireEvent.change(statusSelect, { target: { value: 'Active' } })

    await waitFor(() =>
      expect(screen.getByTestId('url').textContent).toContain('status=Active'),
    )
  })

  it('applies a filter that arrives in the URL', async () => {
    renderFleet('/fleet-master?status=Inactive&site=NHC')
    await waitFor(() => expect(lastQuery).not.toBeNull())

    // The restored filters reach the server read, not just the controls.
    await waitFor(() => {
      expect(lastQuery.eq.status).toBe('Inactive')
      expect(lastQuery.eq.site).toBe('NHC')
    })
  })

  it('restores a page beyond the first without the search debounce resetting it', async () => {
    // The debounce used to reset the page on mount, which would have thrown a
    // restored reader back to page 1 of their search 300ms after arriving.
    renderFleet('/fleet-master?search=TM&page=3')
    await waitFor(() => expect(lastQuery).not.toBeNull())

    await new Promise(r => setTimeout(r, 400))
    expect(screen.getByTestId('url').textContent).toContain('page=3')
    expect(screen.getByTestId('url').textContent).toContain('search=TM')
    // The restored search is queried immediately rather than after the debounce.
    expect(lastQuery.or).toContain('TM')
  })

  it('ignores a page size the table does not offer, so the server range stays bounded', async () => {
    renderFleet('/fleet-master?size=100000')
    await waitFor(() => expect(lastQuery).not.toBeNull())
    // The page size now arrives from the URL, so a hand-typed one must not widen
    // the read. The assertion is on the range actually sent to the server.
    const [from, to] = lastQuery.range
    expect(to - from + 1).toBe(25)
  })

  it('honours a page size the table does offer', async () => {
    renderFleet('/fleet-master?size=100')
    await waitFor(() => expect(lastQuery).not.toBeNull())
    const [from, to] = lastQuery.range
    expect(to - from + 1).toBe(100)
  })

  it('keeps an unrelated param that another page linked in', async () => {
    renderFleet('/fleet-master?ref=dashboard')
    await waitFor(() => expect(lastQuery).not.toBeNull())

    const statusSelect = screen.getByDisplayValue('fleetmaster.filters.allStatuses')
    fireEvent.change(statusSelect, { target: { value: 'Active' } })

    await waitFor(() => {
      const url = screen.getByTestId('url').textContent
      expect(url).toContain('ref=dashboard')
      expect(url).toContain('status=Active')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. The other three registers: same contract, through the shared hook
// ─────────────────────────────────────────────────────────────────────────────
import { useFilterState } from '../hooks/useFilterState'

// The REAL defaults each page passes. If a page changes its keys, this copy has
// to change with it - which is the point: the pair is the page's URL contract.
const PAGE_DEFAULTS = {
  AssetManagement: {
    search: '', site: '', country: '', type: '', status: '', risk: '', ops: '',
    sort: 'asset_no', dir: 'asc', page: '1',
  },
  DriverManagement: {
    search: '', site: 'all', country: 'all',
    preset: '1yr', from: '', to: '',
    sort: 'riskScore', dir: 'asc',
  },
  Inspections: {
    search: '', status: 'all', site: 'all', region: 'all', inspector: 'all',
    from: '', to: '',
  },
}

function FilterHarness({ defaults, writes }) {
  const [filters, setFilter, resetFilters, hasActiveFilters, setFilters] = useFilterState(defaults)
  return (
    <div>
      <output data-testid="filters">{JSON.stringify(filters)}</output>
      <output data-testid="active">{String(hasActiveFilters)}</output>
      <button onClick={() => setFilters(writes)}>write</button>
      <button onClick={() => setFilter('search', 'TM5')}>search</button>
      <button onClick={resetFilters}>reset</button>
    </div>
  )
}

function renderHarness(page, url, writes = {}) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <UrlProbe />
      <FilterHarness defaults={PAGE_DEFAULTS[page]} writes={writes} />
    </MemoryRouter>,
  )
  return () => JSON.parse(screen.getByTestId('filters').textContent)
}

describe.each(Object.keys(PAGE_DEFAULTS))('%s filter round trip', page => {
  it('starts on its documented defaults when the URL is bare', () => {
    const read = renderHarness(page, '/x')
    expect(read()).toEqual(PAGE_DEFAULTS[page])
    expect(screen.getByTestId('url').textContent).toBe('')
  })

  it('writes a changed filter to the URL and reads it back', async () => {
    const read = renderHarness(page, '/x')
    fireEvent.click(screen.getByText('search'))
    await waitFor(() => expect(read().search).toBe('TM5'))
    expect(screen.getByTestId('url').textContent).toContain('search=TM5')
  })

  it('applies every filter that arrives in the URL', () => {
    const params = Object.keys(PAGE_DEFAULTS[page])
      .map(k => `${k}=${encodeURIComponent(`v-${k}`)}`)
      .join('&')
    const read = renderHarness(page, `/x?${params}`)
    for (const key of Object.keys(PAGE_DEFAULTS[page])) {
      expect(read()[key]).toBe(`v-${key}`)
    }
  })

  it('leaves a param it does not own untouched', async () => {
    renderHarness(page, '/x?asset=TM001')
    fireEvent.click(screen.getByText('search'))
    await waitFor(() =>
      expect(screen.getByTestId('url').textContent).toContain('search=TM5'),
    )
    expect(screen.getByTestId('url').textContent).toContain('asset=TM001')
  })

  it('clearing a filter removes it from the URL rather than pinning a blank', async () => {
    const read = renderHarness(page, '/x?search=TM5')
    expect(read().search).toBe('TM5')
    fireEvent.click(screen.getByText('reset'))
    await waitFor(() => expect(read()).toEqual(PAGE_DEFAULTS[page]))
    expect(screen.getByTestId('url').textContent).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Inspections: its own deep links must survive the filters moving into the URL
// ─────────────────────────────────────────────────────────────────────────────
// A full render of Inspections is not practical here (chart.js, a virtualiser,
// the PDF engine and a checklist camera all load at module scope), so this is a
// source scan of the one interaction that cannot be expressed through the hook:
// the page consumes `?asset=` and `?approve=` and then removes them. It used to
// do that by clearing the WHOLE query string, which would now take the reader's
// filters with it.
import { readFileSync } from 'fs'

describe('Inspections deep-link params', () => {
  const src = readFileSync('src/pages/Inspections.jsx', 'utf8')

  it('still consumes ?asset= and ?approve=', () => {
    expect(src).toContain("searchParams.get('asset')")
    expect(src).toContain("searchParams.get('approve')")
  })

  it('drops only the consumed key, never the whole query string', () => {
    // `setSearchParams({})` would wipe the register's filters along with the
    // deep-link param it meant to clear.
    expect(src).not.toMatch(/setSearchParams\(\{\}/)
    expect(src).toContain("next.delete('asset')")
    expect(src).toContain("next.delete('approve')")
  })
})

describe('Driver Management date window', () => {
  // The window is a named preset by default, so a shared link reads "the last
  // year" rather than a year frozen to the day it was copied. A hand-typed range
  // must therefore be marked, and it cannot be marked with an empty string:
  // useFilterState drops a blank param, which would silently restore the preset.
  it('a custom range is not silently turned back into the default preset', async () => {
    const read = renderHarness(
      'DriverManagement',
      '/x',
      { preset: 'custom', from: '2026-01-01', to: '2026-03-31' },
    )
    fireEvent.click(screen.getByText('write'))
    await waitFor(() => expect(read().preset).toBe('custom'))
    expect(read().from).toBe('2026-01-01')
    expect(screen.getByTestId('url').textContent).toContain('preset=custom')
  })
})
