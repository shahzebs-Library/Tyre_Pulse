import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const listWorkstreams = vi.fn()
const setWorkstreamStatus = vi.fn()
const listAuthorityReports = vi.fn()
const getDamageAssessment = vi.fn()
const getAssetByNo = vi.fn()
const listProfiles = vi.fn()
const logCommunication = vi.fn()
const listFleetValidationItems = vi.fn()
const upsertFleetValidationItem = vi.fn()
const upsertFleetValidationItems = vi.fn()
const renderAccidentCasePdf = vi.fn()

vi.mock('../lib/api/accidentCase', () => ({
  listWorkstreams: (...a) => listWorkstreams(...a),
  setWorkstreamStatus: (...a) => setWorkstreamStatus(...a),
}))
vi.mock('../lib/api/accidentLiability', () => ({ listAuthorityReports: (...a) => listAuthorityReports(...a) }))
vi.mock('../lib/api/accidentDamageAssessment', () => ({ getDamageAssessment: (...a) => getDamageAssessment(...a) }))
vi.mock('../lib/api/assets', () => ({ getAssetByNo: (...a) => getAssetByNo(...a) }))
vi.mock('../lib/api/users', () => ({ listProfiles: (...a) => listProfiles(...a) }))
vi.mock('../lib/api/accidentCommunications', () => ({ logCommunication: (...a) => logCommunication(...a) }))
vi.mock('../lib/api/fleetValidationItems', () => ({
  listFleetValidationItems: (...a) => listFleetValidationItems(...a),
  upsertFleetValidationItem: (...a) => upsertFleetValidationItem(...a),
  upsertFleetValidationItems: (...a) => upsertFleetValidationItems(...a),
}))
vi.mock('../lib/accidentCasePdf', () => ({ renderAccidentCasePdf: (...a) => renderAccidentCasePdf(...a) }))
vi.mock('../lib/api/accidentSla', () => ({ listSlaInstances: () => Promise.resolve([]) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u9', full_name: 'Omar Ali', role: 'Fleet Supervisor' } }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: { display_name: 'Acme Fleet' } }) }))

import FleetValidationPanel from '../components/accidents/FleetValidationPanel'

const acc = {
  id: 'a1', asset_no: 'TM514', driver_name: 'Khalid', site: 'NHC', location: 'Gate 2', country: 'KSA',
  accident_type: 'collision', severity: 'severe', status: 'reported', incident_date: '2026-09-10',
  description: 'Reversing into a barrier', injuries: false, third_party_involved: true,
  photos: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
}
const profiles = [
  { id: 'u1', full_name: 'Fatima Al', role: 'Insurance Officer', approved: true },
  { id: 'u2', full_name: 'Mai Noor', role: 'Data Monitor Officer', approved: true },
]
const allDone = [
  'asset_driver_confirmed', 'incident_facts_confirmed', 'damage_map_reviewed',
  'required_photographs', 'police_najm_documents', 'workshop_assessment_requested',
].map((k) => ({ item_key: k, state: 'done', checked_by_name: 'Omar Ali', checked_at: '2026-09-16T08:00:00Z' }))

function arm({ persisted = true, rows = [], reports = [{ authority_type: 'police', report_status: 'available' }], ws = [] } = {}) {
  listWorkstreams.mockResolvedValue(ws)
  setWorkstreamStatus.mockImplementation((_id, key, patch) => Promise.resolve({ workstream_key: key, ...patch }))
  listAuthorityReports.mockResolvedValue(reports)
  getDamageAssessment.mockResolvedValue({ id: 'd1', damage_areas: [{ region_key: 'a' }, { region_key: 'b' }, { region_key: 'c' }] })
  getAssetByNo.mockResolvedValue({ asset_no: 'TM514', vehicle_type: 'TR-MIXER' })
  listProfiles.mockResolvedValue(profiles)
  listFleetValidationItems.mockResolvedValue({ rows, persisted })
  upsertFleetValidationItem.mockImplementation((_id, key, patch) => Promise.resolve({ item_key: key, ...patch }))
  upsertFleetValidationItems.mockResolvedValue([])
  logCommunication.mockResolvedValue({ id: 'c1' })
  renderAccidentCasePdf.mockResolvedValue(undefined)
}

beforeEach(() => { vi.clearAllMocks() })

describe('FleetValidationPanel (mock M6)', () => {
  it('renders header pills, incident summary, the six checklist rows, the Najm warning and a disabled complete button', async () => {
    arm()
    render(<FleetValidationPanel accidentId="a1" elevated acc={acc} />)
    await screen.findByText('Fleet validation checklist')

    // header strip
    expect(screen.getByText('Major accident')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByTestId('workstream-header')).toBeInTheDocument()
    expect(screen.getByText('Workstream 1 of 7')).toBeInTheDocument()

    // incident summary
    expect(screen.getByText('Collision')).toBeInTheDocument()
    expect(screen.getByText('NHC · Gate 2')).toBeInTheDocument()
    expect(screen.getByText('Khalid')).toBeInTheDocument()
    expect(screen.getByText('3 marked damage areas · 7 photos')).toBeInTheDocument()
    expect(screen.getByText('No injuries')).toBeInTheDocument()
    expect(screen.getByText('Third party involved')).toBeInTheDocument()

    // six rows with derived states + counts
    for (const label of ['Asset and driver confirmed', 'Incident facts confirmed', 'Damage map reviewed', 'Required photographs', 'Police / Najm documents', 'Workshop assessment requested']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('7 of 7')).toBeInTheDocument()
    expect(screen.getByText('1 missing')).toBeInTheDocument()
    // a damage assessment exists in this fixture, so the workshop item derives done (no "Pending" count)
    expect(screen.getByText('Assessment recorded')).toBeInTheDocument()
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()

    // notify block
    expect(screen.getByText('Fatima Al')).toBeInTheDocument()
    expect(screen.getByText('Incident report, asset details, damage locations, photos, police / Najm documents')).toBeInTheDocument()
    expect(screen.getByText('Najm report is missing. Claim registration cannot start.')).toBeInTheDocument()
    expect(screen.getByLabelText('Send when required documents complete')).toBeChecked()

    // footer + gate
    expect(screen.getByText('Mai Noor · Command Center is monitoring SLA')).toBeInTheDocument()
    const complete = screen.getByRole('button', { name: /Complete Fleet validation and notify Fatima Al/ })
    expect(complete).toBeDisabled()
    expect(screen.getByText('Complete all required checklist items to enable.')).toBeInTheDocument()
  })

  it('says the checklist is not saved when the table is not provisioned, and keeps ticks local', async () => {
    arm({ persisted: false })
    render(<FleetValidationPanel accidentId="a1" elevated acc={acc} />)
    await screen.findByText('Fleet validation checklist')
    expect(screen.getByText(/Checklist is not saved until the migration is applied/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Damage map reviewed:/ }))
    expect(upsertFleetValidationItem).not.toHaveBeenCalled()
  })

  it('clicking a row toggles done <-> pending and persists with the signed-in name', async () => {
    arm()
    render(<FleetValidationPanel accidentId="a1" elevated acc={acc} />)
    await screen.findByText('Fleet validation checklist')
    // The police/najm row derives 'attention' (Najm missing); a click lifts it to done.
    fireEvent.click(screen.getByRole('button', { name: /^Police \/ Najm documents:/ }))
    await waitFor(() => expect(upsertFleetValidationItem).toHaveBeenCalledTimes(1))
    const [id, key, patch, ctx] = upsertFleetValidationItem.mock.calls[0]
    expect(id).toBe('a1')
    expect(key).toBe('police_najm_documents')
    expect(patch.state).toBe('done')
    expect(patch.checked_by_name).toBe('Omar Ali')
    expect(patch.checked_by_id).toBe('u9')
    expect(patch.count_done).toBe(1)
    expect(patch.count_required).toBe(2)
    expect(ctx).toEqual({ country: 'KSA', site: 'NHC' })
    await screen.findByText('Checked by Omar Ali')
  })

  it('enables Complete only when every item is done, then completes the workstream and logs the notification', async () => {
    arm({ rows: allDone, reports: [
      { authority_type: 'police', report_status: 'available' }, { authority_type: 'najm', report_status: 'available' },
    ] })
    render(<FleetValidationPanel accidentId="a1" elevated acc={acc} />)
    await screen.findByText('Fleet validation checklist')
    expect(screen.queryByText('Complete all required checklist items to enable.')).not.toBeInTheDocument()
    const complete = screen.getByRole('button', { name: /Complete Fleet validation and notify Fatima Al/ })
    expect(complete).toBeEnabled()
    fireEvent.click(complete)
    await waitFor(() => expect(setWorkstreamStatus).toHaveBeenCalledTimes(1))
    expect(setWorkstreamStatus.mock.calls[0][1]).toBe('fleet_validation')
    expect(setWorkstreamStatus.mock.calls[0][2].status).toBe('completed')
    await waitFor(() => expect(logCommunication).toHaveBeenCalledTimes(1))
    expect(logCommunication.mock.calls[0][1].toParty).toBe('Fatima Al')
    expect(logCommunication.mock.calls[0][1].workstreamKey).toBe('fleet_validation')
    await screen.findByText('Fleet validation completed')
  })

  it('"Send available details now" and "Request missing document" log communications; the PDF button opens the case report', async () => {
    arm()
    render(<FleetValidationPanel accidentId="a1" elevated acc={acc} />)
    await screen.findByText('Fleet validation checklist')

    fireEvent.click(screen.getByRole('button', { name: /Send available details now/ }))
    await waitFor(() => expect(logCommunication).toHaveBeenCalledTimes(1))
    expect(logCommunication.mock.calls[0][1].toParty).toBe('Fatima Al')
    expect(logCommunication.mock.calls[0][1].channel).toBe('in_app')

    fireEvent.click(screen.getByRole('button', { name: /Request missing document/ }))
    await waitFor(() => expect(logCommunication).toHaveBeenCalledTimes(2))
    expect(logCommunication.mock.calls[1][1].subject).toBe('Request missing document: Najm report')

    fireEvent.click(screen.getByRole('button', { name: /View complete incident report/ }))
    await waitFor(() => expect(renderAccidentCasePdf).toHaveBeenCalledTimes(1))
    expect(renderAccidentCasePdf.mock.calls[0][0].company).toBe('Acme Fleet')
    expect(renderAccidentCasePdf.mock.calls[0][0].case.id).toBe('a1')
  })

  it('the chevron jumps to the related tab when the parent provides onNavigateTab', async () => {
    arm()
    const onNavigateTab = vi.fn()
    render(<FleetValidationPanel accidentId="a1" elevated acc={acc} onNavigateTab={onNavigateTab} />)
    await screen.findByText('Fleet validation checklist')
    fireEvent.click(screen.getByRole('button', { name: 'Open Police / Najm documents' }))
    expect(onNavigateTab).toHaveBeenCalledWith('liability')
  })

  it('renders honestly from a nearly empty incident: Not set everywhere, no invented person', async () => {
    arm({ reports: [], persisted: true })
    listProfiles.mockResolvedValue([])
    getAssetByNo.mockResolvedValue(null)
    getDamageAssessment.mockResolvedValue(null)
    render(<FleetValidationPanel accidentId="a2" elevated={false} acc={{ id: 'a2', country: 'KSA' }} />)
    await screen.findByText('Fleet validation checklist')
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
    expect(screen.getByText('0 marked damage areas · 0 photos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Complete Fleet validation and notify Insurance/ })).toBeDisabled()
    expect(screen.queryByText(/Command Center is monitoring SLA/)).not.toBeInTheDocument()
    expect(screen.getByText('Police report and Najm report are missing. Claim registration cannot start.')).toBeInTheDocument()
  })
})
