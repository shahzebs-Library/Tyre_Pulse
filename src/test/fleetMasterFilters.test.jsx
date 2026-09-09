import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  country: 'KSA',
  records: vi.fn(), sites: vi.fn(), summary: vi.fn(),
}))
vi.mock('../lib/api', () => ({ assets: {
  listFleetRecords: (...args) => h.records(...args),
  listSites: (...args) => h.sites(...args),
  getFleetSummary: (...args) => h.summary(...args),
} }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: h.country, activeCurrency: 'SAR' }), COUNTRIES: ['KSA', 'UAE'] }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Manager' } }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: key => key }) }))
vi.mock('../hooks/useReportMeta', () => ({ useReportMeta: () => ({}) }))
vi.mock('../hooks/useScrollRestore', () => ({ useScrollRestore: () => null }))
vi.mock('../components/ui/EnterpriseTable', () => ({ default: ({ data }) => <div data-testid="rows">{data.map(row => row.asset_no).join(',')}</div> }))
vi.mock('../components/ui/PageHeader', () => ({ default: () => null }))
vi.mock('../components/CustomFieldsPanel', () => ({ default: () => null }))
vi.mock('../lib/api/billing', () => ({ canAddResource: async () => true }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn() }))

import FleetMaster from '../pages/FleetMaster'

const summary = total => ({ total, active: total, missingSpecs: 0, noPolicy: 0, truncated: false })
function tree(url) { return <MemoryRouter initialEntries={[url]}><FleetMaster /></MemoryRouter> }
beforeEach(() => {
  h.country = 'KSA'
  h.records.mockReset().mockResolvedValue({ data: [], count: 0 })
  h.sites.mockReset().mockResolvedValue(['NHC'])
  h.summary.mockReset().mockResolvedValue(summary(2))
})

describe('Fleet Master filter transitions', () => {
  it('resets the old country site and page while retaining search and status', async () => {
    const url = '/fleet-master?site=NHC&page=3&search=Volvo&status=Active'
    const view = render(tree(url))
    await waitFor(() => expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ country: 'KSA', page: 2, site: 'NHC' })))
    h.country = 'UAE'
    view.rerender(tree(url))
    await waitFor(() => expect(h.records).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'UAE', page: 0, site: '', search: 'Volvo', status: 'Active' })))
  })

  it('does not restore the old country site options when its slow request finishes', async () => {
    let resolveOld
    h.sites.mockImplementation(({ country }) => country === 'KSA' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(['Dubai']))
    const view = render(tree('/fleet-master'))
    await waitFor(() => expect(h.sites).toHaveBeenCalled())
    h.country = 'UAE'
    view.rerender(tree('/fleet-master'))
    await screen.findByRole('option', { name: 'Dubai' })
    await act(async () => { resolveOld(['NHC']) })
    expect(screen.queryByRole('option', { name: 'NHC' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Dubai' })).toBeTruthy()
  })

  it('does not replace current summary cards with an old country response', async () => {
    const oldRequests = []
    h.summary.mockImplementation(({ country }) => country === 'KSA' ? new Promise(resolve => oldRequests.push(resolve)) : Promise.resolve(summary(42)))
    const view = render(tree('/fleet-master'))
    await waitFor(() => expect(oldRequests.length).toBeGreaterThan(0))
    h.country = 'UAE'
    view.rerender(tree('/fleet-master'))
    await waitFor(() => expect(screen.getAllByText('42')).toHaveLength(2))
    await act(async () => { oldRequests.forEach(resolve => resolve(summary(7))) })
    expect(screen.getAllByText('42')).toHaveLength(2)
    expect(screen.queryByText('7')).toBeNull()
  })

  it('hides prior summary figures until the new country request completes', async () => {
    h.summary.mockImplementation(({ country }) => country === 'KSA' ? Promise.resolve(summary(7)) : new Promise(() => {}))
    const view = render(tree('/fleet-master'))
    await waitFor(() => expect(screen.getAllByText('7')).toHaveLength(2))
    h.country = 'UAE'
    view.rerender(tree('/fleet-master'))
    expect(screen.queryByText('7')).toBeNull()
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('rejects an old record response during the search debounce', async () => {
    let resolveOld
    h.records.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue({ data: [{ id: 'new', asset_no: 'NEW' }], count: 1 })
    render(tree('/fleet-master'))
    await waitFor(() => expect(h.records).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByPlaceholderText('fleetmaster.filters.searchPlaceholder'), { target: { value: 'NEW' } })
    await act(async () => { resolveOld({ data: [{ id: 'old', asset_no: 'OLD' }], count: 1 }) })
    expect(screen.getByTestId('rows').textContent).not.toContain('OLD')
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('NEW'))
  })

  it('rejects an earlier country record response', async () => {
    let resolveOld
    h.records.mockImplementation(({ country }) => country === 'KSA'
      ? new Promise(resolve => { resolveOld = resolve })
      : Promise.resolve({ data: [{ id: 'uae', asset_no: 'UAE-1' }], count: 1 }))
    const view = render(tree('/fleet-master'))
    await waitFor(() => expect(h.records).toHaveBeenCalled())
    h.country = 'UAE'
    view.rerender(tree('/fleet-master'))
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('UAE-1'))
    await act(async () => { resolveOld({ data: [{ id: 'ksa', asset_no: 'KSA-1' }], count: 1 }) })
    expect(screen.getByTestId('rows').textContent).toBe('UAE-1')
  })

  it.each(['Infinity', '2.5', '-4'])('does not send an invalid page offset from page=%s', async page => {
    render(tree(`/fleet-master?page=${page}`))
    await waitFor(() => expect(h.records).toHaveBeenCalled())
    expect(h.records.mock.calls[0][0].page).toBe(0)
  })
})
