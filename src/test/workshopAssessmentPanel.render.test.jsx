import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import WorkshopAssessmentPanel from '../components/accidents/WorkshopAssessmentPanel'

// Every Supabase boundary the panel touches is mocked; the vocabulary
// (accidentCaseVocab) and the gating engine (assessmentGating) run for real so
// the tab is proven to speak the mock's words and obey its submit gate.

const getDamageAssessment = vi.fn()
const saveDamageAssessment = vi.fn()
const submitDamageAssessment = vi.fn()
const writeDamageAreas = vi.fn()
const patchRepairOrderParity = vi.fn(() => Promise.resolve(null))
vi.mock('../lib/api/accidentDamageAssessment', () => ({
  getDamageAssessment: (...a) => getDamageAssessment(...a),
  saveDamageAssessment: (...a) => saveDamageAssessment(...a),
  submitDamageAssessment: (...a) => submitDamageAssessment(...a),
  writeDamageAreas: (...a) => writeDamageAreas(...a),
  patchRepairOrderParity: (...a) => patchRepairOrderParity(...a),
  parityColumnsUnavailable: () => false,
  REPAIR_ROUTES: ['internal', 'external', 'on_site', 'insurer_approved', 'dealer', 'specialist', 'temporary', 'replacement', 'total_loss', 'disposal', 'under_review', 'none'],
}))

const getOpenRepairOrder = vi.fn(() => Promise.resolve(null))
const upsertRepairOrder = vi.fn((_id, p) => Promise.resolve({ id: 'ro1', status: 'planned', repair_route: p.repairRoute, workshop_name: p.workshopName }))
vi.mock('../lib/api/accidentRepairOrders', () => ({
  getOpenRepairOrder: (...a) => getOpenRepairOrder(...a),
  upsertRepairOrder: (...a) => upsertRepairOrder(...a),
  WORKSHOP_TYPES: ['internal', 'external', 'insurer_approved', 'dealer', 'specialist'],
  REPAIR_ROUTES: ['none', 'temporary', 'internal', 'external', 'insurer_approved', 'dealer', 'specialist', 'replacement', 'total_loss', 'disposal', 'under_review'],
}))

const listEvidence = vi.fn(() => Promise.resolve([]))
const addEvidence = vi.fn()
vi.mock('../lib/api/accidentEvidence', () => ({
  listEvidence: (...a) => listEvidence(...a),
  addEvidence: (...a) => addEvidence(...a),
  verifyEvidence: vi.fn(),
}))
vi.mock('../lib/api/accidentWorkflow', () => ({ setAccidentRepairCost: vi.fn(() => Promise.resolve()) }))
vi.mock('../lib/api/assets', () => ({
  getAssetByNo: vi.fn(() => Promise.resolve({
    asset_no: 'MP093', vehicle_type: 'Concrete pump', make: 'SANY', model: '5-axle Concrete Pump',
    current_km: 128450, registration_no: '7326 HRA', site: 'NHC',
  })),
}))
vi.mock('../lib/api/accidentCase', () => ({
  listWorkstreams: vi.fn(() => Promise.resolve([
    { accident_id: 'acc1', workstream_key: 'assessment', status: 'in_progress', owner_role: 'Workshop Supervisor', assigned_at: new Date().toISOString() },
  ])),
}))
vi.mock('../lib/api/accidentSla', () => ({ listSlaInstances: vi.fn(() => Promise.resolve([])) }))
vi.mock('../lib/api/accidentCommunications', () => ({ logCommunication: vi.fn(() => Promise.resolve({})) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { full_name: 'Eng. Vinay' } }) }))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrl: vi.fn((v) => Promise.resolve(v ? 'https://cdn.test/' + encodeURIComponent(v) : null)) }))

const ACC = { id: 'acc1', asset_no: 'MP093', country: 'KSA', site: 'NHC', location: 'Gate 2', workshop_name: '', repair_cost: null }
const fmt = (v) => `SAR ${Number(v).toLocaleString()}`

const MARKS = [
  { view: 'top', region_key: 'boom_3', region_label: 'Boom section 3', damage_type: 'crack', severity: 'severe', action: 'structural_review', photo_refs: ['tp-storage://tyre-photos/a.jpg'] },
  { view: 'left', region_key: 'outrigger_lf', component_label: 'Left front outrigger', damage_type: 'bent', severity: 'moderate', action: 'replace', photo_refs: [] },
  { view: 'rear', region_key: 'hopper_guard', region_label: 'Rear hopper guard', damage_type: 'broken', severity: 'minor', photo_refs: [] },
]
const DRAFT = {
  id: 'da1', accident_id: 'acc1', assessment_status: 'draft', assessor_name: 'Eng. Vinay', damage_areas: MARKS,
  estimated_labour_hours: 18, estimated_labour_cost: 5400, estimated_parts_cost: 12600,
  parts_available_count: 2, parts_special_order_count: 1, recommended_route: 'external', route_reason: 'Boom crack needs OEM jig.',
}

beforeEach(() => {
  vi.clearAllMocks()
  getDamageAssessment.mockResolvedValue(DRAFT)
  saveDamageAssessment.mockImplementation((_id, patch) => Promise.resolve({ ...DRAFT, ...patch }))
  submitDamageAssessment.mockResolvedValue({ ...DRAFT, assessment_status: 'submitted' })
  writeDamageAreas.mockImplementation((_id, areas) => Promise.resolve({ ...DRAFT, damage_areas: areas }))
})

async function renderPanel(props = {}) {
  const utils = render(<WorkshopAssessmentPanel accidentId="acc1" elevated acc={ACC} fmtCurrency={fmt} {...props} />)
  await screen.findByText('Repair assessment report')
  return utils
}

describe('WorkshopAssessmentPanel (mock M5)', () => {
  it('mounts the workstream header, vehicle card and damage-map link with the area count', async () => {
    const onNavigateTab = vi.fn()
    await renderPanel({ onNavigateTab })
    expect(screen.getByTestId('workstream-header')).toHaveTextContent('Workstream 2 of 7')
    const card = await screen.findByTestId('vehicle-master-card')
    expect(within(card).getByText('SANY 5-axle Concrete Pump')).toBeInTheDocument()
    expect(within(card).getByText('MP093')).toBeInTheDocument()
    expect(within(card).getByText('128,450 km')).toBeInTheDocument()
    expect(within(card).getByText('7326 HRA')).toBeInTheDocument()
    expect(within(card).getByText('NHC · Gate 2')).toBeInTheDocument()
    fireEvent.click(within(card).getByText(/View damage map · 3 areas/))
    expect(onNavigateTab).toHaveBeenCalledWith('damage_map')
  })

  it('renders the four numbered sections with the mock field labels', async () => {
    await renderPanel()
    expect(screen.getByText('Safety and mobility')).toBeInTheDocument()
    expect(screen.getByText('Safe to move')).toBeInTheDocument()
    expect(screen.getByText('Recovery / tow required')).toBeInTheDocument()
    expect(screen.getByText('Vehicle off road (VOR)')).toBeInTheDocument()
    expect(screen.getByText('Damage assessment (3)')).toBeInTheDocument()
    expect(screen.getByText('Labour and parts estimate')).toBeInTheDocument()
    expect(screen.getByText('Repair route recommendation')).toBeInTheDocument()
    for (const label of ['Labour hours', 'Labour estimate', 'Parts estimate', 'Total preliminary estimate', 'Parts availability', 'Expected duration (days)', 'Quotation status', 'Selected workshop', 'City']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('shows one damage row per mark with component, type + severity, and a persisted Action select', async () => {
    await renderPanel()
    const rows = screen.getAllByTestId('damage-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Boom section 3')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Cracked')).toBeInTheDocument()   // canonDamageType('crack')
    expect(within(rows[0]).getByText('Major')).toBeInTheDocument()     // DAMAGE_LEVELS label for 'severe'
    expect(within(rows[1]).getByText('Left front outrigger')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('combobox')).toHaveValue('structural_review')
    // The first photo resolves through the storage resolver; a mark with none shows the placeholder.
    await waitFor(() => expect(within(rows[0]).getByAltText('Damage')).toHaveAttribute('src', expect.stringContaining('cdn.test')))
    expect(within(rows[2]).getByTitle('No photo')).toBeInTheDocument()

    fireEvent.change(within(rows[2]).getByRole('combobox'), { target: { value: 'repair' } })
    await waitFor(() => expect(writeDamageAreas).toHaveBeenCalledTimes(1))
    const [id, areas] = writeDamageAreas.mock.calls[0]
    expect(id).toBe('da1')
    expect(areas[2].action).toBe('repair')
    expect(areas[0].action).toBe('structural_review')
  })

  it('derives the total estimate and the parts availability line', async () => {
    await renderPanel()
    expect(screen.getByTestId('total-estimate')).toHaveTextContent('SAR 18,000')
    expect(screen.getByTestId('parts-availability')).toHaveTextContent('2 available · 1 special order')
  })

  it('badges the engine recommendation (external when a mark is Major) and keeps legacy routes under Other routes', async () => {
    await renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Repair route' })
    const tiles = within(group).getAllByRole('radio')
    expect(tiles.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Internal workshop'), expect.stringContaining('External workshop'), expect.stringContaining('On-site repair'),
    ])
    expect(within(tiles[1]).getByText('Recommended')).toBeInTheDocument()
    expect(within(tiles[0]).queryByText('Recommended')).not.toBeInTheDocument()
    expect(tiles[1]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByText('Other routes'))
    const other = screen.getByRole('combobox', { name: 'Other routes' })
    expect(within(other).getByText('Dealer workshop')).toBeInTheDocument()
    expect(within(other).getByText('Total loss')).toBeInTheDocument()
  })

  it('lists the required attachments as Attached / Missing / count and warns about the vendor quotation', async () => {
    listEvidence.mockResolvedValue([
      { id: 'e1', requirement_key: 'assessment_report_pdf', kind: 'document', verification_status: 'unverified' },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, requirement_key: 'damage_photos', kind: 'photo', verification_status: 'unverified' })),
      { id: 'e2', requirement_key: 'recovery_request', kind: 'document', verification_status: 'unverified' },
    ])
    await renderPanel()
    expect(screen.getByTestId('attachment-assessment_report_pdf')).toHaveTextContent('Attached')
    expect(screen.getByTestId('attachment-vendor_quotation')).toHaveTextContent('Missing')
    expect(screen.getByTestId('attachment-damage_photos')).toHaveTextContent('9')
    expect(screen.getByTestId('attachment-recovery_request')).toHaveTextContent('Attached')
    expect(screen.getByTestId('quotation-warning')).toHaveTextContent('Attach vendor quotation to enable submission to External Workshop.')
    // Submit is DISABLED until the quotation is attached, with the helper text.
    const submit = screen.getByRole('button', { name: /Submit assessment and route/ })
    expect(submit).toBeDisabled()
    expect(screen.getByTestId('submit-helper')).toHaveTextContent('Attach vendor quotation to enable submission')
    expect(screen.getByRole('button', { name: 'Save assessment' })).toBeEnabled()
  })

  it('enables submit once the vendor quotation exists, then saves, routes and locks', async () => {
    listEvidence.mockResolvedValue([{ id: 'q1', requirement_key: 'vendor_quotation', kind: 'document', verification_status: 'unverified' }])
    await renderPanel()
    fireEvent.change(screen.getByLabelText('Selected workshop'), { target: { value: 'Al Futtaim Body Shop' } })
    const submit = screen.getByRole('button', { name: /Submit assessment and route/ })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(submitDamageAssessment).toHaveBeenCalledWith('da1'))
    expect(saveDamageAssessment).toHaveBeenCalled()
    const patch = saveDamageAssessment.mock.calls[0][1]
    expect(patch.estimated_total_cost).toBe(18000)
    expect(patch).not.toHaveProperty('damage_areas')
    expect(upsertRepairOrder).toHaveBeenCalledWith('acc1', expect.objectContaining({ repairRoute: 'external', workshopName: 'Al Futtaim Body Shop' }))
    expect(patchRepairOrderParity).toHaveBeenCalledWith('ro1', expect.objectContaining({ vendor_city: null }))
    await screen.findByText('This assessment has been submitted and is read-only.')
  })

  it('offers the four NOTIFY_ROLES chips and keeps the repair order + actual cost under a disclosure', async () => {
    await renderPanel()
    expect(screen.getByText('After submit notify')).toBeInTheDocument()
    for (const label of ['Fleet', 'Insurance', 'Command Center', 'PMV Manager']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByText('Actual repair cost')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('legacy-disclosure')).getByRole('button', { expanded: false }))
    expect(screen.getByText('No open repair order for this case yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open repair order' })).toBeInTheDocument()
    expect(screen.getAllByText('Actual repair cost').length).toBeGreaterThan(0)
  })

  it('renders honestly with no assessment yet: Not set everywhere, submit disabled with Save first', async () => {
    getDamageAssessment.mockResolvedValue(null)
    await renderPanel()
    expect(screen.getByText('No damage areas marked yet. Use the Mark Damage tab to add marks and photos.')).toBeInTheDocument()
    expect(screen.getByTestId('total-estimate')).toHaveTextContent('Not set')
    expect(screen.getByTestId('parts-availability')).toHaveTextContent('Not set')
    expect(screen.getByRole('button', { name: /Submit assessment and route/ })).toBeDisabled()
    expect(screen.getByTestId('submit-helper')).toHaveTextContent('Save the assessment first.')
  })

  it('is read-only for a non-elevated user', async () => {
    await renderPanel({ elevated: false })
    expect(screen.getByText('Only Admin / Manager / Director can record this assessment.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save assessment' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Labour hours')).toBeDisabled()
  })
})
