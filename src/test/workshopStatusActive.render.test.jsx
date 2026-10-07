import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import en from '../locales/en/workshopStatus.json'
import common from '../locales/en/common.json'

// Workshop Status -> Active vehicles (Loop 7). The real view engine and kit
// render; only the workshop API, settings and the permission RPC are mocked.

const DICT = { workshopStatus: en, common }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
const settings = vi.hoisted(() => ({ country: 'KSA' }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: settings.country }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))

const perms = vi.hoisted(() => ({ value: { view: true, update: true, export: true } }))
vi.mock('../lib/api/workshopStatusPermissions', () => ({
  loadMyWorkshopPermissions: vi.fn(async () => ({ permissions: perms.value, error: null })),
}))
vi.mock('../lib/api/workshopStatusActive', () => ({ loadActiveVehicles: vi.fn() }))
vi.mock('../lib/api/workshopStatus', () => ({
  listActiveRecords: vi.fn(async () => []),
  findPreviousUploadByHash: vi.fn(),
  stageUpload: vi.fn(),
  confirmUpload: vi.fn(),
  cancelUpload: vi.fn(async () => ({})),
  buildStagedRows: vi.fn(() => []),
}))

import ActiveVehiclesPanel from '../components/workshopStatus/ActiveVehiclesPanel'
import WorkshopStatus from '../pages/WorkshopStatus'
import { loadActiveVehicles } from '../lib/api/workshopStatusActive'

const pad = (n) => String(n).padStart(2, '0')
const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const nowIso = new Date().toISOString()

const ROWS = [
  { id: 'r1', asset_no: 'TM100', country: 'KSA', site: 'NHC', complaint: 'Brake noise', ooc_since: dayAgo(20), current_stage: 'Waiting for Parts', delay_reason: 'MR Pending', parts_status: 'MR Raised', next_action: 'Chase MR', responsible_user_id: 'u1', responsible_name: 'Ahmed Khan', last_manual_update_at: nowIso, last_updated_by_name: 'Ahmed Khan', last_update_source: 'manual', work_done: 'Pads removed' },
  { id: 'r2', asset_no: 'TM200', country: 'KSA', site: 'Diriyah', complaint: 'Engine', ooc_since: dayAgo(2), current_stage: 'Repair in Progress', last_updated_by_name: 'Upload Bot', excel_updated_at: nowIso, last_update_source: 'excel' },
]

function renderPanel(props = {}) {
  return render(
    <ActiveVehiclesPanel permissions={perms.value} permState="ready" onUpdate={props.onUpdate ?? vi.fn()} {...props} />,
  )
}
const table = () => screen.getByRole('table')

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  settings.country = 'KSA'
  perms.value = { view: true, update: true, export: true }
  loadActiveVehicles.mockResolvedValue({ rows: ROWS, truncated: false })
})

describe('Active vehicles panel', () => {
  it('lists the active vehicles with the system-captured last update', async () => {
    renderPanel()
    await screen.findByRole('table')
    expect(loadActiveVehicles).toHaveBeenCalledWith({ country: 'KSA' })
    const t = within(table())
    expect(t.getByText('TM100')).toBeTruthy()
    expect(t.getByText('TM200')).toBeTruthy()
    expect(t.getAllByText('Ahmed Khan').length).toBeGreaterThan(0)
    expect(t.getByText('Never updated by a person')).toBeTruthy()
    expect(screen.getByText('Showing 2 of 2 active vehicles.')).toBeTruthy()
  })

  it('shows the country column and loads every country on All', async () => {
    settings.country = 'All'
    renderPanel()
    await screen.findByRole('table')
    expect(loadActiveVehicles).toHaveBeenCalledWith({ country: '' })
    expect(within(table()).getByRole('columnheader', { name: 'Country' })).toBeTruthy()
  })

  it('searches and filters', async () => {
    renderPanel()
    await screen.findByRole('table')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'engine' } })
    expect(within(table()).queryByText('TM100')).toBeNull()
    expect(within(table()).getByText('TM200')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const filters = within(screen.getByTestId('wks-av-filters'))
    fireEvent.change(filters.getByLabelText('Current stage'), { target: { value: 'Waiting for Parts' } })
    expect(within(table()).getByText('TM100')).toBeTruthy()
    expect(within(table()).queryByText('TM200')).toBeNull()
    fireEvent.click(filters.getByRole('button', { name: 'Clear filters' }))
    expect(within(table()).getByText('TM200')).toBeTruthy()
  })

  it('applies a KPI preset (down more than 14 days)', async () => {
    renderPanel()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: /Down more than 14 days/ }))
    expect(within(table()).getByText('TM100')).toBeTruthy()
    expect(within(table()).queryByText('TM200')).toBeNull()
  })

  it('expands a row to show the remaining fields', async () => {
    renderPanel()
    await screen.findByRole('table')
    fireEvent.click(within(table()).getByRole('button', { name: 'Show details for TM100' }))
    expect(within(table()).getByText('Pads removed')).toBeTruthy()
  })

  it('shows Update only with the update permission and calls onUpdate', async () => {
    const onUpdate = vi.fn()
    renderPanel({ onUpdate })
    await screen.findByRole('table')
    fireEvent.click(within(table()).getByRole('button', { name: 'Update TM100' }))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))
    cleanup()

    perms.value = { view: true, update: false }
    renderPanel({ permissions: perms.value })
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /Update TM/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Export Excel/ })).toBeNull()
  })

  it('reloads when reloadKey changes', async () => {
    const { rerender } = renderPanel({ reloadKey: 0 })
    await screen.findByRole('table')
    expect(loadActiveVehicles).toHaveBeenCalledTimes(1)
    rerender(<ActiveVehiclesPanel permissions={perms.value} permState="ready" onUpdate={vi.fn()} reloadKey={1} />)
    await waitFor(() => expect(loadActiveVehicles).toHaveBeenCalledTimes(2))
  })

  it('shows the empty state', async () => {
    loadActiveVehicles.mockResolvedValue({ rows: [], truncated: false })
    renderPanel()
    expect(await screen.findByText('No vehicles in the workshop report')).toBeTruthy()
  })

  it('shows an error with Retry and recovers', async () => {
    loadActiveVehicles.mockRejectedValueOnce(new Error('relation "x" does not exist'))
    renderPanel()
    expect(await screen.findByText('The workshop list could not be loaded')).toBeTruthy()
    expect(screen.queryByText(/relation/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByRole('table')).toBeTruthy()
  })

  it('denies the list without the view permission', async () => {
    renderPanel({ permissions: { view: false } })
    expect(screen.getByText('You cannot view the workshop list')).toBeTruthy()
    expect(loadActiveVehicles).not.toHaveBeenCalled()
  })
})

describe('Workshop Status page', () => {
  it('opens on the Active vehicles tab by default', async () => {
    render(<MemoryRouter><WorkshopStatus /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Active vehicles' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('table')).toBeTruthy()
  })
})
