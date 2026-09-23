import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const h = vi.hoisted(() => ({ callback: null, read: vi.fn(), update: vi.fn(), dismiss: vi.fn(), waiting: { postMessage: vi.fn() } }))
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: options => { h.callback = options; return { needRefresh: [true,h.dismiss], offlineReady: [false,vi.fn()], updateServiceWorker: h.update } } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' }, hasPermission: () => true }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', t: key => key }) }))
vi.mock('../lib/releases', async original => ({ ...await original(), readWaitingRelease: h.read }))
import PwaUpdatePrompt from '../components/PwaUpdatePrompt'
beforeEach(() => { h.read.mockReset(); h.update.mockReset().mockResolvedValue(undefined); h.dismiss.mockReset() })
it('keeps update available when release details cannot be obtained', async () => {
  render(<MemoryRouter><PwaUpdatePrompt /></MemoryRouter>)
  fireEvent.click(screen.getByText('pwa.reloadUpdate'))
  await waitFor(() => expect(h.update).toHaveBeenCalledWith(true))
  expect(screen.getByText('pwa.notesUnavailable')).toBeTruthy()
})
it('shows an update error without removing the retry action', async () => {
  h.update.mockRejectedValue(new Error('offline'))
  render(<MemoryRouter><PwaUpdatePrompt /></MemoryRouter>)
  fireEvent.click(screen.getByText('pwa.reloadUpdate'))
  expect(await screen.findByText('pwa.updateFailed')).toBeTruthy()
  expect(screen.getByText('pwa.reloadUpdate')).toBeTruthy()
})
