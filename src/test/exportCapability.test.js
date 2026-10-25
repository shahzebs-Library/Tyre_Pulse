import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveExportAllowed, registerExportGate, canExportFrom, assertExportAllowed,
  ExportDeniedError, currentExportModule,
} from '../lib/exportCapability'

const base = { role: 'Manager', isSuperAdmin: false, moduleKey: 'tyre_records', capabilities: {}, roleCapabilities: {}, defaultView: true }

describe('resolveExportAllowed', () => {
  it('defaults to ALLOW so nobody loses export they have today', () => {
    expect(resolveExportAllowed(base)).toBe(true)
    // custom role / DB-view module: stored export=false is the matrix default, not a denial
    expect(resolveExportAllowed({ ...base, role: 'Fleet Supervisor', defaultView: false, roleCapabilities: { tyre_records: { export: false } } })).toBe(true)
  })
  it('Admin and super admin are never blocked, even with a revoke', () => {
    const capabilities = { tyre_records: { export: 'revoke' } }
    expect(resolveExportAllowed({ ...base, role: 'Admin', capabilities })).toBe(true)
    expect(resolveExportAllowed({ ...base, isSuperAdmin: true, capabilities })).toBe(true)
  })
  it('an explicit per-user revoke blocks; a different module is unaffected', () => {
    const capabilities = { tyre_records: { export: 'revoke' } }
    expect(resolveExportAllowed({ ...base, capabilities })).toBe(false)
    expect(resolveExportAllowed({ ...base, capabilities, moduleKey: 'accidents' })).toBe(true)
  })
  it('revoke beats role; grant beats a role-level off', () => {
    const off = { tyre_records: { export: false } }
    expect(resolveExportAllowed({ ...base, roleCapabilities: off })).toBe(false)
    expect(resolveExportAllowed({ ...base, roleCapabilities: off, capabilities: { tyre_records: { export: 'grant' } } })).toBe(true)
    expect(resolveExportAllowed({ ...base, roleCapabilities: { tyre_records: { export: true } }, capabilities: { tyre_records: { export: 'revoke' } } })).toBe(false)
  })
})

describe('export gate registry', () => {
  beforeEach(() => registerExportGate(null))
  it('fails open when no gate is registered (signed out / tests)', () => {
    expect(canExportFrom('tyre_records')).toBe(true)
    expect(assertExportAllowed('tyre_records')).toBe(true)
  })
  it('throws ExportDeniedError carrying the module when the gate refuses', () => {
    registerExportGate((k) => k !== 'accidents')
    expect(() => assertExportAllowed('accidents')).toThrow(ExportDeniedError)
    expect(assertExportAllowed('tyre_records')).toBe(true)
    try { assertExportAllowed('accidents') } catch (e) { expect(e.moduleKey).toBe('accidents') }
  })
  it('a throwing gate never blocks an export', () => {
    registerExportGate(() => { throw new Error('boom') })
    expect(canExportFrom('x')).toBe(true)
  })
  it('maps a route to its governing module the way the sidebar does', () => {
    expect(currentExportModule('/accidents')).toBeTruthy()
  })
})

describe('guardExport integration', () => {
  it('refuses and audits a revoked export, allows otherwise', async () => {
    vi.resetModules()
    const exp = vi.fn()
    vi.doMock('../lib/auditLogger', () => ({ audit: { export: exp } }))
    const cap = await import('../lib/exportCapability')
    const { applyExportPolicy } = await import('../lib/exportUtils')
    cap.registerExportGate(() => false)
    expect(() => applyExportPolicy([{ a: 1 }], 'Tyre list')).toThrow(/permission to export/)
    await new Promise((r) => setTimeout(r, 20))
    expect(exp).toHaveBeenCalledWith('Tyre list (denied)', expect.objectContaining({ denied: true, rows: 0 }))
    cap.registerExportGate(() => true)
    expect(applyExportPolicy([{ a: 1 }], 'Tyre list')).toEqual([{ a: 1 }])
    vi.doUnmock('../lib/auditLogger')
  })
})
