import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LiabilityPaymentPanel from '../components/accidents/LiabilityPaymentPanel'
import { FAULT_TILES, PAYER_TILES, AUTHORITY_ROWS, RESPONSIBILITY_DOCS } from '../lib/accidentCaseVocab'

// The panel is UI over the liability / evidence / communications services - all
// mocked. The vocabulary (accidentCaseVocab) and the pure docs engine
// (responsibilityDocs) run for real so the tile/row/document inventory is true
// to the mock screen M3.

const getMeta = vi.fn()
const saveAssessment = vi.fn()
const saveFieldAudit = vi.fn()
const listReports = vi.fn(() => Promise.resolve([]))
const saveReport = vi.fn((_a, type, patch) => Promise.resolve({ authority_type: type, ...patch }))
vi.mock('../lib/api/accidentLiability', async () => {
  const real = await vi.importActual('../lib/api/accidentLiability')
  return {
    ...real,
    getLiabilityAssessmentWithMeta: (...a) => getMeta(...a),
    saveLiabilityAssessment: (...a) => saveAssessment(...a),
    approveLiabilityAssessment: vi.fn(),
    saveFieldAudit: (...a) => saveFieldAudit(...a),
    listAuthorityReports: (...a) => listReports(...a),
    saveAuthorityReport: (...a) => saveReport(...a),
  }
})
vi.mock('../lib/api/_client', () => ({ isMissingColumn: (e) => String(e?.code) === '42703' }))

const listEvidence = vi.fn(() => Promise.resolve([]))
vi.mock('../lib/api/accidentEvidence', () => ({
  listEvidence: (...a) => listEvidence(...a),
  addEvidence: vi.fn(),
  verifyEvidence: vi.fn(),
}))

const logCommunication = vi.fn(() => Promise.resolve({ id: 'c1' }))
vi.mock('../lib/api/accidentCommunications', () => ({ logCommunication: (...a) => logCommunication(...a) }))

vi.mock('../lib/api/accidentCase', () => ({ listWorkstreams: () => Promise.resolve([]) }))
vi.mock('../lib/api/accidentSla', () => ({ listSlaInstances: () => Promise.resolve([]) }))
vi.mock('../lib/api/users', () => ({
  listProfiles: () => Promise.resolve([
    { id: 'u1', full_name: 'Sara Khan', role: 'Fleet Supervisor' },
    { id: 'u2', full_name: 'Omar Ali', role: 'Insurance Officer' },
  ]),
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me', full_name: 'Ajay Kumar', role: 'Manager' } }) }))
vi.mock('../components/accidents/NotifyRecipientsPanel', () => ({ default: () => null }))

const workstreams = [
  { workstream_key: 'liability', owner_id: 'u1', owner_role: 'Fleet Supervisor', team: 'Fleet' },
  { workstream_key: 'insurance', owner_id: 'u2', owner_role: 'Insurance Officer', team: 'Insurance' },
]

beforeEach(() => {
  vi.clearAllMocks()
  getMeta.mockResolvedValue({ assessment: null, parityProvisioned: true })
  listReports.mockResolvedValue([])
  listEvidence.mockResolvedValue([])
  saveAssessment.mockImplementation((_id, patch) => Promise.resolve({ id: 'la1', accident_id: 'a1', ...patch }))
})

describe('LiabilityPaymentPanel (mock M3)', () => {
  it('renders the workstream header owner line plus all four sections field for field', async () => {
    render(<LiabilityPaymentPanel accidentId="a1" elevated acc={{}} workstreams={workstreams} />)
    expect(await screen.findByText('1. Who was at fault?')).toBeInTheDocument()
    expect(screen.getByText('Sara Khan | Insurance review: Omar Ali')).toBeInTheDocument()
    for (const t of FAULT_TILES) expect(screen.getByRole('button', { name: t.label })).toBeInTheDocument()
    expect(FAULT_TILES).toHaveLength(5)
    for (const p of PAYER_TILES) expect(screen.getByRole('button', { name: p.label })).toBeInTheDocument()
    expect(PAYER_TILES).toHaveLength(6)
    for (const r of AUTHORITY_ROWS) expect(screen.getByText(r.label)).toBeInTheDocument()
    expect(AUTHORITY_ROWS).toHaveLength(7)
    for (const d of RESPONSIBILITY_DOCS) expect(screen.getByText(d.label)).toBeInTheDocument()
    expect(screen.getByTestId('docs-counter')).toHaveTextContent('0 of 6 required documents')
    expect(screen.getByText('(Optional)')).toBeInTheDocument()
    expect(screen.getByText('Provisional until authority/insurer confirmation.')).toBeInTheDocument()
    expect(screen.getByText('Fault status')).toBeInTheDocument()
    expect(screen.getByText('GCC liability %')).toBeInTheDocument()
    expect(screen.getByText('Other-party liability %')).toBeInTheDocument()
    expect(screen.getByText('Fault party')).toBeInTheDocument()
    expect(screen.getByText('Payer')).toBeInTheDocument()
    expect(screen.getByText('Responsible company')).toBeInTheDocument()
    expect(screen.getByText('Recovery required')).toBeInTheDocument()
    expect(screen.getByText('Save responsibility details')).toBeInTheDocument()
    expect(screen.getByText('Request missing Taqdeer document')).toBeInTheDocument()
    // No "Continue" without a navigation handler; no Taqdeer warning while not required.
    expect(screen.queryByText(/Continue to damage mapping/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('taqdeer-warning')).not.toBeInTheDocument()
    expect(screen.queryByTestId('parity-note')).not.toBeInTheDocument()
  })

  it('derives fault status + liability split from the tile and payer / recovery from the payer tile', async () => {
    render(<LiabilityPaymentPanel accidentId="a1" elevated acc={{}} workstreams={workstreams} />)
    await screen.findByText('1. Who was at fault?')
    fireEvent.click(screen.getByRole('button', { name: 'Other party' }))
    expect(screen.getByText('Non-faulty')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Our driver / GCC' }))
    expect(screen.getByText('Faulty')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Under investigation' }))
    expect(screen.getByText('Under review')).toBeInTheDocument()
    // Shared fault opens both percentages for editing.
    fireEvent.click(screen.getByRole('button', { name: 'Shared fault' }))
    expect(screen.getByLabelText('GCC liability %')).toHaveValue(50)
    expect(screen.getByLabelText('Other-party liability %')).toHaveValue(50)
    // Payer -> recovery required derived (Yes for other-party insurance).
    fireEvent.click(screen.getByRole('button', { name: 'Other party insurance' }))
    expect(screen.getByText('Derived from payer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes', pressed: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'GCC / company' }))
    expect(screen.getByRole('button', { name: 'No', pressed: true })).toBeInTheDocument()
  })

  it('stamps recorded_by from the signed-in profile when a third-party value is saved', async () => {
    render(<LiabilityPaymentPanel accidentId="a1" elevated acc={{}} workstreams={workstreams} />)
    await screen.findByText('1. Who was at fault?')
    fireEvent.change(screen.getByLabelText('Third-party plate'), { target: { value: '1234 ABC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Other party insurance' }))
    fireEvent.click(screen.getByText('Save responsibility details'))
    await waitFor(() => expect(saveAssessment).toHaveBeenCalledTimes(1))
    const [, patch] = saveAssessment.mock.calls[0]
    expect(patch.third_party_plate).toBe('1234 ABC')
    expect(patch.payer).toBe('other_party_insurance')
    expect(patch.field_audit.third_party_plate.recorded_by).toBe('Ajay Kumar')
    expect(patch.field_audit.payer.recorded_by).toBe('Ajay Kumar')
    expect(patch.field_audit.third_party_driver).toBeUndefined()
    // After save the Recorded by column shows the stamp.
    expect(await screen.findAllByText('Ajay Kumar')).not.toHaveLength(0)
  })

  it('shows the Taqdeer warning when required and the document is missing, and logs an in-app request', async () => {
    getMeta.mockResolvedValue({
      assessment: { id: 'la1', accident_id: 'a1', liability_type: 'third_party_full', our_liability_pct: 0, third_party_pct: 100, taqdeer_required: true, field_audit: {} },
      parityProvisioned: true,
    })
    render(<LiabilityPaymentPanel accidentId="a1" elevated acc={{}} workstreams={workstreams} />)
    expect(await screen.findByTestId('taqdeer-warning')).toHaveTextContent(
      'Insurance claim can be drafted, but payer confirmation waits for Taqdeer assessment.',
    )
    fireEvent.click(screen.getByText('Request missing Taqdeer document'))
    await waitFor(() => expect(logCommunication).toHaveBeenCalledTimes(1))
    const [id, args] = logCommunication.mock.calls[0]
    expect(id).toBe('a1')
    expect(args.channel).toBe('in_app')
    expect(args.workstreamKey).toBe('liability')
    expect(args.authorName).toBe('Ajay Kumar')
    expect(await screen.findByText(/Request logged in the case communications/)).toBeInTheDocument()
  })

  it('hides the warning once the Taqdeer document is attached and shows uploader + verification', async () => {
    getMeta.mockResolvedValue({ assessment: { id: 'la1', taqdeer_required: true, field_audit: {} }, parityProvisioned: true })
    listEvidence.mockResolvedValue([{
      id: 'e1', requirement_key: 'taqdeer_assessment', uploaded_by: 'u2', uploaded_at: '2026-09-16T08:00:00Z',
      created_at: '2026-09-16T08:00:00Z', verification_status: 'verified', storage_ref: 'https://files.example/t.pdf',
    }])
    render(<LiabilityPaymentPanel accidentId="a1" elevated acc={{}} workstreams={workstreams} />)
    await screen.findByText('1. Who was at fault?')
    expect(screen.queryByTestId('taqdeer-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('docs-counter')).toHaveTextContent('1 of 6 required documents')
    expect(screen.getByText('Omar Ali')).toBeInTheDocument()
    expect(screen.getByText('Attached')).toBeInTheDocument()
  })

  it('says the parity columns are not provisioned instead of failing, and still saves the base fields', async () => {
    getMeta.mockResolvedValue({ assessment: null, parityProvisioned: false })
    render(<LiabilityPaymentPanel accidentId="a1" elevated acc={{}} workstreams={workstreams} />)
    expect(await screen.findByTestId('parity-note')).toHaveTextContent(/not provisioned/)
    // Payer tiles are disabled; fault tiles still work.
    expect(screen.getByRole('button', { name: 'Our insurance' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Other party' }))
    expect(screen.getByText('Non-faulty')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save responsibility details'))
    await waitFor(() => expect(saveAssessment).toHaveBeenCalledTimes(1))
    const [, patch] = saveAssessment.mock.calls[0]
    expect(patch.liability_type).toBe('third_party_full')
    expect(patch).not.toHaveProperty('payer')
    expect(patch).not.toHaveProperty('field_audit')
  })

  it('is read-only for a non-elevated user and offers Continue to damage mapping when a handler is given', async () => {
    const onNavigateTab = vi.fn()
    render(<LiabilityPaymentPanel accidentId="a1" elevated={false} acc={{}} workstreams={workstreams} onNavigateTab={onNavigateTab} />)
    await screen.findByText('1. Who was at fault?')
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Other party' })).toBeDisabled()
    expect(screen.queryByText('Save responsibility details')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/Continue to damage mapping/))
    expect(onNavigateTab).toHaveBeenCalledWith('damage_map')
  })
})
