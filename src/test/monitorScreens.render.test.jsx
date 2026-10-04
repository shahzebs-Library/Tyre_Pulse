/**
 * Control Center MONITOR screens with real-shaped data: Error Center overview,
 * Alert Center, Analytics, Notifications and Operations. Checks the numbers the
 * RPCs return reach the screen, unknowns read N/A, emails stay masked, and the
 * dangerous actions go through a confirm dialog that asks for a reason.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null, Pie: () => null }))
vi.mock('../console/components/ui/charts', async (orig) => {
  const real = await orig()
  const Stub = ({ summary }) => <div data-testid="chart">{summary || null}</div>
  return { ...real, TrendChart: Stub, BarsChart: Stub, ShareChart: Stub, useChartTheme: () => 'dark' }
})

const api = vi.hoisted(() => ({
  getErrorGroups: vi.fn(), setErrorGroupState: vi.fn(), resolveErrorGroups: vi.fn(), getUserIssueSummary: vi.fn(),
  listOwnerProfiles: vi.fn(), getAlertInbox: vi.fn(), setAlertState: vi.fn(), getPlatformActivity: vi.fn(),
  getNotificationHealth: vi.fn(), getAnnouncementAudience: vi.fn(), getCronHealth: vi.fn(), getCronLastFailures: vi.fn(),
  setCronActive: vi.fn(), runCronNow: vi.fn(), listImportBatches: vi.fn(),
}))
vi.mock('../lib/api/monitorCenter', () => api)
vi.mock('../lib/api/alertRules', () => ({ listAlertRules: vi.fn(async () => [{ id: 'r1', metric: 'open_accidents', operator: 'gt', threshold: 3, notify_in_app: true, active: true }]), metricLabel: (k) => k }))
vi.mock('../lib/api/platformIncidents', () => ({ openIncident: vi.fn(async () => ({ id: 'i1' })) }))
vi.mock('../lib/api/metricRegistry', () => ({ listMetrics: vi.fn(async () => [{ metric_id: 'cpk', name: 'Cost per km', business_owner: 'Ops', refresh_sla: 'daily', calc_ref: 'x', dashboards: ['d'] }]) }))
vi.mock('../lib/api/systemConfig', () => ({ loadSystemConfig: vi.fn(async () => ({ push_notifications: 'true' })), saveSystemConfigValues: vi.fn(async () => []) }))
vi.mock('../lib/api/broadcast', () => ({ previewAudience: vi.fn(async () => ({ ok: true, total: 674, with_app: 77 })), sendBroadcast: vi.fn() }))
vi.mock('../lib/api/imports', () => ({ reverseBatch: vi.fn(async () => ({})) }))
vi.mock('../console/ConsoleAuthContext', () => ({ useConsoleAuth: () => ({ logAction: vi.fn(async () => {}) }) }))

import ErrorOverview from '../console/pages/errorCenter/ErrorOverview'
import ConsoleAlertCenter from '../console/pages/ConsoleAlertCenter'
import ConsoleAnalytics from '../console/pages/ConsoleAnalytics'
import ConsoleNotifications from '../console/pages/ConsoleNotifications'
import ConsoleOperations from '../console/pages/ConsoleOperations'

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>)

describe('Error Center overview', () => {
  it('shows totals, coverage and masked accounts, and resolves with a reason', async () => {
    api.getErrorGroups.mockResolvedValue({
      totals: { rows: 236, unresolved: 229, critical: 5, error: 47, warning: 82, info: 95, new_today: 5, new_today_errors: 0 },
      coverage: { web_errors: 47, web_errors_with_user: 47, android_crashes: 5, android_with_user: 0, all_rows: 236, all_with_user: 96, error_rows: 52, error_rows_with_user: 47 },
      customer_accounts: 725, accounts: [{ user_id: 'u1', email: 'w***@gmail.com', role: 'Admin', staff: true, events: 36, groups: 5, last_error: '2026-09-21' }],
      daily: [], groups: [{ key: 'g1', severity: 'error', surfaces: ['web'], sample: 'Cannot read toFixed', events: 14, unresolved_events: 14, staff: 1, customers: 0, last_seen: '2026-08-15' }],
    })
    api.getUserIssueSummary.mockResolvedValue(null)
    api.listOwnerProfiles.mockResolvedValue([])
    api.resolveErrorGroups.mockResolvedValue({ resolved: 1 })
    wrap(<ErrorOverview />)
    expect(await screen.findByText('229')).toBeTruthy()
    expect(screen.getByText('47 of 52')).toBeTruthy()
    expect(screen.getByText('0 of 5')).toBeTruthy()
    expect(screen.getByText('w***@gmail.com')).toBeTruthy()
    expect(screen.getByText(/Android crashes do not say who crashed/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select Cannot read toFixed'))
    fireEvent.click(screen.getByText('Resolve selected'))
    expect(await screen.findByText(/Reason \(goes to the audit log\)/)).toBeTruthy()
  })
  it('shows an error with Retry when the read fails', async () => {
    api.getErrorGroups.mockRejectedValue(new Error('The error groups could not be loaded.'))
    api.getUserIssueSummary.mockResolvedValue(null)
    api.listOwnerProfiles.mockResolvedValue([])
    wrap(<ErrorOverview />)
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
  })
})

describe('Alert Center', () => {
  it('lists alerts grouped and acknowledges one', async () => {
    api.getAlertInbox.mockResolvedValue({
      sources: { error_log: { unresolved: 229, critical: 5, routine: 177 }, crash: { total: 5, last_30d: 0, last_at: '2026-08-19' }, upload_gap: { total: 7, last_30d: 3 }, security: { failing: 2, high: 1 }, trust: { open: 0, resolved: 1 }, incidents: { open: 0, ever: 0 } },
      items: [{ key: 'crash|fatal', source: 'crash', severity: 'critical', title: '5 fatal Android app crashes', state: 'new', first_at: '2026-08-19' }],
    })
    api.listOwnerProfiles.mockResolvedValue([])
    api.setAlertState.mockResolvedValue({ ok: true })
    wrap(<ConsoleAlertCenter />)
    expect(await screen.findByText('5 fatal Android app crashes')).toBeTruthy()
    expect(screen.getByText('Needs a person (1)')).toBeTruthy()
    expect(screen.getByText(/177 of 229 error log rows \(77%\)/)).toBeTruthy()
    fireEvent.click(screen.getAllByText('Acknowledge')[0])
    await waitFor(() => expect(api.setAlertState).toHaveBeenCalledWith({ keys: ['crash|fatal'], action: 'acknowledge' }))
  })
})

describe('Analytics', () => {
  it('shows activity and the cohort', async () => {
    api.getPlatformActivity.mockResolvedValue({
      accounts: 727, signed_in: { d30: 118, d7: 17, never: 582 }, app_opened: { d30: 102, d7: 77 },
      cohort: { month: 'September', created: 682, ever_signed: 100, signed_7d: 8 }, by_role: [{ role: 'Driver', accounts: 674, active: 93, app: 77 }],
      by_country: [], by_org: [{ org_id: 'o1', name: 'Default Organisation', members: 726, active30: 118 }], daily: [], ai: { d30: 0, all: 39 }, ai_budget: null,
    })
    wrap(<ConsoleAnalytics />)
    expect((await screen.findAllByText('118')).length).toBeGreaterThan(0)
    expect(screen.getByText('682')).toBeTruthy()
    expect(screen.getByText('Remind inactive drivers')).toBeTruthy()
    expect(screen.getByText(/1 of 1 metrics certified/)).toBeTruthy()
  })
})

describe('Notifications', () => {
  it('shows delivery, bell read rate and asks before pausing push', async () => {
    api.getNotificationHealth.mockResolvedValue({
      workflow: { total: 1448, delivered: 1446, skipped: 2, failed: 0, pending: 0, people: 2650, p50_seconds: 120 },
      by_event: [{ event_type: 'inspection.approval_requested', status: 'delivered', messages: 922, people: 1986 }],
      bell: { sent_30d: 5772, read_30d: 886 }, bell_by_type: [], devices: { active: 130, seen_7d: 77, android: 130 }, by_version: [], reports: {}, announcements: { total: 1, showing: 0 },
    })
    wrap(<ConsoleNotifications />)
    expect((await screen.findAllByText('Inspection waiting for approval')).length).toBeGreaterThan(0)
    expect(screen.getByText(/886 of 5,772 \(15%\)/)).toBeTruthy()
    expect(screen.getByText('2.0 min')).toBeTruthy()
    fireEvent.click(await screen.findByText('Pause all push'))
    expect(await screen.findByText(/Stops every push message/)).toBeTruthy()
  })
})

describe('Operations', () => {
  it('shows outcome lines, repeats and jobs in Riyadh time', async () => {
    api.listImportBatches.mockResolvedValue([
      { id: 'b2', module: 'sco', country: 'KSA', import_status: 'committed', imported_rows: 672, created_at: '2026-08-09T09:24:00Z' },
      { id: 'b1', module: 'sco', country: 'KSA', import_status: 'committed', imported_rows: 672, created_at: '2026-08-08T09:00:00Z' },
      { id: 'b0', module: 'production', country: 'Egypt', import_status: 'failed', imported_rows: 0, created_at: '2026-08-15T09:00:00Z' },
    ])
    api.getCronHealth.mockResolvedValue({ jobs: [{ jobid: 1, jobname: 'nightly-backup', schedule: '30 0 * * *', active: true, runs_nd: 7, failed_nd: 0 }] })
    api.getCronLastFailures.mockResolvedValue({ items: [] })
    wrap(<ConsoleOperations />)
    expect(await screen.findAllByText(/Added 672 sco rows\./)).toHaveLength(2)
    expect(screen.getAllByText('Possible repeat').length).toBeGreaterThan(0)
    expect(screen.getByText('Daily 03:30')).toBeTruthy()
    expect(screen.getAllByText(/Rows read: not recorded/).length).toBe(3)
    fireEvent.click(screen.getAllByText('Undo import')[0])
    expect(await screen.findByLabelText('Type UNDO to confirm')).toBeTruthy()
  })
})
