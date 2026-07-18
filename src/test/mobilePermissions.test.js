/**
 * Mobile RBAC precedence, including the NEW role-level mobile matrix layer.
 *
 * The mobile app has no standalone unit-test runner (only `tsc --noEmit`), so
 * this exercises the REAL mobile module (mobile/lib/permissions.ts) under the web
 * vitest suite - the file is pure TypeScript (imports only ./types), so esbuild
 * transforms it cleanly.
 *
 * Precedence (highest first): super-admin > per-user grant revoke > per-user grant
 * grant > admin allow-all > role mobile matrix (true/false) > client role default.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveModuleAccess, moduleAllowedByRole, mobileRoleMatrixFromRaw,
} from '../../mobile/lib/permissions'

describe('resolveModuleAccess role matrix layer', () => {
  it('role matrix denies a module the role default allows (mobile only)', () => {
    // manager sees `records` by default...
    expect(moduleAllowedByRole('records', 'manager')).toBe(true)
    // ...but an explicit role mobile Deny hides it.
    expect(resolveModuleAccess('records', 'manager', null, false, { records: false })).toBe(false)
  })

  it('role matrix enables a module the role default denies', () => {
    // director does NOT get analytics by default...
    expect(moduleAllowedByRole('analytics', 'director')).toBe(false)
    // ...but an explicit role mobile Allow surfaces it.
    expect(resolveModuleAccess('analytics', 'director', null, false, { analytics: true })).toBe(true)
  })

  it('per-user grant beats the role matrix (grant over a matrix deny)', () => {
    expect(resolveModuleAccess('records', 'manager', { records: 'grant' }, false, { records: false })).toBe(true)
  })

  it('per-user revoke beats the role matrix (revoke over a matrix allow)', () => {
    expect(resolveModuleAccess('records', 'manager', { records: 'revoke' }, false, { records: true })).toBe(false)
  })

  it('fails OPEN: empty / undefined matrix falls back to the role default', () => {
    expect(resolveModuleAccess('records', 'manager', null, false, {})).toBe(true)
    expect(resolveModuleAccess('records', 'manager', null, false, undefined)).toBe(true)
    // and a role-denied module stays denied when the matrix is empty
    expect(resolveModuleAccess('analytics', 'director', null, false, {})).toBe(false)
  })

  it('admin and super-admin are always allowed even against a matrix deny', () => {
    expect(resolveModuleAccess('records', 'admin', null, false, { records: false })).toBe(true)
    expect(resolveModuleAccess('records', 'inspector', null, true, { records: false })).toBe(true)
  })

  it('back-compat: existing 4-arg callers behave exactly as before', () => {
    expect(resolveModuleAccess('records', 'manager', null, false)).toBe(true)
    expect(resolveModuleAccess('analytics', 'director', null, false)).toBe(false)
  })
})

describe('mobileRoleMatrixFromRaw', () => {
  it('keeps only mobile: keys, strips the prefix, and requires boolean values', () => {
    const raw = {
      analytics: true,                 // plain (web) row -> ignored
      'mobile:analytics': false,        // mobile deny
      'mobile:records': true,           // mobile allow
      'mobile:bogus': 'yes',            // non-boolean -> dropped
    }
    expect(mobileRoleMatrixFromRaw(raw)).toEqual({ analytics: false, records: true })
  })
  it('returns {} for null / undefined (fail-open)', () => {
    expect(mobileRoleMatrixFromRaw(null)).toEqual({})
    expect(mobileRoleMatrixFromRaw(undefined)).toEqual({})
  })
})
