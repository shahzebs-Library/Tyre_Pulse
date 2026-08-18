import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * The builder end of role targeting and the icon picker.
 *
 * The payload is asserted on the object the builder hands the service, because
 * that is where the back-compat rule lives: nothing selected must save NULL
 * (never []), or every untargeted checklist would start reading as one that was
 * deliberately narrowed to nobody.
 */

const updateTemplate = vi.fn(() => Promise.resolve({ id: 't1' }))

const TEMPLATE = {
  id: 't1', name: 'Workshop Sheet', description: '', category: 'Workshop',
  // The seeded shape: a lucide component name, which the old preview printed
  // on screen as the literal word.
  icon: 'ClipboardCheck',
  status: 'draft', version: 1, require_signature: false, require_approval: false,
  scored: false, pass_threshold: null, country: 'KSA',
  fields: [{ id: 'q1', type: 'text', label: 'Notes', required: false }],
  assignee_roles: null,
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
// The live role list is a database read; the picker must work without it, so it
// is stubbed to the two trades V591 created.
vi.mock('../lib/api/customRoles', () => ({
  listAssignableRoles: () => Promise.resolve(['Admin', 'Mechanic', 'Electrician', 'Driver']),
  ASSIGNABLE_BUILTIN_ROLES: ['Admin', 'Manager', 'Director', 'Driver', 'Tyre Man'],
}))

import ChecklistBuilder from '../pages/ChecklistBuilder'

async function openBuilder() {
  render(<ChecklistBuilder />)
  await waitFor(() => expect(screen.getByDisplayValue('Workshop Sheet')).toBeInTheDocument())
}

const savedValues = () => updateTemplate.mock.calls.at(-1)[1]

beforeEach(() => { updateTemplate.mockClear() })

describe('ChecklistBuilder role targeting', () => {
  it('saves NULL when no role is selected', async () => {
    await openBuilder()
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().assignee_roles).toBeNull()
  })

  it('saves the two roles that were picked', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Mechanic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Electrician' }))
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().assignee_roles).toEqual(['Mechanic', 'Electrician'])
  })

  it('de-selecting the last role goes back to NULL, not an empty array', async () => {
    await openBuilder()
    const mech = screen.getByRole('button', { name: 'Mechanic' })
    fireEvent.click(mech)
    fireEvent.click(mech)
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().assignee_roles).toBeNull()
  })

  it('offers the trades V591 created, which no picker could reach before', async () => {
    await openBuilder()
    expect(screen.getByRole('button', { name: 'Mechanic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Electrician' })).toBeInTheDocument()
  })

  it('says "Everyone" while nothing is selected and names the roles once they are', async () => {
    await openBuilder()
    expect(screen.getByText(/^Everyone\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Driver' }))
    expect(screen.getByText(/Offered to Driver/)).toBeInTheDocument()
  })
})

describe('ChecklistBuilder icon picker', () => {
  it('does not print the stored lucide name anywhere on screen', async () => {
    await openBuilder()
    expect(screen.queryByText(/ClipboardCheck/)).toBeNull()
  })

  it('leaves the stored icon untouched when nothing is picked', async () => {
    // Opening a template and pressing Save must not silently rewrite the author's
    // icon into a different vocabulary.
    await openBuilder()
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().icon).toBe('ClipboardCheck')
  })

  it('saves the TOKEN when an icon is picked from the grid', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Electrical' }))
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().icon).toBe('bolt')
  })

  it('keeps the emoji route working as a secondary choice', async () => {
    await openBuilder()
    fireEvent.click(screen.getByText('Use an emoji instead'))
    fireEvent.click(screen.getByTitle('Use 🛞'))
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(savedValues().icon).toBe('🛞')
  })
})
