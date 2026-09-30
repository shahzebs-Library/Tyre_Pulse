import { describe, it, expect } from 'vitest'
import { resolveAppVersion } from '../../vite.config.js'
import { sentryReleaseConfig } from '../lib/monitoring'

describe('resolveAppVersion (build-time VITE_APP_VERSION)', () => {
  it('joins package version and the Vercel sha, shortened to 7', () => {
    expect(resolveAppVersion({ env: { VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890' }, pkgVersion: '2.2.0' })).toBe('2.2.0+abcdef1')
  })
  it('falls back to a supplied git sha when Vercel is absent', () => {
    expect(resolveAppVersion({ env: {}, pkgVersion: '2.2.0', gitSha: '3bcfd28\n' })).toBe('2.2.0+3bcfd28')
  })
  it('is just the version when no sha is available (never throws)', () => {
    expect(resolveAppVersion({ env: {}, pkgVersion: '2.2.0', gitSha: '' })).toBe('2.2.0')
    expect(resolveAppVersion({ env: { VERCEL_GIT_COMMIT_SHA: 'not a sha!' }, pkgVersion: '2.2.0', gitSha: '' })).toBe('2.2.0')
  })
  it('an explicit VITE_APP_VERSION wins', () => {
    expect(resolveAppVersion({ env: { VITE_APP_VERSION: ' 9.9.9 ', VERCEL_GIT_COMMIT_SHA: 'abcdef1' }, pkgVersion: '2.2.0' })).toBe('9.9.9')
  })
  it('reads package.json and git by default without throwing', () => {
    const v = resolveAppVersion({ env: {} })
    expect(v).toMatch(/^\d+\.\d+\.\d+(\+[0-9a-f]{7})?$/)
  })
})

describe('sentryReleaseConfig', () => {
  it('uses the build version as release and the deploy tier as environment', () => {
    expect(sentryReleaseConfig({ VITE_APP_VERSION: '2.2.0+abcdef1', VITE_APP_ENV: 'production', MODE: 'production' }))
      .toEqual({ release: '2.2.0+abcdef1', environment: 'production' })
  })
  it('falls back to MODE and leaves release unset when no version is built in', () => {
    expect(sentryReleaseConfig({ VITE_APP_VERSION: '', MODE: 'development' }))
      .toEqual({ release: undefined, environment: 'development' })
  })
  it('the running build carries an injected version', () => {
    expect(import.meta.env.VITE_APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
