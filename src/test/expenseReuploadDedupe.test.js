import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/api/_client', () => ({ supabase: {}, isMissingRelation: () => false, toServiceError: (e) => e, isNotProvisioned: () => false }))
import { expenseLineKey, dropStoredDuplicates } from '../lib/api/partsConsumption'

const line = (o = {}) => ({ country: 'KSA', issue_number: 'GC/MIS/0638/1126', work_order_no: 'GCKR/JC/1/1126', item_code: '400100-O', txn_date: '09-11-2026', qty: '2', value_amount: '50', ...o })
const stored = (o = {}) => ({ country: 'KSA', issue_number: 'GC/MIS/0638/1126', work_order_no: 'GCKR/JC/1/1126', item_code: '400100-O', event_date: '2026-11-09', qty: '2.00', value_amount: '50.00', ...o })

describe('expense re-upload dedupe (no # column)', () => {
  it('file line and stored line share a key despite date and number formats', () => {
    expect(expenseLineKey(line())).toBe(expenseLineKey(stored()))
  })
  it('a re-uploaded file adds nothing', () => {
    const { keep, dropped } = dropStoredDuplicates([line(), line({ item_code: 'X' })], [stored(), stored({ item_code: 'X' })])
    expect(keep).toHaveLength(0)
    expect(dropped).toBe(2)
  })
  it('keeps genuine repeated lines beyond what is stored', () => {
    const { keep, dropped } = dropStoredDuplicates([line(), line(), line()], [stored()])
    expect(dropped).toBe(1)
    expect(keep).toHaveLength(2)
  })
  it('a different value or another country is new', () => {
    const { keep } = dropStoredDuplicates([line({ value_amount: '51' }), line({ country: 'UAE' })], [stored()])
    expect(keep).toHaveLength(2)
  })
  it('# is only a per-file counter: a re-upload with a shifted # is still dropped', () => {
    const { keep, dropped } = dropStoredDuplicates([line({ source_row: '7' })], [stored({ source_row: '412' })])
    expect(keep).toHaveLength(0)
    expect(dropped).toBe(1)
  })
  it('the same line from another store or cost centre is new', () => {
    const { keep } = dropStoredDuplicates(
      [line({ store_code: 'NHC-ST' }), line({ cost_center: 'CC2' })],
      [stored({ store_code: 'JED-ST' }), stored({ cost_center: 'CC1' })])
    expect(keep).toHaveLength(2)
  })
})
