import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  decideChecklist: vi.fn(),
  getMySignature: vi.fn(),
  saveMySignature: vi.fn(),
  clearMySignature: vi.fn(),
  role: { current: 'Admin' },
}))

vi.mock('../lib/api/approvalsQueue', () => ({ decideChecklist: h.decideChecklist }))
vi.mock('../lib/api/userSignature', () => ({
  getMySignature: h.getMySignature,
  saveMySignature: h.saveMySignature,
  clearMySignature: h.clearMySignature,
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: h.role.current, is_super_admin: false } }),
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, lang: 'en' }),
}))

const { default: ChecklistDecisionPanel } = await import('../components/checklist/ChecklistDecisionPanel')

const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L9 9"/></svg>'

const PENDING = { id: 'sub-1', approval_status: 'pending', answers: {}, title: 'Workshop Daily' }

beforeEach(() => {
  h.decideChecklist.mockReset().mockResolvedValue({ ok: true, decision: 'approved', status: 'approved' })
  h.getMySignature.mockReset().mockResolvedValue(SVG_A)
  h.saveMySignature.mockReset().mockImplementation((v) => Promise.resolve(v))
  h.role.current = 'Admin'
})

describe('ChecklistDecisionPanel - deciding where the sheet is read', () => {
  it('PRE-FILLING A SIGNATURE RECORDS NOTHING - the person still has to press approve', async () => {
    // This is the whole safety property of the saved signature. The mark is
    // loaded and shown; nothing reaches decide_checklist_approval until the
    // button is pressed.
    render(<ChecklistDecisionPanel submission={PENDING} />)
    await screen.findByText('signature.field.savedInUse')
    expect(h.decideChecklist).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('signature.decide.approve'))
    await waitFor(() => expect(h.decideChecklist).toHaveBeenCalledTimes(1))
    expect(h.decideChecklist.mock.calls[0][1].signature).toBe(SVG_A)
  })

  it('writes through the guarded RPC service, never a direct table update', async () => {
    render(<ChecklistDecisionPanel submission={PENDING} />)
    await screen.findByText('signature.field.savedInUse')
    fireEvent.click(screen.getByText('signature.decide.approve'))
    await waitFor(() => expect(h.decideChecklist).toHaveBeenCalled())
    const [id, decision] = h.decideChecklist.mock.calls[0]
    expect(id).toBe('sub-1')
    expect(decision.approved).toBe(true)
    expect(decision.currentStatus).toBe('pending')
  })

  it('refuses to approve with no signature at all, and says why', async () => {
    h.getMySignature.mockResolvedValue(null)
    render(<ChecklistDecisionPanel submission={PENDING} />)
    await screen.findByTestId('signature-capture')
    expect(screen.getByText('signature.decide.needSignature')).toBeInTheDocument()
    fireEvent.click(screen.getByText('signature.decide.approve'))
    await new Promise((r) => setTimeout(r, 0))
    expect(h.decideChecklist).not.toHaveBeenCalled()
  })

  it('returning for correction needs a note and never sends a signature', async () => {
    render(<ChecklistDecisionPanel submission={PENDING} />)
    await screen.findByText('signature.field.savedInUse')

    fireEvent.click(screen.getByText('signature.decide.return'))
    await screen.findByText('signature.decide.needNote')
    expect(h.decideChecklist).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('signature.decide.note'), { target: { value: 'Fix item 3' } })
    fireEvent.click(screen.getByText('signature.decide.return'))
    await waitFor(() => expect(h.decideChecklist).toHaveBeenCalled())
    const decision = h.decideChecklist.mock.calls[0][1]
    expect(decision.approved).toBe(false)
    expect(decision.signature).toBeNull()
  })

  it('renders nothing on a sheet nobody is waiting on', () => {
    const { container } = render(
      <ChecklistDecisionPanel submission={{ ...PENDING, approval_status: 'approved' }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('does not offer a button to a role that cannot give this sign-off', async () => {
    h.role.current = 'Reporter'
    render(<ChecklistDecisionPanel submission={PENDING} />)
    expect(await screen.findByText('signature.decide.notYours')).toBeInTheDocument()
    expect(screen.queryByTestId('checklist-decision-panel')).toBeNull()
  })
})
