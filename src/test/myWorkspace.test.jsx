import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const h = vi.hoisted(() => ({ grants: new Set(), status: {}, country: 'KSA', profile: { id: 'supervisor', role: 'Fleet Supervisor', site: 'JEDDAH' }, count: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: h.profile, hasPermission: key => h.grants.has(key), moduleStatus: key => h.status[key] || 'live' }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: h.country }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: text => text }) }))
vi.mock('../lib/api/workspace', () => ({ loadWorkspaceCount: h.count }))
import MyWorkspace from '../pages/MyWorkspace'
import { WorkspaceNavigationContext } from '../contexts/WorkspaceNavigationContext'
import { executiveHomeAllowed } from '../lib/workspaceAccess'
const items = [{ to: '/vehicle-washing', label: 'Vehicle Washing' }, { to: '/fleet-master', label: 'Fleet Master' }, { to: '/inspections', label: 'Inspections' }]
const view = () => <MemoryRouter><WorkspaceNavigationContext.Provider value={items}><MyWorkspace /></WorkspaceNavigationContext.Provider></MemoryRouter>
beforeEach(() => { h.profile = { id: 'supervisor', role: 'Fleet Supervisor', site: 'JEDDAH' }; h.grants = new Set(['vehicle_washing']); h.status = {}; h.country = 'KSA'; h.count.mockReset().mockResolvedValue(4) })
describe('permission-scoped home', () => {
  it('shows Data Monitor permitted modules without loading revoked dashboard summaries', () => {
    h.profile = { id: 'monitor', role: 'Data Monitor Officer' }
    h.grants = new Set(['inspections', 'work_orders', 'serial_tracker', 'accidents'])
    render(view())
    expect(screen.getByRole('link', { name: 'Inspections' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Fleet Master' })).toBeNull()
    expect(h.count).not.toHaveBeenCalled()
  })
  it('provides permitted shortcuts without any summary reads when Dashboard is off', () => {
    render(view())
    expect(screen.getByRole('link', { name: 'Vehicle Washing' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Fleet Master' })).toBeNull()
    expect(h.count).not.toHaveBeenCalled()
  })
  it('requests only summaries for permitted, live modules', async () => {
    h.grants = new Set(['dashboard', 'vehicle_washing', 'fleet_master']); h.status.fleet_master = 'disabled'
    render(view())
    await screen.findByText('Accessible wash records: 4')
    expect(h.count).toHaveBeenCalledTimes(1)
    expect(h.count).toHaveBeenCalledWith('vehicle_washing', expect.objectContaining({ country: 'KSA' }))
    expect(screen.queryByText('Fleet Master')).toBeNull()
  })
  it('aborts old requests and removes data immediately after revocation', async () => {
    h.grants.add('dashboard')
    let finish
    h.count.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const page = render(view())
    const signal = h.count.mock.calls[0][1].signal
    h.grants.delete('vehicle_washing'); page.rerender(view())
    expect(signal.aborted).toBe(true)
    await act(async () => finish(900))
    expect(screen.queryByText(/900/)).toBeNull()
    expect(screen.queryByText('Vehicle Washing')).toBeNull()
  })
  it('clears old country counts and cancels pending requests on scope switch', async () => {
    h.grants.add('dashboard')
    h.count.mockImplementation(() => new Promise(() => {}))
    const page = render(view())
    const signal = h.count.mock.calls[0][1].signal
    h.country = 'UAE'; h.count.mockResolvedValue(2); page.rerender(view())
    expect(signal.aborted).toBe(true)
    await screen.findByText('Accessible wash records: 2')
  })
  it('keeps the unrestricted dashboard out of operational and revoked accounts', () => {
    const auth = { profile: h.profile, hasPermission: () => true }
    expect(executiveHomeAllowed(auth)).toBe(false)
    expect(executiveHomeAllowed({ ...auth, profile: { role: 'Admin' } })).toBe(true)
    expect(executiveHomeAllowed({ ...auth, profile: { role: 'Admin' }, hasPermission: () => false })).toBe(false)
    expect(executiveHomeAllowed({ ...auth, loading: true })).toBe(false)
  })
})
