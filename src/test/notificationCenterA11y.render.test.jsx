import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../hooks/useFeatureFlags', () => ({ useFeatureGate: () => true }))
vi.mock('../hooks/useRealtimeAlerts', () => ({
  useRealtimeAlerts: () => ({
    notifications: [{
      id: 'n1', title: 'Pressure low', message: 'TM514 LHF1', severity: 'High',
      read: false, timestamp: new Date().toISOString(), type: 'alert',
    }],
    unreadCount: 1,
    loading: false,
    error: null,
    refresh: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearAll: vi.fn(),
    dismiss: vi.fn(),
    relativeTime: () => 'just now',
  }),
}))

import NotificationCenter from '../components/NotificationCenter'

function setup() {
  render(<MemoryRouter><NotificationCenter /></MemoryRouter>)
  return screen.getByRole('button', { name: /Notifications/ })
}

describe('NotificationCenter keyboard contract', () => {
  it('reports expanded state and exposes a labelled dialog', () => {
    const bell = setup()
    expect(bell.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(bell)
    expect(bell.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy()
  })

  it('Escape closes the panel and returns focus to the bell', async () => {
    const bell = setup()
    fireEvent.click(bell)
    const row = screen.getByText('Pressure low').closest('[role="button"]')
    row.focus()
    expect(document.activeElement).toBe(row)
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(bell.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(bell)
  })

  it('a notification row is operable from the keyboard', () => {
    const bell = setup()
    fireEvent.click(bell)
    const row = screen.getByText('Pressure low').closest('[role="button"]')
    expect(row.getAttribute('tabindex')).toBe('0')
  })
})
