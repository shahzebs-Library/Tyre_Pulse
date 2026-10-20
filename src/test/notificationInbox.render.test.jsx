import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => ({ rows: [], error: null, loading: false, enabled: true, markRead: vi.fn(), markAllRead: vi.fn(), dismiss: vi.fn(), clearAll: vi.fn(), refresh: vi.fn() }))
vi.mock('../hooks/useFeatureFlags', () => ({ useFeatureGate: () => h.enabled }))
vi.mock('../hooks/useRealtimeAlerts', () => ({ useRealtimeAlerts: () => ({ notifications: h.rows, unreadCount: h.rows.filter(n => !n.read).length, error: h.error, loading: h.loading, markRead: h.markRead, markAllRead: h.markAllRead, dismiss: h.dismiss, clearAll: h.clearAll, refresh: h.refresh, relativeTime: () => '8m ago' }) }))
import NotificationCenter from '../components/NotificationCenter'

function CurrentRoute() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}{location.search}</output> }
function setup() {
  render(<MemoryRouter><NotificationCenter /><CurrentRoute /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
  return screen.getByRole('dialog', { name: 'Notifications' })
}
const row = (id, extra = {}) => ({ id, title: 'Inspection awaiting approval', message: 'TM671 at QIDDIYA needs your sign-off.', type: 'approval', severity: 'Medium', entityType: 'inspection', entityId: 'record-1', timestamp: new Date().toISOString(), read: false, ...extra })

beforeEach(() => { vi.clearAllMocks(); h.rows = [row('one'), row('two')]; h.error = null; h.loading = false; h.enabled = true })
afterEach(cleanup)

describe('notification inbox interactions', () => {
  it('groups same-record updates and marks each unread original ID on review, keeping existing routing', () => {
    const panel = setup()
    expect(within(panel).getAllByText('Inspection awaiting approval')).toHaveLength(1)
    expect(within(panel).getByText('2 updates')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Review approval' }))
    expect(h.markRead.mock.calls).toEqual([['one'], ['two']])
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/approvals')
  })
  it('search and filters have resettable empty states without marking records read', () => {
    const panel = setup()
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'LAHEQ' } })
    expect(within(panel).getByText('No matching notifications')).toBeTruthy()
    expect(h.markRead).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset filters' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Critical', exact: true }))
    expect(within(panel).getByText('No matching notifications')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Read', exact: true }))
    expect(within(panel).getByText('0 of 2 loaded')).toBeTruthy()
  })
  it('preserves grouped mark-read and dismissal actions without navigating', () => {
    const panel = setup()
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark read', exact: true }))
    expect(h.markRead.mock.calls).toEqual([['one'], ['two']])
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss updates' }))
    expect(h.dismiss.mock.calls).toEqual([['one'], ['two']])
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/')
  })
  it('opens notification preferences on the real settings tab', () => {
    const panel = setup()
    expect(within(panel).getByRole('link', { name: 'Notification settings' })).toHaveAttribute('href', '/settings?tab=notifications')
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark all read' }))
    expect(h.markAllRead).toHaveBeenCalledOnce()
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear loaded feed' }))
    expect(h.clearAll).toHaveBeenCalledOnce()
  })
  it('keeps cached rows visible during errors and provides retry', () => {
    h.error = 'Could not refresh'
    const panel = setup()
    expect(within(panel).getByRole('alert')).toHaveTextContent('Could not refresh')
    expect(within(panel).getByText('2 updates')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    expect(h.refresh).toHaveBeenCalledOnce()
  })
  it('close returns focus to the notification bell', () => {
    const panel = setup()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close notifications' }))
    expect(screen.getByRole('button', { name: /Notifications/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /Notifications/ })).toHaveAttribute('aria-expanded', 'false')
  })
  it('preserves loading, empty and feature-gated states', () => {
    h.rows = []; h.loading = true
    const panel = setup()
    expect(within(panel).getByRole('status')).toHaveTextContent('Loading notifications')
    cleanup(); h.loading = false
    expect(within(setup()).getByText('You’re all caught up')).toBeTruthy()
    cleanup(); h.enabled = false
    render(<MemoryRouter><NotificationCenter /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull()
  })
})
