import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Runtime guards for filling + submitting a checklist. Uses the REAL fieldTypes
// engine (validateSubmission) so the page's validation wiring is exercised end
// to end; only the data/context/navigation seams are mocked.

const nav = vi.fn()
const createSubmission = vi.fn(() => Promise.resolve({ id: 's1' }))
let TEMPLATE = null

vi.mock('react-router-dom', () => ({
  useParams: () => ({ templateId: 't1' }),
  useNavigate: () => nav,
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}))
vi.mock('../lib/api/checklistSchedules', () => ({ completeAssignment: vi.fn(() => Promise.resolve()) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', full_name: 'Sam', role: 'Manager' } }) }))
vi.mock('../components/SignaturePad', () => ({ default: () => null }))
vi.mock('../lib/api/checklists', () => ({
  getTemplate: () => Promise.resolve(TEMPLATE),
  createSubmission: (...a) => createSubmission(...a),
  uploadChecklistPhoto: () => Promise.resolve('https://cdn/x.jpg'),
}))

import ChecklistRun from '../pages/ChecklistRun'

beforeEach(() => { nav.mockClear(); createSubmission.mockClear() })

describe('ChecklistRun submit guards', () => {
  it('blocks submit when a required field is empty', async () => {
    TEMPLATE = { id: 't1', name: 'Daily', version: 1, require_signature: false, fields: [{ id: 'q1', type: 'text', label: 'Notes', required: true }] }
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })
    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(screen.getByText(/correct the highlighted fields/i)).toBeInTheDocument())
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('submits a valid checklist and navigates to the new submission', async () => {
    TEMPLATE = { id: 't1', name: 'Daily', version: 1, require_signature: false, fields: [{ id: 'q1', type: 'text', label: 'Notes', required: false }] }
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })
    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    const payload = createSubmission.mock.calls[0][0]
    expect(payload.template_id).toBe('t1')
    expect(payload.status).toBe('submitted')
    await waitFor(() => expect(nav).toHaveBeenCalledWith(expect.stringMatching(/\/checklists\/submission\/s1/)))
  })

  it('blocks submit when a signature is required but not captured', async () => {
    TEMPLATE = { id: 't1', name: 'Daily', version: 1, require_signature: true, fields: [{ id: 'q1', type: 'text', label: 'Notes', required: false }] }
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })
    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(screen.getByText(/signature is required/i)).toBeInTheDocument())
    expect(createSubmission).not.toHaveBeenCalled()
  })
})
