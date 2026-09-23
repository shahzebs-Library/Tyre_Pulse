import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const h = vi.hoisted(() => ({ auth: {} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: text => text }) }))
vi.mock('../lib/api/customRoles', () => ({ isBuiltInRole: () => true }))
vi.mock('../lib/api/systemConfig', () => ({ configBool: () => false }))
import { RoleRoute } from '../components/ProtectedRoute'
beforeEach(() => {
  h.auth = { profile: { role: 'Data Monitor Officer' }, loading: false, isSuperAdmin: false, hasPermission: key => key === 'serial_tracker', moduleStatus: () => 'live', grantedModules: new Set() }
})
const show = (path = '/serial-tracker', allowed = ['Admin']) => render(<MemoryRouter initialEntries={[path]}><RoleRoute allowed={allowed}><div>Module content</div></RoleRoute></MemoryRouter>)
describe('Data Monitor route permissions', () => {
  it('opens a module granted in Settings despite the legacy role list', () => {
    show()
    expect(screen.getByText('Module content')).toBeTruthy()
  })
  it('does not mount a revoked module even with a stale grant and role allow list', () => {
    h.auth.hasPermission = () => false
    h.auth.grantedModules.add('serial_tracker')
    show('/serial-tracker', ['Data Monitor Officer'])
    expect(screen.queryByText('Module content')).toBeNull()
    expect(screen.getByText('auth.accessRestrictedTitle')).toBeTruthy()
  })
  it.each(['maintenance', 'disabled'])('blocks %s modules before mounting their data loaders', status => {
    h.auth.moduleStatus = () => status
    show()
    expect(screen.queryByText('Module content')).toBeNull()
  })
  it('waits for permissions to load', () => {
    h.auth.loading = true
    show()
    expect(screen.queryByText('Module content')).toBeNull()
  })
  it('keeps report builders admin-only even when granted', () => {
    h.auth.hasPermission = () => true
    show('/report-builder')
    expect(screen.queryByText('Module content')).toBeNull()
  })
})
