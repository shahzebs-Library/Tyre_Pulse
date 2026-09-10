import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const h = vi.hoisted(() => ({ role: 'Fleet Supervisor', grant: true, language: 'en' }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: h.role }, hasPermission: () => h.grant }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: h.language, t: key => key }) }))
import UpdateHistory, { ReleaseNotes } from '../components/ReleaseNotes'
const releases = [{ id: 'one', date: '2026-09-10', changes: [{ modules: ['vehicle_washing'], text: { en: 'Washing improved', ar: 'تحسين الغسيل' } }] }]
beforeEach(() => { h.role = 'Fleet Supervisor'; h.grant = true; h.language = 'en' })
it('removes notes immediately when module access is revoked', () => {
  const view = render(<ReleaseNotes releases={releases} />)
  expect(screen.getByText('Washing improved')).toBeTruthy()
  h.grant = false; view.rerender(<ReleaseNotes releases={releases} />)
  expect(screen.queryByText('Washing improved')).toBeNull()
})
it('renders Arabic notes', () => {
  h.language = 'ar'
  render(<ReleaseNotes releases={releases} />)
  expect(screen.getByText('تحسين الغسيل')).toBeTruthy()
})
it('opens the history when linked from the update notice', () => {
  const { container } = render(<MemoryRouter initialEntries={['/settings#updates']}><UpdateHistory /></MemoryRouter>)
  expect(container.querySelector('#updates').open).toBe(true)
})
