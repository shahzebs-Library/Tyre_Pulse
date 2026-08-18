import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * The fill screen must not ask twice.
 *
 * Every published template carries its own asset field and its own site field,
 * so the old header block asked for both a second time one card higher up -
 * which is exactly what the owner reported. The rule that removes the duplicate
 * is DERIVED from the template's fields, never from its name, so these tests
 * drive both directions: a sheet that asks for the asset itself loses the header
 * input and still records the asset, and a sheet that does not keeps it.
 *
 * Everything below uses the REAL fieldTypes + checklistMarks engines; only the
 * data, context and navigation seams are mocked.
 */

const nav = vi.fn()
const createSubmission = vi.fn(() => Promise.resolve({ id: 's1' }))
const getAssetByNo = vi.fn(() => Promise.resolve(null))
const listSubmissions = vi.fn(() => Promise.resolve([]))
let TEMPLATE = null

vi.mock('react-router-dom', () => ({
  useParams: () => ({ templateId: 't1' }),
  useNavigate: () => nav,
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}))
vi.mock('../lib/api/checklistSchedules', () => ({ completeAssignment: vi.fn(() => Promise.resolve()) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', full_name: 'Sam', role: 'Manager' } }) }))
vi.mock('../components/SignaturePad', () => ({
  default: ({ label, onSave }) => (
    <button type="button" onClick={() => onSave(`data:image/png;base64,SIG-${label}`)}>capture-signature</button>
  ),
}))
// The live picker loads the fleet over the network; here it is just the control
// the operator types the asset into, which is all this page cares about.
vi.mock('../components/checklist/ReferencePicker', () => ({
  default: ({ source, value, onChange }) => (
    <input
      aria-label={`picker-${source}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))
vi.mock('../lib/api/assets', () => ({ getAssetByNo: (...a) => getAssetByNo(...a) }))
vi.mock('../lib/api/checklists', () => ({
  getTemplate: () => Promise.resolve(TEMPLATE),
  createSubmission: (...a) => createSubmission(...a),
  uploadChecklistPhoto: () => Promise.resolve('https://cdn/x.jpg'),
  listSubmissions: (...a) => listSubmissions(...a),
}))

import ChecklistRun from '../pages/ChecklistRun'

beforeEach(() => {
  nav.mockClear(); createSubmission.mockClear()
  getAssetByNo.mockClear(); getAssetByNo.mockResolvedValue(null)
  listSubmissions.mockClear(); listSubmissions.mockResolvedValue([])
})

const ready = () => screen.findByRole('button', { name: /Submit/i })
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Submit/i }))
const payload = () => createSubmission.mock.calls[0][0]

const LEGEND = {
  options: ['OK', 'Not OK', 'Not applicable'],
  meta: [
    { value: 'OK', icon: 'ok', tone: 'good', meaning: 'Checked and correct.' },
    { value: 'Not OK', icon: 'fault', tone: 'bad', meaning: 'A fault is present.' },
    { value: 'Not applicable', icon: 'na', tone: 'muted', meaning: 'Not on this machine.' },
  ],
  blocking: ['Not OK'],
  require_note: ['Not OK'],
}

describe('the header does not ask what the sheet already asks', () => {
  it('drops the asset input when the template has an asset field, and records the asset from the ANSWER', async () => {
    TEMPLATE = {
      id: 't1', name: 'Workshop Daily Checklist', version: 1,
      fields: [{ id: 'f_ws_asset', type: 'asset', label: 'Asset / GCC code' }],
    }
    render(<ChecklistRun />)
    await ready()

    // Asked once, on the sheet - not in the header.
    expect(screen.queryByLabelText('Asset No.')).toBeNull()
    expect(screen.getByLabelText('picker-asset')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('picker-asset'), { target: { value: 'TM514' } })
    await waitFor(() => expect(getAssetByNo).toHaveBeenCalledWith('TM514', 'KSA'))

    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().asset_no).toBe('TM514')
    expect(payload().answers.f_ws_asset).toBe('TM514')
  })

  it('keeps the header inputs for a template that asks for neither', async () => {
    TEMPLATE = { id: 't1', name: 'Plain', version: 1, fields: [{ id: 'q1', type: 'text', label: 'Notes' }] }
    render(<ChecklistRun />)
    await ready()

    const assetInput = screen.getByLabelText('Asset No.')
    const siteInput = screen.getByLabelText('Site')
    fireEvent.change(assetInput, { target: { value: 'TRK-1024' } })
    fireEvent.change(siteInput, { target: { value: 'NHC' } })

    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().asset_no).toBe('TRK-1024')
    expect(payload().site).toBe('NHC')
  })

  it('drops the site input when the template has a site field, and records the site from the ANSWER', async () => {
    TEMPLATE = {
      id: 't1', name: 'Fleet Transit Mixer Checklist', version: 1,
      fields: [{ id: 'f_tm_site', type: 'site', label: 'Location' }],
    }
    render(<ChecklistRun />)
    await ready()

    expect(screen.queryByLabelText('Site')).toBeNull()
    fireEvent.change(screen.getByLabelText('picker-site'), { target: { value: 'DIRIYAH-G1' } })

    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().site).toBe('DIRIYAH-G1')
  })

  it('treats a field filled from the register site as the same question', async () => {
    TEMPLATE = {
      id: 't1', name: 'Workshop', version: 1,
      fields: [{ id: 'loc', type: 'text', label: 'Location', autoFrom: 'asset.site' }],
    }
    render(<ChecklistRun />)
    await ready()
    expect(screen.queryByLabelText('Site')).toBeNull()
  })
})

describe('the reference is minted server-side', () => {
  it('does not ask for a title when the template has a prefix, and says what will happen', async () => {
    TEMPLATE = { id: 't1', name: 'Workshop Daily Checklist', version: 1, doc_prefix: 'WDC', fields: [] }
    render(<ChecklistRun />)
    await ready()

    expect(screen.queryByLabelText('Title / Reference')).toBeNull()
    expect(screen.getByText(/Reference: WDC - assigned automatically when you submit/i)).toBeInTheDocument()

    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().title).toBe('Workshop Daily Checklist')
  })

  it('keeps the title input for a template with no prefix', async () => {
    TEMPLATE = { id: 't1', name: 'Plain', version: 1, fields: [] }
    render(<ChecklistRun />)
    await ready()
    fireEvent.change(screen.getByLabelText('Title / Reference'), { target: { value: 'Morning round' } })
    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().title).toBe('Morning round')
  })
})

describe('the asset fills the sheet', () => {
  const REGISTER_TEMPLATE = {
    id: 't1', name: 'Workshop Daily Checklist', version: 1,
    fields: [
      { id: 'f_ws_asset', type: 'asset', label: 'Asset / GCC code' },
      { id: 'f_ws_site', type: 'site', label: 'Location', autoFrom: 'asset.site', readOnly: true },
      { id: 'f_ws_reg', type: 'text', label: 'Registration / fleet No', autoFrom: 'asset.fleet_no', readOnly: true },
    ],
  }

  it('fills and LOCKS a read-only field once the register supplied a value', async () => {
    getAssetByNo.mockResolvedValue({ asset_no: 'TM514', site: 'NHC', fleet_number: 'FN-77', vehicle_type: 'TR-MIXER' })
    TEMPLATE = REGISTER_TEMPLATE
    render(<ChecklistRun />)
    await ready()
    fireEvent.change(screen.getByLabelText('picker-asset'), { target: { value: 'TM514' } })

    await waitFor(() => expect(screen.getByText('FN-77')).toBeInTheDocument())
    expect(screen.getAllByText(/From the asset register/i).length).toBeGreaterThan(0)

    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().answers.f_ws_reg).toBe('FN-77')
    expect(payload().site).toBe('NHC')
  })

  it('leaves a read-only field TYPEABLE when the register has nothing for it', async () => {
    // fleet_number is set on 398 of 1,030 KSA assets and on none of the UAE or
    // Egypt ones. An unconditional lock would be permanently blank there.
    getAssetByNo.mockResolvedValue({ asset_no: 'UAE-9', site: null, fleet_number: null })
    TEMPLATE = REGISTER_TEMPLATE
    render(<ChecklistRun />)
    await ready()
    fireEvent.change(screen.getByLabelText('picker-asset'), { target: { value: 'UAE-9' } })

    await waitFor(() => expect(screen.getAllByText(/register has no value for this machine/i).length).toBeGreaterThan(0))
    const box = screen.getByLabelText('picker-site')  // site field still a live control
    expect(box).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Enter value'), { target: { value: 'PLATE-1' } })
    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().answers.f_ws_reg).toBe('PLATE-1')
  })
})

describe('the close gates', () => {
  const MARKED = {
    id: 't1', name: 'Workshop', version: 1,
    option_sets: { legend: LEGEND },
    fields: [{ id: 'q1', type: 'select', label: 'Brakes', options: LEGEND.options, options_ref: 'legend', allow_note: true }],
  }

  it('blocks submit when a fault carries no remark, and names the line', async () => {
    TEMPLATE = MARKED
    render(<ChecklistRun />)
    await ready()
    fireEvent.click(screen.getByTitle('Not OK'))
    submit()
    await waitFor(() => expect(screen.getByText(/A remark is required on: Brakes/i)).toBeInTheDocument())
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('records a fault with a remark - a fault stops CLOSING, never submitting', async () => {
    TEMPLATE = MARKED
    render(<ChecklistRun />)
    await ready()
    fireEvent.click(screen.getByTitle('Not OK'))
    fireEvent.change(screen.getByPlaceholderText(/Remarks/i), { target: { value: 'Pads worn' } })

    // The screen says what the approval trigger will refuse, before anyone signs.
    expect(screen.getByText(/cannot be closed/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Submit with faults recorded/i }))
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().answers.q1).toBe('Not OK')
    expect(payload().notes).toEqual({ q1: 'Pads worn' })
  })
})

describe('km and hour meter are one pair', () => {
  const METERS = {
    id: 't1', name: 'Workshop', version: 1,
    fields: [
      { id: 'km', type: 'number', label: 'Km reading', group_require_one: 'meter' },
      { id: 'hr', type: 'number', label: 'Hour meter reading', group_require_one: 'meter' },
    ],
  }

  it('blocks submit when neither reading is given', async () => {
    TEMPLATE = METERS
    render(<ChecklistRun />)
    await ready()
    submit()
    await waitFor(() => expect(screen.getByText(/Record at least one meter reading/i)).toBeInTheDocument())
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('accepts ZERO as a reading - zero is a reading, not a blank', async () => {
    TEMPLATE = METERS
    render(<ChecklistRun />)
    await ready()
    // The hour meter is the second number box; the label is not linked to the
    // input, so the control is addressed by role.
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '0' } })
    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
    expect(payload().answers.hr).toBe('0')
  })
})

describe('the 10-day rule is advisory', () => {
  it('warns that the machine is not due, and never refuses the check', async () => {
    TEMPLATE = {
      id: 't1', name: 'Workshop Daily Checklist', version: 1, min_interval_days: 10,
      fields: [{ id: 'f_ws_asset', type: 'asset', label: 'Asset' }],
    }
    listSubmissions.mockResolvedValue([
      { id: 'p1', document_no: 'WDC-TM514-2026-0001', submitted_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    ])
    render(<ChecklistRun />)
    await ready()
    fireEvent.change(screen.getByLabelText('picker-asset'), { target: { value: 'TM514' } })

    await waitFor(() => expect(screen.getByText(/not due yet/i)).toBeInTheDocument())
    expect(screen.getByText(/WDC-TM514-2026-0001/)).toBeInTheDocument()

    submit()
    await waitFor(() => expect(createSubmission).toHaveBeenCalledTimes(1))
  })

  it('says nothing when the history could not be read', async () => {
    TEMPLATE = {
      id: 't1', name: 'Workshop Daily Checklist', version: 1, min_interval_days: 10,
      fields: [{ id: 'f_ws_asset', type: 'asset', label: 'Asset' }],
    }
    listSubmissions.mockRejectedValue(new Error('network'))
    render(<ChecklistRun />)
    await ready()
    fireEvent.change(screen.getByLabelText('picker-asset'), { target: { value: 'TM514' } })
    await waitFor(() => expect(listSubmissions).toHaveBeenCalled())
    expect(screen.queryByText(/not due yet/i)).toBeNull()
  })
})
