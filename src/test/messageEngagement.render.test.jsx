import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const tables = {
  broadcast_recipient_receipts: [{ recipient_id: 'u1', read_at: 'x', acknowledged_at: null }],
  broadcast_replies: [],
  team_push_device_events: [{ user_id: 'u1', event_type: 'received_foreground', occurred_at: 'x' }],
}
let queueRows = [{ status: 'delivered', result: { push: 2 }, last_error: null }]
const builder = (rows) => { const b = { select: () => b, eq: () => b, order: () => b, limit: () => Promise.resolve({ data: rows, error: null }) }; return b }
vi.mock('../lib/api/_client', () => ({
  supabase: { from: (t) => builder(tables[t] || []) },
  toServiceError: (e) => e,
}))
vi.mock('../lib/api/teamMessaging', () => ({ listBroadcastPushQueue: () => Promise.resolve(queueRows) }))

import MessageEngagement from '../components/team/MessageEngagement'

const history = [{ id: 'b1', title: 'Safety', sent_at: '2026-10-22T00:00:00Z', recipient_count: 4 }]

describe('MessageEngagement delivery states', () => {
  it('labels provider acceptance without claiming OS delivery', async () => {
    render(<MessageEngagement history={history} />)
    fireEvent.change(screen.getByLabelText(/Sent communication/i), { target: { value: 'b1' } })
    await waitFor(() => expect(screen.getByTestId('delivery-headline')).toBeTruthy())
    expect(screen.getByTestId('delivery-headline').textContent).toBe('Accepted by push provider')
    for (const l of ['Queued', 'Opened in app', 'Failed']) expect(screen.getAllByText(l).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/OS[- ]delivered/i)
  })
  it('shows failed when the provider accepted no device', async () => {
    queueRows = [{ status: 'failed', last_error: 'HTTP 500' }]
    render(<MessageEngagement history={history} />)
    fireEvent.change(screen.getAllByLabelText(/Sent communication/i).at(-1), { target: { value: 'b1' } })
    await waitFor(() => expect(screen.getAllByTestId('delivery-headline').at(-1).textContent).toBe('Failed'))
    expect(document.body.textContent).toContain('HTTP 500')
  })
})
