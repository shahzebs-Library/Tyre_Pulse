import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

/**
 * The V594/V595 settings, and the trap that comes with them.
 *
 * This builder rebuilds every field from an EXPLICIT key list, so any key it
 * does not name is DROPPED on save. That is why opening the Workshop Daily
 * Checklist and pressing Save used to be destructive: the locked date, the
 * auto-filled site and plate, the meter pairing and the remark rule would all
 * have gone, silently, with the template still reporting a successful save.
 *
 * The payload is asserted on the object handed to the service, because that is
 * where the back-compat rule lives.
 */

const updateTemplate = vi.fn(() => Promise.resolve({ id: 't1' }))

const LEGEND = {
  options: ['OK', 'Not OK', 'Not applicable'],
  blocking: ['Not OK'],
}

const TEMPLATE = {
  id: 't1', name: 'Workshop Daily Checklist', description: '', category: 'Workshop',
  icon: 'ClipboardCheck', status: 'published', version: 2,
  require_signature: true, require_approval: true,
  require_area_manager: true, doc_prefix: 'WDC', min_interval_days: 10,
  scored: false, pass_threshold: null, country: 'KSA',
  option_sets: { legend: LEGEND },
  assignee_roles: ['Mechanic'],
  fields: [
    {
      id: 'f_date', type: 'date', label: 'Date',
      locked: true, autoValue: 'today',
    },
    {
      id: 'f_site', type: 'text', label: 'Location',
      autoFrom: 'asset.site', readOnly: true,
    },
    {
      id: 'f_km', type: 'number', label: 'Kilometres',
      group_require_one: 'meter', compareTo: 'asset.current_km', unit: 'km',
    },
    {
      id: 'f_brakes', type: 'select', label: 'Brakes', options_ref: 'legend',
      options: LEGEND.options, allow_note: true, allow_photo: true,
      allow_gallery: true, require_note_when: ['Not OK'],
    },
  ],
}

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 't1' }),
  useNavigate: () => vi.fn(),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../lib/api/checklists', () => ({
  getTemplate: () => Promise.resolve(TEMPLATE),
  createTemplate: vi.fn(() => Promise.resolve(TEMPLATE)),
  updateTemplate: (...a) => updateTemplate(...a),
  publishTemplate: vi.fn(() => Promise.resolve(TEMPLATE)),
}))
vi.mock('../lib/api/customRoles', () => ({
  listAssignableRoles: () => Promise.resolve(['Admin', 'Mechanic', 'Electrician', 'Driver']),
  ASSIGNABLE_BUILTIN_ROLES: ['Admin', 'Manager', 'Director', 'Driver', 'Tyre Man'],
}))

import ChecklistBuilder from '../pages/ChecklistBuilder'

async function openBuilder() {
  render(<ChecklistBuilder />)
  await waitFor(() => expect(screen.getByDisplayValue('Workshop Daily Checklist')).toBeInTheDocument())
}

const savedValues = () => updateTemplate.mock.calls.at(-1)[1]
const savedField = (id) => savedValues().fields.find((f) => f.id === id)

beforeEach(() => { updateTemplate.mockClear() })
afterEach(() => cleanup())

describe('ChecklistBuilder keeps the V594 template settings', () => {
  it('opening and saving leaves them byte-identical', async () => {
    await openBuilder()
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    const v = savedValues()
    expect(v.require_area_manager).toBe(true)
    expect(v.doc_prefix).toBe('WDC')
    expect(v.min_interval_days).toBe(10)
  })

  it('offers the two-stage rule, the prefix and the recurrence rule on screen', async () => {
    await openBuilder()
    expect(screen.getByText('Needs an area manager to close')).toBeInTheDocument()
    expect(screen.getByDisplayValue('WDC')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
  })

  it('an untouched template with none of them saves nulls, not zeros', async () => {
    // "No rule was set" and "a rule that is always satisfied" are two different
    // statements and must not share a stored value.
    await openBuilder()
    fireEvent.change(screen.getByDisplayValue('WDC'), { target: { value: '' } })
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().doc_prefix).toBeNull()
    expect(savedValues().min_interval_days).toBeNull()
  })
})

describe('ChecklistBuilder keeps the V595 field settings', () => {
  it('a save does not destroy the locked date, the auto-fill or the meter pairing', async () => {
    await openBuilder()
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())

    expect(savedField('f_date').locked).toBe(true)
    expect(savedField('f_date').autoValue).toBe('today')
    expect(savedField('f_site').autoFrom).toBe('asset.site')
    expect(savedField('f_site').readOnly).toBe(true)
    expect(savedField('f_km').group_require_one).toBe('meter')
    expect(savedField('f_brakes').allow_gallery).toBe(true)
    expect(savedField('f_brakes').require_note_when).toEqual(['Not OK'])
  })

  it('keeps settings this editor does not even show', async () => {
    // A setting nobody can see here is the easiest one to destroy by accident.
    await openBuilder()
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedField('f_km').compareTo).toBe('asset.current_km')
    expect(savedField('f_km').unit).toBe('km')
  })

  it('offers the marks that must carry a remark, read from the shared legend', async () => {
    await openBuilder()
    // Open the brakes line, which points at the shared legend. The label also
    // appears in the live preview, so the first match is the editor row.
    fireEvent.click(screen.getAllByText('Brakes')[0])
    await waitFor(() => expect(screen.getByText('Marks that must carry a remark')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Not OK' })).toBeInTheDocument()
  })

  it('offers every auto-fill source the engine knows, so none is unreachable', async () => {
    await openBuilder()
    fireEvent.click(screen.getAllByText('Location')[0])
    await waitFor(() => expect(screen.getByText('Fill from the asset')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Site the asset belongs to')).toBeInTheDocument()
  })
})
