import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

// Charts need a real canvas; the render contract here is the page, not chart.js.
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../console/components/ui/charts', () => ({
  ShareChart: ({ summary }) => <div data-testid="share-chart">{summary}</div>,
  STATUS: { dark: { good: '#0f0', medium: '#fa0', critical: '#f00', low: '#999' }, light: { good: '#0f0', medium: '#fa0', critical: '#f00', low: '#999' } },
  useChartTheme: () => 'dark',
}))
vi.mock('../console/ConsoleAuthContext', () => ({
  useConsoleAuth: () => ({ admin: { full_name: 'Ops Admin' }, logAction: () => Promise.reject(new Error('audit down')) }),
}))
vi.mock('../components/Layout', () => ({
  NAV_CATALOG: [
    { key: 'ops', label: 'Operations', items: [{ to: '/dashboard', label: 'Dashboard' }, { to: '/assets', label: 'Assets' }] },
  ],
}))

const h = vi.hoisted(() => ({
  modules: [
    { module_id: 'dashboard', name: 'Dashboard', category: 'Core', status: 'live', visible_to: 'all' },
    { module_id: 'assets', name: 'Assets', category: 'Fleet', status: 'maintenance', visible_to: 'all', maintenance_note: 'Upgrade' },
    { module_id: 'ai', name: 'AI', category: 'Core', status: 'disabled', visible_to: 'admin_only' },
  ],
}))
vi.mock('../lib/api/modulesRegistry', () => ({
  listModules: () => Promise.resolve(h.modules),
  seedFromCatalog: () => Promise.resolve(),
  setModuleStatus: vi.fn(() => Promise.resolve()),
  bulkSetStatus: vi.fn(() => Promise.resolve()),
  dependencyWarnings: () => [],
  MODULE_STATUS_META: {
    live: { label: 'Live' }, maintenance: { label: 'Maintenance' }, disabled: { label: 'Off' }, beta: { label: 'Beta' },
  },
}))
vi.mock('../lib/moduleCatalog', () => ({ buildNavModuleCatalog: () => [] }))
vi.mock('../lib/api/navLayout', () => ({
  getNavLayout: () => Promise.resolve({}),
  saveNavLayout: vi.fn(() => Promise.resolve()),
}))
vi.mock('../lib/api/vehicleDiagrams', () => ({
  listVehicleDiagramConfigs: () => Promise.resolve([]),
  upsertVehicleDiagramConfig: vi.fn(() => Promise.resolve({ id: 'x', vehicle_type: 'TR-MIXER', active: true })),
  deleteVehicleDiagramConfig: vi.fn(() => Promise.resolve()),
  invalidateCustomLayouts: () => {},
  canonVehicleTypeKey: (v) => String(v || '').trim().toUpperCase(),
}))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: () => Promise.resolve({ data: [{ vehicle_type: 'TR-MIXER' }], error: null }) }))
vi.mock('../components/VehicleDiagramCustomBody', () => ({
  CustomDiagramPreview: ({ layout }) => <svg data-testid="vd-preview" data-tyres={layout?.tyres?.length} />,
}))
vi.mock('../lib/api/brandLogo', () => ({
  getCompanyLogo: () => Promise.resolve(''),
  setCompanyLogo: vi.fn(() => Promise.resolve()),
  getDiagramBg: () => Promise.resolve('#112233'),
  setDiagramBg: vi.fn(() => Promise.resolve({ ok: true })),
}))
vi.mock('../lib/supabase', () => {
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: { value: '"vivid"' }, error: null }),
    upsert: () => Promise.resolve({ error: null }),
  }
  return { supabase: { from: () => chain } }
})

import ConsoleModuleControl from '../console/pages/ConsoleModuleControl'
import ConsoleNavigation from '../console/pages/ConsoleNavigation'
import ConsoleVehicleDesigner from '../console/pages/ConsoleVehicleDesigner'
import ConsoleReportAppearance from '../console/pages/ConsoleReportAppearance'

beforeEach(() => cleanup())

describe('console configuration pages render on the kit', () => {
  it('Module Control shows status counts, the share chart and filters by status', async () => {
    render(<ConsoleModuleControl />)
    expect(await screen.findByText('Dashboard')).toBeTruthy()
    expect(screen.getByTestId('share-chart').textContent).toMatch(/1 live, 1 in maintenance, 1 off/)
    // Status filter via the segmented control narrows the board.
    fireEvent.click(screen.getAllByRole('button', { name: /^Off/ })[0])
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.getByText('AI')).toBeTruthy()
  })

  it('Navigation Customizer renders groups and the live preview', async () => {
    render(<ConsoleNavigation />)
    expect(await screen.findByText('Live preview')).toBeTruthy()
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0)
  })

  it('Vehicle Designer renders the builder and its live SVG preview', async () => {
    render(<ConsoleVehicleDesigner />)
    expect(await screen.findByText('No custom designs yet')).toBeTruthy()
    expect(Number(screen.getByTestId('vd-preview').getAttribute('data-tyres'))).toBeGreaterThan(0)
  })

  it('a failing audit log does not turn a saved design into an error', async () => {
    render(<ConsoleVehicleDesigner />)
    await screen.findByText('No custom designs yet')
    fireEvent.change(screen.getByLabelText('Vehicle type name'), { target: { value: 'tr-mixer' } })
    fireEvent.click(screen.getByRole('button', { name: /Save design/ }))
    expect(await screen.findByText(/Design saved/)).toBeTruthy()
  })

  it('Report Appearance renders the three sections', async () => {
    render(<ConsoleReportAppearance />)
    expect(await screen.findByText('Chart colour theme')).toBeTruthy()
    expect(screen.getByText('Company logo')).toBeTruthy()
    expect(screen.getByText('Inspection diagram background')).toBeTruthy()
  })
})
