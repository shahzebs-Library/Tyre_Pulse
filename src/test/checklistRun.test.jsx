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
// A drivable stand-in for the signature pad: it renders only while open (the
// real one is a modal), shows which signature is being asked for, and saves a
// data URL that identifies it. That is what makes a MULTI-signature sheet
// testable at all.
vi.mock('../components/SignaturePad', () => ({
  default: ({ label, onSave }) => (
    <button type="button" onClick={() => onSave(`data:image/png;base64,SIG-${label}`)}>
      capture-signature
    </button>
  ),
}))
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

// The Green Concrete workshop sheet is signed off by three trades: mechanic,
// auto electrician, and the engineer certifying the machine fit for operation.
const THREE_SIGNATURES = {
  id: 't1', name: 'Workshop Daily TM Inspection', version: 1, require_signature: false,
  fields: [
    { id: 'q1', type: 'text', label: 'Job card', required: false },
    { id: 'sig_mech', type: 'signature', label: 'Mechanic signature', required: true },
    { id: 'sig_elec', type: 'signature', label: 'Auto electrician signature' },
    { id: 'sig_insp', type: 'signature', label: 'Inspector signature', required: true },
  ],
}

describe('multiple signatures', () => {
  it('keeps every signature: capturing one does not overwrite another', async () => {
    TEMPLATE = THREE_SIGNATURES
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })

    // Sign all three, one after another.
    for (let i = 0; i < 3; i += 1) {
      const pads = screen.getAllByRole('button', { name: /Add signature/i })
      fireEvent.click(pads[0])
      fireEvent.click(await screen.findByRole('button', { name: /capture-signature/i }))
    }

    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    const payload = createSubmission.mock.calls[0][0]

    // All three survive, each under its own field id, each distinct.
    expect(Object.keys(payload.signatures).sort()).toEqual(['sig_elec', 'sig_insp', 'sig_mech'])
    expect(payload.signatures.sig_mech).toContain('Mechanic signature')
    expect(payload.signatures.sig_elec).toContain('Auto electrician signature')
    expect(payload.signatures.sig_insp).toContain('Inspector signature')
    expect(new Set(Object.values(payload.signatures)).size).toBe(3)

    // signature_data keeps its meaning as the single primary sign-off, so every
    // existing reader and export is unchanged.
    expect(payload.signature_data).toBe(payload.signatures.sig_mech)
    expect(payload.printed_name).toBe('Sam')
  })

  it('blocks submit until every REQUIRED signature is given, and names the missing one', async () => {
    TEMPLATE = THREE_SIGNATURES
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })

    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(screen.getByText(/Mechanic signature is required/i)).toBeInTheDocument())
    expect(screen.getByText(/Inspector signature is required/i)).toBeInTheDocument()
    // The optional one is never demanded.
    expect(screen.queryByText(/Auto electrician signature is required/i)).toBeNull()
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('records a remark per line, keeping only lines that were actually written on', async () => {
    TEMPLATE = {
      id: 't1', name: 'Fleet', version: 1, require_signature: false,
      fields: [
        { id: 'q1', type: 'select', label: 'Brakes', options: ['OK', 'Not OK'], allow_note: true },
        { id: 'q2', type: 'select', label: 'Lights', options: ['OK', 'Not OK'], allow_note: true },
        { id: 'q3', type: 'text', label: 'Plain line' },
      ],
    }
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })

    // Only lines with allow_note get a remarks box.
    const boxes = screen.getAllByPlaceholderText(/Remarks/i)
    expect(boxes).toHaveLength(2)

    fireEvent.change(boxes[0], { target: { value: '  Pads worn, replaced  ' } })
    fireEvent.change(boxes[1], { target: { value: '   ' } })   // whitespace only

    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    const payload = createSubmission.mock.calls[0][0]

    // Trimmed, and a blank box is not stored as an observation.
    expect(payload.notes).toEqual({ q1: 'Pads worn, replaced' })
  })
})

describe('reading language', () => {
  const LEGEND = ['OK', 'Not OK', 'Not applicable']
  const TRANSLATED = {
    id: 't1', name: 'Workshop sheet', version: 1, require_signature: false,
    name_i18n: { ar: 'AR sheet' },
    option_sets: { legend: { options: LEGEND, i18n: { ar: ['AR OK', 'AR Not OK', 'AR N/A'] } } },
    fields: [
      {
        id: 'q1', type: 'select', label: 'Grill and bumpers',
        labels: { ar: 'AR Grill' }, options: LEGEND, options_ref: 'legend', required: true,
      },
    ],
  }

  it('offers only the languages the template really carries', async () => {
    TEMPLATE = { id: 't1', name: 'Plain', version: 1, fields: [{ id: 'q1', type: 'text', label: 'A' }] }
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })
    // No translations means no picker: every option would render English.
    expect(screen.queryByRole('button', { name: 'العربية' })).toBeNull()
  })

  it('switches labels and options to the reader language but STORES THE ENGLISH ANSWER', async () => {
    TEMPLATE = TRANSLATED
    render(<ChecklistRun />)
    await screen.findByRole('button', { name: /Submit checklist/i })

    // English first.
    expect(screen.getByText('Grill and bumpers')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'العربية' }))
    await waitFor(() => expect(screen.getByText('AR Grill')).toBeInTheDocument())
    // The option a fitter reads is Arabic...
    expect(screen.getByRole('option', { name: 'AR Not OK' })).toBeInTheDocument()

    // ...and the value behind it is the English token.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Not OK' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit checklist/i }))
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(createSubmission.mock.calls[0][0].answers.q1).toBe('Not OK')
  })
})
