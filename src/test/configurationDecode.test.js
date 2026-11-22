import { describe, it, expect } from 'vitest'
import { decodeConfigValue, decodeConfigRows } from '../lib/configurationStore'

describe('decodeConfigValue', () => {
  it('peels a value saved twice-quoted (the live "SAR" bug)', () => {
    expect(decodeConfigValue('"\\"SAR\\""')).toBe('SAR')
    expect(decodeConfigValue('"\\"Green Concrete Company\\""')).toBe('Green Concrete Company')
  })
  it('reads a once-quoted and a plain string the same way', () => {
    expect(decodeConfigValue('"AED"')).toBe('AED')
    expect(decodeConfigValue('EGP')).toBe('EGP')
  })
  it('keeps numbers, booleans and objects', () => {
    expect(decodeConfigValue('"1200"')).toBe(1200)
    expect(decodeConfigValue('1200')).toBe(1200)
    expect(decodeConfigValue('true')).toBe(true)
    expect(decodeConfigValue('{"a":1}')).toEqual({ a: 1 })
  })
  it('leaves blanks and non-strings alone', () => {
    expect(decodeConfigValue('')).toBe('')
    expect(decodeConfigValue(null)).toBe(null)
  })
  it('maps rows by key', () => {
    expect(decodeConfigRows([{ key: 'currency', value: '"\\"SAR\\""' }, { key: 'x', value: '2' }])).toEqual({ currency: 'SAR', x: 2 })
  })
})

describe('decodeConfigRows text keys', () => {
  it('keeps a numeric-looking company name as text', () => {
    expect(decodeConfigRows([{ key: 'company_name', value: '"123"' }])).toEqual({ company_name: '123' })
  })
})
