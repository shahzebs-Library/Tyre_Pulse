/**
 * Behaviour guards for the restructured platform/ops console pages:
 *  - System Configuration shows a never-saved key at the default the app uses
 *    (labelled "Not set"), keeps enforcement badges derived from
 *    ENFORCEMENT_STATUS, and writes ONLY the keys that changed.
 *  - Mobile App Control (Flutter app) judges the forced-update minimum against the SAVED
 *    newest release, so an unsaved higher release cannot unlock it, and a
 *    failed settings read disables saving.
 *  - Tabs deep-link through ?tab=.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ rows: [], upserts: [], mobile: null, devices: null }))

vi.mock('../console/components/ui/charts', () => ({
  TrendChart: () => null, BarsChart: () => null, ShareChart: () => null, useChartTheme: () => 'dark',
}))
vi.mock('../console/ConsoleAuthContext', () => ({
  useConsoleAuth: () => ({ logAction: () => Promise.resolve() }),
}))
vi.mock('../console/pages/config/FxRatesPanel', () => ({ default: () => <div>FX panel</div> }))
vi.mock('../lib/supabase', () => {
  const chain = {
    select: () => Promise.resolve({ data: h.rows, error: null }),
    upsert: (rows) => { h.upserts.push(rows); return Promise.resolve({ error: null }) },
  }
  return { supabase: { from: () => chain } }
})
vi.mock('../lib/api/mobileOps', () => ({
  getMobileOps: () => Promise.resolve(h.mobile),
  getFlutterOps: () => Promise.resolve(h.mobile),
  setFlutterVersion: vi.fn(() => Promise.resolve()),
  listFlutterVersionHistory: () => Promise.resolve([]),
  setMobileMinVersion: vi.fn(() => Promise.resolve()),
  setMobileLatestVersion: vi.fn(() => Promise.resolve()),
}))
vi.mock('../console/pages/mobileApp/deviceVersions', () => ({
  getDeviceVersions: () => Promise.resolve(h.devices),
  getFlutterDeviceVersions: () => Promise.resolve(h.devices),
}))

import ConsoleSystemConfig from '../console/pages/ConsoleSystemConfig'
import ConsoleMobileApp from '../console/pages/ConsoleMobileApp'

const at = (path, el) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>)

beforeEach(() => { cleanup(); h.upserts = [] })

describe('System Configuration', () => {
  it('shows a never-saved key at the app default, labelled Not set', async () => {
    h.rows = [{ key: 'maintenance_mode', value: 'false' }]
    at('/console/config', <ConsoleSystemConfig />)
    expect(await screen.findByText('Open registration')).toBeTruthy()
    const sw = screen.getByRole('switch', { name: 'Open registration' })
    expect(sw.getAttribute('aria-checked')).toBe('true') // CONFIG_DEFAULTS.registration_open
    expect(screen.getAllByText(/Not set, default On/).length).toBeGreaterThan(0)
  })

  it('marks a saved-only key as saved only (derived from ENFORCEMENT_STATUS)', async () => {
    h.rows = []
    at('/console/config?tab=ai', <ConsoleSystemConfig />)
    const label = await screen.findByText('Default AI model')
    const row = label.closest('div.flex-1')
    expect(within(row).getByText('Saved only')).toBeTruthy()
  })

  it('reviews and writes only the changed keys', async () => {
    h.rows = [{ key: 'maintenance_mode', value: 'false' }, { key: 'max_upload_rows', value: '100000' }]
    at('/console/config', <ConsoleSystemConfig />)
    const input = await screen.findByRole('spinbutton', { name: 'Max upload rows' })
    fireEvent.change(input, { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /Review 1 change/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await screen.findByRole('button', { name: /Saved/ })
    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0].map((r) => r.key)).toEqual(['max_upload_rows'])
  })

  it('refuses a negative number in review', async () => {
    h.rows = [{ key: 'max_upload_rows', value: '100000' }]
    at('/console/config', <ConsoleSystemConfig />)
    const input = await screen.findByRole('spinbutton', { name: 'Max upload rows' })
    fireEvent.change(input, { target: { value: '-4' } })
    fireEvent.click(screen.getByRole('button', { name: /Review 1 change/ }))
    const save = await screen.findByRole('button', { name: 'Save changes' })
    expect(save.disabled).toBe(true)
  })

  it('deep links to the stored keys tab', async () => {
    h.rows = [{ key: 'nav_layout', value: '{}' }]
    at('/console/config?tab=stored', <ConsoleSystemConfig />)
    expect(await screen.findByText('nav_layout')).toBeTruthy()
  })
})

describe('Mobile App Control interlock', () => {
  it('refuses a minimum above the SAVED release even when a higher release is typed but not saved', async () => {
    h.mobile = { minVersion: '1.5.0', latestVersion: '1.6.0', configOk: true, activeDevices: 1, usersWithPush: 1 }
    h.devices = { total: 3, active: 3, revoked: 0, seen7d: 3, seen30d: 3, users: 3, byVersion: [{ app_version: '1.6.0', devices: 2, seen_30d: 2 }, { app_version: '1.5.0', devices: 1, seen_30d: 1 }] }
    const { unmount } = at('/console/mobile-app?tab=releases', <ConsoleMobileApp />)
    const latest = await screen.findByPlaceholderText('e.g. 0.1.1')
    fireEvent.change(latest, { target: { value: '1.9.0' } })
    unmount()
    at('/console/mobile-app?tab=gate', <ConsoleMobileApp />)
    const min = await screen.findByPlaceholderText(/blank = gate off/)
    fireEvent.change(min, { target: { value: '1.8.0' } })
    expect(screen.getByText(/Refused:/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save rule' }).disabled).toBe(true)
  })

  it('previews how many devices a minimum would block', async () => {
    h.mobile = { minVersion: '', latestVersion: '1.6.0', configOk: true, activeDevices: 1, usersWithPush: 1 }
    h.devices = { total: 3, active: 3, revoked: 0, seen7d: 3, seen30d: 3, users: 3, byVersion: [{ app_version: '1.6.0', devices: 2, seen_30d: 2 }, { app_version: '1.5.0', devices: 1, seen_30d: 1 }] }
    at('/console/mobile-app?tab=gate', <ConsoleMobileApp />)
    const min = await screen.findByPlaceholderText(/blank = gate off/)
    fireEvent.change(min, { target: { value: '1.6.0' } })
    expect(screen.getByText(/1 of 3 active devices would see the update screen/)).toBeTruthy()
  })

  it('a failed settings read disables saving and never shows "Gate off"', async () => {
    h.mobile = { minVersion: '', latestVersion: '', configOk: false, activeDevices: null, usersWithPush: null }
    h.devices = { total: 0, active: 0, revoked: 0, seen7d: 0, seen30d: 0, users: 0, byVersion: [] }
    at('/console/mobile-app?tab=gate', <ConsoleMobileApp />)
    expect(await screen.findByText(/Could not read the app settings/)).toBeTruthy()
    expect(screen.queryByText('Gate off')).toBeNull()
    expect(screen.getByPlaceholderText(/blank = gate off/).disabled).toBe(true)
  })
})

describe('Mobile App Control is the Flutter app', () => {
  it('names the Flutter package and shows the retired Expo gate read-only', async () => {
    h.mobile = { minVersion: '', latestVersion: '0.1.0', configOk: true, retired: { minVersion: '1.6.0', latestVersion: '1.6.0' } }
    h.devices = { total: 0, active: 0, revoked: 0, seen7d: 0, seen30d: 0, users: 0, expoActive: 130, byVersion: [] }
    at('/console/mobile-app?tab=retired', <ConsoleMobileApp />)
    expect(await screen.findByText('Retired app (read-only)')).toBeTruthy()
    expect(screen.getAllByText(/com\.shahzebrahman\.tyrepulse\b/).length).toBeGreaterThan(0)
    expect(screen.getByText('130')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('raising the minimum asks for a reason and the typed version', async () => {
    h.mobile = { minVersion: '', latestVersion: '0.1.1', configOk: true, retired: {} }
    h.devices = { total: 1, active: 1, revoked: 0, seen7d: 1, seen30d: 1, users: 1, expoActive: 0, byVersion: [{ app_version: '0.1.0', devices: 1, seen_30d: 1 }] }
    at('/console/mobile-app?tab=gate', <ConsoleMobileApp />)
    const min = await screen.findByPlaceholderText(/blank = gate off/)
    fireEvent.change(min, { target: { value: '0.1.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByText('Force Flutter phones to update?')).toBeTruthy()
    expect(screen.getByLabelText('Type 0.1.1 to confirm')).toBeTruthy()
    expect(screen.getByPlaceholderText('Why are you doing this?')).toBeTruthy()
  })
})
