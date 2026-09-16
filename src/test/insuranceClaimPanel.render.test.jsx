import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import InsuranceClaimPanel from '../components/accidents/InsuranceClaimPanel'

// The panel is UI over loadClaimTabContext (one composed read) + the RPC-backed
// writers. The pure engine (../lib/claimPackage) runs for real so the counter,
// the register lock and the derived money are the true arithmetic.

const loadClaimTabContext = vi.fn()
const registerClaim = vi.fn(() => Promise.resolve({ id: 'c1', insurer: 'Tawuniya', policy_no: 'P-1', claim_no: null, decision: 'registered' }))
const recordRecovery = vi.fn()
vi.mock('../lib/api/accidentInsuranceClaims', () => ({
  loadClaimTabContext: (...a) => loadClaimTabContext(...a),
  registerClaim: (...a) => registerClaim(...a),
  decideClaim: vi.fn(), settleClaim: vi.fn(),
  recordRecovery: (...a) => recordRecovery(...a),
  CLAIM_DECISIONS: ['fully_approved', 'rejected'],
  RECOVERY_SOURCES: ['insurer', 'third_party'],
  RECOVERY_STATUSES: ['pending', 'recovered'],
}))
const logCommunication = vi.fn(() => Promise.resolve({ id: 'm1' }))
vi.mock('../lib/api/accidentCommunications', () => ({ logCommunication: (...a) => logCommunication(...a) }))
vi.mock('../lib/api/accidentEvidence', () => ({ addEvidence: vi.fn() }))
vi.mock('../lib/api/accidentSla', () => ({ listSlaInstances: () => Promise.resolve([]) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { full_name: 'Ms. Fatima' } }) }))

const ev = (key, n = 1) => Array.from({ length: n }, (_, i) => ({ id: `${key}${i}`, requirement_key: key, workstream_key: 'insurance', created_at: '2026-09-16T12:00:00Z' }))
const sevenOfEight = [
  ...ev('accident_report_pdf'), ...ev('fleet_validation'), ...ev('workshop_assessment_pdf'), ...ev('damage_photographs', 9),
  ...ev('police_najm_report'), ...ev('vehicle_registration'), ...ev('policy_document'),
]
const workstreams = [
  { workstream_key: 'insurance', team: 'Insurance', owner_id: 'u4', assigned_at: '2026-09-16T12:08:00Z' },
  { workstream_key: 'fleet_validation', team: 'Fleet', owner_id: 'u1' },
  { workstream_key: 'assessment', team: 'Workshop', owner_id: 'u2' },
  { workstream_key: 'timeline', team: 'Command Center', owner_id: 'u3' },
]
const profiles = [
  { id: 'u1', full_name: 'Mr. Ajay' }, { id: 'u2', full_name: 'Eng. Vinay' },
  { id: 'u3', full_name: 'Ms. Mai' }, { id: 'u4', full_name: 'Ms. Fatima' },
]
const baseCtx = {
  claim: null, docs: [], recoveries: [], evidence: sevenOfEight,
  liability: { liability_type: 'shared', our_liability_pct: 50 },
  repairOrder: { repair_route: 'external', workshop_type: 'external' }, assessment: null,
  workstreams, communications: [], profiles,
}
const acc = { id: 'a1', country: 'KSA', claim_amount: 12000 }
const fmt = (v) => `SAR ${Number(v).toLocaleString('en-US')}`

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  loadClaimTabContext.mockResolvedValue(baseCtx)
})

describe('InsuranceClaimPanel (mock M4)', () => {
  it('renders the workstream header, banner, the 8-doc package at 7 of 8 and the locked register button', async () => {
    render(<InsuranceClaimPanel accidentId="a1" elevated acc={acc} fmtCurrency={fmt} />)
    expect(await screen.findByText('Claim document package')).toBeInTheDocument()
    // Header
    expect(screen.getByText('Workstream 3 of 7:')).toBeInTheDocument()
    expect(screen.getByText('Insurance / Claims')).toBeInTheDocument()
    expect(screen.getByText('External repair assessment')).toBeInTheDocument()
    expect(screen.getByText('Ms. Fatima')).toBeInTheDocument()
    // Package
    const pkg = screen.getByTestId('claim-package')
    for (const label of ['Accident report PDF', 'Fleet validation', 'Workshop assessment PDF', 'Damage photographs', 'Police / Najm report', 'Vehicle registration', 'Driving licence', 'Policy document']) {
      expect(within(pkg).getByText(label)).toBeInTheDocument()
    }
    expect(within(pkg).getByText('7 of 8 required documents')).toBeInTheDocument()
    expect(within(pkg).getByText('9 received')).toBeInTheDocument()
    expect(within(pkg).getByText('Missing')).toBeInTheDocument()
    expect(within(pkg).getByText('Claim registration unlocks when all required documents are complete.')).toBeInTheDocument()
    expect(within(pkg).getByRole('button', { name: /Request driving licence/ })).toBeInTheDocument()
    expect(within(pkg).getByRole('button', { name: /Upload document/ })).toBeInTheDocument()
    // Registration
    const reg = screen.getByTestId('claim-registration')
    expect(within(reg).getByText('Auto-generated after registration')).toBeInTheDocument()
    expect(within(reg).getByText('Shared fault')).toBeInTheDocument()
    expect(within(reg).getByText('50%')).toBeInTheDocument()
    expect(within(reg).getByLabelText('Claim amount')).toHaveValue(12000)
    expect(within(reg).getByText('SAR 12,000')).toBeInTheDocument() // net claimable (no deductible)
    const registerBtn = within(reg).getByRole('button', { name: /Register claim with insurer/ })
    expect(registerBtn).toBeDisabled()
    expect(within(reg).getByText('Enable once all required documents are complete.')).toBeInTheDocument()
    expect(registerClaim).not.toHaveBeenCalled()
    // Payment
    const pay = screen.getByTestId('claim-payment')
    expect(screen.getByTestId('claim-status')).toHaveTextContent('Not registered')
    expect(within(pay).getByText('Update recovery amount')).toBeInTheDocument()
    expect(within(pay).getByText(/Recovery amounts remain editable after operational case closure\. Every adjustment is timestamped and audited\./)).toBeInTheDocument()
    // Notify
    expect(screen.getByTestId('notify-fleet')).toHaveTextContent('Mr. Ajay')
    expect(screen.getByTestId('notify-workshop')).toHaveTextContent('Eng. Vinay')
    expect(screen.getByTestId('notify-command_center')).toHaveTextContent('Ms. Mai')
    expect(screen.getByTestId('notify-pmv_manager')).toHaveTextContent('PMV Manager')
    expect(screen.getByTestId('notify-pmv_manager')).toHaveTextContent('(visibility)')
    expect(screen.getByText('Notification includes claim number, document status, claim amount, and next action.')).toBeInTheDocument()
    // Footer actions
    expect(screen.getByRole('button', { name: /Save claim draft/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Complete documents/ })).toBeInTheDocument()
    expect(screen.getByTestId('cc-footer')).toHaveTextContent('Ms. Mai is monitoring SLA and missing documents.')
  })

  it('"Request driving licence" logs a document request on the case timeline and reads as Requested', async () => {
    render(<InsuranceClaimPanel accidentId="a1" elevated acc={acc} fmtCurrency={fmt} />)
    fireEvent.click(await screen.findByRole('button', { name: /Request driving licence/ }))
    await waitFor(() => expect(logCommunication).toHaveBeenCalledTimes(1))
    expect(logCommunication.mock.calls[0][0]).toBe('a1')
    expect(logCommunication.mock.calls[0][1]).toMatchObject({
      channel: 'in_app', direction: 'outbound', subject: 'Document request: Driving licence', workstreamKey: 'insurance', authorName: 'Ms. Fatima',
    })
    expect(await screen.findByText('Requested')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Request driving licence/ })).not.toBeInTheDocument()
  })

  it('unlocks and registers once every required document is present, with no claim number supplied', async () => {
    loadClaimTabContext.mockResolvedValue({ ...baseCtx, evidence: [...sevenOfEight, ...ev('driving_licence')] })
    render(<InsuranceClaimPanel accidentId="a1" elevated acc={acc} fmtCurrency={fmt} />)
    expect(await screen.findByText('8 of 8 required documents')).toBeInTheDocument()
    expect(screen.queryByText('Claim registration unlocks when all required documents are complete.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Complete documents/ })).not.toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /Register claim with insurer/ })
    expect(btn).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText('Insurer'), { target: { value: 'Tawuniya' } })
    fireEvent.change(screen.getByLabelText('Deductible'), { target: { value: '2000' } })
    expect(screen.getByText('SAR 10,000')).toBeInTheDocument() // net claimable live
    fireEvent.click(btn)
    await waitFor(() => expect(registerClaim).toHaveBeenCalledTimes(1))
    expect(registerClaim.mock.calls[0][1]).toMatchObject({ insurer: 'Tawuniya', claimNo: null, claimAmount: 12000, deductible: 2000 })
    expect(await screen.findByText('Claim registered with the insurer.')).toBeInTheDocument()
    // Registered but the insurer has not issued a number yet: honest "Not set", not the pre-registration hint.
    expect(screen.queryByText('Auto-generated after registration')).not.toBeInTheDocument()
    expect(screen.getByTestId('claim-status')).toHaveTextContent('Registered')
  })

  it('payment section derives recovered and outstanding from the recoveries and the approved amount', async () => {
    loadClaimTabContext.mockResolvedValue({
      ...baseCtx,
      claim: { id: 'c1', insurer: 'Tawuniya', policy_no: 'P-1', claim_no: 'CLM-77', decision: 'partially_approved', approved_amount: 9000, deductible: 1000, updated_at: '2026-09-16T13:00:00Z' },
      recoveries: [
        { id: 'r1', source: 'third_party', amount: 2500, status: 'recovered', created_at: '2026-09-16T14:00:00Z' },
        { id: 'r2', source: 'insurer', amount: 4000, status: 'pending', created_at: '2026-09-15T14:00:00Z' },
      ],
    })
    render(<InsuranceClaimPanel accidentId="a1" elevated acc={acc} fmtCurrency={fmt} />)
    const pay = await screen.findByTestId('claim-payment')
    expect(screen.getByTestId('claim-status')).toHaveTextContent('Partially approved')
    expect(within(pay).getByText('SAR 9,000')).toBeInTheDocument()     // approved
    expect(within(pay).getAllByText('SAR 2,500').length).toBeGreaterThan(0) // recovered = only the recovered row
    expect(within(pay).getByText('SAR 6,500')).toBeInTheDocument()     // outstanding = 9000 - 2500
    expect(within(pay).getAllByText('Third party').length).toBeGreaterThan(0) // latest recovery source (KPI + list row)
    const reg = screen.getByTestId('claim-registration')
    expect(within(reg).getByText('CLM-77')).toBeInTheDocument()
    expect(within(reg).getByText('SAR 11,000')).toBeInTheDocument()    // net claimable 12000 - 1000
    expect(within(reg).getByRole('button', { name: /Insurer decision/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save claim draft/ })).not.toBeInTheDocument()
  })

  it('Save claim draft keeps the form on this device without calling the register RPC; a non-elevated user gets no write controls', async () => {
    render(<InsuranceClaimPanel accidentId="a1" elevated acc={acc} fmtCurrency={fmt} />)
    fireEvent.change(await screen.findByLabelText('Insurer'), { target: { value: 'Malath' } })
    fireEvent.click(screen.getByRole('button', { name: /Save claim draft/ }))
    expect(await screen.findByText(/Claim draft saved on this device/)).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('tp.claimDraft.a1')).insurer).toBe('Malath')
    expect(registerClaim).not.toHaveBeenCalled()
  })

  it('is read-only for a non-elevated user and hides the Command Center footer when no owner is known', async () => {
    loadClaimTabContext.mockResolvedValue({ ...baseCtx, workstreams: [], profiles: [], repairOrder: null })
    render(<InsuranceClaimPanel accidentId="a1" elevated={false} acc={acc} fmtCurrency={fmt} />)
    expect(await screen.findByText('Claim document package')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Register claim with insurer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Request driving licence/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Upload document/ })).not.toBeInTheDocument()
    expect(screen.queryByText('External repair assessment')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cc-footer')).not.toBeInTheDocument()
    expect(screen.getByTestId('notify-fleet')).toHaveTextContent('Fleet')
    expect(screen.getByText('Only Admin / Manager / Director can register or update this claim.')).toBeInTheDocument()
  })
})
