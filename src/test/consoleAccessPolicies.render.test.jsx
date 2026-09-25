import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/api/accessPolicies', () => ({
  getAccessPolicies: vi.fn(async () => ({
    ip: {
      enabled: false, callerIp: '198.51.100.4', callerCovered: false,
      entries: [{ id: 'e1', label: 'Head office', cidr: '203.0.113.0/24', active: true, created_at: '2026-09-01T00:00:00Z', covers_caller: false }],
    },
    sso: {
      registeredProviders: 0, registeredDomains: [],
      orgs: [{ id: 'o1', name: 'Company A', connections: 0, active_connections: 0, active_domains: [], enforced_domains: [], required: false, affected_users: 0 }],
    },
  })),
  addAllowlistEntry: vi.fn(), setAllowlistEntryActive: vi.fn(), deleteAllowlistEntry: vi.fn(),
  setConsoleIpAllowlist: vi.fn(), setSsoRequired: vi.fn(),
}))

import ConsoleAccessPolicies from '../console/pages/ConsoleAccessPolicies'

describe('ConsoleAccessPolicies', () => {
  it('refuses to turn the allowlist on when your IP is not covered', async () => {
    render(<ConsoleAccessPolicies />)
    expect(await screen.findByText('Head office')).toBeTruthy()
    expect(screen.getByText('198.51.100.4')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Turn on/ }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Use my address/ })).toBeTruthy()
  })
  it('refuses to require SSO without an active, registered connection', async () => {
    render(<ConsoleAccessPolicies />)
    expect(await screen.findByText('Company A')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Require SSO/ }).disabled).toBe(true)
    expect(screen.getByText(/No active SSO connection/)).toBeTruthy()
  })
})
