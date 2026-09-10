import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
const h = vi.hoisted(() => ({ country: 'KSA', language: 'en', profile: {}, load: vi.fn(), people: vi.fn(), sites: vi.fn(), roles: vi.fn(), save: vi.fn(), publish: vi.fn(), retire: vi.fn(), simulate: vi.fn(), events: vi.fn() }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: h.country }), COUNTRIES: ['KSA', 'UAE'] }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: h.language, isRTL: h.language === 'ar' }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: h.profile }) }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title, actions }) => <header><h1>{title}</h1>{actions}</header> }))
vi.mock('../components/ui/TablePagination', () => ({ default: () => null, usePagedRows: rows => ({ pageRows: rows }) }))
vi.mock('../lib/api/approvalMatrix', () => ({ listApprovalPolicies: h.load, listApprovalPeople: h.people, listApprovalRoles: h.roles, saveApprovalPolicy: h.save, publishApprovalPolicy: h.publish, retireApprovalPolicy: h.retire, simulateApprovalPolicy: h.simulate, listApprovalPolicyEvents: h.events }))
vi.mock('../lib/api/sites', () => ({ listSites: h.sites }))
import ApprovalMatrix from '../pages/ApprovalMatrix'
const draft = { id: 'p1', name: 'Inspection approval', entity_type: 'inspection', priority: 0, version: 1, state: 'draft', updated_at: 'stamp', match_country: 'KSA', stages: [{ name: 'Supervisor', approver_role: 'Manager', require_signature: true, prevent_self_approval: true, distinct_reviewer: true }], change_reason: 'New governance' }
beforeEach(() => {
  vi.clearAllMocks(); h.country = 'KSA'; h.language = 'en'
  h.profile = { id: 'admin', org_id: 'org', role: 'Admin' }
  h.load.mockResolvedValue([draft]); h.people.mockResolvedValue([{ id: 'u1', full_name: 'Reviewer One', role: 'Manager', countries: ['KSA'], sites: ['West'] }]); h.sites.mockResolvedValue([{ id: 's1', name: 'West', country: 'KSA' }, { id: 's2', name: 'East', country: 'UAE' }]); h.roles.mockResolvedValue(['Manager']); h.events.mockResolvedValue([])
})
describe('governed Approval Matrix', () => {
  it('clears administration state and stops reading when administrator permission is revoked', async () => {
    const { rerender } = render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    h.load.mockClear()
    h.profile = { ...h.profile, role: 'Driver' }
    rerender(<ApprovalMatrix />)
    expect(screen.getByRole('alert')).toHaveTextContent('Only an active administrator')
    expect(screen.queryByText('Inspection approval')).not.toBeInTheDocument()
    expect(h.load).not.toHaveBeenCalled()
  })
  it('loads the workspace for an active Super Admin without an Admin role', async () => {
    h.profile = { ...h.profile, role: 'Director', is_super_admin: true }
    render(<ApprovalMatrix />)
    expect(await screen.findByRole('button', { name: 'Edit draft' })).toBeEnabled()
  })
  it.each([[-1, null], [10001, null], [0, 1.5], [0, 8761]])('rejects priority %s and SLA %s outside the server contract', async (priority, sla) => {
    render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    const editor = within(screen.getByRole('region', { name: 'Policy draft' }))
    fireEvent.change(editor.getByLabelText(/^Priority/), { target: { value: priority } })
    if (sla != null) fireEvent.change(editor.getByLabelText(/^SLA/), { target: { value: sla } })
    fireEvent.click(editor.getByRole('button', { name: 'Save draft' }))
    expect(screen.getByRole('status')).toHaveTextContent('Priority must be')
    expect(h.save).not.toHaveBeenCalled()
  })
  it('blocks an already opened publication review after the draft is edited', async () => {
    render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish', exact: true }))
    const review = within(screen.getByRole('region', { name: 'Review policy change' }))
    fireEvent.change(review.getByLabelText('Change reason'), { target: { value: 'Reviewed' } })
    fireEvent.change(screen.getByLabelText('Policy name'), { target: { value: 'Unsaved routing' } })
    expect(review.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(review.getByRole('alert')).toHaveTextContent('Save changes')
    expect(h.publish).not.toHaveBeenCalled()
  })
  it('does not send a selected draft to simulation for another module', async () => {
    render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    const simulation = within(screen.getByRole('region', { name: 'Routing simulation' }))
    fireEvent.click(simulation.getByLabelText('Include the saved draft'))
    fireEvent.change(simulation.getByLabelText('Module'), { target: { value: 'work_order' } })
    expect(simulation.getByRole('button', { name: 'Simulate' })).toBeDisabled()
    expect(simulation.getByText(/Select the same module/)).toBeInTheDocument()
    expect(h.simulate).not.toHaveBeenCalled()
  })
  it('preserves an explicit reviewer independence choice in saved drafts', async () => {
    h.save.mockResolvedValue(draft)
    render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    fireEvent.click(screen.getByLabelText('Different reviewer from earlier stages'))
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ stages: [expect.objectContaining({ distinct_reviewer: false })] }), 'stamp'))
  })
  it('does not turn a missing backend into an empty policy list or allow configuration', async () => {
    h.load.mockRejectedValue({ code: '42P01' }); render(<ApprovalMatrix />)
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
    expect(screen.getByRole('button', { name: 'New policy' })).toBeDisabled()
    expect(screen.queryByText(/No policies match/)).not.toBeInTheDocument()
  })
  it('fails closed when reference people cannot be verified', async () => {
    h.people.mockRejectedValue(new Error('denied')); render(<ApprovalMatrix />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified')
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  })
  it('requires review and a reason before publishing with the loaded concurrency token', async () => {
    h.publish.mockResolvedValue({ ...draft, state: 'published' }); render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish', exact: true }))
    expect(h.publish).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Reviewed by policy owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(h.publish).toHaveBeenCalledWith(draft, 'Reviewed by policy owner', null))
  })
  it('requires a different administrator to publish the author?s draft', async () => {
    h.load.mockResolvedValue([{ ...draft, created_by: 'admin' }]); render(<ApprovalMatrix />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish', exact: true }))
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Reviewed' } })
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(screen.getByText('A different authorised administrator must publish this draft.')).toBeInTheDocument()
  })
  it('offers the verified pre-execution adapters in policy drafts and simulation', async () => {
    render(<ApprovalMatrix />); fireEvent.click(await screen.findByRole('button', { name: 'New policy' }))
    const editor = within(screen.getByRole('region', { name: 'Policy draft' }))
    expect(editor.getByRole('option', { name: 'Work order execution' })).toHaveValue('work_order')
    expect(editor.getByRole('option', { name: 'Tyre operation execution' })).toHaveValue('tyre_change')
  })
  it('limits sites by country and clears the selection when country changes', async () => {
    render(<ApprovalMatrix />); fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    const editor = within(screen.getByRole('region', { name: 'Policy draft' }))
    const site = editor.getByLabelText(/Site/)
    expect(within(site).queryByRole('option', { name: 'East' })).toBeNull()
    fireEvent.change(site, { target: { value: 'West' } })
    fireEvent.change(editor.getByLabelText('Country'), { target: { value: 'UAE' } })
    expect(site.value).toBe(''); expect(within(site).getByRole('option', { name: 'East' })).toBeTruthy()
  })
  it('discards stale simulation responses after context changes', async () => {
    let resolve; h.simulate.mockImplementation(() => new Promise(r => { resolve = r }))
    const { rerender } = render(<ApprovalMatrix />); await screen.findByRole('button', { name: 'Edit draft' })
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }))
    // Context changes are driven by the shared country selector even during a request.
    h.country = 'UAE'
    rerender(<ApprovalMatrix />)
    await act(async () => resolve({ mode: 'enforced', status: 'matched', policy: { ...draft, name: 'STALE ROUTE' }, candidates: [] }))
    expect(screen.queryByText(/STALE ROUTE/)).not.toBeInTheDocument()
  })
  it('renders the complete workspace in Arabic and RTL', async () => {
    h.language = 'ar'; const { container } = render(<ApprovalMatrix />)
    await screen.findByRole('button', { name: 'تعديل المسودة' })
    expect(screen.getByRole('heading', { name: 'مصفوفة الموافقات' })).toBeTruthy()
    expect(container.firstChild).toHaveAttribute('dir', 'rtl')
  })
})
