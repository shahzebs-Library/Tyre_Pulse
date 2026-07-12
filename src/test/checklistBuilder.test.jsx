import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Regression guard: editing a template (/checklist-builder/:id) starts with a
// null draft until the fetch lands. A `const scored = !!draft.scored` ran before
// any load guard and threw "Cannot read properties of null (reading 'scored')"
// on the live site. These tests render edit mode and assert it survives the
// null-draft first render and then shows the loaded template.

const TEMPLATE = {
  id: 't1', name: 'Daily Safety Check', description: '', category: 'Safety', icon: null,
  status: 'draft', version: 1, require_signature: false, require_approval: false,
  scored: false, pass_threshold: null,
  fields: [{ id: 'q1', type: 'text', label: 'Notes', required: false }],
  country: 'KSA',
}

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 't1' }),
  useNavigate: () => vi.fn(),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../lib/api/checklists', () => ({
  getTemplate: () => Promise.resolve(TEMPLATE),
  createTemplate: vi.fn(() => Promise.resolve(TEMPLATE)),
  updateTemplate: vi.fn(() => Promise.resolve(TEMPLATE)),
  publishTemplate: vi.fn(() => Promise.resolve(TEMPLATE)),
}))

import ChecklistBuilder from '../pages/ChecklistBuilder'

describe('ChecklistBuilder edit mode', () => {
  it('renders without crashing while the draft is loading, then shows the template', async () => {
    // If the null-draft guard regressed, this render throws synchronously.
    render(<ChecklistBuilder />)
    // The loaded template's name appears in the name input once the fetch lands.
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Daily Safety Check')
      expect(nameInput).toBeInTheDocument()
    })
  })
})
