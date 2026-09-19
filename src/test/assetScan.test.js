import { describe, it, expect } from 'vitest'
import { extractScanCode } from '../lib/assetScan'

describe('extractScanCode', () => {
  it('returns a bare code unchanged (trimmed)', () => {
    expect(extractScanCode('  TRK-001  ')).toBe('TRK-001')
  })

  it('returns empty string for blank/null/undefined input', () => {
    expect(extractScanCode('')).toBe('')
    expect(extractScanCode('   ')).toBe('')
    expect(extractScanCode(null)).toBe('')
    expect(extractScanCode(undefined)).toBe('')
  })

  it('extracts the asset code from a JSON payload', () => {
    expect(extractScanCode('{"asset_no":"TM514"}')).toBe('TM514')
    expect(extractScanCode('{"assetNo":"TM514"}')).toBe('TM514')
    expect(extractScanCode('{"fleet_number":"F-42"}')).toBe('F-42')
    expect(extractScanCode('{"serial":"S-9"}')).toBe('S-9')
    expect(extractScanCode('{"code":"C-1"}')).toBe('C-1')
  })

  it('falls back to the raw string when JSON has no recognised key', () => {
    const raw = '{"foo":"bar"}'
    expect(extractScanCode(raw)).toBe(raw)
  })

  it('falls back to the raw string on malformed JSON-looking input', () => {
    const raw = '{not valid json}'
    expect(extractScanCode(raw)).toBe(raw)
  })

  it('extracts the code from a URL query param', () => {
    expect(extractScanCode('https://app.tyrepulse.app/asset?asset=TM514')).toBe('TM514')
    expect(extractScanCode('https://app.tyrepulse.app/asset?asset_no=TM514')).toBe('TM514')
    expect(extractScanCode('https://app.tyrepulse.app/asset?code=TM514')).toBe('TM514')
  })

  it('extracts the code from a URL path segment when no known query param exists', () => {
    expect(extractScanCode('https://app.tyrepulse.app/asset/TM514')).toBe('TM514')
  })

  it('strips commas and parens (they break PostgREST filters)', () => {
    expect(extractScanCode('TM(514),X')).toBe('TM514X')
  })

  it('caps extremely long input at 64 characters', () => {
    const long = 'A'.repeat(100)
    expect(extractScanCode(long)).toHaveLength(64)
  })
})
