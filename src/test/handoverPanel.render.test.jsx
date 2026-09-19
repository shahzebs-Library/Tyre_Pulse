import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HandoverPanel from '../components/accidents/HandoverPanel'

// Every Supabase boundary the panel touches is mocked; the pure engines
// (handoverGating, accidentDispatch, accidentCaseVocab) run for real so the
// gate, the stepper and the chip labels are the genuine rules.
const listHandoverInspections = vi.fn()
const recordHandoverInspection = vi.fn()
vi.mock('../lib/api/accidentHandover', () => ({
  listHandoverInspections: (...a) => listHandoverInspections(...a),
  recordHandoverInspection: (...a) => recordHandoverInspection(...a),
}))

const getOpenRepairOrder = vi.fn()
const upsertRepairOrder = vi.fn()
const updateVendorDetails = vi.fn()
vi.mock('../lib/api/accidentRepairOrders', () => ({
  getOpenRepairOrder: (...a) => getOpenRepairOrder(...a),
  upsertRepairOrder: (...a) => upsertRepairOrder(...a),
  updateVendorDetails: (...a) => updateVendorDetails(...a),
}))

const getDowntime = vi.fn()
const saveDowntime = vi.fn()
vi.mock('../lib/api/accidentDowntime', () => ({
  getDowntime: (...a) => getDowntime(...a),
  saveDowntime: (...a) => saveDowntime(...a),
  VEHICLE_STATUSES: ['operational', 'under_repair', 'returned_to_operation'],
}))

const getLatestDispatch = vi.fn()
const saveDispatch = vi.fn()
const acceptCustody = vi.fn()
vi.mock('../lib/api/accidentDispatches', () => ({
  getLatestDispatch: (...a) => getLatestDispatch(...a),
  saveDispatch: (...a) => saveDispatch(...a),
  acceptCustody: (...a) => acceptCustody(...a),
  NOT_PROVISIONED_MESSAGE: 'Dispatch records are not provisioned on this database yet.',
}))

const listEvidence = vi.fn()
vi.mock('../lib/api/accidentEvidence', () => ({
  listEvidence: (...a) => listEvidence(...a),
  uploadEvidenceFile: vi.fn(() => Promise.resolve('https://files/x.jpg')),
  addEvidence: vi.fn(),
  verifyEvidence: vi.fn(),
}))

const listSlaInstances = vi.fn()
vi.mock('../lib/api/accidentSla', () => ({ listSlaInstances: (...a) => listSlaInstances(...a) }))

vi.mock('../components/accidents/NotifyRecipientsPanel', () => ({ default: () => <div data-testid="notify" /> }))
vi.mock('../components/SignaturePad', () => ({
  default: ({ onSave }) => <button type="button" onClick={() => onSave('data:image/png;base64,QUFB')}>pad-sign</button>,
}))

const ORDER = {
  id: 'ro1', repair_route: 'external', workshop_name: 'Vendor Workshop', vendor_city: 'Riyadh',
  vendor_contact_name: 'Contact One', vendor_contact_phone: '+966 50 000 0000', vendor_contact_email: 'ws@example.com',
  vendor_registration_no: 'REG-1', vendor_inspector_name: null, quotation_status: null,
}
const IN_TRANSIT = {
  id: 'd1', accident_id: 'a1', live_status: 'in_transit', departure_at: '2026-09-16T08:00:00Z', arrived_at: null,
  sent_by_name: 'Sender', carrier: 'Carrier Co', driver_name: 'Driver', recovery_vehicle: 'Low loader',
  origin: 'Site A', destination: 'Vendor Workshop', eta_at: '2026-09-16T11:00:00Z',
  out_odometer_km: 12000, out_engine_hours: 800, out_fuel_pct: 50, keys_count: 2,
  documents_sent: ['Registration', 'Insurance', 'Job card', 'Damage report'], accessories: ['Spare wheel', 'Jack', 'Toolkit'],
  outgoing_photos: [], outgoing_signed_by: 'Sender', outgoing_signed_at: '2026-09-16T07:50:00Z', outgoing_signature: null,
  arrived_at_: null, received_by_name: null, received_by_designation: null, receiving_photos: [], handover_paper_ref: null,
  receiver_signature: null, sender_signature: null, custody_accepted: false, accepted_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  listHandoverInspections.mockResolvedValue([])
  getOpenRepairOrder.mockResolvedValue(ORDER)
  getDowntime.mockResolvedValue(null)
  getLatestDispatch.mockResolvedValue({ row: IN_TRANSIT, provisioned: true })
  listEvidence.mockResolvedValue([{ kind: 'photo' }, { kind: 'photo' }, { kind: 'document' }])
  listSlaInstances.mockResolvedValue([])
  saveDispatch.mockImplementation((_id, patch, { existingId } = {}) => Promise.resolve({ ...IN_TRANSIT, id: existingId || 'd1', ...patch }))
  acceptCustody.mockImplementation((_id, patch) => Promise.resolve({ ...IN_TRANSIT, ...patch, live_status: 'accepted', custody_accepted: true, accepted_at: '2026-09-16T10:00:00Z' }))
  recordHandoverInspection.mockResolvedValue({ id: 'h1', decision: 'accepted', inspector_name: 'Receiver', inspected_at: '2026-09-16T10:00:00Z', photos: [] })
})

describe('HandoverPanel (mock M2)', () => {
  it('renders the header chips, the warning banner and the vendor block from real data', async () => {
    render(<HandoverPanel accidentId="a1" elevated acc={{}} />)
    expect(await screen.findByTestId('chip-route')).toHaveTextContent('External workshop')
    expect(screen.getByTestId('chip-status')).toHaveTextContent('In transit')
    expect(screen.getByTestId('chip-transit')).not.toHaveTextContent('Not set')
    expect(screen.getByTestId('chip-sla')).toHaveTextContent('Not started')
    expect(screen.getByText('Vendor SLA starts only after signed vehicle acceptance.')).toBeInTheDocument()
    expect(screen.getByTestId('workstream-header')).toHaveTextContent('Workstream 6 of 7')
    // Section 1 facts, incl. "Unassigned" for a null inspector and a tel: contact link.
    expect(screen.getByText('Vendor Workshop')).toBeInTheDocument()
    expect(screen.getByText('Riyadh')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    const contact = screen.getByText('Contact workshop').closest('a')
    expect(contact.getAttribute('href')).toBe('tel:+966500000000')
    // Section 3 chips with counts and the photo count from evidence.
    expect(screen.getByText('4 documents')).toBeInTheDocument()
    expect(screen.getByText('3 items')).toBeInTheDocument()
    expect(screen.getByTestId('outgoing-photo-count')).toHaveTextContent('2 photos')
    // Live status pill + stepper states.
    expect(screen.getByTestId('live-status-pill')).toHaveTextContent('In transit')
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getByText('Next')).toBeInTheDocument()
    expect(screen.getByText(/PO is created only after quotation review and approval/)).toBeInTheDocument()
  })

  it('keeps Sign and accept DISABLED with the helper text until every required receipt field is complete, then accepts and writes the legacy inspection', async () => {
    render(<HandoverPanel accidentId="a1" elevated acc={{}} />)
    const btn = await screen.findByTestId('sign-accept')
    expect(btn).toBeDisabled()
    expect(screen.getByTestId('accept-helper')).toHaveTextContent('Complete all required fields to enable')
    expect(screen.getByTestId('accept-helper')).toHaveTextContent('Arrived date/time')

    fireEvent.change(screen.getByLabelText('Arrived date/time'), { target: { value: '2026-09-16T09:08' } })
    fireEvent.change(screen.getByLabelText('Received by (name)'), { target: { value: 'Receiver' } })
    fireEvent.change(screen.getByLabelText('Received by (designation)'), { target: { value: 'Supervisor' } })
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Upload receiving photos'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByTestId('receiving-photo-count')).toHaveTextContent('1 photo'))
    fireEvent.change(screen.getByLabelText('Upload signed handover paper'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText('View paper')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Capture receiver signature'))
    fireEvent.click(screen.getByText('pad-sign'))
    expect(btn).toBeDisabled() // custody checkbox still unticked
    fireEvent.click(screen.getByLabelText('I accept custody of this vehicle'))
    expect(btn).not.toBeDisabled()
    expect(screen.queryByTestId('accept-helper')).not.toBeInTheDocument()

    fireEvent.click(btn)
    await waitFor(() => expect(acceptCustody).toHaveBeenCalledTimes(1))
    expect(acceptCustody.mock.calls[0][0]).toBe('d1')
    expect(acceptCustody.mock.calls[0][1]).toMatchObject({ received_by_name: 'Receiver', custody_accepted: true, receiving_photos: ['https://files/x.jpg'] })
    await waitFor(() => expect(recordHandoverInspection).toHaveBeenCalledTimes(1))
    expect(recordHandoverInspection.mock.calls[0][1]).toMatchObject({ decision: 'accepted', inspector_name: 'Receiver' })
    expect(await screen.findByTestId('chip-status')).toHaveTextContent('Accepted')
  })

  it('degrades honestly when accident_dispatches is not provisioned: note shown, Not set everywhere, no invented values', async () => {
    getLatestDispatch.mockResolvedValue({ row: null, provisioned: false })
    getOpenRepairOrder.mockResolvedValue(null)
    render(<HandoverPanel accidentId="a1" elevated={false} acc={{}} />)
    expect(await screen.findByTestId('not-provisioned')).toBeInTheDocument()
    expect(screen.getByTestId('chip-status')).toHaveTextContent('Not set')
    expect(screen.getByTestId('chip-transit')).toHaveTextContent('Not set')
    expect(screen.getByTestId('chip-route')).toHaveTextContent('Not set')
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(10)
    expect(screen.queryByText('0 km')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sign-accept')).not.toBeInTheDocument()
    expect(screen.getByText(/Only Admin \/ Manager \/ Director can complete the workshop receipt/)).toBeInTheDocument()
  })

  it('saves dispatch details as full ISO timestamps to both downtime and dispatch rows', async () => {
    saveDowntime.mockResolvedValue({ id: 'dt1', delivered_to_workshop_at: '2026-09-16T09:30:00.000Z' })
    render(<HandoverPanel accidentId="a1" elevated acc={{}} />)
    await screen.findByTestId('chip-route')
    fireEvent.change(screen.getByLabelText('Delivered to workshop'), { target: { value: '2026-09-16T09:30' } })
    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'New Carrier' } })
    fireEvent.click(screen.getByText('Save dispatch details'))
    await waitFor(() => expect(saveDowntime).toHaveBeenCalledTimes(1))
    const dt = saveDowntime.mock.calls[0][1]
    expect(dt.delivered_to_workshop_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    await waitFor(() => expect(saveDispatch).toHaveBeenCalledTimes(1))
    expect(saveDispatch.mock.calls[0][1]).toMatchObject({ carrier: 'New Carrier', live_status: 'in_transit', repair_order_id: 'ro1' })
    expect(saveDispatch.mock.calls[0][2]).toEqual({ existingId: 'd1' })
  })

  it('has no em or en dashes in any rendered string', async () => {
    render(<HandoverPanel accidentId="a1" elevated acc={{}} />)
    await screen.findByTestId('chip-route')
    expect(document.body.textContent).not.toMatch(/[–—]/)
  })
})
