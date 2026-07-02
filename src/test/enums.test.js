import { describe, it, expect } from 'vitest'
import { transformRow, validateRow } from '../lib/import'
import { canonicalizeEnum, isInEnum, ENUM_DOMAINS } from '../lib/import/enums.js'

describe('import engine - controlled-vocabulary (CHECK) enums', () => {
  describe('canonicalizeEnum', () => {
    const WORK_TYPE = ENUM_DOMAINS.workorder.work_type
    it('snaps case-different values to the exact DB spelling', () => {
      expect(canonicalizeEnum('repair', WORK_TYPE)).toBe('Repair')
      expect(canonicalizeEnum('OPEN', ENUM_DOMAINS.workorder.status)).toBe('Open')
    })
    it('snaps separator-different values (space/underscore/hyphen)', () => {
      expect(canonicalizeEnum('Tyre_Change', WORK_TYPE)).toBe('Tyre Change')
      expect(canonicalizeEnum('pressure-check', WORK_TYPE)).toBe('Pressure Check')
      expect(canonicalizeEnum('TYRE FAILURE', ENUM_DOMAINS.accident.accident_type)).toBe('tyre_failure')
    })
    it('leaves genuinely-unknown values unchanged and blanks untouched', () => {
      expect(canonicalizeEnum('PUMPS', WORK_TYPE)).toBe('PUMPS')
      expect(canonicalizeEnum('', WORK_TYPE)).toBe('')
      expect(canonicalizeEnum(null, WORK_TYPE)).toBe(null)
    })
  })

  describe('isInEnum', () => {
    it('treats blank as valid (nullable column) and matches loosely', () => {
      expect(isInEnum('', ENUM_DOMAINS.workorder.status)).toBe(true)
      expect(isInEnum(null, ENUM_DOMAINS.workorder.status)).toBe(true)
      expect(isInEnum('in progress', ENUM_DOMAINS.workorder.status)).toBe(true)
      expect(isInEnum('PUMPS', ENUM_DOMAINS.workorder.work_type)).toBe(false)
    })
  })

  describe('transformRow canonicalises enum columns', () => {
    it('normalises a work_type mapped from a source header', () => {
      const { transformed } = transformRow(
        { 'Reason of Repair': 'tyre change' },
        [{ sourceHeader: 'Reason of Repair', target: 'work_type' }],
        { module: 'workorder' },
      )
      expect(transformed.work_type).toBe('Tyre Change')
    })
    it('leaves an out-of-domain value as-is for validation to catch', () => {
      const { transformed } = transformRow(
        { 'Asset Type': 'PUMPS' },
        [{ sourceHeader: 'Asset Type', target: 'work_type' }],
        { module: 'workorder' },
      )
      expect(transformed.work_type).toBe('PUMPS')
    })
  })

  describe('validateRow flags out-of-domain enum values as errors', () => {
    it('errors on an invalid work_type with the allowed list in the message', () => {
      const res = validateRow({ work_type: 'PUMPS' }, 'workorder')
      expect(res.status).toBe('error')
      const issue = res.issues.find((i) => i.code === 'ENUM_INVALID' && i.field === 'work_type')
      expect(issue).toBeTruthy()
      expect(issue.message).toContain('Tyre Change')
    })
    it('accepts a canonicalised value (post-transform) as ready', () => {
      const { transformed } = transformRow(
        { WT: 'repair', ST: 'open', PR: 'high' },
        [
          { sourceHeader: 'WT', target: 'work_type' },
          { sourceHeader: 'ST', target: 'status' },
          { sourceHeader: 'PR', target: 'priority' },
        ],
        { module: 'workorder' },
      )
      const res = validateRow(transformed, 'workorder')
      expect(res.issues.some((i) => i.code === 'ENUM_INVALID')).toBe(false)
    })
    it('does not flag a blank enum value', () => {
      const res = validateRow({ asset_no: 'A1', work_order_no: 'WO1' }, 'workorder')
      expect(res.issues.some((i) => i.code === 'ENUM_INVALID')).toBe(false)
    })
    it('applies the correct per-module domain for a shared column name (status)', () => {
      // fleet.status domain is Active/Inactive/... - "Open" (a work-order status) is invalid here.
      const res = validateRow({ status: 'Open' }, 'fleet')
      expect(res.issues.some((i) => i.code === 'ENUM_INVALID' && i.field === 'status')).toBe(true)
    })
  })
})
