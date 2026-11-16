import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => {
  const names = []
  const removed = []
  const makeChannel = (name) => {
    const ch = { name, on: vi.fn(() => ch), subscribe: vi.fn(() => ch) }
    return ch
  }
  const query = {
    select: () => query, eq: () => query, order: () => query,
    limit: () => Promise.resolve({ data: [] }),
  }
  return {
    names, removed,
    supabase: {
      channel: vi.fn((name) => { names.push(name); return makeChannel(name) }),
      removeChannel: vi.fn((ch) => { removed.push(ch.name) }),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'u1' } } })) },
      from: vi.fn(() => query),
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
vi.mock('../lib/notifications', () => ({
  fetchLatestAlerts: vi.fn(() => Promise.resolve([])),
  markNotificationRead: vi.fn(),
  countUnread: vi.fn(() => 0),
}))

const { useRealtimeAlerts, uniqueChannelName } = await import('../hooks/useRealtimeAlerts')

function Probe() { useRealtimeAlerts(); return null }

beforeEach(() => { h.names.length = 0; h.removed.length = 0 })

describe('useRealtimeAlerts - realtime channel names (D2)', () => {
  it('uniqueChannelName never repeats for the same base', () => {
    const a = uniqueChannelName('x')
    const b = uniqueChannelName('x')
    expect(a).not.toBe(b)
    expect(a.startsWith('x:')).toBe(true)
  })

  it('two mounted instances subscribe distinct channels and remove every one on unmount', async () => {
    render(<><Probe /><Probe /></>)
    await waitFor(() => expect(h.names.length).toBe(4))
    expect(new Set(h.names).size).toBe(4)
    expect(h.names.filter((n) => n.startsWith('tp-realtime-alerts:')).length).toBe(2)
    expect(h.names.filter((n) => n.startsWith('tp-db-notifications:')).length).toBe(2)
    cleanup()
    expect(new Set(h.removed)).toEqual(new Set(h.names))
  })
})
