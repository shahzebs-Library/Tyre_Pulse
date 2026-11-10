import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/api/_client', () => ({ supabase: {}, isMissingRelation: () => false, toServiceError: (e) => e, isNotProvisioned: () => false }))
import { expenseLineKey, chunkByLineKey } from '../lib/api/partsConsumption'

const line = (o = {}) => ({ country: 'KSA', issue_number: 'GC/MIS/0638/1126', work_order_no: 'GCKR/JC/1/1126', item_code: '400100-O', txn_date: '09-11-2026', qty: '2', value_amount: '50', ...o })
const stored = (o = {}) => ({ country: 'KSA', issue_number: 'GC/MIS/0638/1126', work_order_no: 'GCKR/JC/1/1126', item_code: '400100-O', event_date: '2026-11-09', qty: '2.00', value_amount: '50.00', ...o })

describe('expense re-upload dedupe (no # column)', () => {
  it('file line and stored line share a key despite date and number formats', () => {
    expect(expenseLineKey(line())).toBe(expenseLineKey(stored()))
  })
  it('# is only a per-file counter: it is not part of the line key', () => {
    expect(expenseLineKey(line({ source_row: '7' }))).toBe(expenseLineKey(stored({ source_row: '412' })))
  })
  it('a different value, country, store or cost centre is a different line', () => {
    const k = expenseLineKey(stored())
    for (const o of [{ value_amount: '51' }, { country: 'UAE' }, { store_code: 'NHC-ST' }, { cost_center: 'CC2' }]) {
      expect(expenseLineKey(line(o))).not.toBe(k)
    }
  })
  it('keeps every copy of a line in ONE chunk so the database guard counts them together', () => {
    const rows = [line(), line({ item_code: 'A' }), line({ item_code: 'B' }), line(), line({ item_code: 'C' }), line()]
    const chunks = chunkByLineKey(rows, 2)
    const holding = chunks.filter((c) => c.some((r) => r.item_code === '400100-O'))
    expect(holding).toHaveLength(1)
    expect(holding[0].filter((r) => r.item_code === '400100-O')).toHaveLength(3)
    expect(chunks.flat()).toHaveLength(rows.length)
  })
  it('respects the chunk size when groups are small', () => {
    const rows = Array.from({ length: 10 }, (_, i) => line({ item_code: `I${i}` }))
    expect(chunkByLineKey(rows, 4).map((c) => c.length)).toEqual([4, 4, 2])
  })
})
