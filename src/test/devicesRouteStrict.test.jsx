import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const h = vi.hoisted(() => ({ auth: {} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }))
vi.mock('../lib/api/customRoles', () => ({ isBuiltInRole: (r) => ['Admin', 'Manager', 'Director'].includes(r) }))
vi.mock('../lib/api/systemConfig', () => ({ configBool: () => false }))
import { RoleRoute } from '../components/ProtectedRoute'

const show = () => render(
  <MemoryRouter initialEntries={['/telematics-devices']}>
    <RoleRoute allowed={['Admin']} strict><div>Devices page</div></RoleRoute>
  </MemoryRouter>,
)

beforeEach(() => {
  h.auth = { loading: false, isSuperAdmin: false, hasPermission: () => true, moduleStatus: () => 'live',
    grantedModules: new Set(['telematics_devices']) }
})

describe('Devices & Integrations route is Admin / super admin only', () => {
  it.each(['Manager', 'Store Keeper', 'Data Monitor Officer'])('%s cannot open it even with a grant', (role) => {
    h.auth.profile = { role }
    show()
    expect(screen.queryByText('Devices page')).toBeNull()
  })
  it('Admin and super admin can', () => {
    h.auth.profile = { role: 'Admin' }
    show()
    expect(screen.getByText('Devices page')).toBeTruthy()
  })
  it('super admin with another role can', () => {
    h.auth.profile = { role: 'Manager' }
    h.auth.isSuperAdmin = true
    show()
    expect(screen.getByText('Devices page')).toBeTruthy()
  })
})
