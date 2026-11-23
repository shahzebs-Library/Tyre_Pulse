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

  it('keeps text settings that are valid JSON as the text typed', () => {
    const map = decodeConfigRows([
      { key: 'company_name', value: '"1.00"' },
      { key: 'currency', value: 'null' },
    ])
    expect(map.company_name).toBe('1.00')
    expect(map.currency).toBe('null')
  })

  it('still removes nested quoting from text settings', () => {
    expect(decodeConfigRows([{ key: 'currency', value: '"\\"SAR\\""' }]).currency).toBe('SAR')
    expect(decodeConfigRows([{ key: 'company_name', value: null }]).company_name).toBe('')
  })
})
