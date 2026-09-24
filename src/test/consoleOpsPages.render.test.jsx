/**
 * Render contract for the console operations pages after their move onto the
 * shared console UI kit and chart components: System Health, Automation Health,
 * Delivery, Self-Healing, Alert Rules and Crash Reports.
 *
 * Charts are stubbed (they need a canvas); what is asserted is the data each
 * page hands them and the workflow bugs fixed during the conversion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../console/components/ui/charts', () => {
  const pal = { critical: '#f00', high: '#f80', medium: '#fa0', low: '#999', good: '#0f0' }
  return {
    TrendChart: ({ labels = [], series = [], summary }) => (
      <div data-testid="trend" data-days={labels.length} data-series={series.map((s) => s.label).join('|')}>{summary}</div>
    ),
    BarsChart: ({ summary }) => <div data-testid="bars">{summary}</div>,
    ShareChart: ({ summary }) => <div data-testid="share">{summary}</div>,
    ScoreRing: ({ score }) => <div data-testid="ring">{score === null || score === undefined ? 'N/A' : score}</div>,
    STATUS: { dark: pal, light: pal },
    SERIES: { dark: ['#1', '#2', '#3'], light: ['#1', '#2', '#3'] },
    useChartTheme: () => 'dark',
  }
})
vi.mock('../console/ConsoleAuthContext', () => ({ useConsoleAuth: () => ({ admin: { full_name: 'Ops' } }) }))

const h = vi.hoisted(() => {
  const today = new Date().toISOString()
  return {
    today,
    resolveSystemLog: vi.fn(() => Promise.reject(Object.assign(new Error('permission denied for table system_logs'), { code: '42501' }))),
    trendRows: [
      { id: '1', created_at: today, severity: 'critical' },
      { id: '2', created_at: today, severity: 'error' },
      { id: '3', created_at: today, severity: 'warn' },
    ],
    listCronJobs: vi.fn(() => Promise.reject(new Error('boom'))),
    applyBackfillOrphan: vi.fn(() => Promise.resolve(1)),
    deleteAlertRule: vi.fn(() => Promise.resolve()),
    listPushLog: vi.fn(() => Promise.reject(new Error('network down'))),
  }
})

vi.mock('../lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { channel: () => channel, removeChannel: () => {} } }
})
vi.mock('../lib/fetchAll', () => ({
  fetchAllPages: () => Promise.resolve({ data: h.trendRows, error: null, truncated: false }),
}))
vi.mock('../lib/api/systemLogs', () => ({
  listSystemLogs: () => Promise.resolve([
    { id: 'log-1', severity: 'error', module_id: 'tyres', message: 'Something broke', created_at: h.today, resolved: false },
  ]),
  resolveSystemLog: h.resolveSystemLog,
  resolveAllSystemLogs: vi.fn(() => Promise.resolve(1)),
  getHealthMetrics: () => Promise.resolve({
    latestByStream: { tyre_records: h.today },
    errors: { unresolvedCritical: 0, unresolvedError: 1 },
    ai: { total: 3, errors: 0 },
    reports: { total: 2, failed: 0 },
    logsByDay: [],
  }),
}))
vi.mock('../lib/systemHealth', () => ({
  runAllChecks: () => Promise.resolve({
    checkedAt: h.today,
    summary: { ok: 1, degraded: 0, down: 0, unknown: 0, total: 1 },
    checks: [{ id: 'database', group: 'database', label: 'Database', status: 'ok', latencyMs: 40 }],
  }),
}))
vi.mock('../lib/api/automationHealth', async () => {
  const actual = await vi.importActual('../lib/api/automationHealth')
  return {
    ...actual,
    listSchedules: () => Promise.resolve([
      { id: 's1', name: 'Weekly fleet', report_type: 'fleet', frequency: 'weekly', active: true, next_run_at: '2000-01-01T00:00:00Z' },
      { id: 's2', name: 'Paused one', report_type: 'kpi', frequency: 'daily', active: false },
    ]),
    listCronJobs: h.listCronJobs,
  }
})
vi.mock('../lib/api/deliveryHealth', async () => {
  const actual = await vi.importActual('../lib/api/deliveryHealth')
  return {
    ...actual,
    listEmailLog: () => Promise.resolve([
      { id: 'e1', status: 'sent', sent_at: h.today, report_type: 'fleet' },
      { id: 'e2', status: 'error', sent_at: h.today, schedule_name: 'Weekly fleet', error: 'Bounced' },
    ]),
    listPushLog: h.listPushLog,
    pushReach: () => Promise.resolve(4),
  }
})
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), reportFileName: () => 'x' }))
vi.mock('../lib/api/selfHealing', () => ({
  runScans: () => Promise.resolve({
    orphans: [{ asset_no: 'TM999', vehicle_type: 'TR-MIXER', tyre_count: 2 }],
    duplicates: [], serialConflicts: [], staleRows: [],
  }),
  scanAnomalies: () => Promise.resolve([]),
  applyBackfillOrphan: h.applyBackfillOrphan,
  applyBackfillAllOrphans: vi.fn(() => Promise.resolve(1)),
  applyMergeDuplicate: vi.fn(() => Promise.resolve(1)),
  logHealFinding: () => {},
}))
vi.mock('../lib/api/alertRules', async () => {
  const actual = await vi.importActual('../lib/api/alertRules')
  return {
    ...actual,
    listAlertRules: () => Promise.resolve([
      { id: 'r1', name: 'Risky tyres', metric: 'high_risk_tyres', operator: 'gte', threshold: 5, active: true, triggered_count: 3, notify_in_app: true },
      { id: 'r2', name: 'PM overdue', metric: 'pm_overdue', operator: 'gt', threshold: 1, active: false, triggered_count: 0 },
    ]),
    createAlertRule: vi.fn(() => Promise.resolve()),
    updateAlertRule: vi.fn(() => Promise.resolve()),
    toggleAlertRule: vi.fn(() => Promise.resolve()),
    deleteAlertRule: h.deleteAlertRule,
  }
})
vi.mock('../lib/api/sentryCrashes', () => ({
  getSentryStatus: () => Promise.resolve({ configured: true, org: 'acme' }),
  saveSentryConfig: vi.fn(() => Promise.resolve()),
  listSentryIssues: () => Promise.resolve({
    ok: true,
    issues: [
      { id: 'i1', shortId: 'APP-1', title: 'Crash in scanner', level: 'fatal', status: 'unresolved', count: 12, userCount: 3 },
      { id: 'i2', shortId: 'APP-2', title: 'Null ref', level: 'error', status: 'unresolved', count: 5, userCount: 1 },
      { id: 'i3', shortId: 'APP-3', title: 'Another null', level: 'error', status: 'unresolved', count: 2, userCount: 1 },
    ],
  }),
  getSentryProjects: () => Promise.resolve({ ok: true, projects: [] }),
  getSentryIssueDetail: () => Promise.resolve({ ok: true, event: null, activity: [] }),
  updateSentryIssue: vi.fn(() => Promise.resolve({ ok: true })),
  getSentryMembers: () => Promise.resolve({ ok: true, members: [] }),
  assignSentryIssue: vi.fn(() => Promise.resolve({ ok: true })),
  commentSentryIssue: vi.fn(() => Promise.resolve({ ok: true })),
}))

import ConsoleSystemHealth from '../console/pages/ConsoleSystemHealth'
import ConsoleAutomation from '../console/pages/ConsoleAutomation'
import ConsoleDelivery from '../console/pages/ConsoleDelivery'
import ConsoleSelfHealing from '../console/pages/ConsoleSelfHealing'
import ConsoleAlertRules from '../console/pages/ConsoleAlertRules'
import ConsoleCrashReports from '../console/pages/ConsoleCrashReports'

beforeEach(() => cleanup())

describe('console operations pages on the kit', () => {
  it('System Health splits the error trend by severity and says when a resolve fails', async () => {
    render(<ConsoleSystemHealth />)
    expect(await screen.findByText('Something broke')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('trend').dataset.series).toBe('Critical|Error|Warning'))
    expect(screen.getByTestId('trend').dataset.days).toBe('14')
    expect(screen.getByTestId('bars').textContent).toMatch(/Critical 1, Error 1, Warning 1, Info 0/)
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    // Used to be swallowed silently; a failed resolve is now stated, in plain words.
    const err = await screen.findByText(/permission/i)
    expect(err.textContent).not.toMatch(/system_logs/)
  })

  it('Automation states a failed cron read instead of an empty job list', async () => {
    render(<ConsoleAutomation />)
    expect(await screen.findByText('Weekly fleet')).toBeTruthy()
    expect(screen.getByTestId('share').textContent).toMatch(/Overdue 1, Paused 1/)
    expect(screen.getAllByText('Jobs could not be read').length).toBeGreaterThan(0)
    expect(screen.queryByText('No background jobs are visible')).toBeNull()
  })

  it('Delivery draws a continuous day axis and flags a failed push read', async () => {
    render(<ConsoleDelivery />)
    expect(await screen.findByText('Bounced')).toBeTruthy()
    const trend = screen.getByTestId('trend')
    expect(Number(trend.dataset.days)).toBe(31)
    expect(trend.dataset.series).toBe('Sent|Failed')
    expect(screen.getByText('Push notifications could not be read')).toBeTruthy()
  })

  it('Self-Healing confirms a fix in a dialog and keeps the success notice after the rescan', async () => {
    render(<ConsoleSelfHealing />)
    expect(await screen.findByText('TM999')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Backfill' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Apply fix/ }))
    await waitFor(() => expect(h.applyBackfillOrphan).toHaveBeenCalledWith('TM999'))
    expect(await screen.findByText(/was added to the fleet list/)).toBeTruthy()
  })

  it('Alert Rules charts rules per metric and deletes only after confirmation', async () => {
    render(<ConsoleAlertRules />)
    expect(await screen.findByText('Risky tyres')).toBeTruthy()
    expect(screen.getAllByTestId('bars')[0].textContent).toMatch(/High-risk tyres 1/)
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0])
    expect(h.deleteAlertRule).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /Delete rule/ }))
    await waitFor(() => expect(h.deleteAlertRule).toHaveBeenCalledWith('r1'))
  })

  it('Crash Reports charts issues by level', async () => {
    render(<ConsoleCrashReports />)
    expect(await screen.findByText('Crash in scanner')).toBeTruthy()
    expect(screen.getAllByTestId('bars')[0].textContent).toBe('Fatal 1, Error 2')
  })
})
