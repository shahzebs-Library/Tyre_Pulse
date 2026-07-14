import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Light render test for the Per-User Grants screen. Mocks the two service
// boundaries (users + accessGrants) and useAuth (super admin), asserts the user
// directory renders and that Save calls setUserAccessGrant with the picked
// module + effect. Supabase is stubbed so importing permissionMatrix.js (which
// pulls ./supabase at module load) has no side effects.

vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) } }))

const USERS = [
  { id: 'u1', full_name: 'Ayesha Khan', email: 'ayesha@fleet.io', role: 'Inspector', is_super_admin: false },
  { id: 'u2', full_name: 'Omar Farid', email: 'omar@fleet.io', role: 'Manager', is_super_admin: true },
]

const listProfiles = vi.fn(() => Promise.resolve(USERS))
vi.mock('../lib/api/users', () => ({ listProfiles: (...a) => listProfiles(...a) }))

const listUserGrants = vi.fn(() => Promise.resolve([]))
const setUserAccessGrant = vi.fn(() => Promise.resolve('grant-1'))
const revokeUserAccessGrant = vi.fn(() => Promise.resolve())
vi.mock('../lib/api/accessGrants', () => ({
  listUserGrants: (...a) => listUserGrants(...a),
  setUserAccessGrant: (...a) => setUserAccessGrant(...a),
  revokeUserAccessGrant: (...a) => revokeUserAccessGrant(...a),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isSuperAdmin: true, profile: { id: 'me', role: 'Admin', is_super_admin: true } }),
}))

const AccessGrantsManager = (await import('./AccessGrantsManager')).default

beforeEach(() => {
  listProfiles.mockClear()
  listUserGrants.mockClear()
  setUserAccessGrant.mockClear()
  revokeUserAccessGrant.mockClear()
})

describe('AccessGrantsManager', () => {
  it('renders the user directory from listProfiles', async () => {
    render(createElement(AccessGrantsManager))
    expect(await screen.findByText('Ayesha Khan')).toBeInTheDocument()
    expect(screen.getByText('Omar Farid')).toBeInTheDocument()
    expect(listProfiles).toHaveBeenCalled()
  })

  it('saves a grant with the selected module and effect', async () => {
    render(createElement(AccessGrantsManager))

    // Select a user -> loads their (empty) grants
    fireEvent.click(await screen.findByText('Ayesha Khan'))
    await waitFor(() => expect(listUserGrants).toHaveBeenCalledWith('u1'))

    // Pick a module in the inline picker (Analytics is a known catalog label)
    fireEvent.click(await screen.findByText('Analytics'))

    // Save (effect defaults to 'grant', capability to 'view')
    fireEvent.click(screen.getByRole('button', { name: /Save grant/i }))

    await waitFor(() => expect(setUserAccessGrant).toHaveBeenCalledTimes(1))
    expect(setUserAccessGrant).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', moduleKey: 'analytics', effect: 'grant', capability: 'view' }),
    )
  })
})
