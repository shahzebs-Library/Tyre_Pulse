import { it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../contexts/LanguageContext', async importOriginal => (await import('./workforceLanguageMock.js')).mockWorkforceLanguage(importOriginal))
vi.mock('../lib/api/workforceAssignments', () => ({
  recommendAssignees: vi.fn(() => Promise.reject(new Error('boom'))),
  qualificationReasonText: c => c,
}))

import AssigneeRecommendations from '../components/workforce/AssigneeRecommendations'

it('a failed recommendation read shows an error instead of spinning forever', async () => {
  render(<AssigneeRecommendations taskType="tyre change" site="NHC" selectedId="" onPick={() => {}} />)
  expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toBeInTheDocument()
  expect(screen.queryByText(/Checking qualifications/)).toBeNull()
})
