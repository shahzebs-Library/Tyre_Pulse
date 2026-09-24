import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../console/components/ui/charts', () => ({ TrendChart: () => <div data-testid="trend" /> }))
const revoke = vi.fn(async () => ({ ok: true }))
vi.mock('../lib/api/apiKeyAdmin', () => ({
  listAllApiKeys: vi.fn(async () => ({
    keys: [
      { id: 'a', name: 'ERP sync', key_prefix: 'tp_1234567', scopes: ['read'], active: true, organisation_id: 'o1', organisation_name: 'Company A', created_at: '2026-01-01T00:00:00Z', last_used_at: null, expires_at: null, requests_last_hour: 0 },
      { id: 'b', name: 'Old BI', key_prefix: 'tp_7654321', scopes: ['read'], active: false, organisation_id: 'o1', organisation_name: 'Company A', created_at: '2026-01-01T00:00:00Z', revoked_at: '2026-02-01T00:00:00Z', revoke_reason: 'leaked key' },
    ],
    usageLastHour: [], maxAgeDays: 365, generatedAt: '2026-09-24T00:00:00Z',
  })),
  revokeApiKeyAsAdmin: (...a) => revoke(...a),
  setApiKeyExpiry: vi.fn(),
}))

import ConsoleApiKeys from '../console/pages/ConsoleApiKeys'

describe('ConsoleApiKeys', () => {
  it('shows prefixes, findings and requires a reason to revoke', async () => {
    render(<ConsoleApiKeys />)
    expect(await screen.findByText('ERP sync')).toBeTruthy()
    expect(screen.getByText('tp_1234567...')).toBeTruthy()
    expect(screen.getAllByText('No expiry').length).toBeGreaterThan(0)
    expect(screen.getByText(/leaked key/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Revoke$/ }))
    const btn = await screen.findByRole('button', { name: /Revoke key/ })
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/public repository/), { target: { value: 'no longer used' } })
    fireEvent.click(screen.getByRole('button', { name: /Revoke key/ }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('a', 'no longer used'))
  })
})
