import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, todayStr } from '../lib/inspectionPlanner'

const h = vi.hoisted(() => ({
  country: 'KSA', language: 'en', permitted: true, load: vi.fn(), save: vi.fn(), cancel: vi.fn(), remove: vi.fn(),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: h.country, appSettings: {} }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', role: 'Admin' }, loading: false,
  hasPermission: () => h.permitted, hasCapability: () => h.permitted, moduleStatus: () => 'live' }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ orgId: 'org', branding: null }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: h.language, isRTL: h.language === 'ar', t: key => key }) }))
vi.mock('../hooks/useFeatureFlags', () => ({ useFeatureGate: () => true }))
vi.mock('../hooks/useEntityWorkflow', () => ({ useEntityWorkflow: () => ({ loading: false, error: null, isActive: false, isLocked: false }) }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="site-chart" /> }))
vi.mock('../lib/api/inspectionPlanner', () => ({ loadPlannerData: h.load, savePlannerSchedules: h.save, updateScheduleStatus: h.cancel, deletePlannerSchedule: h.remove }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => null }))
vi.mock('../lib/exportUtils', () => ({ resolvePdfBrand: vi.fn(), pdfHeader: vi.fn(), pdfFooter: vi.fn(), pdfEmptyState: vi.fn(), pdfTableTheme: vi.fn() }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title, subtitle, actions, onRefresh, refreshing }) => <header>
  <h1>{title}</h1><p>{subtitle}</p><button onClick={onRefresh} disabled={refreshing}>Refresh planner</button>{actions}
</header> }))
import InspectionPlanner from '../pages/InspectionPlanner'

const today = todayStr()
function bundle(asset = 'OLD', country = 'KSA') {
  return {
    inspections: [{ id: `reading-${asset}`, asset_no: asset, inspection_date: addDays(today, -45), inspector_name: 'Inspector A', country, site: 'North' }],
    tyreRecords: [{ id: 'tyre', asset_no: 'NEVER', country, site: 'North', risk_level: 'Low' }],
    schedule: [], dataError: null, scheduleError: null, truncated: false,
  }
}
const view = () => <MemoryRouter><InspectionPlanner /></MemoryRouter>

beforeEach(() => {
  h.country = 'KSA'; h.language = 'en'; h.permitted = true
  h.load.mockReset().mockResolvedValue(bundle())
  h.save.mockReset().mockResolvedValue([{ id: 'saved' }])
  h.cancel.mockReset().mockResolvedValue([{ id: 'cancelled' }])
  h.remove.mockReset().mockResolvedValue([{ id: 'removed' }])
})

describe('Inspection Planner workspace integration', () => {
  it('refreshes the whole planner and replaces the visible queue', async () => {
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    h.load.mockResolvedValue(bundle('REFRESHED'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh planner' }))
    await screen.findByText('REFRESHED', { selector: 'a, span' })
    expect(screen.queryByText('OLD', { selector: 'a, span' })).not.toBeInTheDocument()
    expect(h.load).toHaveBeenCalledTimes(2)
    expect(h.load.mock.calls[1][0].country).toBe('KSA')
    expect(h.load.mock.calls[1][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts old country work, clears selection, and ignores a late response', async () => {
    let resolveOld
    h.load.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(bundle('UAE-ONLY', 'UAE'))
    const { rerender } = render(view())
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(1))
    const oldSignal = h.load.mock.calls[0][0].signal
    h.country = 'UAE'
    rerender(view())
    await screen.findByText('UAE-ONLY', { selector: 'a, span' })
    expect(oldSignal.aborted).toBe(true)
    await act(async () => resolveOld(bundle('LATE-KSA')))
    expect(screen.queryByText('LATE-KSA')).not.toBeInTheDocument()
    expect(screen.getByText('UAE-ONLY', { selector: 'a, span' })).toBeInTheDocument()
  })

  it('shows unavailable history rather than a healthy empty queue', async () => {
    h.load.mockResolvedValue({ ...bundle(), inspections: [], tyreRecords: [], dataError: 'History unavailable' })
    render(view())
    await screen.findAllByText(/History unavailable/i)
    expect(screen.queryByText('All vehicles are on schedule.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Schedule inspection/i })).toBeDisabled()
  })

  it('separates never-inspected vehicles from overdue dates', async () => {
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    fireEvent.click(screen.getByRole('button', { name: /Never inspected/i }))
    expect(screen.getByText('NEVER', { selector: 'a, span' })).toBeInTheDocument()
    expect(screen.queryByText('OLD', { selector: 'a, span' })).not.toBeInTheDocument()
    expect(screen.queryByText(/99[0-9]{2}\s*d/)).not.toBeInTheDocument()
  })

  it('requires a specific country before creating appointments', async () => {
    h.country = 'All'
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    expect(screen.getByRole('button', { name: /Schedule inspection/i })).toBeDisabled()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('does not infer completed appointments from nearby inspection readings', async () => {
    h.load.mockResolvedValue({ ...bundle(), tyreRecords: [],
      inspections: [{ id: 'i1', asset_no: 'OLD', country: 'KSA', site: 'North', inspection_date: today, inspector_name: 'Inspector A' }],
      schedule: [
        { id: 'due', asset_no: 'OLD', country: 'KSA', inspection_date: today, status: 'Scheduled' },
        { id: 'cancelled', asset_no: 'OLD', country: 'KSA', inspection_date: today, status: 'Cancelled' },
        { id: 'future', asset_no: 'OLD', country: 'KSA', inspection_date: addDays(today, 1), status: 'Completed' },
      ] })
    render(view())
    await waitFor(() => expect(screen.getByRole('button', { name: /Schedule inspection/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analytics', exact: true }))
    const completionCard = screen.getByRole('heading', { name: 'Schedule completion this month' }).parentElement
    expect(within(completionCard).getByText('0%')).toBeInTheDocument()
    const coverageCard = screen.getByRole('heading', { name: 'Known-asset inspection coverage' }).parentElement
    expect(within(coverageCard).getByText('100%')).toBeInTheDocument()
  })

  it('filters actual appointments without adding duplicate inspection-reading entries', async () => {
    h.load.mockResolvedValue({ ...bundle(), schedule: [
      { id: 's1', asset_no: 'SCHEDULED', country: 'KSA', inspection_date: today, inspector_name: 'Inspector A', status: 'Scheduled' },
      { id: 's2', asset_no: 'CANCELLED', country: 'KSA', inspection_date: today, inspector_name: 'Inspector B', status: 'Cancelled' },
    ] })
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    fireEvent.click(screen.getByRole('button', { name: 'Agenda', exact: true }))
    expect(screen.getAllByRole('article')).toHaveLength(2)
    fireEvent.change(screen.getByRole('combobox', { name: /Appointment status/ }), { target: { value: 'Scheduled' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('SCHEDULED')).toBeInTheDocument()
    expect(screen.queryByText('CANCELLED')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search asset or site'), { target: { value: 'missing' } })
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('shows unavailable appointments instead of claiming a vehicle has no schedule', async () => {
    h.load.mockResolvedValue({ ...bundle(), scheduleError: 'Could not load the schedule.' })
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    const queue = screen.getByRole('region', { name: 'Inspection work queue' })
    expect(within(queue).getByText('Schedule unavailable')).toBeInTheDocument()
    expect(within(queue).queryByText('Not scheduled')).not.toBeInTheDocument()
  })

  it('renders Arabic queue copy and direction', async () => {
    h.language = 'ar'
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    expect(screen.getByRole('heading', { name: 'مخطط الفحص' }).closest('[dir]')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('region', { name: 'قائمة أعمال الفحص' })).toBeInTheDocument()
  })

  it('keeps API save errors inside the scheduling dialog', async () => {
    h.save.mockRejectedValue(new Error('The change could not be confirmed. Refresh and check your access before trying again.'))
    render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    fireEvent.click(screen.getByRole('button', { name: /Schedule inspection/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Asset/ }), { target: { value: 'OLD' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Inspector/ }), { target: { value: 'Inspector A' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be confirmed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  it('does not load planner records after access is revoked', async () => {
    const { rerender } = render(view())
    await screen.findByText('OLD', { selector: 'a, span' })
    h.permitted = false
    rerender(view())
    expect(screen.queryByText('OLD', { selector: 'a, span' })).not.toBeInTheDocument()
    expect(h.load).toHaveBeenCalledTimes(1)
    expect(h.load.mock.calls[0][0].signal.aborted).toBe(true)
  })
})
